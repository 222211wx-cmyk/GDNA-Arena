import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger.js";
import { runClipMediaBatch } from "./jobs/clip-media.js";
import { runClipCompressionBatch } from "./jobs/clip-compression.js";
import { runClipThumbnailRetryBatch } from "./jobs/clip-thumbnail-retry.js";
import { runClipStorageCleanupBatch, abortOneExpiredR2Upload } from "./jobs/clip-storage-cleanup.js";
import { startClipTempCleanupWorker } from "./lib/clip-temp-cleanup.js";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port<=0) throw new Error("Worker PORT is required");
const controller = new AbortController();
let stopping = false;
const server = http.createServer((req,res) => {
  if (req.url!=="/healthz" && req.url!=="/internal-media-worker/healthz") { res.writeHead(404).end(); return; }
  res.writeHead(stopping ? 503:200,{"Content-Type":"application/json","Cache-Control":"no-store"});
  res.end(JSON.stringify({ok:!stopping,service:"media-worker"}));
});
server.listen(port,"0.0.0.0");
startClipTempCleanupWorker();
const stop = () => { stopping=true; controller.abort(); server.close(); };
process.on("SIGTERM",stop);
process.on("SIGINT",stop);
// One shared advisory lock bounds ALL encoder work across worker replicas.
async function loop() {
  while (!stopping) {
    const lock = await pool.connect();
    lock.on("error",stop);
    let acquired = false;
    try {
      acquired = (await lock.query("SELECT pg_try_advisory_lock(19183723,1) AS acquired")).rows[0].acquired;
      if (acquired && !stopping) {
        await runClipMediaBatch(controller.signal);
        if (!stopping) await runClipCompressionBatch(controller.signal);
        if (!stopping) await runClipThumbnailRetryBatch(controller.signal);
        if (!stopping) await runClipStorageCleanupBatch();
        if (!stopping) await abortOneExpiredR2Upload();
      }
    } catch { logger.warn("Media worker batch deferred"); }
    finally {
      if (acquired) await lock.query("SELECT pg_advisory_unlock(19183723,1)").catch(()=>{});
      lock.off("error",stop);
      lock.release();
    }
    if (!stopping) await sleep(3000);
  }
  await pool.end();
}
void loop().then(()=>process.exit(0)).catch(()=>process.exit(1));