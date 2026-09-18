import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import multer from "multer";
import { pool } from "@workspace/db";
import { objectStorageClient } from "../lib/chatStorage";
import type { File as GcsFile } from "@google-cloud/storage";
import { logger } from "../lib/logger";
import { spawn } from "node:child_process";
import { clipsFeedPage, parseClipsFeedQuery } from "./clips-feed.js";
import { generateClipThumbnail } from "../lib/clip-thumbnail.js";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";

// ─── CLIPS — كليبسز (Reels-style, producer-owned) ────────────────────────────
// Owner's rules:
//  • Minimum duration 1 minute — shorter clips are REJECTED.
//  • No upper limit (even 25 hours).
//  • Only the owner of the work may publish: every file is sha256-fingerprinted
//    at upload; first owner wins (same rights system as the rest of the empire).
//  • Views earn coins via monetization_settings (content_type 'clip').

const router: IRouter = Router();
const MIN_DURATION_SEC = 60; // owner rule: 1 minute minimum — NO maximum (any chrono above 1 min)
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
      CREATE TABLE IF NOT EXISTS clip_views (
        clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        viewer_ip TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (clip_id, viewer_ip)
      );
      INSERT INTO monetization_settings (content_type, rate, unit)
        VALUES ('clip', 0.01, 'view') ON CONFLICT (content_type) DO NOTHING;
    `);
    logger.info("[clips] tables ready");
  } catch (e) {
    logger.error({ err: e }, "[clips] table setup failed");
  }
}

function clipFile(name: string): GcsFile {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const full = `${dir.replace(/\/$/, "")}/clips/${name}`;
  const parts = (full.startsWith("/") ? full : `/${full}`).split("/");
  return objectStorageClient.bucket(parts[1]).file(parts.slice(2).join("/"));
}

async function verifiedDuration(file: GcsFile): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "pipe:0"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "";
    const timer = setTimeout(() => { probe.kill("SIGKILL"); reject(new Error("MEDIA_PROBE_TIMEOUT")); }, 30_000);
    probe.stdout.on("data", chunk => { output += String(chunk); });
    probe.stderr.on("data", chunk => { errors += String(chunk); });
    probe.on("error", error => { clearTimeout(timer); reject(error); });
    probe.on("close", code => {
      clearTimeout(timer);
      const duration = Number.parseFloat(output.trim());
      if (code !== 0 || !Number.isFinite(duration)) reject(new Error(errors || "INVALID_MEDIA_DURATION"));
      else resolve(duration);
    });
    file.createReadStream().on("error", error => probe.stdin.destroy(error)).pipe(probe.stdin);
  });
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
       FROM clips WHERE is_frozen = FALSE ${before === null ? "" : "AND id < $1"}
       ORDER BY id DESC LIMIT $${params.length}`, params);
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
    let thumbnailName: string | null = null;
    let published = false;
    const cleanup = () => {
      for (const name of [f?.filename, thumbnailName]) {
        if (name) void clipFile(name).delete({ ignoreNotFound: true })
          .catch(error => logger.warn({ err: error }, "[clips] upload cleanup failed"));
      }
    };
    try {
      if (err) {
        const msg = (err as Error).message === "UNSUPPORTED_TYPE"
          ? "صيغة الفيديو غير مدعومة — MP4 / WebM / MOV فقط"
          : (err as { code?: string }).code === "LIMIT_FILE_SIZE" ? "الفيديو كبير بزاف — الحد 2GB" : "فشل الرفع";
        res.status(400).json({ error: msg }); return;
      }
      if (!f?.filename || !f.sha256) { res.status(400).json({ error: "الفيديو مطلوب" }); return; }
      const title = String(req.body?.title ?? "").trim().slice(0, 120);
       const claimedDurationSec = Math.floor(parseFloat(String(req.body?.durationSec ?? "0")));
      if (!title) { cleanup(); res.status(400).json({ error: "العنوان مطلوب" }); return; }
       let durationSec: number;
       try {
         durationSec = Math.floor(await verifiedDuration(clipFile(f.filename)));
       } catch {
         cleanup();
         res.status(400).json({ error: "تعذّر التحقق من مدة الفيديو — الملف غير صالح أو غير مدعوم" });
         return;
       }
       if (!Number.isFinite(claimedDurationSec) || durationSec < MIN_DURATION_SEC) {
        cleanup();
         res.status(400).json({ error: "أي فيديو أقل من 60 ثانية يتم حظره تلقائياً. الحد الأدنى دقيقة واحدة." });
        return;
      }
      const { rows: urows } = await requirePool().query(`SELECT username FROM users WHERE id=$1`, [userId]);
      const username = urows[0]?.username ?? "citizen";

      // This derivative never replaces or contributes to the original-file hash.
      // Finish storage before publishing the row so a returned thumb is durable.
      try {
        const jpeg = await generateClipThumbnail(clipFile(f.filename));
        thumbnailName = `thumb_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
        await clipFile(thumbnailName).save(jpeg, {
          resumable: false, timeout: 10_000,
          metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" },
        });
      } catch (error) {
        logger.warn({ err: error }, "[clips] thumbnail unavailable; publishing original video");
        if (thumbnailName) {
          void clipFile(thumbnailName).delete({ ignoreNotFound: true })
            .catch(error => logger.warn({ err: error }, "[clips] thumbnail cleanup failed"));
        }
        thumbnailName = null;
      }

      // Rights: first owner wins. A duplicate fingerprint = someone else's work.
      const client = await requirePool().connect();
      try {
        await client.query("BEGIN");
        const fp = await client.query(
          `INSERT INTO content_fingerprints (fingerprint, content_type, content_id, owner_name)
           VALUES ($1, 'clip', 0, $2) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
          [f.sha256, username]);
        if (!fp.rows[0]) {
          const own = await client.query(`SELECT owner_name FROM content_fingerprints WHERE fingerprint=$1`, [f.sha256]);
          await client.query("ROLLBACK");
          cleanup();
          res.status(409).json({ error: `🛡️ حقوق الملكية الفكرية: هاد العمل مسجل من قبل باسم ${own.rows[0]?.owner_name ?? "مواطن آخر"} — غير صاحب العمل عندو الحق فالنشر` });
          return;
        }
        const { rows } = await client.query(
          `INSERT INTO clips (user_id, username, title, object_name, content_type, size_bytes, duration_sec, thumbnail_object_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, duration_sec, created_at, thumbnail_object_name`,
          [userId, username, title, f.filename, f.mimetype, f.size ?? 0, durationSec, thumbnailName]);
        await client.query(`UPDATE content_fingerprints SET content_id=$1 WHERE id=$2`, [rows[0].id, fp.rows[0].id]);
        await client.query("COMMIT");
        published = true;
        res.json({ clip: clipWithThumbnail(rows[0]) });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch { /* noop */ }
        throw e;
      } finally { client.release(); }
    } catch (e) {
      if (!published) cleanup();
      logger.error({ err: e }, "[clips] publish failed");
      res.status(500).json({ error: "Failed" });
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
      `UPDATE clips SET title=$1 WHERE id=$2 AND user_id=$3
       RETURNING id, user_id, username, title, content_type, duration_sec, views, created_at, thumbnail_object_name`,
      [title, id, userId],
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
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ user_id: number; object_name: string; thumbnail_object_name: string | null }>(
      `SELECT user_id, object_name, thumbnail_object_name FROM clips WHERE id=$1 FOR UPDATE`, [id],
    );
    const clip = rows[0];
    if (!clip) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "الكليب غير موجود" });
      return;
    }
    if (clip.user_id !== userId && !(await isAdmin(userId))) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "لا يمكنك حذف كليب مواطن آخر" });
      return;
    }

    // Delete the derivative first. A failed storage deletion keeps the row for
    // retry; ignoreNotFound makes retries safe after a partial deletion.
    if (clip.thumbnail_object_name) {
      await clipFile(clip.thumbnail_object_name).delete({ ignoreNotFound: true });
    }
    await clipFile(clip.object_name).delete({ ignoreNotFound: true });
    await client.query(`DELETE FROM clip_views WHERE clip_id=$1`, [id]);
    const deleted = await client.query(`DELETE FROM clips WHERE id=$1 RETURNING id`, [id]);
    if (!deleted.rows[0]) throw new Error("CLIP_DELETE_RACE");

    // Keep content_fingerprints intact. It is the permanent first-owner record:
    // removing it would let a later uploader claim the same original work.
    await client.query("COMMIT");
    committed = true;
    res.status(204).end();
  } catch (e) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: e, clipId: id, userId }, "[clips] delete failed");
    res.status(500).json({ error: "تعذر حذف الكليب، عاود المحاولة" });
  } finally {
    client.release();
  }
});

