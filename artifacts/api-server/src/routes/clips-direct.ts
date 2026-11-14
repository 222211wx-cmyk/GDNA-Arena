import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../lib/db";
import { r2Client, r2Config, r2Reference } from "../lib/r2-storage";
import { publishClip, ClipUploadError } from "../lib/clips-publish";
import { resolveClipUploadType, clipDownloadExtension, MAX_NEW_CLIP_BYTES, NEW_CLIP_TOO_LARGE } from "../lib/clips-upload-protocol";
import { validateClipDisplayTitle } from "../lib/clips-title";
import { finalClipReceipt } from "./clips-thumbnail-response";
import { logger } from "../lib/logger";

const router = Router();
router.use(["/clips/presign", "/clips/confirm"], (req, res, next) => {
  if (!req.session?.userId) { res.status(401).json({ error: "يجب تسجيل الدخول" }); return; }
  if (req.body?.expectedOwnerId !== undefined && req.body.expectedOwnerId !== req.session.userId) {
    res.status(403).json({ error: "تغير الحساب؛ اختر الملف مجدداً" }); return;
  }
  res.set("Cache-Control", "no-store");
  next();
}, rateLimit({ windowMs: 3600_000, limit: 100, keyGenerator: req => String(req.session!.userId) }));

router.post("/clips/confirm", async (req, res) => {
  const key = req.body?.key;
  if (typeof key !== "string" || !/^clips\/original\/\d+\/[a-f0-9-]+\.[a-z0-9]+$/.test(key)) {
    res.status(400).json({ error: "رابط رفع غير صالح" }); return;
  }
  const client = await pool.connect();
  try {
    // Serialize duplicate confirmation across processes and preserve idempotency.
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    const { rows } = await client.query(`SELECT * FROM r2_clip_uploads
      WHERE object_name=$1 AND user_id=$2 AND multipart_upload_id='direct-put'`,
    [r2Reference(key), req.session!.userId]);
    const row = rows[0];
    if (!row) throw new ClipUploadError(404, "الملف غير موجود");
    if (row.clip_id) {
      const existing = await client.query("SELECT id,title,code,duration_sec,created_at,processing_status FROM clips WHERE id=$1", [row.clip_id]);
      if (!existing.rows[0]) throw new ClipUploadError(404, "تم حذف المنشور");
      res.json(finalClipReceipt(existing.rows[0])); return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) throw new ClipUploadError(410, "انتهت مهلة الرفع؛ اختر الملف مجدداً");
    const clip = await publishClip({
      userId: row.user_id, filename: row.object_name, title: row.original_name,
      displayTitle: row.display_title, contentType: row.content_type,
      size: Number(row.size_bytes), sha256: "", deferThumbnail: true, originalReady: true,
    }, client, async (tx, published) => {
      await tx.query("UPDATE r2_clip_uploads SET state='published',clip_id=$2,updated_at=NOW() WHERE id=$1", [row.id, published.id]);
    });
    res.json(finalClipReceipt(clip));
  } catch (error) {
    logger.error({ err: error }, "Direct clip confirmation failed");
    res.status(error instanceof ClipUploadError ? error.status : 503)
      .json({ error: error instanceof ClipUploadError ? error.message : "تعذر تأكيد النشر" });
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
    client.release();
  }
});
export default router;
