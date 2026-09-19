import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool } from "@workspace/db";
import {
  r2Client,
  r2Config,
  r2ConnectionStatus,
  r2Reference,
} from "../lib/r2-storage.js";
import {
  MAX_NEW_CLIP_BYTES,
  NEW_CLIP_TOO_LARGE,
  clipDownloadExtension,
  resolveClipUploadType,
  ClipUploadError,
} from "../lib/clip-upload-protocol.js";
import { publishClip, validateClipDisplayTitle } from "../lib/clip-publish.js";
import { finalClipReceipt } from "./clips-thumbnail-response.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const PART_BYTES = 5 * 1024 * 1024;
const URL_TTL_SECONDS = 15 * 60;
const SESSION_TTL_HOURS = 48;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UploadRow = {
  id: string;
  user_id: number;
  object_name: string;
  multipart_upload_id: string;
  original_name: string;
  display_title: string | null;
  content_type: string;
  size_bytes: string;
  duration_sec: number;
  state: "active" | "completing" | "published" | "aborted";
  clip_id: number | null;
  expires_at: Date;
};

function auth(req: any, res: any): number | null {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return null; }
  return userId;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeEtag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^"?[a-fA-F0-9]{32}(?:-\d+)?"?$/.test(trimmed) ? trimmed : null;
}

async function uploadRow(id: string, userId: number): Promise<UploadRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await pool.query<UploadRow>(
    `SELECT id,user_id,object_name,multipart_upload_id,original_name,display_title,content_type,
            size_bytes,duration_sec,state,clip_id,expires_at
     FROM r2_clip_uploads WHERE id=$1 AND user_id=$2`, [id, userId],
  );
  return rows[0] ?? null;
}

type R2Config = NonNullable<ReturnType<typeof r2Config>>;

async function completeUpload(req: Request, res: Response, userId: number, config: R2Config): Promise<void> {
  if (["objectUrl", "publicUrl", "url"].some(field =>
    Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
    throw new ClipUploadError(400, "Object URLs are not accepted; the upload session identifies the R2 object");
  }
  const sessionId = String(req.body?.sessionId ?? "").toLowerCase();
  const row = await uploadRow(sessionId, userId);
  if (!row) { res.status(404).json({ error: "R2 upload session not found" }); return; }
  if (row.expires_at.getTime() <= Date.now() && row.state !== "published") {
    res.status(410).json({ error: "R2 upload session expired" }); return;
  }
  const key = row.object_name.slice("r2:".length);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`r2-upload:${row.id}`]);
    locked = true;
    const currentResult = await client.query<UploadRow>(
      `SELECT id,user_id,object_name,multipart_upload_id,original_name,display_title,content_type,
              size_bytes,duration_sec,state,clip_id,expires_at
       FROM r2_clip_uploads WHERE id=$1 AND user_id=$2`, [row.id, userId],
    );
    const current = currentResult.rows[0];
    if (!current) { res.status(404).json({ error: "R2 upload session not found" }); return; }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "title")) {
      const requestedTitle = validateClipDisplayTitle(req.body.title) ?? null;
      if (requestedTitle !== current.display_title) {
        res.status(409).json({ error: "Clip title does not match the authorized upload session" }); return;
      }
    }
    if (current.state === "published" && current.clip_id) {
      const found = await client.query(`SELECT * FROM clips WHERE id=$1 AND user_id=$2`, [current.clip_id, userId]);
      if (!found.rows[0]) { res.status(410).json({ error: "Published clip was removed" }); return; }
      res.json(finalClipReceipt(found.rows[0])); return;
    }
    if (current.state !== "active" && current.state !== "completing") {
      res.status(409).json({ error: "R2 upload cannot be completed" }); return;
    }
    const expectedParts = Math.ceil(Number(current.size_bytes) / PART_BYTES);
    const rawParts = Array.isArray(req.body?.parts) ? req.body.parts : [];
    const parts: { PartNumber: number | null; ETag: string | null }[] = rawParts.map((part: any) => ({
      PartNumber: integer(part?.partNumber),
      ETag: safeEtag(part?.etag),
    }));
    if (parts.length !== expectedParts || parts.some((part, index) =>
      part.PartNumber !== index + 1 || !part.ETag)) {
      res.status(400).json({ error: "Every multipart part and ETag is required in order" }); return;
    }
    const listed = await r2Client().send(new ListPartsCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: current.multipart_upload_id,
    })).catch(error => {
      if ((error as { name?: string }).name === "NoSuchUpload" && current.state === "completing") return null;
      throw error;
    });
    if (listed) {
      const stored = listed.Parts ?? [];
      const mismatch = stored.length !== expectedParts || stored.some((part, index) => {
        const expectedSize = index === expectedParts - 1
          ? Number(current.size_bytes) - index * PART_BYTES
          : PART_BYTES;
        return part.PartNumber !== index + 1 || Number(part.Size) !== expectedSize ||
          part.ETag !== parts[index]?.ETag;
      });
      if (mismatch || listed.IsTruncated) {
        res.status(409).json({ error: "Stored R2 parts do not match the authorized upload" }); return;
      }
    }
    await client.query(
      `UPDATE r2_clip_uploads SET state='completing',updated_at=NOW() WHERE id=$1`, [current.id],
    );
    try {
      await r2Client().send(new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: key,
        UploadId: current.multipart_upload_id,
        MultipartUpload: { Parts: parts as { PartNumber: number; ETag: string }[] },
      }));
    } catch (error) {
      if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
      // A lost Complete acknowledgement consumes the multipart upload. HEAD
      // below is the authoritative idempotence check before publication.
    }
    const head = await r2Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    if (Number(head.ContentLength) !== Number(current.size_bytes) ||
        head.ContentType !== current.content_type ||
        head.Metadata?.owner !== String(userId) ||
        head.Metadata?.session !== current.id) {
      throw new ClipUploadError(409, "Completed R2 object failed ownership or size verification");
    }
    // publishClip probes the completed object and is authoritative for the
    // >=60-second rule; client duration is intentionally only resumable metadata.
    const existing = await client.query(
      `SELECT id,title,content_type,duration_sec,code,created_at,
              thumbnail_object_name,processing_status
       FROM clips WHERE user_id=$1
         AND (object_name=$2 OR upload_object_name=$2)
       ORDER BY id LIMIT 1`, [userId, current.object_name],
    );
    const clip = existing.rows[0] ?? await publishClip({
        userId,
        filename: current.object_name,
        title: current.original_name,
        displayTitle: current.display_title ?? undefined,
        contentType: current.content_type,
        size: Number(current.size_bytes),
        sha256: "",
        deferThumbnail: true,
      }, client, async (transaction, published) => {
        await transaction.query(
          `UPDATE r2_clip_uploads SET state='published',clip_id=$2,updated_at=NOW()
           WHERE id=$1 AND user_id=$3`,
          [current.id, published.id, userId],
        );
      });
    if (existing.rows[0]) {
      await client.query(
        `UPDATE r2_clip_uploads SET state='published',clip_id=$2,updated_at=NOW()
         WHERE id=$1 AND user_id=$3`,
        [current.id, clip.id, userId],
      );
    }
    res.json(finalClipReceipt(clip));
  } finally {
    if (locked) await client.query(
      "SELECT pg_advisory_unlock(hashtextextended($1,0))", [`r2-upload:${row.id}`],
    ).catch(() => {});
    client.release();
  }
}

