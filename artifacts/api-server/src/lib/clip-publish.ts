import { randomInt } from "node:crypto";
import { pool } from "@workspace/db";
import { clipFile } from "./clip-storage.js";
import { clipWithThumbnail } from "../routes/clips-thumbnail-response.js";
import { ClipUploadError, normalizeClipContentType, clipDurationSeconds, clipMediaType, looksLikeImage, parseClipCategory, type ClipCategory, MAX_NEW_CLIP_BYTES, NEW_CLIP_TOO_LARGE } from "./clip-upload-protocol.js";
import { verifiedDuration, ClipProbeBusyError } from "./clip-duration.js";

export { clipFile } from "./clip-storage.js";
export { verifiedDuration } from "./clip-duration.js";
export { ClipUploadError, MAX_CLIP_BYTES, CLIP_EXT, validateClipRightsInput } from "./clip-upload-protocol.js";
const connectDatabase = () => pool.connect();
export type ClipDatabaseClient = Awaited<ReturnType<typeof connectDatabase>>;

export interface PublishClipInput {
  /** Direct original-file uploads never enter the transcoding queue. */
  originalReady?: boolean;
  signal?: AbortSignal;
  /** Library A | B | C | D. Defaults to B. */
  category?: ClipCategory | string;
  userId: number; filename: string; title: string; contentType: string; size: number; sha256: string;
  /** Explicit publication name. `title` remains the original upload filename. */
  displayTitle?: string;
  // Accepted for compatibility with older clients, never used to gate publication.
  purpose?: unknown; originalReference?: unknown; rightsHolderName?: unknown;
  rightsHolderRole?: unknown; isOriginalFootage?: unknown; deferThumbnail?: boolean;
}

/** GDNA-CLIPS-<category>-<0001>. Counter row is locked and rolled back with the publish transaction. */
export async function makeMatricule(client: ClipDatabaseClient, category: ClipCategory): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO clip_matricule_counters (category, n) VALUES ($1, 1)
     ON CONFLICT (category) DO UPDATE SET n = clip_matricule_counters.n + 1 RETURNING n`, [category],
  );
  return `GDNA-CLIPS-${category}-${String(rows[0].n).padStart(4, "0")}`;
}

export function clipName(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.trim() || "clip";
  return base.replace(/\.[^.]+$/, "").trim() || base;
}

export function validateClipDisplayTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ClipUploadError(400, "Clip display title must be text");
  const title = value.trim();
  if (!title) throw new ClipUploadError(400, "Clip display title cannot be blank");
  if ([...title].length > 120) throw new ClipUploadError(400, "Clip display title cannot exceed 120 characters");
  return title;
}

/** Verify real media and stored-byte integrity; accept any positive duration. */
export async function publishClip(
  input: PublishClipInput,
  lockedClient?: ClipDatabaseClient,
  beforeCommit?: (client: ClipDatabaseClient, clip: Record<string, any>) => Promise<void>,
) {
  const contentType = normalizeClipContentType(input.contentType);
  if (!contentType) throw new ClipUploadError(415, "صيغة الصوت أو الفيديو غير مدعومة");
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new ClipUploadError(400, "Invalid media size");
  const displayTitle = validateClipDisplayTitle(input.displayTitle);
  const [metadata] = await clipFile(input.filename).getMetadata();
  if (Number(metadata.size) !== input.size) throw new ClipUploadError(409, "Stored media size does not match");
  const category = parseClipCategory(input.category);
  const mediaType = clipMediaType(contentType);
  let duration = 0; // images have no duration
  if (mediaType === "image") {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of clipFile(input.filename).createReadStream({ start: 0, end: 11 })) chunks.push(Buffer.from(chunk));
    } catch { throw new ClipUploadError(400, "تعذّر التحقق من الصورة — Image illisible"); }
    if (!looksLikeImage(contentType, Buffer.concat(chunks))) throw new ClipUploadError(400, "الملف ليس صورة صالحة — Image invalide");
  } else {
    let verifiedSeconds: number;
    try { verifiedSeconds = await verifiedDuration(clipFile(input.filename), "media", input.signal); }
    catch (error) {
      if (error instanceof ClipProbeBusyError) throw new ClipUploadError(503, "Media verification is busy; retry shortly");
      throw new ClipUploadError(400, "تعذّر التحقق من الملف الصوتي أو الفيديو — الملف غير صالح أو غير مدعوم");
    }
    duration = clipDurationSeconds(verifiedSeconds, contentType);
  }
  // Explicit names are not filenames: dots and slashes are meaningful and
  // must survive unchanged. Legacy callers still derive a name from `title`.
  const name = displayTitle ?? clipName(input.title);
  const client = lockedClient ?? await connectDatabase();
  try {
    await client.query("BEGIN");
    // Share-lock the account through publication. Account erasure first updates
    // this same user row, so it cannot miss an in-flight new clip or allow one
    // to appear after erasure has completed.
    const { rows: users } = await client.query(
      "SELECT username FROM users WHERE id=$1 AND password_hash IS DISTINCT FROM 'DELETED' FOR SHARE", [input.userId],
    );
    if (!users[0]) throw new ClipUploadError(401, "User no longer exists");
    const processingStatus = input.originalReady ? "ready" : "queued";
    // ON CONFLICT keeps collisions non-fatal within the transaction. No code
    // supplied by a client is trusted. The namespace has one million entries.
    const matricule = await makeMatricule(client, category);
    for (let attempt = 0; attempt < 32; attempt++) {
      const code = `HELX-${String(randomInt(1_000_000)).padStart(6, "0")}`;
      const { rows } = await client.query(
        `INSERT INTO clips
           (user_id, username, title, object_name, upload_object_name, content_type,
            size_bytes, duration_sec, code, processing_status, original_name,
            category, matricule, media_type, thumbnail_object_name)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, title, content_type, duration_sec, code, created_at,
                   thumbnail_object_name, processing_status, category, matricule, media_type`,
        [input.userId, users[0].username, name, input.filename, contentType,
          input.size, duration, code, processingStatus, input.title.split(/[\\/]/).pop() || input.title,
          category, matricule, mediaType, mediaType === "image" ? input.filename : null],
      );
      if (!rows[0]) continue;
      if (beforeCommit) await beforeCommit(client, rows[0]);
      await client.query("COMMIT");
      return clipWithThumbnail(rows[0]);
    }
    throw new ClipUploadError(503, "Publication codes are busy; retry shortly");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // Caller checks durable references before cleanup, including ambiguous COMMIT.
    throw error;
  } finally {
    if (!lockedClient) client.release();
  }
}