import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import { extractClipAudioSignature, originalAudioCoverage } from "./clip-acoustic-signature.js";
import { shouldBlockForProtectedAudio } from "./clip-upload-protocol.js";

function storageFile(bytes: Buffer): Pick<File, "createReadStream" | "getMetadata"> {
  return {
    async getMetadata() { return [{ size: String(bytes.length) }]; },
    createReadStream() { return Readable.from(bytes); },
  } as unknown as Pick<File, "createReadStream" | "getMetadata">;
}

function audioFixture(directory: string, name: string, source: string, codec: string): Buffer {
  const path = join(directory, name);
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", source,
    "-t", "12", "-c:a", codec, path,
  ]);
  assert.equal(result.status, 0, result.stderr.toString());
  return readFileSync(path);
}

test("acoustic signature survives real codec re-encoding and measures registered coverage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-acoustic-test-"));
  try {
    const source = "aevalsrc=0.25*sin(2*PI*(220+80*floor(t))*t)+0.18*sin(2*PI*(660+45*floor(t))*t):s=44100";
    const wav = audioFixture(directory, "original.wav", source, "pcm_s16le");
    const m4a = audioFixture(directory, "reencoded.m4a", source, "aac");
    const original = await extractClipAudioSignature(storageFile(wav));
    const reencoded = await extractClipAudioSignature(storageFile(m4a));
    assert.ok(originalAudioCoverage(original, reencoded) >= 0.9);
    assert.ok(originalAudioCoverage(original, {
      ...reencoded, frames: reencoded.frames.slice(0, Math.floor(reencoded.frames.length * 0.75)),
    }) < 0.8, "a short music excerpt does not cover the original recording");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("different recordings and silence do not produce protected matches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-acoustic-negative-test-"));
  try {
    const first = audioFixture(directory, "first.wav", "sine=frequency=330:sample_rate=44100", "pcm_s16le");
    const second = audioFixture(directory, "second.wav", "sine=frequency=2100:sample_rate=44100", "pcm_s16le");
    const silent = audioFixture(directory, "silent.wav", "anullsrc=r=44100:cl=mono", "pcm_s16le");
    const a = await extractClipAudioSignature(storageFile(first));
    const b = await extractClipAudioSignature(storageFile(second));
    assert.equal(originalAudioCoverage(a, b), 0);
    await assert.rejects(extractClipAudioSignature(storageFile(silent)), /UNUSABLE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("audio policy blocks full music copies but not music overlap in citizen footage or short excerpts", () => {
  assert.equal(shouldBlockForProtectedAudio("audio/mpeg", false, 0.9), true);
  assert.equal(shouldBlockForProtectedAudio("video/mp4", false, 0.95), true);
  assert.equal(shouldBlockForProtectedAudio("video/webm", true, 1), false,
    "full-copy visual protection is a separate check and cannot be bypassed by this policy");
  assert.equal(shouldBlockForProtectedAudio("video/mp4", true, 0.79), false);
  assert.equal(shouldBlockForProtectedAudio("audio/mpeg", false, 0.899), false);
});