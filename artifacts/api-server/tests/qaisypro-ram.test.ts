// RAM test: extract a ~2 GB ZIP (500 files). The S3 mock runs in a CHILD process so only the extractor's RAM is measured.
// Usage: RAM_ZIP=/tmp/big.zip node .ram-test.mjs
import fs from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { objects, sinkPrefixes, startS3 } from "./s3-mock.js";
if (process.argv[2] === "mock") {
  const zip = process.env.RAM_ZIP!; await startS3(); sinkPrefixes.push("qaisypro/extracted/");
  objects.set("t/qaisypro/uploads/big/big.zip", { file: zip, size: fs.statSync(zip).size });
  process.send!({ endpoint: process.env.R2_ENDPOINT });
} else {
  const zip = process.env.RAM_ZIP!; const size = fs.statSync(zip).size;
  const child = fork(fileURLToPath(import.meta.url), ["mock"], { env: process.env });
  const { endpoint } = await new Promise<any>((r) => child.once("message", r));
  Object.assign(process.env, { R2_ENDPOINT: endpoint, R2_BUCKET_NAME: "t", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" });
  const { startExtract } = await import("../src/qaisypro/extract.js");
  const base = Math.round(process.memoryUsage().rss / 1048576); const t0 = Date.now();
  const job = startExtract({ id: "big", userId: 1, key: "qaisypro/uploads/big/big.zip", uploadId: "", fileName: "big.zip", size, chunkSize: 0, totalChunks: 1, contentType: "", createdAt: "" });
  let peak = 0; const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss / 1048576); }, 100);
  while (job.state === "running") await new Promise((r) => setTimeout(r, 100));
  clearInterval(iv);
  console.log(JSON.stringify({ state: job.state, error: job.error, zipMB: Math.round(size / 1048576), files: job.files, extractedMB: Math.round(job.bytes / 1048576), failed: job.failed.length, seconds: Math.round((Date.now() - t0) / 1000), rssBeforeMB: base, peakRssMB: Math.round(peak), maxTmpFiles: job.maxTmpFiles }));
  child.kill(); process.exit(0);
}
