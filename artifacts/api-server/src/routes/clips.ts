import { Router, type IRouter } from "express";
import crypto from "crypto";
import multer from "multer";
import { pool } from "@workspace/db";
import type { File as GcsFile } from "@google-cloud/storage";
import { logger } from "../lib/logger";
import { createClipsFeedHandler } from "./clips-feed.js";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";
import { createClipsUploadsRouter } from "./clips-uploads.js";
import { createClipPlaybackRouter, publicAvatarUrl } from "./clip-playback.js";
import { signClipPlayback } from "../lib/clip-playback.js";
import { ClipUploads } from "../lib/clip-uploads.js";
import { gcsUploadStore, clipUploadPublisher } from "../lib/clip-uploads-gcs.js";
import { clipByteRange } from "../lib/clip-byte-range.js";
import { runClipStorageCleanupBatch } from "../jobs/clip-storage-cleanup.js";
import { clipCompressionLock } from "../jobs/clip-compression.js";
import { createSimpleClipUploadRouter } from "./clip-simple-upload.js";
import {
  CLIP_EXT, MAX_NEW_CLIP_BYTES, NEW_CLIP_TOO_LARGE, resolveClipUploadType, clipDownloadExtension,
} from "../lib/clip-upload-protocol.js";
import { validateContent } from "../lib/moderate.js";

// ─── CLIPS — كليبسز (Reels-style stories and original declarations) ──────────
// Publishing rules:
//  • Minimum duration 1 minute — shorter clips are REJECTED.
//  • No upper limit (even 25 hours).
//  • SHA-256 detects exact bytes only. Original declarations additionally protect
//    registered full-duration visuals; they are declarations, not legal findings.
//  • Views earn coins via monetization_settings (content_type 'clip').
import { clipFile, retryThumbnailName } from "../lib/clip-storage.js";
import { publishClip, ClipUploadError } from "../lib/clip-publish.js";
import { CLIP_THUMBNAIL_MAX_ATTEMPTS } from "../jobs/clip-thumbnail-retry.js";

const router: IRouter = Router();
router.use(createClipPlaybackRouter({
  async find(code, viewerId) {
    const { rows } = await pool.query(
      `SELECT c.id,c.code,c.title,c.original_name,c.duration_sec,c.size_bytes,c.created_at,c.content_type,
              c.processing_status,c.object_name,c.user_id,c.username,
              (SELECT COUNT(*) FROM clip_likes l WHERE l.clip_id=c.id) AS like_count,
              (SELECT COUNT(*) FROM clip_comments m WHERE m.clip_id=c.id) AS comment_count,
              (SELECT COUNT(*) FROM clip_bookmarks b WHERE b.clip_id=c.id) AS save_count,
              (SELECT COUNT(*) FROM clip_shares s WHERE s.clip_id=c.id) AS share_count,
              EXISTS(SELECT 1 FROM clip_likes l WHERE l.clip_id=c.id AND l.user_id=$2) AS liked_by_viewer,
              EXISTS(SELECT 1 FROM clip_bookmarks b WHERE b.clip_id=c.id AND b.user_id=$2) AS saved_by_viewer,
              COALESCE(NULLIF(to_jsonb(u)->>'avatar_url',''), NULLIF(to_jsonb(u)->>'avatar','')) AS avatar_url
       FROM clips c JOIN users u ON u.id=c.user_id
       WHERE c.code=$1 AND c.is_frozen=FALSE`,
      [code, viewerId],
    );
    return rows[0] ? { ...rows[0], avatar_url: publicAvatarUrl(rows[0].avatar_url) } : null;
  },
  sign: signClipPlayback,
  log: error => logger.warn({ err: error }, "[clips] playback metadata unavailable"),
}));
router.use(createClipsUploadsRouter(new ClipUploads(gcsUploadStore, clipUploadPublisher)));
router.use(createSimpleClipUploadRouter({
  file: clipFile,
  publish: input => publishClip({ ...input, deferThumbnail: true }),
  log: (err, message) => logger.warn({ err }, `[clips] ${message}`),
  async cleanup(name) {
    // Preserve a committed original when a COMMIT acknowledgement was lost.
    const { rows } = await requirePool().query(`SELECT id FROM clips WHERE object_name=$1 OR upload_object_name=$1 OR processing_output_object=$1`, [name]);
    if (rows.length) return;
    // Persist a delayed sweep before best-effort deletion. This also catches an
    // SDK request that finishes late after the aborted stream has been destroyed.
    await requirePool().query(
      `INSERT INTO clip_storage_cleanup (object_name, clip_id, retry_at)
       VALUES ($1, 0, NOW() + INTERVAL '5 minutes') ON CONFLICT (object_name) DO NOTHING`, [name],
    );
    await clipFile(name).delete({ ignoreNotFound: true });
  },
}));

