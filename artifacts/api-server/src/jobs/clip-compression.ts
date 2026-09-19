import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { compressStoredClip, ClipCompressionCleanupError } from "../lib/clip-server-compression.js";
import { logger } from "../lib/logger.js";
import { retryThumbnailName } from "../lib/clip-storage-names.js";
import { providerSibling } from "../lib/clip-storage.js";

const GLOBAL_LOCK_NAMESPACE = 19183722;
const GLOBAL_LOCK_KEY = 1;
const MAX_ATTEMPTS = 8;
let timer: NodeJS.Timeout | undefined;
let running = false;
export const clipCompressionLock = (id: number) => `clip-compression:${id}`;

type Candidate = {
  id: number; object_name: string; content_type: string; size_bytes: string;
  processing_attempts: number; processing_output_object: string | null;
};

/**
 * Durable, one-at-a-time processing across replicas. Short DB transactions
 * persist attempt + candidate object BEFORE encoding. Session advisory locks
 * fence deletion; DELETE returns 409 rather than waiting on a long encoder.
 * Originals remain playable until a successful atomic pointer swap.
 */
export async function runClipCompressionBatch(): Promise<number> {
  if (running) return 0;
  running = true;
  const client = await pool.connect().catch(error => { running = false; throw error; });
  let globalLocked = false, clipLocked = false, broken = false;
  let candidate: Candidate | undefined;
  const controller = new AbortController();
  const lostConnection = (error: Error) => { broken = true; controller.abort(error); };
  client.on("error", lostConnection);
  const enqueue = async (names: (string | null | undefined)[]) => {
    const unique = [...new Set(names.filter((name): name is string => !!name))];
    if (!unique.length || !candidate) return;
    await client.query(
      `INSERT INTO clip_storage_cleanup (object_name, clip_id)
       SELECT name,$1 FROM unnest($2::text[]) AS name
       ON CONFLICT (object_name) DO UPDATE SET retry_at=NOW()`,
      [candidate.id, unique],
    );
  };
  let outputName: string | undefined;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1,$2) AS acquired", [GLOBAL_LOCK_NAMESPACE, GLOBAL_LOCK_KEY]);
    globalLocked = lock.rows[0]?.acquired === true;
    if (!globalLocked) return 0;
    await client.query(
      `WITH exhausted AS (
         SELECT id, object_name, processing_output_object FROM clips
         WHERE processing_status='processing' AND processing_attempts >= $1
           AND processing_retry_at <= NOW()
         FOR UPDATE
       ), cleared AS (
         UPDATE clips c SET processing_status='failed', processing_output_object=NULL
         FROM exhausted e WHERE c.id=e.id
         RETURNING e.id, e.object_name, e.processing_output_object
       )
       INSERT INTO clip_storage_cleanup (object_name,clip_id)
       SELECT processing_output_object,id FROM cleared
       WHERE processing_output_object IS NOT NULL AND processing_output_object <> object_name
       ON CONFLICT (object_name) DO NOTHING`, [MAX_ATTEMPTS],
    );
    const { rows } = await client.query<Candidate>(
      `SELECT id, object_name, content_type, size_bytes, processing_attempts, processing_output_object
       FROM clips WHERE processing_status IN ('queued','processing')
         AND processing_retry_at <= NOW() AND processing_attempts < $1 AND is_frozen=FALSE
       ORDER BY processing_retry_at,id LIMIT 1`, [MAX_ATTEMPTS],
    );
    candidate = rows[0];
    if (!candidate) return 0;
    const acquired = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [clipCompressionLock(candidate.id)],
    );
    clipLocked = acquired.rows[0]?.acquired === true;
    if (!clipLocked) return 0;
    await client.query("BEGIN");
    const current = await client.query<Candidate>(
      `SELECT id, object_name, content_type, size_bytes, processing_attempts, processing_output_object
       FROM clips WHERE id=$1 AND object_name=$2 AND processing_status IN ('queued','processing')
       FOR UPDATE`, [candidate.id, candidate.object_name],
    );
    if (!current.rows[0]) { await client.query("ROLLBACK"); return 0; }
    candidate = current.rows[0];
    // A previous process died; this attempt's exclusive lock means no older
    // active owner may write the old candidate. Connection loss aborts its I/O.
    await enqueue([candidate.processing_output_object]);
    outputName = providerSibling(candidate.object_name,
      `clip_compressed_${randomUUID().replaceAll("-", "")}${candidate.content_type.startsWith("audio/") ? ".m4a" : ".mp4"}`);
    candidate.processing_attempts++;
    await client.query(
      `UPDATE clips SET processing_status='processing', processing_attempts=$2,
       upload_object_name=COALESCE(upload_object_name,object_name),
       processing_output_object=$3, processing_retry_at=NOW()+INTERVAL '5 minutes'
       WHERE id=$1`, [candidate.id, candidate.processing_attempts, outputName],
    );
    await client.query("COMMIT");
    const compressionInput = {
      filename: candidate.object_name, contentType: candidate.content_type, size: Number(candidate.size_bytes),
      outputFilename: outputName, signal: controller.signal, force: true,
    };
    const output = await compressStoredClip(compressionInput);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (output && output.filename !== outputName) {
      await enqueue([output.filename]);
      throw new Error("Compressor did not use its durably reserved output name");
    }
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id, thumbnail_object_name FROM clips WHERE id=$1 AND object_name=$2 AND processing_attempts=$3
       AND processing_output_object=$4 FOR UPDATE`,
      [candidate.id, candidate.object_name, candidate.processing_attempts, outputName],
    );
    if (!locked.rows[0]) {
      await enqueue([outputName]);
      await client.query("COMMIT");
      return 0;
    }
    if (output) {
      await client.query(
        `UPDATE clips SET object_name=$2, content_type=$3, size_bytes=$4,
         processing_status='ready', processing_output_object=NULL WHERE id=$1`,
        [candidate.id, output.filename, output.contentType, output.size],
      );
      const priorPoster = retryThumbnailName(candidate.id, candidate.object_name);
      // upload_object_name is a durable RETAINED original, not merely an
      // idempotency key. Optimization never authorizes deletion of its source.
      await enqueue([locked.rows[0].thumbnail_object_name === priorPoster ? null : priorPoster]);
    } else {
      await client.query(
        `UPDATE clips SET processing_status='unchanged', processing_output_object=NULL WHERE id=$1`, [candidate.id],
      );
      await enqueue([outputName]);
    }
    await client.query("COMMIT");
    return 1;
  } catch (error) {
    if (!broken) {
      try {
        await client.query("ROLLBACK");
        await client.query("BEGIN");
        if (candidate && outputName) {
          // Check the current pointer before deleting a candidate after an
          // ambiguous COMMIT. Never clean a possibly published object.
          const { rows } = await client.query(
            "SELECT object_name FROM clips WHERE id=$1 FOR UPDATE", [candidate.id],
          );
          if (rows[0]?.object_name !== outputName) {
            if (Number((error as { code?: unknown })?.code) !== 412) await enqueue([outputName]);
            if (error instanceof ClipCompressionCleanupError && error.orphanFilename !== rows[0]?.object_name) {
              await enqueue([error.orphanFilename]);
            }
            await client.query(
              `UPDATE clips SET processing_status=$4, processing_output_object=NULL,
               processing_retry_at=NOW()+INTERVAL '1 minute'*POWER(2,LEAST(processing_attempts,8))
               WHERE id=$1 AND object_name=$2 AND processing_attempts=$3`,
              [candidate.id, candidate.object_name, candidate.processing_attempts,
                candidate.processing_attempts >= MAX_ATTEMPTS ? "failed" : "queued"],
            );
          }
        }
        await client.query("COMMIT");
      } catch { broken = true; }
    }
    logger.warn({ err: error, clipId: candidate?.id }, "[clips] compression deferred; original retained");
    return 0;
  } finally {
    controller.abort();
    if (!broken) {
      try {
        if (clipLocked && candidate) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [clipCompressionLock(candidate.id)]);
        if (globalLocked) await client.query("SELECT pg_advisory_unlock($1,$2)", [GLOBAL_LOCK_NAMESPACE, GLOBAL_LOCK_KEY]);
      } catch { broken = true; }
    }
    client.off("error", lostConnection);
    client.release(broken);
    running = false;
  }
}

export function startClipCompressionJob(): void {
  if (timer) return;
  const tick = async () => {
    try { await runClipCompressionBatch(); }
    catch (err) { logger.error({ err }, "[clips] compression worker failed"); }
    finally { timer = setTimeout(tick, 15_000); timer.unref(); }
  };
  timer = setTimeout(tick, 15_000);
  timer.unref();
}