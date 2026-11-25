// Live stats: speed, queue, R2 storage, CDN hits. CDN is reported honestly: no CDN base URL, no hits.
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2Client, r2Config } from "../lib/r2-storage.js";
import { stats } from "./upload-core.js";
import { extractStats, jobs } from "./extract.js";
import { failoverState } from "./failover.js";

let cdnHits = 0;
export const noteCdnHit = () => { cdnHits++; }; // hook for the future CDN edge / redirect route
let storage: { bytes: number; objects: number; at: number } | null = null; let refreshing: Promise<void> | null = null;
function refreshStorage() {
  if (refreshing) return;
  refreshing = (async () => {
    let bytes = 0, objects = 0, token: string | undefined;
    do {
      const r = await r2Client().send(new ListObjectsV2Command({ Bucket: r2Config()!.bucket, Prefix: "qaisypro/", ContinuationToken: token }));
      for (const o of r.Contents ?? []) { bytes += o.Size ?? 0; objects++; }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    storage = { bytes, objects, at: Date.now() };
  })().catch(() => {}).finally(() => { refreshing = null; });
}
export function snapshot() {
  const now = Date.now();
  while (stats.recent.length && now - stats.recent[0][0] > 10_000) stats.recent.shift();
  const windowBytes = stats.recent.reduce((a, [, n]) => a + n, 0);
  if (r2Config() && (!storage || now - storage.at > 60_000)) refreshStorage();
  const running = [...jobs.values()].filter((j) => j.state === "running");
  return {
    speed: { bytesPerSecond: Math.round(windowBytes / 10), windowSeconds: 10, parallel: 8 },
    queue: { chunksInFlight: stats.active, extractJobsRunning: running.length, extractFilesInFlight: running.length ? Math.min(3, 3) : 0 },
    totals: { uploadedBytes: stats.bytesIn, chunks: stats.chunks, extractedFiles: extractStats.files, extractedBytes: extractStats.bytes, uptimeSeconds: Math.round((now - stats.startedAt) / 1000) },
    r2Storage: storage ? { bytes: storage.bytes, objects: storage.objects, asOf: new Date(storage.at).toISOString() } : { computing: Boolean(r2Config()), configured: Boolean(r2Config()) },
    cdn: { configured: Boolean(process.env.QAISYPRO_CDN_BASE_URL), hits: cdnHits },
    failover: failoverState(),
    memory: { rssMB: Math.round(process.memoryUsage().rss / 1048576) },
  };
}
