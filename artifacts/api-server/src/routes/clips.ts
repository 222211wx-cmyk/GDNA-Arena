import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import multer from "multer";
import { pool } from "@workspace/db";
import type { File as GcsFile } from "@google-cloud/storage";
import { logger } from "../lib/logger";
import { clipsFeedPage, parseClipsFeedQuery } from "./clips-feed.js";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";
import { createClipsUploadsRouter } from "./clips-uploads.js";
import { ClipUploads } from "../lib/clip-uploads.js";
import { gcsUploadStore, clipUploadPublisher } from "../lib/clip-uploads-gcs.js";
import { clipByteRange } from "../lib/clip-byte-range.js";
import { runClipStorageCleanupBatch } from "../jobs/clip-storage-cleanup.js";

// ─── CLIPS — كليبسز (Reels-style, producer-owned) ────────────────────────────
// Owner's rules:
//  • Minimum duration 1 minute — shorter clips are REJECTED.
//  • No upper limit (even 25 hours).
//  • Only the owner of the work may publish: every file is sha256-fingerprinted
//    at upload; first owner wins (same rights system as the rest of the empire).
//  • Views earn coins via monetization_settings (content_type 'clip').
import { clipFile, retryThumbnailName } from "../lib/clip-storage.js";
import { publishClip, ClipUploadError } from "../lib/clip-publish.js";
import { CLIP_THUMBNAIL_MAX_ATTEMPTS } from "../jobs/clip-thumbnail-retry.js";

const router: IRouter = Router();
router.use(createClipsUploadsRouter(new ClipUploads(gcsUploadStore, clipUploadPublisher)));
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB per clip
const ALLOWED = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXT: Record<string, string> = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };

function requirePool() {
  if (!pool) throw new Error("Database not configured");
  return pool;
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
    if (!ALLOWED.has(file.mimetype)) { cb(new Error("UNSUPPORTED_TYPE")); return; }
    const filename = `clip_${crypto.randomUUID().replace(/-/g, "")}${EXT[file.mimetype]}`;
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
const upload = multer({ storage: clipStorage, limits: { fileSize: MAX_BYTES, files: 1 } });

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
router.get("/clips/feed", async (req, res): Promise<void> => {
  const feedQuery = parseClipsFeedQuery(req.query);
  if (!feedQuery.ok) {
    res.status(400).json({ error: `Invalid ${feedQuery.parameter}` });
    return;
  }

  try {
    const { before, limit } = feedQuery;
    const params = before === null ? [limit + 1] : [before, limit + 1];
    const { rows } = await requirePool().query(
      `SELECT id, user_id, username, title, content_type, duration_sec, views, created_at, thumbnail_object_name
       FROM clips WHERE is_frozen = FALSE AND object_name IS NOT NULL AND object_name <> '' ${before === null ? "" : "AND id < $1"}
       ORDER BY id DESC LIMIT $${params.length}`, params,
    );
    res.json(clipsFeedPage(rows.map(clipWithThumbnail), limit));
  } catch (e) { logger.error({ err: e }, "[clips] feed failed"); res.status(500).json({ error: "Failed" }); }
});

// Publishing is expensive (up to 2GB streamed to the bucket) — cap it hard.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6, // 6 publishes per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "بزاف ديال الكليبات فساعة وحدة — تسنى شوية وعاود" },
});

// ─── POST /clips — publish (owner-only via fingerprint, ≥1min, no maximum) ───
router.post("/clips", uploadLimiter, (req, res): void => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  upload.single("video")(req, res, async (err: unknown) => {
    const f = req.file as (Express.Multer.File & { sha256?: string }) | undefined;
    const cleanup = async () => {
      if (!f?.filename) return;
      // Also safe after a lost COMMIT acknowledgement: never remove a referenced object.
      const { rows } = await requirePool().query(`SELECT id FROM clips WHERE object_name=$1`, [f.filename]);
      if (!rows.length) await clipFile(f.filename).delete({ ignoreNotFound: true });
    };
    try {
      if (err) {
        const msg = (err as Error).message === "UNSUPPORTED_TYPE"
          ? "صيغة الفيديو غير مدعومة — MP4 / WebM / MOV فقط"
          : (err as { code?: string }).code === "LIMIT_FILE_SIZE" ? "الفيديو كبير بزاف — الحد 2GB" : "فشل الرفع";
        res.status(400).json({ error: msg }); return;
      }
      if (!f?.filename || !f.sha256) { res.status(400).json({ error: "الفيديو مطلوب" }); return; }
      const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
      if (!title) throw new ClipUploadError(400, "العنوان مطلوب");
      const clip = await publishClip({
        userId, filename: f.filename, title, contentType: f.mimetype,
        size: f.size, sha256: f.sha256,
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
      user_id: number; object_name: string; thumbnail_object_name: string | null;
    }>(
      `SELECT user_id, object_name, thumbnail_object_name
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
      clip.thumbnail_object_name,
      retryThumbnailName(id, clip.object_name),
    ].filter((name): name is string => Boolean(name)))];
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
      const extension = clip.content_type === "video/webm" ? "webm" : clip.content_type === "video/quicktime" ? "mov" : "mp4";
      res.setHeader("Content-Disposition", `attachment; filename="clip-${id}.${extension}"`);
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
