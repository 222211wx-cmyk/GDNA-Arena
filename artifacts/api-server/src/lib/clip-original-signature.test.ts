import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import {
  extractClipVisualSignature,
  matchesOriginalVideo,
} from "./clip-original-signature.js";

function storageFile(bytes: Buffer): Pick<File, "createReadStream" | "getMetadata"> {
  return {
    async getMetadata() {
      return [{ size: String(bytes.length) }];
    },
    createReadStream() {
      return Readable.from(bytes);
    },
  } as unknown as Pick<File, "createReadStream" | "getMetadata">;
}

function makeFixture(
  directory: string,
  name: string,
  videoSource: string,
  options: { audioHz?: number; duration?: number; input?: string } = {},
): Buffer {
  const path = join(directory, name);
  const args = options.input
    ? ["-i", options.input]
    : ["-f", "lavfi", "-i", videoSource];
  if (options.audioHz) {
    args.push("-f", "lavfi", "-i", `sine=frequency=${options.audioHz}:sample_rate=44100`);
  }
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...args,
    "-t", String(options.duration ?? 3),
    "-map", "0:v:0",
    ...(options.audioHz ? ["-map", "1:a:0", "-c:a", "aac"] : []),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-threads", "1", path,
  ]);
  assert.equal(result.status, 0, result.stderr.toString());
  return readFileSync(path);
}

test("same moving scene survives a real re-encode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-signature-test-"));
  try {
    const originalPath = join(directory, "original.mp4");
    const original = makeFixture(directory, "original.mp4", "testsrc2=size=320x180:rate=24");
    const reencoded = makeFixture(directory, "reencoded.mp4", "", { input: originalPath });
    const a = await extractClipVisualSignature(storageFile(original), 3);
    const b = await extractClipVisualSignature(storageFile(reencoded), 3);
    assert.equal(a.frames.length, 8);
    assert.equal(matchesOriginalVideo(
      { durationSeconds: 3, signature: a },
      { durationSeconds: 3, signature: b },
    ), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("different visuals are allowed even with the same audio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-signature-audio-test-"));
  try {
    const first = makeFixture(directory, "first.mp4", "testsrc2=size=320x180:rate=24", { audioHz: 440 });
    const second = makeFixture(directory, "second.mp4", "smptebars=size=320x180:rate=24", { audioHz: 440 });
    const a = await extractClipVisualSignature(storageFile(first), 3);
    const b = await extractClipVisualSignature(storageFile(second), 3);
    assert.equal(matchesOriginalVideo(
      { durationSeconds: 3, signature: a },
      { durationSeconds: 3, signature: b },
    ), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shortened footage outside duration tolerance is allowed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-signature-trim-test-"));
  try {
    const originalPath = join(directory, "original.mp4");
    const original = makeFixture(directory, "original.mp4", "testsrc2=size=320x180:rate=24");
    const trimmed = makeFixture(directory, "trimmed.mp4", "", { input: originalPath, duration: 2 });
    const a = await extractClipVisualSignature(storageFile(original), 3);
    const b = await extractClipVisualSignature(storageFile(trimmed), 2);
    assert.equal(matchesOriginalVideo(
      { durationSeconds: 3, signature: a },
      { durationSeconds: 2, signature: b },
    ), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("static frames conservatively never perceptually match", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-signature-static-test-"));
  try {
    const first = makeFixture(directory, "static-a.mp4", "color=c=black:size=320x180:rate=24");
    const second = makeFixture(directory, "static-b.mp4", "color=c=black:size=320x180:rate=24");
    const a = await extractClipVisualSignature(storageFile(first), 3);
    const b = await extractClipVisualSignature(storageFile(second), 3);
    assert.equal(matchesOriginalVideo(
      { durationSeconds: 3, signature: a },
      { durationSeconds: 3, signature: b },
    ), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});