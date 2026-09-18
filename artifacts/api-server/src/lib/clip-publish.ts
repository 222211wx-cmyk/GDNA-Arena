import crypto from "node:crypto";
import type { File } from "@google-cloud/storage";
import { pool } from "@workspace/db";
import { objectStorageClient } from "./chatStorage.js";
import { logger } from "./logger.js";
import { generateClipThumbnail } from "./clip-thumbnail.js";
import { clipWithThumbnail } from "../routes/clips-thumbnail-response.js";
import {
  ClipUploadError, normalizeClipContentType, isAudioClip, clipDurationSeconds,
  validateClipRightsInput,
} from "./clip-upload-protocol.js";
import { verifiedDuration, ClipProbeBusyError } from "./clip-duration.js";
import {
  extractClipVisualSignature,
  matchesOriginalVideo,
  type ClipVisualSignature,
} from "./clip-original-signature.js";
export { verifiedDuration } from "./clip-duration.js";
export {
  ClipUploadError, MAX_CLIP_BYTES, CLIP_EXT, validateClipRightsInput,
} from "./clip-upload-protocol.js";
const connectDatabase = () => pool.connect();
export type ClipDatabaseClient = Awaited<ReturnType<typeof connectDatabase>>;

export function clipFile(name: string): File {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const parts = `${dir.replace(/\/$/, "")}/clips/${name}`.replace(/^\//, "").split("/");
  return objectStorageClient.bucket(parts[0]).file(parts.slice(1).join("/"));
}

export interface PublishClipInput {
  userId: number;
  filename: string;
  title: string;
  contentType: string;
  size: number;
  sha256: string;
  purpose?: unknown;
  originalReference?: unknown;
  rightsHolderName?: unknown;
  rightsHolderRole?: unknown;
  /** Server-only optimization for the bounded simple route; rights checks remain synchronous. */
  deferThumbnail?: boolean;
}

/** The caller owns original-file cleanup. Only durable originals reach this function. */
export async function publishClip(input: PublishClipInput, lockedClient?: ClipDatabaseClient) {
  if (!pool) throw new Error("Database not configured");
  const { userId, filename, title, size, sha256 } = input;
  const rightsInput = validateClipRightsInput(
    input.purpose, input.originalReference, input.rightsHolderName, input.rightsHolderRole,
  );
  const contentType = normalizeClipContentType(input.contentType);
  if (!contentType) throw new ClipUploadError(415, "صيغة الصوت أو الفيديو غير مدعومة");
  const audio = isAudioClip(contentType);
  const [metadata] = await clipFile(filename).getMetadata();
  if (Number(metadata.size) !== size) throw new ClipUploadError(409, "Stored video size does not match");
  let durationSec: number;
  let verifiedSeconds: number;
  try { verifiedSeconds = await verifiedDuration(clipFile(filename), audio ? "audio" : undefined); }
  catch (error) {
    if (error instanceof ClipProbeBusyError) throw new ClipUploadError(503, "Media verification is busy; retry shortly");
    throw new ClipUploadError(400, "تعذّر التحقق من الملف الصوتي أو الفيديو — الملف غير صالح أو غير مدعوم");
  }
  durationSec = clipDurationSeconds(verifiedSeconds, contentType);
  type Candidate = {
    user_id: number;
    duration_seconds: string | number;
    visual_signature: ClipVisualSignature;
  };
  const candidateSql = `SELECT user_id, duration_seconds, visual_signature
    FROM clip_original_registrations
    WHERE visual_signature IS NOT NULL
      AND duration_seconds BETWEEN $1::numeric - 0.5 AND $1::numeric + 0.5`;
  let visualSignature: ClipVisualSignature | null = null;
  const extractSignature = async () => {
    try {
      return await extractClipVisualSignature(clipFile(filename), verifiedSeconds);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (detail.includes("BUSY") || detail.includes("TIMEOUT")) {
        throw new ClipUploadError(503, "Video rights verification is busy; retry shortly");
      }
      throw new ClipUploadError(503, "Video rights verification could not complete; retry the upload");
    }
  };
  if (!audio) {
    const preflight = await (lockedClient ?? pool).query<{ exists: boolean }>(
      `SELECT EXISTS (${candidateSql}) AS exists`,
      [verifiedSeconds],
    );
    if (rightsInput.purpose === "original" || preflight.rows[0]?.exists) {
      visualSignature = await extractSignature();
    }
  }
  let thumbnailName: string | null = null;
  if (!audio && !input.deferThumbnail) try {
    const jpeg = await generateClipThumbnail(clipFile(filename));
    thumbnailName = `thumb_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
    await clipFile(thumbnailName).save(jpeg, {
      resumable: false, timeout: 10_000,
      metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" },
    });
  } catch (error) {
    logger.warn({ err: error }, "[clips] thumbnail unavailable; publishing original video");
    if (thumbnailName) await clipFile(thumbnailName).delete({ ignoreNotFound: true }).catch(() => {});
    thumbnailName = null;
  }
  const client = lockedClient ?? await connectDatabase();
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    let candidates: Candidate[] = [];
    if (!audio) {
      const buckets = [...new Set([
        Math.floor(verifiedSeconds - 0.5),
        Math.floor(verifiedSeconds + 0.5),
      ])].sort((a, b) => a - b);
      const lockBuckets = async () => {
        for (const bucket of buckets) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`clip-original-duration:v1:${bucket}`],
          );
        }
      };
      await lockBuckets();
      candidates = (await client.query<Candidate>(candidateSql, [verifiedSeconds])).rows;
      // A registration may have committed after preflight. Never silently skip
      // it: release the transaction, extract, then reacquire the same buckets.
      if (candidates.length > 0 && !visualSignature) {
        await client.query("ROLLBACK");
        visualSignature = await extractSignature();
        await client.query("BEGIN");
        await lockBuckets();
        candidates = (await client.query<Candidate>(candidateSql, [verifiedSeconds])).rows;
      }
      const conflicting = visualSignature && candidates.some(candidate =>
        candidate.user_id !== userId &&
        matchesOriginalVideo(
          { durationSeconds: Number(candidate.duration_seconds), signature: candidate.visual_signature },
          { durationSeconds: verifiedSeconds, signature: visualSignature! },
        ));
      if (conflicting) {
        throw new ClipUploadError(409, "حقوق النشر: الفيديو الكامل بنفس المدة والصور مطابق لعمل أصلي صرّح به مواطن آخر");
      }
    }
    // Shared by legacy and resumable publishing; prevents concurrent quota races.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`clip-publish-user:${userId}`]);
    const { rows: users } = await client.query(`SELECT username FROM users WHERE id=$1`, [userId]);
    if (!users[0]) throw new ClipUploadError(401, "User no longer exists");
    const username = users[0].username;
    const count = await client.query(`SELECT count(*)::int AS count FROM clips WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`, [userId]);
    if (count.rows[0].count >= 6) throw new ClipUploadError(429, "Publish limit reached: 6 clips per hour");
    const fp = await client.query(
      `INSERT INTO content_fingerprints (fingerprint, content_type, content_id, owner_name)
       VALUES ($1, 'clip', 0, $2) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`, [sha256, username]);
    if (!fp.rows[0]) {
      throw new ClipUploadError(409, "Exact-byte duplicate: an identical file was already uploaded");
    }
    const { rows } = await client.query(
      `INSERT INTO clips (user_id, username, title, object_name, content_type, size_bytes, duration_sec, thumbnail_object_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, duration_sec, created_at, thumbnail_object_name`,
      [userId, username, title, filename, contentType, size, durationSec, thumbnailName]);
    await client.query(`UPDATE content_fingerprints SET content_id=$1 WHERE id=$2`, [rows[0].id, fp.rows[0].id]);
    let registration: { id: number; created_at: Date } | undefined;
    if (rightsInput.purpose === "original") {
      const result = await client.query<{ id: number; created_at: Date }>(
        `INSERT INTO clip_original_registrations
           (clip_id, user_id, original_reference, rights_holder_name, rights_holder_role,
            duration_seconds, visual_signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [
          rows[0].id, userId, rightsInput.originalReference,
          rightsInput.rightsHolderName, rightsInput.rightsHolderRole,
          verifiedSeconds, visualSignature,
        ],
      );
      registration = result.rows[0];
    }
    commitAttempted = true;
    await client.query("COMMIT");
    return {
      ...clipWithThumbnail(rows[0]),
      rights: rightsInput.purpose === "original"
        ? {
            purpose: "original" as const,
            registrationId: registration!.id,
            registeredAt: registration!.created_at,
            rightsHolderName: rightsInput.rightsHolderName,
            rightsHolderRole: rightsInput.rightsHolderRole,
            status: "declared" as const,
          }
        : { purpose: "story" as const },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // An ambiguous COMMIT must never cause deletion of a possibly published file.
    if (!commitAttempted && thumbnailName) await clipFile(thumbnailName).delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  } finally { if (!lockedClient) client.release(); }
}