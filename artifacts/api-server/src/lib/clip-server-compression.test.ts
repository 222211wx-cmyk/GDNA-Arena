import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import type { File, CreateWriteStreamOptions } from "@google-cloud/storage";
import {
  COMPRESS_ABOVE_BYTES, FFMPEG_NICE_LEVEL, ClipCompressionCleanupError, compressStoredClip,
  createStoredClipCompressor, transcodeClipFile,
} from "./clip-server-compression.js";

type StoredFile = Pick<File, "createReadStream" | "createWriteStream" | "delete">;
const largeInput = { filename: "original.mp4", contentType: "video/mp4", size: COMPRESS_ABOVE_BYTES + 1 };
const reservedName = `clip_compressed_${"1".repeat(32)}_720p.mp4`;

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "clip-compression-test-"));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function probe(path: string) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,duration,display_aspect_ratio,bit_rate",
    "-of", "json", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    format: { duration: string };
    streams: Array<{
      codec_type: string; codec_name: string; width?: number; height?: number;
      duration?: string; display_aspect_ratio?: string; bit_rate?: string;
    }>;
  };
}

function fixture(path: string, video: boolean, dimensions = "1920x1080") {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-v", "error", "-y",
    ...(video ? ["-f", "lavfi", "-i", `testsrc2=size=${dimensions}:rate=2`] : []),
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "61",
    ...(video ? ["-c:v", "ffv1", "-threads", "1"] : []),
    "-c:a", "pcm_s16le", path,
  ], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
}

function store(mode: "ok" | "write-error" | "cleanup-error" | "collision" | "read-error" | "stall" = "ok") {
  const calls: string[] = [], removed: string[] = [];
  const saved = new Map<string, Buffer>();
  let writeOptions: CreateWriteStreamOptions | undefined;
  let source: Readable | undefined;
  return {
    calls, removed, saved,
    get writeOptions() { return writeOptions; },
    get source() { return source; },
    file(name: string): StoredFile {
      calls.push(name);
      return {
        createReadStream() {
          assert.equal(name, "original.mp4");
          source = mode === "stall" ? new Readable({ read() {} }) : Readable.from(Buffer.alloc(1024, 7));
          if (mode === "read-error") queueMicrotask(() => source!.destroy(new Error("source unavailable")));
          return source;
        },
        createWriteStream(options: CreateWriteStreamOptions) {
          assert.notEqual(name, "original.mp4");
          writeOptions = options;
          return new Writable({
            write(chunk: Buffer, _encoding, callback) {
              saved.set(name, Buffer.from(chunk));
              if (mode === "collision") callback(Object.assign(new Error("already exists"), { code: 412 }));
              else if (mode === "write-error" || mode === "cleanup-error") callback(new Error("storage disconnected"));
              else callback();
            },
          });
        },
        async delete() {
          assert.notEqual(name, "original.mp4");
          removed.push(name);
          if (mode === "cleanup-error") throw new Error("cleanup offline");
          saved.delete(name);
          return [];
        },
      } as unknown as StoredFile;
    },
  };
}

test("100 MiB and smaller bypass storage initialization and media processing", async () => {
  let touched = false;
  const compress = createStoredClipCompressor({
    file() { touched = true; throw new Error("must not touch storage"); },
    async transcode() { touched = true; throw new Error("must not transcode"); },
  });
  for (const size of [1, COMPRESS_ABOVE_BYTES - 1, COMPRESS_ABOVE_BYTES]) {
    assert.equal(await compress({ ...largeInput, size }), null);
    assert.equal(await compressStoredClip({ ...largeInput, size }), null);
  }
  assert.equal(touched, false);
});