function requirePool() {
  if (!pool) throw new Error("Database not configured");
  return pool;
}

async function acquireFeedClient(signal?: AbortSignal) {
  const db = requirePool();
  if (signal?.aborted) throw new Error("Clips feed deadline exceeded");
  // Never join an existing checkout queue: the public endpoint degrades instead
  // of consuming its entire latency budget waiting behind private work.
  const maximum = Number((db as typeof db & { options?: { max?: number } }).options?.max) || 10;
  if (db.waitingCount > 0 || (db.idleCount === 0 && db.totalCount >= maximum)) {
    throw new Error("Clips feed database pool is saturated");
  }
  const pending = db.connect();
  if (!signal) return pending;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Clips feed deadline exceeded"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } catch (error) {
    if (signal.aborted) {
      // A checkout already dispatched by pg cannot be cancelled. If it resolves
      // after the response deadline, release it without issuing BEGIN or SQL.
      void pending.then(client => client.release(), () => {});
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function ensureClipsTables(): Promise<void> {
  try {
    await requirePool().query(`
      CREATE TABLE IF NOT EXISTS clips (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        object_name TEXT NOT NULL,
        thumbnail_object_name TEXT,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        duration_sec INTEGER NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        earnings NUMERIC(14,4) NOT NULL DEFAULT 0,
        is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE clips ADD COLUMN IF NOT EXISTS thumbnail_object_name TEXT;
      ALTER TABLE clips ADD COLUMN IF NOT EXISTS thumbnail_retry_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE clips ADD COLUMN IF NOT EXISTS thumbnail_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS clips_thumbnail_retry_due_idx
        ON clips (thumbnail_retry_at, id)
        WHERE thumbnail_object_name IS NULL AND is_frozen = FALSE
          AND thumbnail_retry_attempts < ${CLIP_THUMBNAIL_MAX_ATTEMPTS};
      CREATE TABLE IF NOT EXISTS clip_views (
        clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        viewer_ip TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (clip_id, viewer_ip)
      );
      CREATE TABLE IF NOT EXISTS clip_likes (
        clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (clip_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS clip_comments (
        id SERIAL PRIMARY KEY,
        clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS clip_comments_clip_created_idx
        ON clip_comments (clip_id, created_at, id);
      -- No foreign key: cleanup must survive deletion of the clip and its owner.
      CREATE TABLE IF NOT EXISTS clip_storage_cleanup (
        object_name TEXT PRIMARY KEY,
        clip_id INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS clip_storage_cleanup_due_idx
        ON clip_storage_cleanup (retry_at, object_name);
      CREATE TABLE IF NOT EXISTS r2_clip_uploads (
        id UUID PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id UUID NOT NULL,
        object_name TEXT NOT NULL UNIQUE,
        multipart_upload_id TEXT NOT NULL,
        original_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= ${MAX_NEW_CLIP_BYTES}),
        duration_sec DOUBLE PRECISION NOT NULL CHECK (duration_sec >= 0),
        state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','completing','published','aborted')),
        clip_id INTEGER REFERENCES clips(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS r2_clip_uploads_expiry_idx
        ON r2_clip_uploads (expires_at) WHERE state IN ('active','completing');
      INSERT INTO monetization_settings (content_type, rate, unit)
        VALUES ('clip', 0.01, 'view') ON CONFLICT (content_type) DO NOTHING;
    `);
    logger.info("[clips] tables ready");
  } catch (e) {
    logger.error({ err: e }, "[clips] table setup failed");
  }
}

// Multer engine: stream straight to GCS while computing sha256 — no local disk,
// no memory buffering; the fingerprint is ready the moment the upload finishes.
const clipStorage: import("multer").StorageEngine = {
  _handleFile(_req, file, cb) {
    const normalizedType = resolveClipUploadType(file.mimetype, file.originalname);
    if (!normalizedType) { cb(new Error("UNSUPPORTED_TYPE")); return; }
    file.mimetype = normalizedType;
    const filename = `clip_${crypto.randomUUID().replace(/-/g, "")}${CLIP_EXT[file.mimetype] ?? ".bin"}`;
    let gcs: GcsFile;
    try { gcs = clipFile(filename); } catch (e) { cb(e as Error); return; }
    const hash = crypto.createHash("sha256");
    let size = 0;
    let done = false; // once-only completion — never call cb twice
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      file.stream.unpipe(ws);
      file.stream.resume(); // drain remaining input so the request can finish
      ws.destroy();
      // Delete any partial object directly — multer only calls _removeFile when
      // a filename was reported, which never happens on the failure path.
      gcs.delete({ ignoreNotFound: true }).catch(() => {});
      cb(e);
    };
    file.stream.on("data", (chunk: Buffer) => { hash.update(chunk); size += chunk.length; });
    const ws = gcs.createWriteStream({ resumable: false, metadata: { contentType: file.mimetype } });
    ws.on("error", fail);
    ws.on("finish", () => {
      if (done) return;
      done = true;
      cb(null, { filename, size, sha256: hash.digest("hex") } as any);
    });
    file.stream.on("error", fail);
    file.stream.on("aborted", () => fail(new Error("UPLOAD_ABORTED")));
    file.stream.pipe(ws);
  },
  _removeFile(_req, file, cb) {
    if (!file.filename) { cb(null); return; }
    clipFile(file.filename).delete({ ignoreNotFound: true }).then(() => cb(null), (e) => cb(e));
  },
};
const upload = multer({ storage: clipStorage, limits: { files: 1, fileSize: MAX_NEW_CLIP_BYTES } });

function requireAuth(req: any, res: any): number | null {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "يجب تسجيل الدخول" }); return null; }
  return userId;
}

