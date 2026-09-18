import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import { ClipProbeBusyError, verifiedDuration } from "./clip-duration.js";
import { clipDurationSeconds, normalizeClipContentType, clipDownloadExtension, isAudioClip, resolveClipUploadType } from "./clip-upload-protocol.js";

async function withLimits(
  limits: { inputBytes?: number; outputBytes?: number; timeoutMs?: number },
  run: () => Promise<void>,
) {
  const key = Symbol.for("gdna.clipDuration.testLimits");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  globals[key] = limits;
  try { await run(); } finally { delete globals[key]; }
}

function fixture(extension: string, seconds = 60, faststart = false): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "clip-duration-"));
  try {
    const path = join(directory, `sample.${extension}`);
    const result = spawnSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi",
      "-i", seconds > 86400 ? `color=size=16x16:rate=1/${seconds}` : "testsrc2=size=320x180:rate=10",
      ...(seconds > 86400 ? ["-frames:v", "1"] : ["-t", String(seconds)]),
      "-threads", "1", "-c:v", extension === "webm" ? "libvpx" : "libx264",
      ...(extension === "webm" ? ["-deadline", "realtime"] : ["-preset", "ultrafast"]),
      ...(faststart ? ["-movflags", "+faststart"] : []), path,
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    return readFileSync(path);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function source(contents: Buffer, mode: "normal" | "stall" | "error" | "throw" | "close" = "normal") {
  const ranges: Array<{ start: number; end: number }> = [];
  const streams: Readable[] = [];
  let bytes = 0;
  const file = {
    async getMetadata() { return [{ size: contents.length }]; },
    createReadStream(range: { start: number; end: number }) {
      ranges.push(range);
      if (mode === "throw") throw new Error("GCS_OPEN_FAILED");
      let offset = range.start;
      const stream = new Readable({
        read() {
          if (mode === "stall") return;
          setImmediate(() => {
            if (this.destroyed) return;
            if (mode === "error") { this.destroy(new Error("GCS_READ_FAILED")); return; }
            if (mode === "close") { this.destroy(); return; }
            if (offset > range.end) { this.push(null); return; }
            const end = Math.min(offset + 1024, range.end + 1);
            bytes += end - offset;
            this.push(contents.subarray(offset, end));
            offset = end;
          });
        },
      });
      streams.push(stream);
      return stream;
    },
  } as unknown as File;
  return { file, ranges, streams, bytes: () => bytes };
}

for (const extension of ["mp4", "mov", "webm"]) {
  test(`verifies real 60-second ${extension}, including seekable tail metadata`, async () => {
    const data = fixture(extension);
    if (extension !== "webm") {
      assert.ok(data.indexOf(Buffer.from("moov")) > data.indexOf(Buffer.from("mdat")));
    }
    const input = source(data);
    const original = Buffer.from(data);
    assert.ok(Math.abs(await verifiedDuration(input.file) - 60) < 0.1);
    if (extension !== "webm") {
      assert.ok(input.ranges.some(range => range.start > 0), "must seek to tail metadata");
      assert.ok(input.bytes() < data.length, "must not download the full original");
    }
    assert.ok(input.streams.every(stream => stream.destroyed));
    assert.deepEqual(data, original, "verification must not mutate original bytes");
  });
}

test("preserves sub-minute precision and accepts durations above 24 hours", async () => {
  assert.ok((await verifiedDuration(source(fixture("mp4", 59.9)).file)) < 60);
  assert.equal(Math.floor(await verifiedDuration(source(fixture("mp4", 61)).file)), 61);
  assert.ok((await verifiedDuration(source(fixture("mp4", 90001)).file)) > 86400);
});

test("early successful exit destroys an unfinished source", async () => {
  const data = Buffer.concat([fixture("mp4", 60, true), Buffer.alloc(8 * 1024 * 1024)]);
  const input = source(data);
  assert.equal(Math.floor(await verifiedDuration(input.file)), 60);
  assert.ok(input.bytes() < data.length);
  assert.ok(input.streams.every(stream => stream.destroyed));
});

test("malformed media closes all downloads on early nonzero exit", async () => {
  const input = source(Buffer.alloc(8 * 1024 * 1024, 0x41));
  await assert.rejects(verifiedDuration(input.file), /INVALID_MEDIA_DURATION/);
  assert.ok(input.bytes() < 8 * 1024 * 1024);
  assert.ok(input.streams.length > 0);
  assert.ok(input.streams.every(stream => stream.destroyed));
});

for (const mode of ["error", "throw", "close"] as const) {
  test(`source ${mode} fails safely and immediately`, async () => {
    const input = source(Buffer.alloc(8192), mode);
    await assert.rejects(verifiedDuration(input.file), /GCS_|MEDIA_PROBE_SOURCE_CLOSED/);
    assert.ok(input.streams.every(stream => stream.destroyed));
  });
}

test("stalled downloads hit deadline and stop consuming resources", async () => {
  const input = source(Buffer.alloc(8192), "stall");
  await withLimits({ timeoutMs: 300 }, async () => {
    await assert.rejects(verifiedDuration(input.file), /MEDIA_PROBE_TIMEOUT/);
  });
  assert.ok(input.streams.length > 0);
  assert.ok(input.streams.every(stream => stream.destroyed));
});

test("metadata timeout releases both slots without ever opening a stream", async () => {
  const file = { getMetadata: () => new Promise<never>(() => {}) } as unknown as File;
  await withLimits({ timeoutMs: 20 }, async () => {
    for (let i = 0; i < 3; i++) await assert.rejects(verifiedDuration(file), /MEDIA_PROBE_TIMEOUT/);
  });
});

test("rejects excess concurrent probes immediately without querying storage", async () => {
  const blocked = { getMetadata: () => new Promise<never>(() => {}) } as unknown as File;
  await withLimits({ timeoutMs: 50 }, async () => {
    const first = verifiedDuration(blocked).catch(error => error);
    const second = verifiedDuration(blocked).catch(error => error);
    let metadataCalled = false;
    const third = {
      getMetadata() { metadataCalled = true; throw new Error("unexpected"); },
    } as unknown as File;
    await assert.rejects(verifiedDuration(third), ClipProbeBusyError);
    assert.equal(metadataCalled, false);
    assert.match((await first).message, /TIMEOUT/);
    assert.match((await second).message, /TIMEOUT/);
  });
});

test("bounds upstream bytes even if storage ignores the requested range", async () => {
  const streams: Readable[] = [];
  const file = {
    async getMetadata() { return [{ size: 100000 }]; },
    createReadStream() {
      const stream = Readable.from(Buffer.alloc(8192));
      streams.push(stream);
      return stream;
    },
  } as unknown as File;
  await withLimits({ inputBytes: 4096 }, async () => {
    await assert.rejects(verifiedDuration(file), /MEDIA_PROBE_INPUT_LIMIT/);
  });
  assert.ok(streams.every(stream => stream.destroyed));
});

test("caps probe output and kills the child before releasing its slot", async () => {
  const input = source(fixture("mp4"));
  await withLimits({ outputBytes: 1 }, async () => {
    await assert.rejects(verifiedDuration(input.file), /MEDIA_PROBE_OUTPUT_LIMIT/);
  });
  assert.ok(input.streams.every(stream => stream.destroyed));
});

test("missing ffprobe fails safely rather than leaving a live bridge", async () => {
  const path = process.env.PATH;
  const input = source(Buffer.alloc(8192));
  try {
    process.env.PATH = "/nonexistent-clip-probe-test";
    await assert.rejects(verifiedDuration(input.file), /ENOENT/);
  } finally { process.env.PATH = path; }
  assert.equal(input.streams.length, 0);
});

test("invalid metadata and metadata failures do not open a source", async () => {
  for (const size of [0, -1, "NaN", 2 ** 54]) {
    const file = { async getMetadata() { return [{ size }]; } } as unknown as File;
    await assert.rejects(verifiedDuration(file), /INVALID_MEDIA_SIZE/);
  }
  await assert.rejects(verifiedDuration({
    async getMetadata() { throw new Error("GCS_METADATA_FAILED"); },
  } as unknown as File), /GCS_METADATA_FAILED/);
});

test("publishing retains the minimum-only policy and original upload fingerprint", () => {
  const route = readFileSync("src/routes/clips.ts", "utf8");
  const publish = readFileSync("src/lib/clip-publish.ts", "utf8");
  assert.match(publish, /clipDurationSeconds\(verifiedSeconds, contentType\)/);
  assert.doesNotMatch(publish, /MAX_DURATION|durationSec\s*>/);
  assert.match(publish, /verifiedDuration.*clip-duration\.js/);
  assert.match(route, /hash\.update\(chunk\)/);
  assert.match(route, /sha256: hash\.digest\("hex"\)/);
  assert.match(route, /sha256: f\.sha256/);
  assert.match(publish, /\[sha256, username\]/);
});

for (const [extension, codec] of [
  ["mp3", "libmp3lame"], ["m4a", "aac"], ["aac", "aac"],
  ["ogg", "libopus"], ["wav", "pcm_s16le"], ["webm", "libopus"], ["flac", "flac"],
]) {
  test(`verifies real short ${extension} audio without changing original bytes`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "clip-audio-"));
    try {
      const path = join(directory, `voice.${extension}`);
      const result = spawnSync("ffmpeg", [
        "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "1.25", "-threads", "1", "-c:a", codec, path,
      ]);
      assert.equal(result.status, 0, result.stderr.toString());
      const bytes = readFileSync(path);
      const original = Buffer.from(bytes);
      const input = source(bytes);
      const duration = await verifiedDuration(input.file, "audio");
      assert.ok(duration > 1 && duration < 2, `Unexpected audio duration ${duration}`);
      assert.equal(clipDurationSeconds(duration, extension === "m4a" ? "audio/mp4" : extension === "mp3" ? "audio/mpeg" : `audio/${extension}`), 1);
      assert.deepEqual(bytes, original);
      assert.ok(input.streams.every(stream => stream.destroyed));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("audio MIME cannot disguise a short video to evade the 60-second video policy", async () => {
  await assert.rejects(verifiedDuration(source(fixture("mp4", 2)).file, "audio"), /INVALID_AUDIO_STREAMS/);
  assert.throws(() => clipDurationSeconds(59.9, "video/mp4"));
  assert.equal(clipDurationSeconds(60, "video/mp4"), 60);
  assert.equal(clipDurationSeconds(90001, "video/mp4"), 90001);
  assert.equal(clipDurationSeconds(0.1, "audio/wav"), 1);
  assert.equal(clipDurationSeconds(12.9, "audio/ogg"), 12);
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => clipDurationSeconds(duration, "audio/mp4"));
});

test("MP3 cover artwork is audio, while motion video with an audio track is not", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-stream-kind-"));
  try {
    const cover = join(directory, "cover.mp3");
    const mp3 = spawnSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-f", "lavfi", "-i", "color=size=16x16:color=red", "-t", "1.25",
      "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "mjpeg",
      "-frames:v", "1", "-disposition:v", "attached_pic", "-threads", "1", cover,
    ]);
    assert.equal(mp3.status, 0, mp3.stderr.toString());
    assert.ok(await verifiedDuration(source(readFileSync(cover)).file, "audio") > 0);
    const video = join(directory, "motion.mp4");
    const av = spawnSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=32x32:rate=10",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.25",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-threads", "1", video,
    ]);
    assert.equal(av.status, 0, av.stderr.toString());
    await assert.rejects(verifiedDuration(source(readFileSync(video)).file, "audio"), /INVALID_AUDIO_STREAMS/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("audio MIME aliases share normalized storage types and safe download extensions", () => {
  for (const [raw, normalized, extension] of [
    ["audio/mp3", "audio/mpeg", ".mp3"], ["Audio/MPEG; codecs=mp3", "audio/mpeg", ".mp3"],
    ["audio/x-m4a", "audio/mp4", ".m4a"], ["audio/x-aac", "audio/aac", ".aac"],
    ["application/ogg", "audio/ogg", ".ogg"], ["audio/opus", "audio/ogg", ".ogg"],
    ["audio/x-wav", "audio/wav", ".wav"], ["audio/vnd.wave", "audio/wav", ".wav"],
    ["audio/webm; codecs=opus", "audio/webm", ".webm"], ["audio/x-flac", "audio/flac", ".flac"],
    ["video/mp4", "video/mp4", ".mp4"], ["video/quicktime", "video/quicktime", ".mov"],
  ]) {
    assert.equal(normalizeClipContentType(raw), normalized);
    assert.equal(clipDownloadExtension(raw), extension);
    assert.equal(isAudioClip(raw), normalized.startsWith("audio/"));
  }
  for (const raw of ["application/octet-stream", "text/html", "__proto__", "audio/not-real"]) {
    assert.equal(normalizeClipContentType(raw), null);
    assert.equal(clipDownloadExtension(raw), ".bin");
  }
  assert.equal(resolveClipUploadType("", "Voice.MP3"), "audio/mpeg");
  assert.equal(resolveClipUploadType("application/octet-stream", "recording.m4a"), "audio/mp4");
  assert.equal(resolveClipUploadType("application/octet-stream", "movie.mp4"), "video/mp4");
  assert.equal(resolveClipUploadType("application/octet-stream", "unknown.webm"), "video/webm");
  assert.equal(resolveClipUploadType("text/html", "voice.mp3"), null);
  assert.equal(resolveClipUploadType("application/octet-stream", "voice.mp3.exe"), null);
});

test("audio skips initial poster generation and all video-only retry/admin queries", () => {
  const publish = readFileSync("src/lib/clip-publish.ts", "utf8");
  assert.match(publish, /if \(!audio\) try \{[\s\S]*?generateClipThumbnail/);
  const retry = readFileSync("src/jobs/clip-thumbnail-retry.ts", "utf8");
  assert.equal((retry.match(/content_type LIKE 'video\/%'/g) ?? []).length, 3);
  const admin = readFileSync("src/routes/admin-clip-thumbnails.ts", "utf8");
  assert.equal((admin.match(/content_type LIKE 'video\/%'/g) ?? []).length, 2);
});