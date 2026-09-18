import crypto from "node:crypto";
import type { File } from "@google-cloud/storage";
import { pool } from "@workspace/db";
import { objectStorageClient } from "./chatStorage.js";
import { logger } from "./logger.js";
import { generateClipThumbnail } from "./clip-thumbnail.js";
import { clipWithThumbnail } from "../routes/clips-thumbnail-response.js";
import { ClipUploadError, normalizeClipContentType, isAudioClip, clipDurationSeconds } from "./clip-upload-protocol.js";
import { verifiedDuration, ClipProbeBusyError } from "./clip-duration.js";
export { verifiedDuration } from "./clip-duration.js";
export { ClipUploadError, MAX_CLIP_BYTES, CLIP_EXT } from "./clip-upload-protocol.js";
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
}

/** The caller owns original-file cleanup. Only durable originals reach this function. */
export async function publishClip(input: PublishClipInput, lockedClient?: ClipDatabaseClient) {
  if (!pool) throw new Error("Database not configured");
  const { userId, filename, title, size, sha256 } = input;
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
  const { rows: users } = await (lockedClient ?? pool).query(`SELECT username FROM users WHERE id=$1`, [userId]);
  if (!users[0]) throw new ClipUploadError(401, "User no longer exists");
  const username = users[0].username;
  let thumbnailName: string | null = null;
  if (!audio) try {
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
    // Shared by legacy and resumable publishing; prevents concurrent quota races.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`clip-publish-user:${userId}`]);
    const count = await client.query(`SELECT count(*)::int AS count FROM clips WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`, [userId]);
    if (count.rows[0].count >= 6) throw new ClipUploadError(429, "Publish limit reached: 6 clips per hour");
    const fp = await client.query(
      `INSERT INTO content_fingerprints (fingerprint, content_type, content_id, owner_name)
       VALUES ($1, 'clip', 0, $2) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`, [sha256, username]);
    if (!fp.rows[0]) {
      const own = await client.query(`SELECT owner_name FROM content_fingerprints WHERE fingerprint=$1`, [sha256]);
      throw new ClipUploadError(409, `🛡️ حقوق الملكية الفكرية: هاد العمل مسجل من قبل باسم ${own.rows[0]?.owner_name ?? "مواطن آخر"} — غير صاحب العمل عندو الحق فالنشر`);
    }
    const { rows } = await client.query(
      `INSERT INTO clips (user_id, username, title, object_name, content_type, size_bytes, duration_sec, thumbnail_object_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, duration_sec, created_at, thumbnail_object_name`,
      [userId, username, title, filename, contentType, size, durationSec, thumbnailName]);
    await client.query(`UPDATE content_fingerprints SET content_id=$1 WHERE id=$2`, [rows[0].id, fp.rows[0].id]);
    commitAttempted = true;
    await client.query("COMMIT");
    return clipWithThumbnail(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // An ambiguous COMMIT must never cause deletion of a possibly published file.
    if (!commitAttempted && thumbnailName) await clipFile(thumbnailName).delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  } finally { if (!lockedClient) client.release(); }
}