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
import { validateClipDisplayTitle } from "../lib/clip-title.js";
import { finalClipReceipt } from "./clips-thumbnail-response.js";
import { logger } from "../lib/logger.js";
import { publishClip } from "../lib/clip-publish.js";

const router: IRouter = Router();
async function status(sessionId: string, userId: number) {
  const { rows } = await pool.query(
    `SELECT j.state,j.error,c.id,c.title,c.code,c.duration_sec,c.created_at,c.processing_status,c.thumbnail_object_name
     FROM clip_media_jobs j JOIN r2_clip_uploads u ON u.id=j.session_id
     LEFT JOIN clips c ON c.id=u.clip_id WHERE j.session_id=$1 AND u.user_id=$2`, [sessionId,userId]);
  const row = rows[0];
  if (!row) return null;
  return { sessionId, state: row.state, statusUrl: `/api/upload/status/${sessionId}`,
    ...(row.error ? { error: row.error } : {}),
    ...(row.state === "ready" && row.id ? {receipt: finalClipReceipt(row)} : {}) };
}
router.get("/upload/status/:sessionId", async (req,res) => {
  const userId = auth(req,res);
  if (!userId) return;
  const id = String(req.params.sessionId);
  if (!UUID.test(id)) { res.status(404).json({error:"Upload session not found"}); return; }
  const result = await status(id,userId);
  res.set("Cache-Control","no-store");
  if (!result) { res.status(404).json({error:"Upload session not found"}); return; }
  res.json(result);
});
const PART_BYTES = 5 * 1024 * 1024;
const partBytes = (size: number) => Math.max(PART_BYTES, Math.ceil(size / 9000));
async function listAllParts(bucket: string, key: string, uploadId: string) {
  const parts: import("@aws-sdk/client-s3").Part[] = [];
  let marker: string | undefined;
  do {
    const page = await r2Client().send(new ListPartsCommand({
      Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker,
    }));
    parts.push(...(page.Parts ?? []));
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    if (page.IsTruncated && !marker) throw new Error("R2 pagination cursor missing");
  } while (marker);
  return { Parts: parts, IsTruncated: false };
}
// Five MiB can take >15 minutes on intermittent mobile links. Each retry can
// mint a fresh capability for the same part; never require restarting a session.
const URL_TTL_SECONDS = 60 * 60;
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
  if (req.body?.expectedOwnerId !== undefined && req.body.expectedOwnerId !== userId) {
    res.status(403).json({ error: "Upload belongs to a different signed-in account" }); return null;
  }
  return userId;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeEtag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^(?:"[a-fA-F0-9]{32}(?:-\d+)?"|[a-fA-F0-9]{32}(?:-\d+)?)$/.test(trimmed) ? trimmed : null;
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
  if (row.expires_at instanceof Date && row.expires_at.getTime() <= Date.now() && ["active","completing"].includes(row.state) && !await status(row.id,userId)) {
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
    if (current.expires_at instanceof Date && current.expires_at.getTime() <= Date.now() && ["active","completing"].includes(current.state) && !await status(current.id,userId)) {
      res.status(410).json({ error: "R2 upload session expired" }); return;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "title")) {
      const requestedTitle = validateClipDisplayTitle(req.body.title) ?? null;
      if (requestedTitle !== current.display_title) {
        res.status(409).json({ error: "Clip title does not match the authorized upload session" }); return;
      }
    }
    const accepted = await status(current.id,userId);
    if (accepted) { res.status(202).json(accepted); return; }
    if (current.state === "published" && current.clip_id) {
      const found = await client.query(`SELECT * FROM clips WHERE id=$1 AND user_id=$2`, [current.clip_id, userId]);
      if (!found.rows[0]) { res.status(410).json({ error: "Published clip was removed" }); return; }
      res.json(finalClipReceipt(found.rows[0])); return;
    }
    if (current.state !== "active" && current.state !== "completing") {
      res.status(409).json({ error: "R2 upload cannot be completed" }); return;
    }
    const chunkBytes = partBytes(Number(current.size_bytes));
    const expectedParts = Math.ceil(Number(current.size_bytes) / chunkBytes);
    const listed = await listAllParts(config.bucket,key,current.multipart_upload_id).catch(error => {
      if ((error as { name?: string }).name === "NoSuchUpload" && current.state === "completing") return null;
      throw error;
    });
    const parts = (listed?.Parts ?? []).map(part => ({ PartNumber: part.PartNumber, ETag: part.ETag }));
    if (listed) {
      const stored = listed.Parts ?? [];
      const mismatch = stored.length !== expectedParts || stored.some((part, index) => {
        const expectedSize = index === expectedParts - 1
          ? Number(current.size_bytes) - index * chunkBytes
          : chunkBytes;
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
      if (listed)
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
    const clip = await publishClip({
      userId, filename: current.object_name, title: current.original_name,
      displayTitle: current.display_title ?? undefined, contentType: current.content_type,
      size: Number(current.size_bytes), sha256: "", deferThumbnail: true, originalReady: true,
    }, client, async (tx, published) => {
      await tx.query("UPDATE r2_clip_uploads SET state='published',clip_id=$2,updated_at=NOW() WHERE id=$1", [current.id, published.id]);
    });
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

// The browser sends bytes only to this server. Ownership and the provider
// operation are serialized with completion and cancellation for this session.
router.put("/upload/chunk/:sessionId/:partNumber", async (req, res) => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "Storage is unavailable" }); return; }
  const id = String(req.params.sessionId);
  if (!UUID.test(id)) { res.status(404).end(); return; }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`r2-upload:${id}`]);
    const loaded = await client.query<UploadRow>(
      "SELECT * FROM r2_clip_uploads WHERE id=$1 AND user_id=$2", [id, userId],
    );
    const row = loaded.rows[0];
    if (!row || row.state !== "active" || row.multipart_upload_id === "direct-put") {
      res.status(409).json({ error: "Upload session is not active" }); return;
    }
    const number = integer(req.params.partNumber);
    const chunkBytes = partBytes(Number(row.size_bytes));
    const count = Math.ceil(Number(row.size_bytes) / chunkBytes);
    if (!number || number > count) { res.status(400).end(); return; }
    const expected = number === count ? Number(row.size_bytes) - (count - 1) * chunkBytes : chunkBytes;
    if (Number(req.headers["content-length"]) !== expected) {
      res.status(409).json({ error: "Chunk length does not match the upload manifest" }); return;
    }
    await client.query("UPDATE r2_clip_uploads SET expires_at='infinity',updated_at=NOW() WHERE id=$1", [id]);
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once("aborted", abort);
    try {
      const result = await r2Client().send(new UploadPartCommand({
        Bucket: config.bucket, Key: row.object_name.slice(3),
        UploadId: row.multipart_upload_id, PartNumber: number,
        ContentLength: expected, Body: req,
      }), { abortSignal: controller.signal });
      res.json({ partNumber: number, etag: result.ETag, size: expected });
    } finally { req.removeListener("aborted", abort); }
  } catch (error) { uploadFailure(res, error, userId, "server-chunk"); }
  finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`r2-upload:${id}`]).catch(() => {});
    client.release();
  }
});

