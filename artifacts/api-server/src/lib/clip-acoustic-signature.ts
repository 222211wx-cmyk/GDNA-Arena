import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { File } from "@google-cloud/storage";

export interface ClipAudioSignature {
  version: 1;
  intervalMs: 500;
  frames: string[];
}

type SignatureFile = Pick<File, "createReadStream" | "getMetadata">;
const SAMPLE_RATE = 8_000;
const FRAME_SAMPLES = SAMPLE_RATE / 2;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_FRAMES = 3_600; // At most thirty minutes/14.4 MiB of decoded mono PCM.
const MAX_OUTPUT_BYTES = MAX_FRAMES * FRAME_SAMPLES * 2;
const TIMEOUT_MS = 30_000;
const FREQUENCIES = [120, 190, 300, 470, 740, 1160, 1810, 2800, 3600];
let activeTasks = 0;

async function download(file: SignatureFile, path: string, signal: AbortSignal): Promise<void> {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("CLIP_AUDIO_SIGNATURE_INVALID_SIZE");
  if (size > MAX_INPUT_BYTES) throw new Error("CLIP_AUDIO_SIGNATURE_SKIPPED_SIZE_LIMIT");
  let received = 0;
  const cap = new Transform({
    transform(raw: Buffer | Uint8Array, _encoding, callback) {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      received += bytes.length;
      callback(received > MAX_INPUT_BYTES ? new Error("CLIP_AUDIO_SIGNATURE_INPUT_LIMIT") : null, bytes);
    },
  });
  await pipeline(file.createReadStream(), cap, createWriteStream(path, { flags: "wx" }), { signal });
}

async function decode(path: string, timeoutMs: number): Promise<Buffer> {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
    "-max_alloc", String(64 * 1024 * 1024),
    "-protocol_whitelist", "file,pipe",
    "-format_whitelist", "mov,matroska,webm,mp3,ogg,wav,aac,flac",
    "-i", path,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1",
  ];
  let child: ChildProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let length = 0;
    let stderr = "";
    let terminalError: Error | undefined;
    child.stdout!.on("data", (raw: Buffer | Uint8Array) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      length += bytes.length;
      if (length > MAX_OUTPUT_BYTES) {
        terminalError ??= new Error("CLIP_AUDIO_SIGNATURE_DURATION_LIMIT");
        child?.kill("SIGKILL");
      } else chunks.push(bytes);
    });
    child.stderr!.on("data", raw => {
      if (stderr.length < 8_192) stderr += Buffer.from(raw).toString("utf8").slice(0, 8_192 - stderr.length);
    });
    return await new Promise<Buffer>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", code => {
        if (terminalError) return reject(terminalError);
        if (code !== 0) return reject(new Error(`CLIP_AUDIO_SIGNATURE_DECODE_FAILED: ${stderr.trim() || code}`));
        resolve(Buffer.concat(chunks, length));
      });
      timer = setTimeout(() => {
        terminalError = new Error("CLIP_AUDIO_SIGNATURE_TIMEOUT");
        child?.kill("SIGKILL");
      }, timeoutMs);
      timer.unref();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

function frameFingerprint(pcm: Buffer, byteOffset: number): string | null {
  let sumSquares = 0;
  for (let i = 0; i < FRAME_SAMPLES; i += 4) {
    const sample = pcm.readInt16LE(byteOffset + i * 2) / 32768;
    sumSquares += sample * sample;
  }
  if (Math.sqrt(sumSquares / (FRAME_SAMPLES / 4)) < 0.0015) return null;
  const energies = FREQUENCIES.map(frequency => {
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SAMPLE_RATE);
    let previous = 0, previous2 = 0;
    for (let i = 0; i < FRAME_SAMPLES; i += 2) {
      const current = pcm.readInt16LE(byteOffset + i * 2) / 32768 + coefficient * previous - previous2;
      previous2 = previous;
      previous = current;
    }
    return previous2 * previous2 + previous * previous - coefficient * previous * previous2;
  });
  return energies.map((energy, index) => ({ energy, index }))
    .sort((a, b) => b.energy - a.energy).slice(0, 4).map(item => item.index.toString(16)).join("");
}

/**
 * A deliberately bounded fallback fingerprint. It decodes mono PCM with ffmpeg
 * and stores coarse spectral peaks, so normal codec/container changes survive.
 * It is not an industry-wide song-identification service: objects over 64 MiB,
 * recordings over 30 minutes, missing audio tracks, and saturated concurrency
 * are explicitly reported to the caller rather than inferred from duration.
 */
export async function extractClipAudioSignature(file: SignatureFile): Promise<ClipAudioSignature> {
  if (activeTasks >= 2) throw new Error("CLIP_AUDIO_SIGNATURE_BUSY");
  activeTasks++;
  const directory = join(tmpdir(), `clip-audio-signature-${randomBytes(16).toString("hex")}`);
  const path = join(directory, "media");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("CLIP_AUDIO_SIGNATURE_TIMEOUT")), TIMEOUT_MS);
  timer.unref();
  try {
    await mkdir(directory, { mode: 0o700 });
    await download(file, path, controller.signal);
    const pcm = await decode(path, TIMEOUT_MS);
    const frames: string[] = [];
    for (let offset = 0; offset + FRAME_SAMPLES * 2 <= pcm.length; offset += FRAME_SAMPLES * 2) {
      frames.push(frameFingerprint(pcm, offset) ?? "----");
    }
    if (frames.length < 2 || frames.filter(frame => frame !== "----").length < Math.ceil(frames.length * 0.6)) {
      throw new Error("CLIP_AUDIO_SIGNATURE_UNUSABLE");
    }
    return { version: 1, intervalMs: 500, frames };
  } finally {
    clearTimeout(timer);
    controller.abort();
    await rm(directory, { recursive: true, force: true }).finally(() => { activeTasks--; });
  }
}

function frameMatches(a: string, b: string): boolean {
  if (!/^[0-8]{4}$/.test(a) || !/^[0-8]{4}$/.test(b)) return false;
  if (a[0] !== b[0]) return false;
  const left = new Set(a);
  let overlap = 0;
  for (const band of new Set(b)) if (left.has(band)) overlap++;
  return overlap >= 2;
}

/** Returns the greatest fraction of the registered original covered by an aligned upload. */
export function originalAudioCoverage(registered: unknown, upload: unknown): number {
  const a = registered as Partial<ClipAudioSignature> | null;
  const b = upload as Partial<ClipAudioSignature> | null;
  if (!a || !b || a.version !== 1 || b.version !== 1 || a.intervalMs !== 500 || b.intervalMs !== 500 ||
      !Array.isArray(a.frames) || !Array.isArray(b.frames) || a.frames.length < 2 || b.frames.length < 2 ||
      a.frames.some(frame => typeof frame !== "string") || b.frames.some(frame => typeof frame !== "string")) return 0;
  let best = 0;
  for (let shift = -b.frames.length + 1; shift < a.frames.length; shift++) {
    let matched = 0;
    for (let ai = Math.max(0, shift); ai < Math.min(a.frames.length, shift + b.frames.length); ai++) {
      if (frameMatches(a.frames[ai]!, b.frames[ai - shift]!)) matched++;
    }
    best = Math.max(best, matched / a.frames.length);
  }
  return best;
}