// Scoped to a visible clip, not an arbitrary storage path or expiring signed URL.
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
    stream.on("error", (error: { code?: number }) => {
      if (res.headersSent) res.destroy();
      else res.status(error.code === 404 ? 404 : 500).end();
    }).pipe(res);
  } catch (error) {
    logger.error({ err: error }, "[clips] thumbnail failed");
    if (!res.headersSent) res.status(500).end();
  }
});

// ─── GET /clips/stream/:id — video streaming with Range support ──────────────
router.get("/clips/stream/:id", async (req, res): Promise<void> => {
  try {
    const id = parseClipId(req.params.id);
    if (!id) { res.status(400).end(); return; }
    const { rows } = await requirePool().query(`SELECT object_name, content_type, size_bytes, is_frozen FROM clips WHERE id=$1`, [id]);
    const clip = rows[0];
    if (!clip || clip.is_frozen) { res.status(404).end(); return; }
    const file = clipFile(clip.object_name);
    let size = Number(clip.size_bytes);
    if (!size) { const [meta] = await file.getMetadata(); size = Number(meta.size); }
    res.setHeader("Content-Type", clip.content_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m?.[1] ? parseInt(m[1]) : 0;
      const end = m?.[2] ? Math.min(parseInt(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.status(416).setHeader("Content-Range", `bytes */${size}`).end(); return; }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      file.createReadStream({ start, end }).on("error", () => res.destroy()).pipe(res);
    } else {
      res.setHeader("Content-Length", size);
      file.createReadStream().on("error", () => res.destroy()).pipe(res);
    }
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