router.post(["/clips/create","/upload/complete"], async (req, res): Promise<void> => {
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

router.post(["/r2/presign","/upload/presign"], async (req, res): Promise<void> => {
  const userId = auth(req, res);
  if (!userId) return;
  const config = r2Config();
  if (!config) { res.status(503).json({ error: "R2 storage is not configured" }); return; }
  const action = req.body?.action;
  res.set("Cache-Control", "no-store");
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
      const existing = await pool.query<UploadRow>(
        `SELECT id,user_id,object_name,multipart_upload_id,original_name,display_title,content_type,
                size_bytes,duration_sec,state,clip_id,expires_at
         FROM r2_clip_uploads WHERE user_id=$1 AND request_id=$2`, [userId, requestId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.expires_at instanceof Date && row.expires_at.getTime() <= Date.now() && ["active","completing"].includes(row.state) && !await status(row.id,userId)) {
          res.status(410).json({ error: "R2 upload session expired" }); return;
        }
        if (Number(row.size_bytes) !== size || row.content_type !== contentType ||
            row.original_name !== originalName || row.display_title !== displayTitle) {
          res.status(409).json({ error: "Upload request identity already belongs to different media" }); return;
        }
        res.json({
          sessionId: row.id, partSize: partBytes(size),
          partCount: Math.ceil(size / partBytes(size)), state: row.state,
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
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'infinity')`,
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
              sessionId: winner.id, partSize: partBytes(size),
              partCount: Math.ceil(size / partBytes(size)), state: winner.state,
            });
            return;
          }
        }
        throw error;
      }
      res.status(201).json({
        sessionId: id, partSize: partBytes(size), partCount: Math.ceil(size / partBytes(size)), state: "active",
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
    if (action !== "abort" && row.expires_at instanceof Date && row.expires_at.getTime() <= Date.now() && ["active","completing"].includes(row.state) && !await status(row.id,userId)) {
      res.status(410).json({ error: "R2 upload session expired" }); return;
    }
    const key = row.object_name.slice("r2:".length);

    if (action === "part") {
      if (row.state !== "active") { res.status(409).json({ error: "R2 upload is not active" }); return; }
      const partNumber = integer(req.body?.partNumber);
      const chunkBytes = partBytes(Number(row.size_bytes));
      const partCount = Math.ceil(Number(row.size_bytes) / chunkBytes);
      if (!partNumber || partNumber > partCount) {
        res.status(400).json({ error: "Invalid multipart part number" }); return;
      }
      const expectedBytes = partNumber === partCount
        ? Number(row.size_bytes) - (partCount - 1) * chunkBytes
        : chunkBytes;
      // Rolling owner-authorized activity lease. Paused uploads expire after
      // 48 hours; slow uploads do not expire while parts are still authorized.
      const renewed = await pool.query(
        `UPDATE r2_clip_uploads SET expires_at='infinity',updated_at=NOW()
         WHERE id=$1 AND user_id=$2 AND state='active' RETURNING id`, [row.id, userId],
      );
      if (!renewed.rowCount) { res.status(409).json({ error: "R2 upload is no longer active" }); return; }
      const url = `/api/upload/chunk/${row.id}/${partNumber}`;
      res.set("Cache-Control", "no-store").json({
        url, partNumber, expectedBytes,
        expiresAt: null,
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
      const accepted = await status(row.id,userId);
      if (accepted) { res.json(accepted); return; }
      const listed = await listAllParts(config.bucket,key,row.multipart_upload_id).catch(error => {
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
      const client = await pool.connect();
      try {
        // Serialize with completion so abort cannot mark a just-published clip
        // aborted, nor delete its source while mandatory verification is running.
        await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`r2-upload:${row.id}`]);
        const current = await uploadRow(row.id, userId);
        if (!current || !["active","completing"].includes(current.state) || await status(row.id,userId)) { res.status(409).json({ error: "Upload is already accepted" }); return; }
        await r2Client().send(new AbortMultipartUploadCommand({
          Bucket: config.bucket, Key: key, UploadId: row.multipart_upload_id,
        })).catch(error => {
          if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
        });
        await client.query("BEGIN");
        await client.query(
          `UPDATE r2_clip_uploads SET state='aborted',updated_at=NOW()
           WHERE id=$1 AND user_id=$2 AND state<>'published'`, [row.id, userId],
        );
        // Complete may have succeeded before verification/its acknowledgement
        // failed. Durable cleanup handles that object as well as absent objects.
        await client.query(
          `INSERT INTO clip_storage_cleanup (object_name,clip_id) VALUES ($1,0)
           ON CONFLICT (object_name) DO UPDATE SET retry_at=NOW()`, [row.object_name],
        );
        await client.query("COMMIT");
        res.status(204).end();
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`r2-upload:${row.id}`]).catch(() => {});
        client.release();
      }
      return;
    }

    res.status(400).json({ error: "Unknown R2 presign action" });
  } catch (error) {
    uploadFailure(res, error, userId, String(action ?? ""));
  }
});

export default router;
