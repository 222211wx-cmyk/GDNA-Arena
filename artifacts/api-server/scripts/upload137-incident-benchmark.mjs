// Opt-in live development benchmark. No secrets/capabilities are written out.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import pg from "pg";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

if (process.env.NODE_ENV === "production" || process.env.RUN_UPLOAD137_BENCHMARK !== "1") {
  throw new Error("Requires explicit RUN_UPLOAD137_BENCHMARK=1 in development");
}
const root = "/tmp/upload137-incident";
await mkdir(root, { recursive: true });
const fixture = `${root}/67seconds-144011428.mp4`;
const bytes = 144011428, partSize = 5 * 1024 * 1024;
const evidence = { bytes, durationSeconds: 67, parts: 28, environment: "development workspace network, not measured 4G", checks: [] };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({
  region: "auto", endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
let cookie, userId, sessionId, clipId;
const account = { username: `qa${randomUUID().replaceAll("-", "").slice(0, 14)}`, password: randomUUID(), birthDate: "2000-01-01" };
async function api(path, body) {
  const response = await fetch(`http://localhost:80/api${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${path} returned ${response.status}: ${text.slice(0, 300)}`);
  return { response, data: text ? JSON.parse(text) : null };
}
function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  if (!await stat(fixture).catch(() => null)) {
    const result = spawnSync("ffmpeg", [
      "-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=10",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "67",
      "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2",
      "-b:v", "16M", "-minrate", "16M", "-maxrate", "16M", "-bufsize", "32M",
      "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-movflags", "+faststart", fixture,
    ], { encoding: "utf8", timeout: 180000 });
    assert.equal(result.status, 0, result.stderr);
    const size = (await stat(fixture)).size;
    assert.ok(size < bytes - 8);
    const file = await open(fixture, "a");
    const free = Buffer.alloc(8);
    free.writeUInt32BE(bytes - size); free.write("free", 4);
    await file.write(free); await file.truncate(bytes); await file.close();
    evidence.fixtureEncoding = "Synthetic 1080p H264 CBR blue + AAC sine; legal trailing MP4 free box pads exact target size. Not representative of camera compression savings.";
  }
  evidence.inputProbe = probe(fixture);
  assert.equal(Number(evidence.inputProbe.format.size), bytes);
  assert.equal(Number(evidence.inputProbe.format.duration), 67);
  const registration = await api("/auth/register", account);
  cookie = registration.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookie);
  const users = await pool.query("SELECT id FROM users WHERE username=$1", [account.username]);
  userId = users.rows[0]?.id;
  assert.ok(userId);
  const metadata = { action: "initiate", requestId: randomUUID(), filename: "benchmark67.mp4", contentType: "video/mp4", size: bytes, durationSec: null };
  const initiated = await api("/r2/presign", metadata);
  sessionId = initiated.data.sessionId;
  assert.equal(initiated.data.partCount, 28);
  assert.equal(initiated.data.partSize, partSize);
  const file = await open(fixture, "r");
  const parts = [];
  const transferStart = performance.now();
  try {
    for (let n = 1; n <= 28; n++) {
      if (n === 5) {
        // Fresh inspect/initiate requests model lost client memory after the
        // fourth successful part; server, not local offsets, is authoritative.
        const retry = await api("/r2/presign", metadata);
        assert.equal(retry.data.sessionId, sessionId);
        const inspected = await api("/r2/presign", { action: "inspect", sessionId });
        assert.deepEqual(inspected.data.parts.map(p => ({ partNumber: p.partNumber, etag: p.etag })), parts);
        evidence.checks.push("Interrupted after four parts; fresh initiate/inspect recovered exact four ETags; resumed without resending");
      }
      const length = Math.min(partSize, bytes - (n - 1) * partSize);
      const buffer = Buffer.alloc(length);
      assert.equal((await file.read(buffer, 0, length, (n - 1) * partSize)).bytesRead, length);
      const signed = await api("/r2/presign", { action: "part", sessionId, partNumber: n });
      const target = new URL(signed.data.url);
      assert.ok(target.protocol === "https:" && target.hostname.endsWith(".r2.cloudflarestorage.com"));
      const put = await fetch(signed.data.url, { method: "PUT", body: buffer });
      assert.ok(put.ok, `R2 part ${n} returned ${put.status}`);
      const etag = put.headers.get("etag"); assert.ok(etag);
      parts.push({ partNumber: n, etag });
    }
  } finally { await file.close(); }
  evidence.transferWallSeconds = (performance.now() - transferStart) / 1000;
  evidence.throughputMiBPerSecond = bytes / 1048576 / evidence.transferWallSeconds;
  evidence.throughputMegabitsPerSecond = bytes * 8 / 1000000 / evidence.transferWallSeconds;
  evidence.checks.push("All 144011428 media bytes PUT directly to R2 in 28 parts; API received JSON metadata only");
  const start = performance.now();
  const completed = await api("/clips/create", { sessionId, parts });
  evidence.clipCreateStatus = completed.response.status;
  evidence.finalizationWallSeconds = (performance.now() - start) / 1000;
  clipId = completed.data.clip.id;
  evidence.receiptProcessingStatus = completed.data.clip.processing_status;
  const replay = await api("/clips/create", { sessionId, parts });
  assert.equal(replay.data.clip.id, clipId);
  evidence.checks.push("Finalization 200; repeated completion returns same clip");
  for (let attempt = 0; attempt < 120; attempt++) {
    const { rows } = await pool.query("SELECT processing_status,object_name,upload_object_name FROM clips WHERE id=$1 AND user_id=$2", [clipId, userId]);
    const row = rows[0];
    if (row?.processing_status === "ready") {
      assert.notEqual(row.object_name, row.upload_object_name);
      evidence.processingOutputSuffix720p = row.object_name.endsWith("_720p.mp4");
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.object_name.slice(3) }));
      const output = `${root}/processed.mp4`;
      await pipeline(result.Body, createWriteStream(output));
      evidence.outputProbe = probe(output);
      const video = evidence.outputProbe.streams.find(s => s.codec_type === "video");
      assert.ok(video.width <= 1280 && video.height <= 720); assert.equal(video.codec_name, "h264");
      assert.equal(evidence.outputProbe.streams.find(s => s.codec_type === "audio").codec_name, "aac");
      evidence.checks.push("Persistent worker processed <=720p H264 + AAC; original pointer retained");
      break;
    }
    assert.notEqual(row?.processing_status, "failed");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.ok(evidence.outputProbe, "Worker did not finish within four minutes");
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  // Exact account-owned media only, never historical rows/objects.
  if (userId) {
    const rows = await pool.query("SELECT id,object_name,upload_object_name,thumbnail_object_name,processing_output_object FROM clips WHERE user_id=$1", [userId]);
    const objects = new Set(rows.rows.flatMap(r => [r.object_name, r.upload_object_name, r.thumbnail_object_name, r.processing_output_object]).filter(Boolean));
    if (sessionId) {
      await api("/r2/presign", { action: "abort", sessionId }).catch(() => {});
      const uploads = await pool.query("SELECT object_name FROM r2_clip_uploads WHERE id=$1 AND user_id=$2", [sessionId, userId]);
      uploads.rows.forEach(row => objects.add(row.object_name));
    }
    // Account deletion uses the application's compression fencing/cleanup.
    const deleted = await fetch("http://localhost:80/api/auth/me", {
      method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: account.password }),
    });
    evidence.accountDeletionStatus = deleted.status;
    if (deleted.ok) {
      for (const name of objects) {
        assert.ok(name.startsWith("r2:clips/"));
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: name.slice(3) }));
      }
      evidence.exactTestObjectsCleaned = objects.size;
    }
  }
  await writeFile("/tmp/upload137-incident-result.json", JSON.stringify(evidence, null, 2));
  await pool.end(); s3.destroy();
}