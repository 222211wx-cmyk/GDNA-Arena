import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool } from "../lib/db";
import { r2Client, r2Config, r2Reference } from "../lib/r2-storage.js";
import { clipDownloadExtension, resolveClipUploadType } from "../lib/clips-upload-protocol.js";
import { validateClipDisplayTitle } from "../lib/clips-title.js";
import { auth, completeUpload, integer, uploadFailure } from "./r2.js";

/**
 * Direct browser -> R2 multipart upload. This server only authorizes: it
 * creates the multipart upload, signs one URL per part, and completes it.
 * No media bytes ever pass through it.
 */
export const DIRECT_PART_BYTES = 10 * 1024 * 1024;
export const MAX_PARTS = 10_000; // S3/R2 hard limit
export const SIGN_TTL_SECONDS = 60 * 60;
// Parts grow past 10 MB only when a file would need more than 9000 parts.
export const directPartBytes = (size: number) => Math.max(DIRECT_PART_BYTES, Math.ceil(size / 9000));

const router: IRouter = Router();

type Row = { id: string; object_name: string; multipart_upload_id: string; size_bytes: string; state: string };

async function ownedSession(userId: number, key: unknown, uploadId: unknown): Promise<Row | null> {
  if (typeof key !== "string" || typeof uploadId !== "string" || !uploadId || uploadId === "direct-put") return null;
  let reference: string;
  try { reference = r2Reference(key); } catch { return null; }
  const { rows } = await pool.query<Row>(
    `SELECT id,object_name,multipart_upload_id,size_bytes,state FROM r2_clip_uploads
     WHERE object_name=$1 AND multipart_upload_id=$2 AND user_id=$3`, [reference, uploadId, userId]);
  return rows[0] ?? null;
}

router.post("/upload/init", async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  res.set("Cache-Control", "no-store");
  try {
    const filename = typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 1024) : "";
    const size = integer(req.body?.fileSize);
    const contentType = resolveClipUploadType(String(req.body?.contentType ?? ""), filename);
    const displayTitle = validateClipDisplayTitle(
      Object.prototype.hasOwnProperty.call(req.body ?? {}, "title") ? req.body.title : undefined) ?? null;
    const duration = req.body?.durationSec == null ? 0 : Number(req.body.durationSec);
    if (!filename || !size || !contentType || !Number.isFinite(duration) || duration < 0) {
      res.status(400).json({ error: "Invalid upload metadata" }); return;
    }
    const partSize = directPartBytes(size);
    const totalParts = Math.ceil(size / partSize);
    if (totalParts > MAX_PARTS) { res.status(413).json({ error: "File too large" }); return; }
    const id = randomUUID();
    const key = `clips/original/${userId}/${id}${clipDownloadExtension(contentType)}`;
    const created = await r2Client().send(new CreateMultipartUploadCommand({
      Bucket: config.bucket, Key: key, ContentType: contentType,
      CacheControl: "private, max-age=3600",
      Metadata: { owner: String(userId), session: id },
    }));
    if (!created.UploadId) throw new Error("R2 did not return a multipart upload ID");
    try {
      await pool.query(
        `INSERT INTO r2_clip_uploads
           (id,user_id,request_id,object_name,multipart_upload_id,original_name,display_title,
            content_type,size_bytes,duration_sec,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'infinity')`,
        [id, userId, randomUUID(), r2Reference(key), created.UploadId, filename, displayTitle,
          contentType, size, duration]);
    } catch (error) {
      await r2Client().send(new AbortMultipartUploadCommand({
        Bucket: config.bucket, Key: key, UploadId: created.UploadId })).catch(() => {});
      throw error;
    }
    res.status(201).json({ uploadId: created.UploadId, key, partSize, totalParts });
  } catch (error) { uploadFailure(res, error, userId, "direct-init"); }
});

router.post("/upload/sign-part", async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  res.set("Cache-Control", "no-store");
  try {
    const row = await ownedSession(userId, req.body?.key, req.body?.uploadId);
    if (!row) { res.status(404).json({ error: "Upload session not found" }); return; }
    if (row.state !== "active") { res.status(409).json({ error: "Upload is not active" }); return; }
    const partNumber = integer(req.body?.partNumber);
    const total = Math.ceil(Number(row.size_bytes) / directPartBytes(Number(row.size_bytes)));
    if (!partNumber || partNumber > total) { res.status(400).json({ error: "Invalid part number" }); return; }
    const signedUrl = await getSignedUrl(r2Client(), new UploadPartCommand({
      Bucket: config.bucket, Key: req.body.key, UploadId: row.multipart_upload_id, PartNumber: partNumber,
    }), { expiresIn: SIGN_TTL_SECONDS });
    res.json({ signedUrl });
  } catch (error) { uploadFailure(res, error, userId, "direct-sign-part"); }
});

// Same path as the legacy session-based completion; falls through when the
// body is not the {key, uploadId, parts} shape. R2 ListParts, not the
// client-supplied ETags, decides what is assembled.
router.post("/upload/complete", async (req, res, next): Promise<void> => {
  if (req.body?.uploadId === undefined) { next(); return; }
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  try {
    const row = await ownedSession(userId, req.body?.key, req.body?.uploadId);
    if (!row) { res.status(404).json({ error: "Upload session not found" }); return; }
    if (!Array.isArray(req.body?.parts)) { res.status(400).json({ error: "parts required" }); return; }
    req.body.sessionId = row.id;
    await completeUpload(req, res, userId, config, directPartBytes);
  } catch (error) { uploadFailure(res, error, userId, "direct-complete"); }
});

router.post("/upload/abort", async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  try {
    const row = await ownedSession(userId, req.body?.key, req.body?.uploadId);
    if (!row) { res.status(404).json({ error: "Upload session not found" }); return; }
    if (row.state !== "active") { res.status(409).json({ error: "Upload can no longer be aborted" }); return; }
    await r2Client().send(new AbortMultipartUploadCommand({
      Bucket: config.bucket, Key: req.body.key, UploadId: row.multipart_upload_id,
    })).catch(error => { if ((error as { name?: string }).name !== "NoSuchUpload") throw error; });
    await pool.query(
      "UPDATE r2_clip_uploads SET state='aborted',updated_at=NOW() WHERE id=$1 AND state='active'", [row.id]);
    res.status(204).end();
  } catch (error) { uploadFailure(res, error, userId, "direct-abort"); }
});

export default router;