function parseClipId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function isAdmin(userId: number): Promise<boolean> {
  const { rows } = await requirePool().query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id=$1`, [userId],
  );
  return rows[0]?.is_admin === true;
}

// ─── GET /clips/feed — Reels feed, newest first ──────────────────────────────
router.get("/clips/feed", createClipsFeedHandler({
  async loadRows(before, limit, signal, q = "", viewerId = null) {
    const client = await acquireFeedClient(signal);
    try {
      // The handler deadline may fire while waiting for a saturated pool. In that
      // case release immediately and never start a query after the response.
      if (signal?.aborted) throw new Error("Clips feed deadline exceeded");
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '750ms'");
      await client.query("SET LOCAL lock_timeout = '250ms'");
      const escapedSearch = q.replace(/[\\%_]/g, character => `\\${character}`);
      const params = [viewerId, `%${escapedSearch}%`, before, limit + 1];
      const { rows } = await client.query(
        `SELECT c.id, c.user_id, c.username, c.title, c.content_type, c.duration_sec, c.code, c.processing_status,
                c.views, c.created_at, c.thumbnail_object_name,
                json_build_object(
                  'id', c.user_id,
                  'username', c.username,
                  'avatarUrl', COALESCE(NULLIF(to_jsonb(u)->>'avatar_url',''), NULLIF(to_jsonb(u)->>'avatar',''))
                ) AS author,
                (SELECT COUNT(*) FROM clip_bookmarks b WHERE b.clip_id=c.id)::int AS "saveCount",
                (SELECT COUNT(*) FROM clip_shares s WHERE s.clip_id=c.id)::int AS "shareCount",
                EXISTS(SELECT 1 FROM clip_bookmarks b WHERE b.clip_id=c.id AND b.user_id=$1) AS saved
         FROM clips c JOIN users u ON u.id=c.user_id
         WHERE c.is_frozen = FALSE AND c.object_name IS NOT NULL AND c.object_name <> ''
           AND ($2::text = '%%' OR c.title ILIKE $2 ESCAPE '\'
             OR c.code ILIKE $2 ESCAPE '\' OR c.username ILIKE $2 ESCAPE '\')
           AND ($3::integer IS NULL OR c.id < $3)
         ORDER BY c.id DESC LIMIT $4`, params,
      );
      await client.query("COMMIT");
      return rows.map(row => ({
        ...row,
        author: {
          ...row.author,
          avatarUrl: publicAvatarUrl(row.author?.avatarUrl),
        },
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
  logFailure: err => logger.error({ err }, "[clips] feed failed"),
}));

// ─── POST /clips — compatibility publication (actual media ≥1min, no maximum) ───
router.post("/clips", (req, res): void => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  upload.single("video")(req, res, async (err: unknown) => {
    const f = req.file as (Express.Multer.File & { sha256?: string }) | undefined;
    const cleanup = async () => {
      if (!f?.filename) return;
      // Also safe after a lost COMMIT acknowledgement: never remove a referenced object.
       const { rows } = await requirePool().query(`SELECT id FROM clips WHERE object_name=$1 OR upload_object_name=$1 OR processing_output_object=$1`, [f.filename]);
      if (!rows.length) await clipFile(f.filename).delete({ ignoreNotFound: true });
    };
    try {
      if (err) {
        const msg = (err as Error).message === "UNSUPPORTED_TYPE"
          ? "صيغة الصوت أو الفيديو غير مدعومة"
          : (err as { code?: string }).code === "LIMIT_FILE_SIZE" ? NEW_CLIP_TOO_LARGE : "فشل الرفع";
        res.status((err as { code?: string }).code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg }); return;
      }
      if (!f?.filename || !f.sha256) { res.status(400).json({ error: "الفيديو مطلوب" }); return; }
      const title = f.originalname;
      const clip = await publishClip({
        userId, filename: f.filename, title, contentType: f.mimetype,
        size: f.size, sha256: f.sha256,
        purpose: req.body?.purpose, originalReference: req.body?.originalReference,
        rightsHolderName: req.body?.rightsHolderName, rightsHolderRole: req.body?.rightsHolderRole,
        isOriginalFootage: req.body?.isOriginalFootage,
      });
      res.json({ clip });
    } catch (e) {
      await cleanup().catch(error => logger.warn({ err: error }, "[clips] upload cleanup deferred"));
      logger.error({ err: e }, "[clips] publish failed");
      res.status(e instanceof ClipUploadError ? e.status : 500).json({
        error: e instanceof ClipUploadError ? e.message : "Failed",
      });
    }
  });
});

// ─── PATCH /clips/:id — owner may retitle their own clip ──────────────────────
router.patch("/clips/:id", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
  if (!title) { res.status(400).json({ error: "العنوان مطلوب" }); return; }

  try {
    // Ownership is checked in the UPDATE predicate so a stale feed can never
    // retitle another citizen's clip.
    const { rows } = await requirePool().query(
      `UPDATE clips SET title=$2 WHERE id=$1 AND user_id=$3
       RETURNING id, user_id, username, title, content_type, duration_sec, views, created_at, thumbnail_object_name`,
      [id, title, userId],
    );
    if (!rows[0]) {
      const exists = await requirePool().query(`SELECT id FROM clips WHERE id=$1`, [id]);
      res.status(exists.rows[0] ? 403 : 404).json({
        error: exists.rows[0] ? "لا يمكنك تعديل كليب مواطن آخر" : "الكليب غير موجود",
      });
      return;
    }
    res.json({ clip: clipWithThumbnail(rows[0]) });
  } catch (e) {
    logger.error({ err: e, clipId: id, userId }, "[clips] title update failed");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/clips/:id/engagement", async (req, res): Promise<void> => {
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const viewerId = (req.session as { userId?: number } | undefined)?.userId ?? null;
  const { rows } = await requirePool().query(
    `SELECT c.id,c.user_id,c.username,c.title,c.code,
            (SELECT COUNT(*) FROM clip_likes l WHERE l.clip_id=c.id)::text AS like_count,
            (SELECT COUNT(*) FROM clip_comments m WHERE m.clip_id=c.id)::text AS comment_count,
             (SELECT COUNT(*) FROM clip_bookmarks b WHERE b.clip_id=c.id)::text AS save_count,
             (SELECT COUNT(*) FROM clip_shares s WHERE s.clip_id=c.id)::text AS share_count,
             EXISTS(SELECT 1 FROM clip_likes l WHERE l.clip_id=c.id AND l.user_id=$2) AS liked,
             EXISTS(SELECT 1 FROM clip_bookmarks b WHERE b.clip_id=c.id AND b.user_id=$2) AS saved,
             COALESCE(NULLIF(to_jsonb(u)->>'avatar_url',''), NULLIF(to_jsonb(u)->>'avatar','')) AS avatar_url
      FROM clips c JOIN users u ON u.id=c.user_id
      WHERE c.id=$1 AND c.is_frozen=FALSE`, [id, viewerId],
  );
  const row = rows[0];
  if (!row) { res.status(404).json({ error: "Clip not found" }); return; }
  res.json({
    engagement: {
      id: row.id,
      title: row.title,
      code: row.code,
      author: { id: row.user_id, username: row.username, avatarUrl: publicAvatarUrl(row.avatar_url) },
      isOwner: viewerId === row.user_id,
      liked: row.liked,
      likeCount: Number(row.like_count),
      commentCount: Number(row.comment_count),
      saved: row.saved,
      saveCount: Number(row.save_count),
      shareCount: Number(row.share_count),
    },
  });
});

// ─── POST /clips/:id/like — one persisted heart per citizen ──────────────────
router.post("/clips/:id/like", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");
    const visible = await client.query(`SELECT id FROM clips WHERE id=$1 AND is_frozen=FALSE FOR UPDATE`, [id]);
    if (!visible.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO clip_likes (clip_id,user_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING clip_id`, [id, userId],
    );
    const liked = Boolean(inserted.rows[0]);
    if (!liked) await client.query(`DELETE FROM clip_likes WHERE clip_id=$1 AND user_id=$2`, [id, userId]);
    const count = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM clip_likes WHERE clip_id=$1`, [id]);
    await client.query("COMMIT");
    res.json({ liked, likeCount: Number(count.rows[0]?.count ?? 0) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: error, clipId: id, userId }, "[clips] like failed");
    res.status(500).json({ error: "Failed to update like" });
  } finally {
    client.release();
  }
});

// ─── POST /clips/:id/save — persisted bookmark toggle per citizen ─────────────
router.post("/clips/:id/save", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");
    const visible = await client.query(`SELECT id FROM clips WHERE id=$1 AND is_frozen=FALSE FOR UPDATE`, [id]);
    if (!visible.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO clip_bookmarks (clip_id,user_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING clip_id`, [id, userId],
    );
    const saved = Boolean(inserted.rows[0]);
    if (!saved) await client.query(`DELETE FROM clip_bookmarks WHERE clip_id=$1 AND user_id=$2`, [id, userId]);
    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM clip_bookmarks WHERE clip_id=$1`, [id],
    );
    await client.query("COMMIT");
    res.json({ saved, saveCount: Number(count.rows[0]?.count ?? 0) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: error, clipId: id, userId }, "[clips] save failed");
    res.status(500).json({ error: "Failed to update save" });
  } finally {
    client.release();
  }
});

// ─── POST /clips/:id/share — one count per citizen, retry-safe ────────────────
router.post("/clips/:id/share", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");
    const visible = await client.query(`SELECT id FROM clips WHERE id=$1 AND is_frozen=FALSE FOR UPDATE`, [id]);
    if (!visible.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    await client.query(
      `INSERT INTO clip_shares (clip_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, userId],
    );
    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM clip_shares WHERE clip_id=$1`, [id],
    );
    await client.query("COMMIT");
    res.json({ shared: true, shareCount: Number(count.rows[0]?.count ?? 0) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: error, clipId: id, userId }, "[clips] share failed");
    res.status(500).json({ error: "Failed to record share" });
  } finally {
    client.release();
  }
});

// ─── GET/POST /clips/:id/comments — public list, authenticated creation ──────
router.get("/clips/:id/comments", async (req, res): Promise<void> => {
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const visible = await requirePool().query(`SELECT id FROM clips WHERE id=$1 AND is_frozen=FALSE`, [id]);
  if (!visible.rows[0]) { res.status(404).json({ error: "Clip not found" }); return; }
  const { rows } = await requirePool().query(
    `SELECT recent.id,recent.content,recent.created_at,recent.user_id,u.username
     FROM (
       SELECT id,content,created_at,user_id FROM clip_comments
       WHERE clip_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100
     ) recent
     JOIN users u ON u.id=recent.user_id
     ORDER BY recent.created_at ASC,recent.id ASC`, [id],
  );
  res.json({ comments: rows });
});

router.post("/clips/:id/comments", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content || content.length > 500) {
    res.status(400).json({ error: "Comment must be between 1 and 500 characters" });
    return;
  }
  const moderation = await validateContent(content, { allowTrivial: true });
  if (!moderation.ok) { res.status(400).json({ error: moderation.reason }); return; }
  const { rows } = await requirePool().query(
    `INSERT INTO clip_comments (clip_id,user_id,content)
     SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM clips WHERE id=$1 AND is_frozen=FALSE)
     RETURNING id,content,created_at,user_id`, [id, userId, content],
  );
  if (!rows[0]) { res.status(404).json({ error: "Clip not found" }); return; }
  const user = await requirePool().query<{ username: string }>(`SELECT username FROM users WHERE id=$1`, [userId]);
  res.status(201).json({ comment: { ...rows[0], username: user.rows[0]?.username } });
});

// ─── DELETE /clips/:id — owner or admin removes the clip permanently ──────────
router.delete("/clips/:id", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseClipId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const client = await requirePool().connect();
  let committed = false;
  let released = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      user_id: number; object_name: string; upload_object_name: string | null; thumbnail_object_name: string | null; processing_output_object: string | null;
    }>(
      `SELECT user_id, object_name, upload_object_name, thumbnail_object_name, processing_output_object
       FROM clips WHERE id=$1 FOR UPDATE`, [id],
    );
    const clip = rows[0];
    if (!clip) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "الكليب غير موجود" });
      return;
    }
    if (clip.user_id !== userId) {
      const { rows: users } = await client.query<{ is_admin: boolean }>(
        `SELECT is_admin FROM users WHERE id=$1`, [userId],
      );
      if (users[0]?.is_admin !== true) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "لا يمكنك حذف كليب مواطن آخر" });
        return;
      }
    }
    const storageNames = [...new Set([
      clip.object_name,
      clip.upload_object_name,
      clip.thumbnail_object_name,
      clip.processing_output_object,
      retryThumbnailName(id, clip.object_name),
    ].filter((name): name is string => Boolean(name)))];
    const encoding = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired", [clipCompressionLock(id)],
    );
    if (encoding.rows[0]?.acquired !== true) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Compression is active; retry deletion after processing finishes" });
      return;
    }
    // Transactional outbox: never commit a deletion without its cleanup work.
    // If COMMIT's response is lost, only committed queue rows can touch storage.
    await client.query(
      `INSERT INTO clip_storage_cleanup (object_name, clip_id)
       SELECT name, $1 FROM unnest($2::text[]) AS name
       ON CONFLICT (object_name) DO NOTHING`, [id, storageNames],
    );
    await client.query(`DELETE FROM clip_views WHERE clip_id=$1`, [id]);
    const deleted = await client.query(`DELETE FROM clips WHERE id=$1 RETURNING id`, [id]);
    if (!deleted.rows[0]) throw new Error("CLIP_DELETE_RACE");
    // Permanent first-owner rights survive removal of the clip and its objects.
    await client.query("COMMIT");
    committed = true;
    // Do not retain a transaction connection while cleanup acquires its own:
    // concurrent DELETE requests must not exhaust the pool waiting on themselves.
    client.release();
    released = true;

    try {
      await runClipStorageCleanupBatch(id);
    } catch (error) {
      // The clip is gone and cleanup is durable, even if the immediate DB
      // claim/acknowledgement fails. Do not report a committed deletion as failed.
      logger.warn({ err: error, clipId: id }, "[clips] delete cleanup deferred");
    }
    res.status(204).end();
  } catch (e) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: e, clipId: id, userId }, "[clips] delete failed");
    res.status(500).json({ error: "تعذر حذف الكليب، عاود المحاولة" });
  } finally {
    if (!released) client.release();
  }
});

// Scoped to a visible clip, not an arbitrary storage path.
router.get("/clips/thumbnail/:id", async (req, res): Promise<void> => {
  try {
    const id = parseClipId(req.params.id);
    if (!id) { res.status(400).end(); return; }
    const { rows } = await requirePool().query(
      `SELECT thumbnail_object_name FROM clips WHERE id=$1 AND is_frozen=FALSE`, [id],
    );
    const name = rows[0]?.thumbnail_object_name;
    if (!name) { res.status(404).end(); return; }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const stream = clipFile(name).createReadStream();
    res.on("close", () => stream.destroy());
    stream.on("error", (error: { code?: number | string }) => {
      logger.error({ err: error, clipId: id }, "[clips] thumbnail storage read failed");
      if (res.headersSent) res.destroy();
      else res.status(Number(error.code) === 404 ? 404 : 500).end();
    }).pipe(res);
  } catch (e) { logger.error({ err: e }, "[clips] thumbnail failed"); if (!res.headersSent) res.status(500).end(); }
});

// ─── GET/HEAD /clips/stream/:id — scoped video streaming with byte ranges ─────
router.get("/clips/stream/:id", async (req, res): Promise<void> => {
  try {
    const id = parseClipId(req.params.id);
    if (!id) { res.status(400).end(); return; }
    const { rows } = await requirePool().query(
      `SELECT object_name, content_type, size_bytes, is_frozen FROM clips WHERE id=$1`, [id],
    );
    const clip = rows[0];
    if (!clip || clip.is_frozen || !clip.object_name) { res.status(404).end(); return; }
    const file = clipFile(clip.object_name);
    let size = Number(clip.size_bytes);
    if (!Number.isSafeInteger(size) || size <= 0) { const [meta] = await file.getMetadata(); size = Number(meta.size); }
    if (!Number.isSafeInteger(size) || size <= 0) { res.status(404).end(); return; }
    res.setHeader("Content-Type", clip.content_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const etag = `"clip-${id}-${size}"`;
    res.setHeader("ETag", etag);
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="clip-${id}${clipDownloadExtension(clip.content_type)}"`);
    }
    const range = req.headers.range;
    let bytes: { start: number; end: number } | undefined;
    if (range && (!req.headers["if-range"] || req.headers["if-range"] === etag)) {
      const parsed = clipByteRange(range, size);
      if (!parsed) { res.status(416).setHeader("Content-Range", `bytes */${size}`).end(); return; }
      bytes = parsed;
      const { start, end } = bytes;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
    } else {
      res.setHeader("Content-Length", size);
    }
    if (req.method === "HEAD") { res.end(); return; }
    const stream = file.createReadStream(bytes);
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy()).pipe(res);
  } catch (e) { logger.error({ err: e }, "[clips] stream failed"); if (!res.headersSent) res.status(500).end(); }
});

