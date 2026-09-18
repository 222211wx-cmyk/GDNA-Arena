import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import { ClipProbeBusyError, verifiedDuration } from "./clip-duration.js";

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
  assert.match(route, /MIN_DURATION_SEC = 60/);
  assert.match(route, /durationSec < MIN_DURATION_SEC/);
  assert.doesNotMatch(route, /MAX_DURATION|durationSec\s*>/);
  assert.match(route, /hash\.update\(chunk\)/);
  assert.match(route, /sha256: hash\.digest\("hex"\)/);
  assert.match(route, /\[f\.sha256, username\]/);
});