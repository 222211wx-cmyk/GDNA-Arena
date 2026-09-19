import { pool } from "@workspace/db";
import { clipFile } from "../lib/clip-storage.js";
import { logger } from "../lib/logger";
import { AbortMultipartUploadCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, r2Config, r2Key } from "../lib/r2-storage.js";

const BATCH_SIZE = 12;
const BATCH_DEADLINE_MS = 90_000;
const DELETE_TIMEOUT_MS = 10_000;
const INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | undefined;

export async function abortOneExpiredR2Upload(): Promise<void> {
  const config = r2Config();
  if (!config) return;
  const { rows } = await pool.query<{
    id: string; object_name: string; multipart_upload_id: string;
  }>(
    `SELECT id,object_name,multipart_upload_id FROM r2_clip_uploads
     WHERE state='active' AND expires_at <= NOW()
       AND NOT EXISTS (SELECT 1 FROM clip_media_jobs j WHERE j.session_id=r2_clip_uploads.id)
     ORDER BY expires_at LIMIT 1`,
  );
  const upload = rows[0];
  if (!upload) return;
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [`r2-upload:${upload.id}`],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return;
    await client.query("BEGIN");
    // Recheck under a row lock: owner activity may have renewed the lease
    // after the candidate scan. Fence renewal until remote abort is settled.
    const current = await client.query(
      `SELECT id FROM r2_clip_uploads WHERE id=$1 AND state='active' AND expires_at<=NOW()
       AND NOT EXISTS (SELECT 1 FROM clip_media_jobs j WHERE j.session_id=r2_clip_uploads.id)
       FOR UPDATE`,
      [upload.id],
    );
    if (!current.rows[0]) { await client.query("ROLLBACK"); return; }
    try {
      await r2Client().send(new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: r2Key(upload.object_name),
        UploadId: upload.multipart_upload_id,
      }));
    } catch (error) {
      if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
    }
    await client.query(
      `UPDATE r2_clip_uploads SET state='aborted',updated_at=NOW()
       WHERE id=$1 AND state='active' AND expires_at <= NOW()`, [upload.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (acquired) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`r2-upload:${upload.id}`]).catch(() => {});
    client.release();
  }
}

async function removeObject(objectName: string): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      /^r2:citizen-media\/[1-9]\d*\/(?:avatar|cover)\/[a-f0-9-]{36}$/.test(objectName)
        ? r2Client().send(new DeleteObjectCommand({ Bucket: r2Config()!.bucket, Key: objectName.slice(3) }))
        : clipFile(objectName).delete({ ignoreNotFound: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("CLIP_CLEANUP_TIMEOUT")), DELETE_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  // A timed-out SDK request may still finish. That is safe: names are immutable
  // upload identities, deletion is idempotent, and retries never recreate media.
}

/**
 * Durable per-object outbox, independent of the now-deleted clip. Each claim
 * commits backoff before storage I/O so a crash or lost response leaves work
 * eligible later. Concurrent replicas claim disjoint due rows without holding
 * a database transaction open across a storage request.
 */
export async function runClipStorageCleanupBatch(clipId?: number): Promise<number> {
  const client = await pool.connect();
  let destroyClient = false;
  let removed = 0;
  const deadline = Date.now() + BATCH_DEADLINE_MS;
  try {
    await client.query("SET statement_timeout = '5s'");
    for (let n = 0; n < BATCH_SIZE && Date.now() < deadline; n++) {
      const { rows } = await client.query<{
        object_name: string; clip_id: number; attempts: number;
      }>(`
        WITH candidate AS (
          SELECT pending.object_name FROM clip_storage_cleanup pending
          WHERE pending.retry_at <= NOW() AND ($1::integer IS NULL OR pending.clip_id=$1)
            AND NOT EXISTS (
              SELECT 1 FROM clips c WHERE c.object_name=pending.object_name
                OR c.upload_object_name=pending.object_name
                OR c.thumbnail_object_name=pending.object_name
                OR c.processing_output_object=pending.object_name
            )
            AND NOT EXISTS (
              SELECT 1 FROM r2_clip_uploads u JOIN clip_media_jobs j ON j.session_id=u.id
              WHERE u.object_name=pending.object_name
            )
            AND NOT EXISTS (
              SELECT 1 FROM citizen_profiles p WHERE
                'r2:citizen-media/' || substring(p.avatar_url from '^/api/citizen-profiles/media/(.*)$') = pending.object_name
                OR 'r2:citizen-media/' || substring(p.cover_url from '^/api/citizen-profiles/media/(.*)$') = pending.object_name
            )
          ORDER BY pending.retry_at, pending.object_name
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE clip_storage_cleanup q
        SET attempts = q.attempts + 1,
            retry_at = NOW() + INTERVAL '1 second' *
              LEAST(86400, 300 * POWER(2, LEAST(q.attempts, 9)))
        FROM candidate WHERE q.object_name = candidate.object_name
        RETURNING q.object_name, q.clip_id, q.attempts`, [clipId ?? null]);
      const item = rows[0];
      if (!item) break;
      try {
        await removeObject(item.object_name);
      } catch (err) {
        logger.warn({
          err, clipId: item.clip_id, objectName: item.object_name, attempt: item.attempts,
        }, "[clips] storage cleanup deferred");
        continue;
      }
      // Fence a delayed acknowledgement from an older attempt. If DB ack fails,
      // keep the entry and safely delete the already-missing object next time.
      const ack = await client.query(
        `DELETE FROM clip_storage_cleanup WHERE object_name=$1 AND attempts=$2`,
        [item.object_name, item.attempts],
      );
      removed += ack.rowCount ?? 0;
    }
    return removed;
  } catch (err) {
    destroyClient = true;
    throw err;
  } finally {
    if (!destroyClient) {
      try { await client.query("RESET statement_timeout"); }
      catch { destroyClient = true; }
    }
    client.release(destroyClient);
  }
}

export function startClipStorageCleanupJob(): void {
  if (timer) return;
  const tick = async () => {
    try {
      await runClipStorageCleanupBatch();
      await abortOneExpiredR2Upload();
    }
    catch (err) { logger.error({ err }, "[clips] storage cleanup batch failed"); }
    finally {
      timer = setTimeout(tick, INTERVAL_MS);
      timer.unref();
    }
  };
  timer = setTimeout(tick, 30_000);
  timer.unref();
}