// ─── POST /clips/:id/view — count a view + mint owner earnings ───────────────
router.post("/clips/:id/view", async (req, res): Promise<void> => {
  try {
    const id = parseClipId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    // Viewer identity = proxy-derived req.ip (trust proxy 1) — NEVER the raw
    // X-Forwarded-For header, which any client can forge to mint earnings.
    const ip = req.ip ?? "?";
    // Dedupe + mint atomically: the dedupe row only commits if the earnings
    // update actually applied to an active (unfrozen) clip.
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO clip_views (clip_id, viewer_ip) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING clip_id`, [id, ip]);
      if (ins.rows[0]) {
        const upd = await client.query(
          `UPDATE clips SET views = views + 1,
             earnings = earnings + COALESCE((SELECT rate FROM monetization_settings WHERE content_type='clip'), 0)
           WHERE id=$1 AND is_frozen = FALSE`, [id]);
        if (upd.rowCount === 0) { await client.query("ROLLBACK"); res.status(404).json({ error: "Clip not found" }); return; }
      }
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* noop */ }
      if ((e as { code?: string }).code === "23503") { res.status(404).json({ error: "Clip not found" }); return; }
      throw e;
    } finally { client.release(); }
    const { rows } = await requirePool().query(`SELECT views FROM clips WHERE id=$1`, [id]);
    res.json({ views: rows[0]?.views ?? 0 });
  } catch (e) { logger.error({ err: e }, "[clips] view failed"); res.status(500).json({ error: "Failed" }); }
});

export default router;
