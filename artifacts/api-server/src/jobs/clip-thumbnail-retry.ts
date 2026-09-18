import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pool } from "@workspace/db";
import { clipFile, retryThumbnailName } from "../lib/clip-storage.js";
import { generateClipThumbnail } from "../lib/clip-thumbnail.js";
import { logger } from "../lib/logger";

export const CLIP_THUMBNAIL_RETRY_INTERVAL_MS = 5 * 60_000;
export const CLIP_THUMBNAIL_RETRY_BATCH_SIZE = 3;
export const CLIP_THUMBNAIL_RETRY_BATCH_DEADLINE_MS = 90_000;
export const CLIP_THUMBNAIL_MAX_ATTEMPTS = 8;
// Dedicated two-int advisory-lock namespace, shared by all API replicas.
export const CLIP_THUMBNAIL_LOCK_NAMESPACE = 19183721;
export const CLIP_THUMBNAIL_LOCK_KEY = 1;
let running = false;
let timer: NodeJS.Timeout | undefined;

async function storePoster(name: string, jpeg: Buffer): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  timeout.unref();
  try {
    // Unlike a Promise.race around save(), abort destroys the writer before
    // releasing the clip lock rather than leaving application-level retries.
    await pipeline(
      Readable.from([jpeg]),
      clipFile(name).createWriteStream({
        resumable: false,
        timeout: 10_000,
        metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" },
      }),
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Small, serial, restart-safe batches. Nothing in the public request path calls
 * this function. Attempts/backoff commit BEFORE processing, so crashes consume
 * an attempt too. The row lock is shared with DELETE /clips/:id.
 */
export async function runClipThumbnailRetryBatch(): Promise<number> {
  if (running) return 0;
  running = true;
  const client = await pool.connect().catch((err: unknown) => {
    running = false;
    throw err;
  });
  let locked = false;
  let destroyClient = false;
  let generated = 0;
  const deadline = Date.now() + CLIP_THUMBNAIL_RETRY_BATCH_DEADLINE_MS;
  try {
    await client.query("SET statement_timeout = '5s'");
    const lock = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [CLIP_THUMBNAIL_LOCK_NAMESPACE, CLIP_THUMBNAIL_LOCK_KEY],
    );
    locked = lock.rows[0]?.acquired === true;
    if (!locked) return 0;

    for (let n = 0; n < CLIP_THUMBNAIL_RETRY_BATCH_SIZE && Date.now() < deadline; n++) {
      // One autocommitted statement reserves work and durably advances backoff.
      // Failed/poison files cannot starve unattempted older clips.
      const claim = await client.query<{ id: number; thumbnail_retry_attempts: number }>(`
        WITH candidate AS (
          SELECT id FROM clips
          WHERE thumbnail_object_name IS NULL AND is_frozen = FALSE
            AND content_type LIKE 'video/%'
            AND thumbnail_retry_attempts < $1 AND thumbnail_retry_at <= NOW()
          ORDER BY thumbnail_retry_at, id
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE clips c
        SET thumbnail_retry_attempts = c.thumbnail_retry_attempts + 1,
            thumbnail_retry_at = NOW() + INTERVAL '5 minutes' *
              POWER(2, c.thumbnail_retry_attempts)
        FROM candidate WHERE c.id = candidate.id
        RETURNING c.id, c.thumbnail_retry_attempts`, [CLIP_THUMBNAIL_MAX_ATTEMPTS]);
      const candidate = claim.rows[0];
      if (!candidate) break;

      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ object_name: string }>(
          `SELECT object_name FROM clips
           WHERE id=$1 AND thumbnail_object_name IS NULL AND is_frozen=FALSE
             AND content_type LIKE 'video/%'
           FOR UPDATE SKIP LOCKED`, [candidate.id],
        );
        if (!rows[0]) {
          await client.query("ROLLBACK");
          continue; // Deleted, already completed, frozen, or being deleted.
        }
        const name = retryThumbnailName(candidate.id, rows[0].object_name);
        const jpeg = await generateClipThumbnail(clipFile(rows[0].object_name));
        await storePoster(name, jpeg);
        await client.query(
          `UPDATE clips SET thumbnail_object_name=$2
           WHERE id=$1 AND thumbnail_object_name IS NULL AND content_type LIKE 'video/%'`, [candidate.id, name],
        );
        await client.query("COMMIT");
        generated++;
        logger.info({ clipId: candidate.id }, "[clips] retry poster ready");
      } catch (err) {
        try { await client.query("ROLLBACK"); }
        catch { destroyClient = true; throw err; }
        // Keep the stable candidate tracked by the surviving clip. Do not
        // delete it on ambiguous COMMIT: the pointer may already be committed.
        // Retry overwrites it; deletion removes it even if the pointer is null.
        logger.warn({
          err, clipId: candidate.id, attempt: candidate.thumbnail_retry_attempts,
          exhausted: candidate.thumbnail_retry_attempts >= CLIP_THUMBNAIL_MAX_ATTEMPTS,
        }, "[clips] retry poster failed");
      }
    }
    return generated;
  } catch (err) {
    // An interrupted advisory-lock acquisition can have succeeded on the
    // server even if its response was lost. Never pool that session again.
    destroyClient = true;
    throw err;
  } finally {
    if (client) {
      if (locked && !destroyClient) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock($1, $2)",
            [CLIP_THUMBNAIL_LOCK_NAMESPACE, CLIP_THUMBNAIL_LOCK_KEY],
          );
        }
        catch { destroyClient = true; }
      }
      if (!destroyClient) {
        try { await client.query("RESET statement_timeout"); }
        catch { destroyClient = true; }
      }
      client.release(destroyClient);
    }
    running = false;
  }
}

export function startClipThumbnailRetryJob(): void {
  if (timer) return;
  const tick = async () => {
    try { await runClipThumbnailRetryBatch(); }
    catch (err) { logger.error({ err }, "[clips] poster retry batch failed"); }
    finally {
      timer = setTimeout(tick, CLIP_THUMBNAIL_RETRY_INTERVAL_MS);
      timer.unref();
    }
  };
  // Do not delay HTTP startup or run expensive work in a public feed request.
  timer = setTimeout(tick, 30_000);
  timer.unref();
}