function uploadFailure(res: Response, error: unknown, userId: number, action: string): void {
  logger.warn({
    errorName: error instanceof Error ? error.name : "UnknownError",
    status: error instanceof ClipUploadError ? error.status :
      Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode) || undefined,
    userId,
    action,
  }, "[r2] clip upload request failed");
  res.status(error instanceof ClipUploadError ? error.status : 500).json({
    error: error instanceof ClipUploadError ? error.message : "R2 upload request failed",
  });
}

router.get("/r2/status", async (req, res) => {
  if (!auth(req, res)) return;
  res.set("Cache-Control", "private, max-age=15");
  res.json(await r2ConnectionStatus());
});

router.post("/clips/create", async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  try {
    await completeUpload(req, res, userId, config);
  } catch (error) {
    uploadFailure(res, error, userId, "create");
  }
});

router.post("/r2/presign", async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  const action = req.body?.action;
  try {
    if (action === "initiate") {
      const originalName = typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 1024) : "";
      const displayTitle = validateClipDisplayTitle(
        Object.prototype.hasOwnProperty.call(req.body ?? {}, "title") ? req.body.title : undefined,
      ) ?? null;
      const size = integer(req.body?.size);
      // Browsers cannot always read container metadata. Null is a deliberate
      // unknown hint; publishClip still probes the completed object and enforces
      // the real duration before creating a clip row.
      const duration = req.body?.durationSec === null ? 0 : Number(req.body?.durationSec);
      const contentType = resolveClipUploadType(String(req.body?.contentType ?? ""), originalName);
      const requestId = String(req.body?.requestId ?? "").toLowerCase();
      if (!UUID.test(requestId) || !originalName || !size || !contentType ||
          !Number.isFinite(duration) || duration < 0) {
        res.status(400).json({ error: "Invalid R2 upload metadata" }); return;
      }
      if (size > MAX_NEW_CLIP_BYTES) { res.status(413).json({ error: NEW_CLIP_TOO_LARGE }); return; }
      const existing = await pool.query<UploadRow>(
        `SELECT id,user_id,object_name,multipart_upload_id,original_name,display_title,content_type,
                size_bytes,duration_sec,state,clip_id,expires_at
         FROM r2_clip_uploads WHERE user_id=$1 AND request_id=$2`, [userId, requestId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (Number(row.size_bytes) !== size || row.content_type !== contentType ||
            row.original_name !== originalName || row.display_title !== displayTitle) {
          res.status(409).json({ error: "Upload request identity already belongs to different media" }); return;
        }
        res.json({
          sessionId: row.id, partSize: PART_BYTES,
          partCount: Math.ceil(size / PART_BYTES), state: row.state,
        });
        return;
      }
      const id = randomUUID();
      const key = `clips/original/${userId}/${id}${clipDownloadExtension(contentType)}`;
      const created = await r2Client().send(new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: "private, max-age=3600",
        Metadata: { owner: String(userId), session: id },
      }));
      if (!created.UploadId) throw new Error("R2 did not return a multipart upload ID");
      try {
        await pool.query(
          `INSERT INTO r2_clip_uploads
              (id,user_id,request_id,object_name,multipart_upload_id,original_name,display_title,
               content_type,size_bytes,duration_sec,expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+INTERVAL '${SESSION_TTL_HOURS} hours')`,
          [id, userId, requestId, r2Reference(key), created.UploadId, originalName,
             displayTitle, contentType, size, duration],
        );
      } catch (error) {
        await r2Client().send(new AbortMultipartUploadCommand({
          Bucket: config.bucket, Key: key, UploadId: created.UploadId,
        })).catch(() => {});
        if ((error as { code?: string }).code === "23505") {
          const raced = await pool.query<UploadRow>(
            `SELECT id,user_id,object_name,multipart_upload_id,original_name,display_title,content_type,
                    size_bytes,duration_sec,state,clip_id,expires_at
             FROM r2_clip_uploads WHERE user_id=$1 AND request_id=$2`, [userId, requestId],
          );
          const winner = raced.rows[0];
          if (winner && Number(winner.size_bytes) === size &&
              winner.content_type === contentType && winner.original_name === originalName &&
              winner.display_title === displayTitle) {
            res.json({
              sessionId: winner.id, partSize: PART_BYTES,
              partCount: Math.ceil(size / PART_BYTES), state: winner.state,
            });
            return;
          }
        }
        throw error;
      }
      res.status(201).json({
        sessionId: id, partSize: PART_BYTES, partCount: Math.ceil(size / PART_BYTES), state: "active",
      });
      return;
    }

    if (action === "complete") {
      await completeUpload(req, res, userId, config);
      return;
    }

    const sessionId = String(req.body?.sessionId ?? "").toLowerCase();
    const row = await uploadRow(sessionId, userId);
    if (!row) { res.status(404).json({ error: "R2 upload session not found" }); return; }
    if (row.expires_at.getTime() <= Date.now() && row.state !== "published") {
      res.status(410).json({ error: "R2 upload session expired" }); return;
    }
    const key = row.object_name.slice("r2:".length);

    if (action === "part") {
      if (row.state !== "active") { res.status(409).json({ error: "R2 upload is not active" }); return; }
      const partNumber = integer(req.body?.partNumber);
      const partCount = Math.ceil(Number(row.size_bytes) / PART_BYTES);
      if (!partNumber || partNumber > partCount || partNumber > 10_000) {
        res.status(400).json({ error: "Invalid multipart part number" }); return;
      }
      const expectedBytes = partNumber === partCount
        ? Number(row.size_bytes) - (partCount - 1) * PART_BYTES
        : PART_BYTES;
      const url = await getSignedUrl(r2Client(), new UploadPartCommand({
        Bucket: config.bucket,
        Key: key,
        UploadId: row.multipart_upload_id,
        PartNumber: partNumber,
        ContentLength: expectedBytes,
      }), { expiresIn: URL_TTL_SECONDS });
      res.set("Cache-Control", "no-store").json({
        url, partNumber, expectedBytes,
        expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
      });
      return;
    }

    if (action === "inspect") {
      if (row.state === "published" && row.clip_id) {
        const found = await pool.query(`SELECT * FROM clips WHERE id=$1 AND user_id=$2`, [row.clip_id, userId]);
        if (!found.rows[0]) { res.status(410).json({ error: "Published clip was removed" }); return; }
        res.json({ state: "published", receipt: finalClipReceipt(found.rows[0]) });
        return;
      }
      if (row.state === "aborted") { res.json({ state: "aborted", parts: [] }); return; }
      const listed = await r2Client().send(new ListPartsCommand({
        Bucket: config.bucket, Key: key, UploadId: row.multipart_upload_id,
      })).catch(error => {
        if ((error as { name?: string }).name === "NoSuchUpload") return null;
        throw error;
      });
      res.json({
        state: row.state,
        parts: (listed?.Parts ?? []).map(part => ({
          partNumber: part.PartNumber,
          etag: part.ETag,
          size: part.Size,
        })),
      });
      return;
    }

    if (action === "abort") {
      if (row.state === "published") { res.status(409).json({ error: "Clip is already published" }); return; }
      await r2Client().send(new AbortMultipartUploadCommand({
        Bucket: config.bucket, Key: key, UploadId: row.multipart_upload_id,
      })).catch(error => {
        if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
      });
      await pool.query(
        `UPDATE r2_clip_uploads SET state='aborted',updated_at=NOW()
         WHERE id=$1 AND user_id=$2 AND state<>'published'`, [row.id, userId],
      );
      res.status(204).end();
      return;
    }

    res.status(400).json({ error: "Unknown R2 presign action" });
  } catch (error) {
    uploadFailure(res, error, userId, String(action ?? ""));
  }
});

export default router;