test("force transcodes below the legacy threshold and retains an encoded result even when larger", async () => {
  await temporary(async directory => {
    const storage = store();
    let transcoded = false;
    const compress = createStoredClipCompressor({
      file: storage.file,
      temporaryRoot: directory,
      async transcode(_source, destination) {
        transcoded = true;
        await writeFile(destination, Buffer.alloc(2048, 3));
      },
    });
    const result = await compress({
      ...largeInput,
      size: 1024,
      force: true,
      outputFilename: reservedName,
    });
    assert.equal(transcoded, true);
    assert.equal(result?.filename, reservedName);
    assert.equal(result?.size, 2048);
    assert.equal(storage.saved.get(reservedName)?.length, 2048);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("real 61s video compresses to <=480p/800kbps with its audio and duration preserved", async () => {
  await temporary(async directory => {
    const input = join(directory, "source.mkv"), output = join(directory, "output.mp4");
    fixture(input, true);
    await transcodeClipFile(input, output, "video");
    const original = probe(input), encoded = probe(output);
    const video = encoded.streams.find(stream => stream.codec_type === "video")!;
    const audio = encoded.streams.find(stream => stream.codec_type === "audio")!;
    assert.equal(video.codec_name, "h264");
    assert.equal(video.height, 480);
    assert.ok(video.width! <= 854 && video.width! % 2 === 0);
    assert.ok(Number(video.bit_rate) > 0 && Number(video.bit_rate) <= 840000);
    assert.equal(video.display_aspect_ratio, "16:9");
    assert.equal(audio.codec_name, "aac");
    assert.ok(Math.abs(Number(encoded.format.duration) - Number(original.format.duration)) < 0.15);
    assert.ok(Math.abs(Number(audio.duration) - 61) < 0.15, "audio should remain present through the recording");
    assert.ok((await stat(output)).size < (await stat(input)).size);
    assert.equal(FFMPEG_NICE_LEVEL, 10);
  });
});

test("real 61s audio compresses to AAC, without inventing a video stream", async () => {
  await temporary(async directory => {
    const input = join(directory, "source.wav"), output = join(directory, "output.m4a");
    fixture(input, false);
    await transcodeClipFile(input, output, "audio");
    const encoded = probe(output);
    assert.equal(encoded.streams.length, 1);
    assert.equal(encoded.streams[0].codec_type, "audio");
    assert.equal(encoded.streams[0].codec_name, "aac");
    assert.ok(Math.abs(Number(encoded.format.duration) - 61) < 0.15);
    assert.ok((await stat(output)).size < (await stat(input)).size);
  });
});

test("small video is not upscaled and non-16:9 aspect ratio survives", async () => {
  await temporary(async directory => {
    const input = join(directory, "source.mkv"), output = join(directory, "output.mp4");
    fixture(input, true, "320x240");
    await transcodeClipFile(input, output, "video");
    const video = probe(output).streams.find(stream => stream.codec_type === "video")!;
    assert.equal(video.width, 320);
    assert.equal(video.height, 240);
    assert.equal(video.display_aspect_ratio, "4:3");
  });
});

test("streamed storage output is unique, private, create-only; temp files are cleaned", async () => {
  await temporary(async directory => {
    const storage = store();
    const compress = createStoredClipCompressor({
      file: storage.file, temporaryRoot: directory,
      async transcode(_source, destination, kind) {
        assert.equal(kind, "video");
        await writeFile(destination, Buffer.alloc(32, 9));
      },
    });
    const first = await compress(largeInput), second = await compress(largeInput);
    assert.ok(first && second);
    assert.match(first.filename, /^clip_[a-f0-9]{32}_720p\.mp4$/);
    assert.notEqual(first.filename, second.filename);
    assert.equal(first.contentType, "video/mp4");
    assert.equal(first.size, 32);
    assert.equal(storage.writeOptions?.resumable, true);
    assert.equal(storage.writeOptions?.preconditionOpts?.ifGenerationMatch, 0);
    assert.equal(storage.writeOptions?.metadata?.contentType, "video/mp4");
    assert.equal(storage.saved.get(first.filename)?.length, first.size);
    assert.deepEqual(storage.removed, []);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("ineffective compression returns null and uploads nothing", async () => {
  await temporary(async directory => {
    const storage = store();
    const compress = createStoredClipCompressor({
      file: storage.file, temporaryRoot: directory,
      async transcode(_source, destination) { await writeFile(destination, Buffer.alloc(2048)); },
    });
    assert.equal(await compress(largeInput), null);
    assert.equal(storage.saved.size, 0);
    assert.deepEqual(storage.calls, ["original.mp4"]);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("encoder failures clean temp files and leave the original alone", async () => {
  await temporary(async directory => {
    const storage = store();
    const compress = createStoredClipCompressor({
      file: storage.file, temporaryRoot: directory,
      async transcode(_source, destination) {
        await writeFile(destination, "partial");
        throw new Error("encoder failure");
      },
    });
    await assert.rejects(compress(largeInput), /encoder failure/);
    assert.deepEqual(storage.removed, []);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("partial uploads are removed and cleanup outages expose an orphan for durable retry", async () => {
  for (const mode of ["write-error", "cleanup-error", "collision"] as const) {
    await temporary(async directory => {
      const storage = store(mode);
      const compress = createStoredClipCompressor({
        file: storage.file, temporaryRoot: directory,
        async transcode(_source, destination) { await writeFile(destination, "encoded"); },
      });
      await assert.rejects(compress(largeInput), error => {
        if (mode === "cleanup-error") {
          assert.ok(error instanceof ClipCompressionCleanupError);
          assert.match(error.orphanFilename, /^clip_[a-f0-9]{32}_720p\.mp4$/);
        } else assert.match((error as Error).message, mode === "collision" ? /already exists/ : /storage disconnected/);
        return true;
      });
      assert.equal(storage.removed.length, mode === "collision" ? 0 : 1);
      assert.deepEqual(await readdir(directory), []);
    });
  }
});

test("stalled storage is aborted and its temporary download is removed", async () => {
  await temporary(async directory => {
    const storage = store("stall");
    const compress = createStoredClipCompressor({
      file: storage.file, temporaryRoot: directory, idleTimeoutMs: 30,
    });
    // Keep the test event loop live while the production watchdog is unref'ed.
    const keepAlive = setInterval(() => {}, 1000);
    try { await assert.rejects(compress(largeInput), /storage transfer stalled/); }
    finally { clearInterval(keepAlive); }
    assert.equal(storage.source?.destroyed, true);
    assert.deepEqual(await readdir(directory), []);
    assert.deepEqual(storage.removed, []);
  });
});

test("real ffmpeg failure, watchdog timeout and cancellation settle without a live child", async () => {
  await temporary(async directory => {
    const input = join(directory, "bad"), output = join(directory, "output.mp4");
    await writeFile(input, "not a media file");
    await assert.rejects(transcodeClipFile(input, output, "video"), /ffmpeg compression failed/);
    await assert.rejects(transcodeClipFile(input, output, "video", { idleTimeoutMs: 1 }), /compression stalled/);
    const controller = new AbortController();
    const operation = transcodeClipFile(input, output, "video", { signal: controller.signal });
    controller.abort(new Error("cancel test"));
    await assert.rejects(operation, /cancel test/);
  });
});

test("uploaded playlists cannot make ffmpeg fetch remote URLs", async () => {
  await temporary(async directory => {
    const input = join(directory, "playlist.m3u8"), output = join(directory, "output.mp4");
    await writeFile(input, [
      "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:61",
      "#EXTINF:61,", "http://127.0.0.1:1/private.ts", "#EXT-X-ENDLIST",
    ].join("\n"));
    await assert.rejects(transcodeClipFile(input, output, "video"), /not on whitelist/);
  });
});

test("the exact durably reserved output name is honored; unsafe or mismatched names are refused", async () => {
  await temporary(async directory => {
    const storage = store();
    const compress = createStoredClipCompressor({
      file: storage.file, temporaryRoot: directory,
      async transcode(_source, destination) { await writeFile(destination, "encoded"); },
    });
    const result = await compress({ ...largeInput, outputFilename: reservedName });
    assert.equal(result?.filename, reservedName);
    assert.ok(storage.saved.has(reservedName));
    for (const outputFilename of ["../clip.mp4", "/clip.mp4", "", "clip_other.mp4", reservedName.replace(".mp4", ".m4a")]) {
      await assert.rejects(compress({ ...largeInput, outputFilename }), /Invalid reserved clip output filename/);
    }
    await assert.rejects(compress({ ...largeInput, filename: reservedName, outputFilename: reservedName }),
      /Invalid reserved clip output filename/);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("preaborted jobs touch no storage or temp files, including threshold bypass", async () => {
  const controller = new AbortController();
  const reason = new Error("queue ownership lost");
  controller.abort(reason);
  let touched = false;
  const compress = createStoredClipCompressor({
    file() { touched = true; throw new Error("must not access storage"); },
  });
  for (const size of [COMPRESS_ABOVE_BYTES, COMPRESS_ABOVE_BYTES + 1]) {
    const input = { ...largeInput, size, outputFilename: reservedName, signal: controller.signal };
    await assert.rejects(compress(input), error => error === reason);
    await assert.rejects(compressStoredClip(input), error => error === reason);
  }
  assert.equal(touched, false);
});

test("mid-download cancellation destroys the source and cleans temp files without starting ffmpeg", async () => {
  await temporary(async directory => {
    const controller = new AbortController();
    const reason = new Error("download owner lost");
    const storage = store();
    let source!: Readable;
    let encoded = false;
    const compress = createStoredClipCompressor({
      temporaryRoot: directory,
      file(name) {
        const file = storage.file(name);
        let started = false;
        return {
          ...file,
          createReadStream() {
            source = new Readable({
              read() {
                if (started) return;
                started = true;
                this.push(Buffer.from("partial source"));
                setImmediate(() => controller.abort(reason));
              },
            });
            return source;
          },
        } as StoredFile;
      },
      async transcode() { encoded = true; },
    });
    await assert.rejects(compress({ ...largeInput, outputFilename: reservedName, signal: controller.signal }),
      error => error === reason);
    assert.equal(source.destroyed, true);
    assert.equal(encoded, false);
    assert.deepEqual(storage.removed, []);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("mid-output cancellation destroys the writer and removes only its reserved partial object", async () => {
  await temporary(async directory => {
    const controller = new AbortController();
    const reason = new Error("upload owner lost");
    const storage = store();
    let writer!: Writable;
    const compress = createStoredClipCompressor({
      temporaryRoot: directory,
      file(name) {
        const file = storage.file(name);
        if (name === largeInput.filename) return file;
        return {
          ...file,
          createWriteStream() {
            writer = new Writable({
              write(chunk: Buffer) {
                storage.saved.set(name, Buffer.from(chunk));
                setImmediate(() => controller.abort(reason));
                // No write acknowledgement: abort must close a stalled writer.
              },
            });
            return writer;
          },
        } as unknown as StoredFile;
      },
      async transcode(_source, destination, _kind, options) {
        assert.equal(options?.signal, controller.signal);
        await writeFile(destination, "encoded");
      },
    });
    await assert.rejects(compress({ ...largeInput, outputFilename: reservedName, signal: controller.signal }),
      error => error === reason);
    assert.equal(writer.destroyed, true);
    assert.deepEqual(storage.removed, [reservedName]);
    assert.equal(storage.saved.size, 0);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("queue signal reaches running real ffmpeg and cancellation prevents any output upload", async () => {
  await temporary(async directory => {
    const source = join(directory, "source.wav");
    fixture(source, false);
    const controller = new AbortController();
    const reason = new Error("encoder owner lost");
    const storage = store();
    const compress = createStoredClipCompressor({
      temporaryRoot: directory,
      file(name) {
        const file = storage.file(name);
        return {
          ...file,
          createReadStream() { return createReadStream(source); },
        } as StoredFile;
      },
      async transcode(sourcePath, destinationPath, kind, options) {
        assert.equal(options?.signal, controller.signal);
        const active = transcodeClipFile(sourcePath, destinationPath, kind, options);
        const timer = setTimeout(() => controller.abort(reason), 50);
        try { await active; } finally { clearTimeout(timer); }
      },
    });
    await assert.rejects(compress({
      ...largeInput, contentType: "audio/wav", outputFilename: reservedName.replace(".mp4", ".m4a"), signal: controller.signal,
    }), error => error === reason);
    assert.deepEqual(storage.calls, [largeInput.filename]);
    assert.deepEqual(storage.removed, []);
    assert.deepEqual(await readdir(directory), ["source.wav"]);
  });
});

test("412 on a reserved object never authorizes deletion, even when ownership aborts simultaneously", async () => {
  for (const abort of [false, true]) {
    await temporary(async directory => {
      const storage = store();
      const controller = new AbortController();
      const preexisting = Buffer.from("belongs to a previous successful writer");
      storage.saved.set(reservedName, preexisting);
      const compress = createStoredClipCompressor({
        temporaryRoot: directory,
        file(name) {
          const file = storage.file(name);
          if (name === largeInput.filename) return file;
          return {
            ...file,
            createWriteStream() {
              const stream = new Writable({
                write(_chunk, _encoding, callback) {
                  callback(Object.assign(new Error("create-only conflict"), { code: 412 }));
                },
              });
              // The compressor must remember the subsequent 412 even if its
              // pipeline rejects with this concurrent abort instead.
              if (abort) stream.once("error", () => controller.abort(new Error("owner lost with 412")));
              return stream;
            },
          } as unknown as StoredFile;
        },
        async transcode(_source, destination) { await writeFile(destination, "encoded"); },
      });
      await assert.rejects(compress({ ...largeInput, outputFilename: reservedName, signal: controller.signal }),
        abort ? /owner lost with 412/ : /create-only conflict/);
      assert.deepEqual(storage.removed, []);
      assert.equal(storage.saved.get(reservedName), preexisting);
      assert.deepEqual(await readdir(directory), []);
    });
  }
});