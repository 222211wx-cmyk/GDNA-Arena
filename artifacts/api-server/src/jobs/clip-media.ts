import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { publishClip } from "../lib/clip-publish.js";
import { verifiedDuration } from "../lib/clip-duration.js";
import { clipFile, providerSibling } from "../lib/clip-storage.js";
import { clipDurationSeconds, ClipUploadError, MAX_NEW_CLIP_BYTES } from "../lib/clip-upload-protocol.js";
import { compressStoredClip } from "../lib/clip-server-compression.js";
import { logger } from "../lib/logger.js";

export async function runClipMediaBatch(signal: AbortSignal): Promise<number> {
  const client = await pool.connect();
  const token = randomUUID();
  let job: any;
  let stage = "claim";
  let heartbeat: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort",abort,{once:true});
  client.on("error",abort);
  try {
    const claimed = await client.query(
      `WITH next AS (
        SELECT session_id FROM clip_media_jobs
        WHERE state IN ('queued','processing') AND retry_at<=NOW()
        ORDER BY retry_at,session_id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE clip_media_jobs j SET state='processing',token=$1,attempts=attempts+1,
        retry_at=NOW()+INTERVAL '2 minutes'
      FROM next WHERE j.session_id=next.session_id RETURNING j.*`,[token]);
    job = claimed.rows[0];
    if (!job) return 0;
    stage = "verification";
    heartbeat = setInterval(() => {
      client.query(`UPDATE clip_media_jobs SET retry_at=NOW()+INTERVAL '2 minutes'
        WHERE session_id=$1 AND token=$2 AND state='processing'`,[job.session_id,token])
        .then(r=> { if (!r.rowCount) abort(); }).catch(abort);
    },20_000);
    const {rows} = await client.query("SELECT * FROM r2_clip_uploads WHERE id=$1",[job.session_id]);
    const upload = rows[0];
    if (!upload) throw new ClipUploadError(400,"Upload account was removed");
    if (job.attempts > 8) throw new ClipUploadError(400,"Media processing retry limit reached");
    if (Number(upload.size_bytes)>MAX_NEW_CLIP_BYTES) throw new ClipUploadError(413,"Maximum file size is 10 GiB");
    const [metadata] = await clipFile(upload.object_name).getMetadata();
    if (Number(metadata.size)!==Number(upload.size_bytes)) throw new ClipUploadError(409,"Stored media size does not match");
    try {
      clipDurationSeconds(await verifiedDuration(clipFile(upload.object_name),
        upload.content_type.startsWith("audio/") ? "audio":"video",controller.signal),upload.content_type);
    } catch(error) {
      if (error instanceof Error && /^INVALID_(?:AUDIO|VIDEO|MEDIA)/.test(error.message)) {
        throw new ClipUploadError(400,"Uploaded media is invalid or its actual stream type does not match");
      }
      throw error;
    }
    if (controller.signal.aborted) throw new Error("Worker interrupted");
    // Reserve a unique output before I/O. A later attempt cannot overwrite it.
    const outputName = providerSibling(upload.object_name,`clip_${token.replaceAll("-","")}${upload.content_type.startsWith("audio/") ? ".m4a" : "_720p.mp4"}`);
    await client.query("BEGIN");
    if (job.output_object) await client.query(
      "INSERT INTO clip_storage_cleanup(object_name,clip_id) VALUES ($1,0) ON CONFLICT DO NOTHING",[job.output_object]);
    const reserved = await client.query("UPDATE clip_media_jobs SET output_object=$3 WHERE session_id=$1 AND token=$2 RETURNING session_id",
      [job.session_id,token,outputName]);
    await client.query("COMMIT");
    if (!reserved.rowCount) throw new Error("Worker lease lost");
    job.output_object = outputName;
    stage = "compression";
    const output = await compressStoredClip({filename:upload.object_name,contentType:upload.content_type,
      size:Number(upload.size_bytes),outputFilename:outputName,force:true,signal:controller.signal});
    if (!output || controller.signal.aborted) throw new Error("Media processing interrupted");
    stage = "publication";
    await publishClip({userId:upload.user_id,filename:output.filename,contentType:output.contentType,
      size:output.size,title:upload.original_name,displayTitle:upload.display_title ?? undefined,sha256:"",deferThumbnail:true,signal:controller.signal},
      client,async (transaction,clip) => {
        if (controller.signal.aborted) throw new Error("Worker interrupted");
        const fenced = await transaction.query(
          `UPDATE clip_media_jobs SET state='ready',error=NULL,token=NULL
           WHERE session_id=$1 AND token=$2 AND state='processing' RETURNING session_id`,[job.session_id,token]);
        if (!fenced.rowCount) throw new Error("Worker lease lost");
        await transaction.query("UPDATE clips SET upload_object_name=$2,processing_status='ready' WHERE id=$1",[clip.id,upload.object_name]);
        await transaction.query("UPDATE r2_clip_uploads SET state='published',clip_id=$2,updated_at=NOW() WHERE id=$1",[job.session_id,clip.id]);
      });
    return 1;
  } catch(error) {
    logger.warn({stage,sessionId:job?.session_id,attempt:job?.attempts,
      errorName:error instanceof Error ? error.name:"UnknownError"},
      "Media job deferred or failed");
    await client.query("ROLLBACK").catch(()=>{});
    if (job) {
      const permanent = !controller.signal.aborted && error instanceof ClipUploadError && error.status < 500;
      await client.query(
        `UPDATE clip_media_jobs SET state=$3,error=$4,token=NULL,
         retry_at=NOW()+make_interval(secs=>$5)
         WHERE session_id=$1 AND token=$2`,
        [job.session_id,token,permanent || job.attempts>=8 ? "failed":"queued",
          permanent ? (error as Error).message : job.attempts>=8
            ? "Media processing failed after 8 attempts" : "Media processing interrupted; retry scheduled",
          signal.aborted ? 0 : Math.min(3600,2**job.attempts*15)]).catch(()=>{});
      if (job.output_object) await client.query(
        `INSERT INTO clip_storage_cleanup(object_name,clip_id,retry_at)
         VALUES ($1,0,NOW()+INTERVAL '5 minutes') ON CONFLICT DO NOTHING`,
        [job.output_object]).catch(()=>{});
    }
    return 0;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    controller.abort();
    signal.removeEventListener("abort",abort);
    client.off("error",abort);
    client.release();
  }
}