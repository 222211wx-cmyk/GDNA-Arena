import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import { generateClipThumbnail } from "./clip-thumbnail.js";

const TEST_LIMITS_KEY = Symbol.for("gdna.clipThumbnail.testLimits");

async function withTestLimits<T>(
  limits: { inputBytes?: number; outputBytes?: number; timeoutMs?: number },
  operation: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[TEST_LIMITS_KEY];
  globals[TEST_LIMITS_KEY] = limits;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete globals[TEST_LIMITS_KEY];
    else globals[TEST_LIMITS_KEY] = previous;
  }
}

class ChunkedBufferStream extends Readable {
  private offset = 0;

  constructor(private readonly contents: Buffer) {
    super();
  }

  _read(): void {
    setImmediate(() => {
      if (this.destroyed) return;
      if (this.offset >= this.contents.length) {
        this.push(null);
        return;
      }
      const next = Math.min(this.offset + 1024, this.contents.length);
      this.push(this.contents.subarray(this.offset, next));
      this.offset = next;
    });
  }
}

function fakeFile(contents: Buffer) {
  const ranges: Array<{ start: number; end: number }> = [];
  const streams: ChunkedBufferStream[] = [];
  const file = {
    async getMetadata() {
      return [{ size: String(contents.length) }];
    },
    createReadStream(options: { start: number; end: number }) {
      ranges.push(options);
      const stream = new ChunkedBufferStream(contents.subarray(options.start, options.end + 1));
      streams.push(stream);
      return stream;
    },
  } as unknown as File;
  return { file, ranges, streams };
}

function realMoovAtEndFixture(): Buffer {
  // A normal non-fragmented MP4 needs a seekable output. The fixture is
  // short-lived test data; production generation never writes local files.
  const directory = mkdtempSync(join(tmpdir(), "clip-thumbnail-test-"));
  const temporary = join(directory, "moov-at-end.mp4");
  try {
    const seekable = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10",
      "-t", "1",
      "-c:v", "mpeg4", "-q:v", "3",
      temporary,
    ]);
    assert.equal(seekable.status, 0, seekable.stderr.toString());
    return readFileSync(temporary);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function realWebmFixture(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "clip-thumbnail-webm-test-"));
  const temporary = join(directory, "fixture.webm");
  try {
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=5",
      "-t", "0.4",
      "-c:v", "libvpx-vp9", "-deadline", "realtime",
      temporary,
    ]);
    assert.equal(generated.status, 0, generated.stderr.toString());
    return readFileSync(temporary);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("generates a bounded WebP from a real moov-at-end MP4 using range reads", async () => {
  const fixture = realMoovAtEndFixture();
  const moov = fixture.indexOf(Buffer.from("moov"));
  const mdat = fixture.indexOf(Buffer.from("mdat"));
  assert.ok(moov > mdat, "fixture must put moov after media data");

  const source = fakeFile(fixture);
  const webp = await generateClipThumbnail(source.file);
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  assert.equal(webp.readUInt32LE(4), webp.length - 8);
  assert.ok(webp.length <= 256 * 1024);

  const dimensions = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    "-i", "pipe:0",
  ], { input: webp });
  assert.equal(dimensions.status, 0, dimensions.stderr.toString());
  const [width, height] = dimensions.stdout.toString().trim().split("x").map(Number);
  assert.ok(width <= 480 && height <= 480, `${width}x${height} exceeds bounds`);
  assert.ok(source.ranges.length >= 2, "moov-at-end input should cause an HTTP range seek");
  assert.ok(source.ranges.some(({ start }) => start > 0), "ffmpeg never sought within the object");
});

test("rejects malformed media and destroys every GCS stream", async () => {
  const source = fakeFile(Buffer.alloc(8192, 0x41));
  await assert.rejects(generateClipThumbnail(source.file), /ffmpeg thumbnail generation failed/i);
  assert.ok(source.streams.length > 0);
  assert.ok(source.streams.every((stream) => stream.destroyed));
});

test("generates a WebP from a real WebM fixture", async () => {
  const source = fakeFile(realWebmFixture());
  const webp = await generateClipThumbnail(source.file);
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
});

test("enforces the aggregate input byte bound", async () => {
  const streams: Readable[] = [];
  const file = {
    async getMetadata() {
      return [{ size: "100000" }];
    },
    createReadStream() {
      // Deliberately model a misbehaving upstream that returns more than the
      // requested range. The bridge must still enforce its aggregate bound.
      const stream = Readable.from(Buffer.alloc(4097, 0x41));
      streams.push(stream);
      return stream;
    },
  } as unknown as File;
  await withTestLimits({ inputBytes: 4096 }, async () => {
    await assert.rejects(generateClipThumbnail(file), /input exceeded 4096 byte/i);
  });
  assert.ok(streams.length > 0);
  assert.ok(streams.every((stream) => stream.destroyed));
});

test("enforces the thumbnail output byte bound", async () => {
  const source = fakeFile(realMoovAtEndFixture());
  await withTestLimits({ outputBytes: 1 }, async () => {
    await assert.rejects(generateClipThumbnail(source.file), /output|exceeded 1 byte/i);
  });
  assert.ok(source.streams.every((stream) => stream.destroyed));
});

test("times out metadata lookup and releases its concurrency slot", async () => {
  const hungFile = {
    getMetadata() {
      return new Promise<never>(() => {});
    },
  } as unknown as File;
  await withTestLimits({ timeoutMs: 40 }, async () => {
    await assert.rejects(generateClipThumbnail(hungFile), /timed out/i);
    await assert.rejects(generateClipThumbnail(hungFile), /timed out/i);
  });
});

test("rejects a third concurrent job immediately rather than queueing it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blockedFile = {
    async getMetadata() {
      await gate;
      return [{ size: "1" }];
    },
    createReadStream() {
      return Readable.from(Buffer.from([0]));
    },
  } as unknown as File;

  const first = generateClipThumbnail(blockedFile).catch((error: unknown) => error);
  const second = generateClipThumbnail(blockedFile).catch((error: unknown) => error);
  await assert.rejects(generateClipThumbnail(blockedFile), /busy/i);
  release();
  assert.ok(await first instanceof Error);
  assert.ok(await second instanceof Error);
});

test("rejects invalid object sizes before opening a GCS stream", async () => {
  let opened = false;
  const file = {
    async getMetadata() {
      return [{ size: String(2 ** 54) }];
    },
    createReadStream() {
      opened = true;
      return Readable.from([]);
    },
  } as unknown as File;
  await assert.rejects(generateClipThumbnail(file), /invalid or empty object size/i);
  assert.equal(opened, false);
});