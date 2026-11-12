import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { clipFile } from "../lib/clip-storage";
import { isR2Reference, providerSibling } from "../lib/r2-storage";
import { generateLiteAudio, PermanentAudioError } from "../lib/lite-audio";
import { encodeLiteAvatar } from "../lib/lite-avatar";
import { readMediaBounded, storeVerifiedMedia, type MediaResolver } from "../lib/lite-media-storage";
import { clipCompressionLock } from "./clip-compression";
import { logger } from "../lib/logger";

/** Invoked serially by the existing media-worker, never by a public HTTP request.
 * Durable reservations + same clip lock as deletion/compression fence every write.
 */
export async function runLiteMediaBatch(signal?: AbortSignal, dependencies: {
  pool?: Pick<typeof pool, "connect">; file?: MediaResolver;
} = {}): Promise<number> {
  if (signal?.aborted) return 0;
  const client = await (dependencies.pool ?? pool).connect();
  const file = dependencies.file ?? clipFile;
  const controller = new AbortController();
  const stop = () => controller.abort();
  const lost = () => { broken = true; stop(); };
  let broken = false, locked = false, clipLocked = false;
  let candidate: { clip_id: number; kind: string } | undefined;
  let output: string | null = null, mirror: string | null = null;
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  client.on("error", lost);
  const enqueue = async (names: (string | null)[]) => {
    await client.query(`INSERT INTO clip_storage_cleanup(object_name,clip_id)
      SELECT name,$1 FROM unnest($2::text[]) name WHERE name IS NOT NULL
      ON CONFLICT(object_name) DO UPDATE SET retry_at=now()`, [candidate!.clip_id, names]);
  };
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(19183724,1) AS ok")).rows[0].ok;
    if (!locked) return 0;
    // Recover exhausted crash reservations before looking for new work.
    await client.query(`WITH exhausted AS MATERIALIZED (
      SELECT clip_id,kind,output_object,mirror_object FROM clip_lite_media
      WHERE state IN ('queued','processing') AND attempts>=4 AND retry_at<=now() FOR UPDATE
    ), expired AS (
      UPDATE clip_lite_media l SET state='failed',error='Audio/poster processing retry limit reached',
        output_object=NULL,mirror_object=NULL FROM exhausted e
      WHERE l.clip_id=e.clip_id AND l.kind=e.kind
      RETURNING e.clip_id,e.output_object,e.mirror_object
    ) INSERT INTO clip_storage_cleanup(object_name,clip_id)
      SELECT name,clip_id FROM expired CROSS JOIN LATERAL unnest(ARRAY[output_object,mirror_object]) name
      WHERE name IS NOT NULL ON CONFLICT(object_name) DO UPDATE SET retry_at=now()`);
    candidate = (await client.query(`SELECT l.clip_id,l.kind FROM clip_lite_media l JOIN clips c ON c.id=l.clip_id
      WHERE l.state IN ('queued','processing') AND l.attempts<4 AND l.retry_at<=now() AND NOT c.is_frozen
      ORDER BY l.retry_at,l.clip_id LIMIT 1`)).rows[0];
    if (!candidate) return 0;
    clipLocked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",
      [clipCompressionLock(candidate.clip_id)])).rows[0].ok;
    if (!clipLocked) return 0;
    await client.query("BEGIN");
    const row = (await client.query(`SELECT l.*,c.object_name,c.thumbnail_object_name
      FROM clip_lite_media l JOIN clips c ON c.id=l.clip_id
      WHERE l.clip_id=$1 AND l.kind=$2 AND l.state IN ('queued','processing') AND NOT c.is_frozen
      FOR UPDATE OF c,l`, [candidate.clip_id, candidate.kind])).rows[0];
    if (!row) { await client.query("ROLLBACK"); return 0; }
    await enqueue([row.output_object, row.mirror_object]);
    const source = candidate.kind === "poster" ? row.thumbnail_object_name : row.object_name;
    if (!source) {
      await client.query("UPDATE clip_lite_media SET state='failed',error='Source unavailable',output_object=NULL,mirror_object=NULL WHERE clip_id=$1 AND kind=$2",
        [candidate.clip_id, candidate.kind]);
      await client.query("COMMIT"); return 0;
    }
    const token = randomUUID();
    output = providerSibling(source, `lite-${candidate.kind}-${token}`);
    mirror = isR2Reference(output) ? `lite-mirror-${candidate.kind}-${token}` : null;
    await client.query(`UPDATE clip_lite_media SET state='processing',attempts=attempts+1,
      retry_at=now()+interval '5 minutes'*power(2,attempts),source_object=$3,
      output_object=$4,mirror_object=$5,sha256=NULL,size_bytes=NULL,mirror_verified_at=NULL,error=NULL
      WHERE clip_id=$1 AND kind=$2`, [candidate.clip_id, candidate.kind, source, output, mirror]);
    await client.query("COMMIT");
    const media = candidate.kind === "audio"
      ? await generateLiteAudio(file(source).createReadStream(), controller.signal)
      : { bytes: await encodeLiteAvatar(await readMediaBounded(source, 5 * 1024 * 1024, controller.signal, file), false),
        mime: "image/webp", durationSec: null };
    const verified = await storeVerifiedMedia(media.bytes, media.mime, output, mirror, controller.signal, file);
    await client.query("BEGIN");
    const published = await client.query(`UPDATE clip_lite_media l SET state='ready',sha256=$3,
      size_bytes=$4,mime=$5,duration_sec=$6,mirror_verified_at=CASE WHEN mirror_object IS NOT NULL THEN now() ELSE NULL END
      WHERE clip_id=$1 AND kind=$2 AND output_object=$7
        AND EXISTS(SELECT 1 FROM clips c WHERE c.id=l.clip_id AND NOT c.is_frozen)
      RETURNING clip_id`, [candidate.clip_id, candidate.kind, verified.sha256, verified.sizeBytes, media.mime, media.durationSec, output]);
    if (!published.rowCount) {
      await enqueue([output, mirror]);
      await client.query("UPDATE clip_lite_media SET state='failed',output_object=NULL,mirror_object=NULL,error='Clip unavailable' WHERE clip_id=$1 AND kind=$2",
        [candidate.clip_id, candidate.kind]);
    }
    await client.query("COMMIT");
    return published.rowCount ? 1 : 0;
  } catch (error) {
    if (!broken && candidate) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("BEGIN");
      const current = (await client.query("SELECT state,output_object FROM clip_lite_media WHERE clip_id=$1 AND kind=$2 FOR UPDATE",
        [candidate.clip_id, candidate.kind])).rows[0];
      // Ambiguous success must never delete a published object.
      if (current?.state !== "ready" || current.output_object !== output) {
        await enqueue([output, mirror]);
        await client.query(`UPDATE clip_lite_media SET state=CASE WHEN $3 OR attempts>=4 THEN 'failed' ELSE 'queued' END,
          output_object=NULL,mirror_object=NULL,error=$4 WHERE clip_id=$1 AND kind=$2`,
        [candidate.clip_id, candidate.kind, error instanceof PermanentAudioError,
          error instanceof PermanentAudioError ? error.message : "Media processing/storage unavailable; retry scheduled"]);
      }
      await client.query("COMMIT");
    }
    logger.warn({ clipId: candidate?.clip_id }, "Lite media processing deferred");
    return 0;
  } finally {
    signal?.removeEventListener("abort", stop);
    client.off("error", lost);
    if (!broken) {
      await client.query("ROLLBACK").catch(() => { broken = true; });
      if (clipLocked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [clipCompressionLock(candidate!.clip_id)]).catch(() => { broken = true; });
      if (locked) await client.query("SELECT pg_advisory_unlock(19183724,1)").catch(() => { broken = true; });
    }
    client.release(broken);
  }
}
