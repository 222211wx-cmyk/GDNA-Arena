import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { File } from "@google-cloud/storage";
import { pool } from "@workspace/db";
import { objectStorageClient } from "./chatStorage.js";
import { logger } from "./logger.js";
import { generateClipThumbnail } from "./clip-thumbnail.js";
import { clipWithThumbnail } from "../routes/clips-thumbnail-response.js";
import { ClipUploadError } from "./clip-upload-protocol.js";
export { ClipUploadError, MAX_CLIP_BYTES, CLIP_EXT } from "./clip-upload-protocol.js";
const connectDatabase = () => pool.connect();
export type ClipDatabaseClient = Awaited<ReturnType<typeof connectDatabase>>;

export function clipFile(name: string): File {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const parts = `${dir.replace(/\/$/, "")}/clips/${name}`.replace(/^\//, "").split("/");
  return objectStorageClient.bucket(parts[0]).file(parts.slice(1).join("/"));
}

export async function verifiedDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "pipe:0"], { stdio: ["pipe", "pipe", "pipe"] });
    const input = file.createReadStream();
    let output = "", errors = "", finished = false;
    const finish = (error?: Error, duration?: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input.destroy();
      probe.stdin.destroy();
      if (probe.exitCode === null) probe.kill("SIGKILL");
      if (error) reject(error); else resolve(duration!);
    };
    const timer = setTimeout(() => finish(new Error("MEDIA_PROBE_TIMEOUT")), 30_000);
    probe.stdout.on("data", chunk => { output += String(chunk).slice(0, 1024); });
    probe.stderr.on("data", chunk => { errors = (errors + String(chunk)).slice(0, 4096); });
    probe.on("error", error => finish(error));
    probe.stdin.on("error", error => {
      // ffprobe may close stdin after it has obtained the duration.
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") finish(error);
    });
    input.on("error", error => finish(error));
    probe.on("close", code => {
      const duration = Number.parseFloat(output.trim());
      if (code !== 0 || !Number.isFinite(duration)) finish(new Error(errors || "INVALID_MEDIA_DURATION"));
      else finish(undefined, duration);
    });
    input.pipe(probe.stdin);
  });
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
  const { userId, filename, title, contentType, size, sha256 } = input;
  const [metadata] = await clipFile(filename).getMetadata();
  if (Number(metadata.size) !== size) throw new ClipUploadError(409, "Stored video size does not match");
  let durationSec: number;
  try { durationSec = Math.floor(await verifiedDuration(clipFile(filename))); }
  catch { throw new ClipUploadError(400, "تعذّر التحقق من مدة الفيديو — الملف غير صالح أو غير مدعوم"); }
  if (durationSec < 60) throw new ClipUploadError(400, "أي فيديو أقل من 60 ثانية يتم حظره تلقائياً. الحد الأدنى دقيقة واحدة.");
  const { rows: users } = await (lockedClient ?? pool).query(`SELECT username FROM users WHERE id=$1`, [userId]);
  if (!users[0]) throw new ClipUploadError(401, "User no longer exists");
  const username = users[0].username;
  let thumbnailName: string | null = null;
  try {
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