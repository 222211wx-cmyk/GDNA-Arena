import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { File } from "@google-cloud/storage";

export type ClipVisualSignature = {
  version: 1;
  frames: string[];
};

type SignatureFile = Pick<File, "createReadStream" | "getMetadata">;

const FRAME_COUNT = 8;
const FRAME_WIDTH = 9;
const FRAME_HEIGHT = 8;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = FRAME_COUNT * FRAME_BYTES;
const TIMEOUT_MS = 20_000;
const TEST_LIMITS_KEY = Symbol.for("gdna.clipOriginalSignature.testLimits");

let activeTasks = 0;

function limits(): { inputBytes: number; timeoutMs: number } {
  const defaults = { inputBytes: MAX_INPUT_BYTES, timeoutMs: TIMEOUT_MS };
  if (process.env.NODE_ENV === "production") return defaults;
  const override = (globalThis as typeof globalThis & {
    [TEST_LIMITS_KEY]?: Partial<typeof defaults>;
  })[TEST_LIMITS_KEY];
  return { ...defaults, ...override };
}

function frameSignature(pixels: Buffer): string {
  let bits = 0n;
  let spatialDifference = 0;
  let comparisons = 0;
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH - 1; x++) {
      const left = pixels[y * FRAME_WIDTH + x]!;
      const right = pixels[y * FRAME_WIDTH + x + 1]!;
      if (left > right) bits |= 1n << BigInt(y * (FRAME_WIDTH - 1) + x);
      spatialDifference += Math.abs(left - right);
      comparisons++;
    }
  }
  // The second field is not part of similarity scoring. It preserves enough
  // information to reject blank/flat imagery for which a dHash is misleading.
  const information = Math.round(spatialDifference / comparisons);
  return `${bits.toString(16).padStart(16, "0")}:${information}`;
}

async function download(
  file: SignatureFile,
  destination: string,
  inputBytes: number,
  signal: AbortSignal,
): Promise<void> {
  const metadataPromise = file.getMetadata();
  const [metadata] = await new Promise<Array<{ size?: string | number }>>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("CLIP_SIGNATURE_TIMEOUT"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    metadataPromise.then(
      value => resolve(value as Array<{ size?: string | number }>),
      reject,
    ).finally(() => signal.removeEventListener("abort", onAbort));
  });
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("CLIP_SIGNATURE_INVALID_SIZE");
  }
  if (size > inputBytes) {
    throw new Error(
      `CLIP_SIGNATURE_SKIPPED_SIZE_LIMIT: object exceeds ${inputBytes} bytes; legacy oversized clips require offline processing`,
    );
  }

  let received = 0;
  const cap = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > inputBytes) {
        callback(new Error(`CLIP_SIGNATURE_INPUT_LIMIT: object exceeded ${inputBytes} bytes while streaming`));
      } else {
        callback(null, bytes);
      }
    },
  });
  await pipeline(
    file.createReadStream(),
    cap,
    createWriteStream(destination, { flags: "wx" }),
    { signal },
  );
}

async function decodeFrames(path: string, durationSeconds: number, timeoutMs: number): Promise<Buffer> {
  const rate = FRAME_COUNT / durationSeconds;
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-threads", "1", "-filter_threads", "1",
    "-max_alloc", String(32 * 1024 * 1024),
    "-protocol_whitelist", "file,pipe",
    "-format_whitelist", "mov,matroska,webm",
    "-i", path,
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", `fps=${rate.toPrecision(12)},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
    "-frames:v", String(FRAME_COUNT),
    "-threads", "1",
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
  ];

  let child: ChildProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let terminalError: Error | undefined;
    child.stdout!.on("data", (raw: Buffer | Uint8Array) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminalError ??= new Error("CLIP_SIGNATURE_OUTPUT_LIMIT");
        child?.kill("SIGKILL");
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr!.on("data", (raw: Buffer | Uint8Array) => {
      if (stderr.length < 16_384) {
        stderr += Buffer.from(raw).toString("utf8").slice(0, 16_384 - stderr.length);
      }
    });

    return await new Promise<Buffer>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", (code, signal) => {
        if (terminalError) return reject(terminalError);
        if (code !== 0) {
          return reject(new Error(
            `CLIP_SIGNATURE_DECODE_FAILED (${signal ?? code}): ${stderr.trim() || "unknown error"}`,
          ));
        }
        const output = Buffer.concat(chunks, outputBytes);
        if (output.length !== MAX_OUTPUT_BYTES) {
          return reject(new Error(
            `CLIP_SIGNATURE_FRAME_COUNT: expected ${FRAME_COUNT} frames, received ${output.length / FRAME_BYTES}`,
          ));
        }
        resolve(output);
      });
      timer = setTimeout(() => {
        terminalError = new Error("CLIP_SIGNATURE_TIMEOUT: ffmpeg decoding exceeded its deadline");
        child?.kill("SIGKILL");
      }, timeoutMs);
      timer.unref();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

/**
 * Downloads only a bounded storage object and decodes eight tiny grayscale
 * samples in one ffmpeg pass. Audio is explicitly excluded.
 */
export async function extractClipVisualSignature(
  file: SignatureFile,
  durationSeconds: number,
): Promise<ClipVisualSignature> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("CLIP_SIGNATURE_INVALID_DURATION");
  }
  if (activeTasks >= 2) throw new Error("CLIP_SIGNATURE_BUSY");
  activeTasks++;

  const runtime = limits();
  const deadline = Date.now() + runtime.timeoutMs;
  const directory = join(tmpdir(), `clip-signature-${randomBytes(16).toString("hex")}`);
  const path = join(directory, "original");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(
    new Error("CLIP_SIGNATURE_TIMEOUT: signature extraction exceeded its deadline"),
  ), runtime.timeoutMs);
  timer.unref();
  try {
    await mkdir(directory, { mode: 0o700 });
    await download(file, path, runtime.inputBytes, controller.signal);
    const raw = await decodeFrames(path, durationSeconds, Math.max(1, deadline - Date.now()));
    const frames: string[] = [];
    for (let offset = 0; offset < raw.length; offset += FRAME_BYTES) {
      frames.push(frameSignature(raw.subarray(offset, offset + FRAME_BYTES)));
    }
    return { version: 1, frames };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("CLIP_SIGNATURE_TIMEOUT: signature extraction exceeded its deadline", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    try { await rm(directory, { recursive: true, force: true }); }
    finally { activeTasks--; }
  }
}

function parseFrame(frame: string): { hash: bigint; information: number } | null {
  const match = /^([0-9a-f]{16}):(\d{1,3})$/.exec(frame);
  if (!match) return null;
  const information = Number(match[2]);
  if (information > 255) return null;
  return { hash: BigInt(`0x${match[1]}`), information };
}

function hamming(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    value &= value - 1n;
    count++;
  }
  return count;
}

function usable(frames: { hash: bigint; information: number }[]): boolean {
  // Refuse both low-detail and effectively static samples. Exact byte identity
  // is intentionally left to the separate SHA comparison.
  if (frames.filter(frame => frame.information >= 3).length < 6) return false;
  let temporalChange = 0;
  for (let index = 1; index < frames.length; index++) {
    temporalChange += hamming(frames[index - 1]!.hash, frames[index]!.hash);
  }
  return temporalChange >= 10;
}

export function matchesOriginalVideo(
  a: { durationSeconds: number; signature: ClipVisualSignature },
  b: { durationSeconds: number; signature: ClipVisualSignature },
): boolean {
  if (!Number.isFinite(a.durationSeconds) || !Number.isFinite(b.durationSeconds) ||
      Math.abs(a.durationSeconds - b.durationSeconds) > 0.5 ||
      a.signature.version !== 1 || b.signature.version !== 1 ||
      a.signature.frames.length !== FRAME_COUNT || b.signature.frames.length !== FRAME_COUNT) {
    return false;
  }
  const left = a.signature.frames.map(parseFrame);
  const right = b.signature.frames.map(parseFrame);
  if (left.some(frame => frame === null) || right.some(frame => frame === null)) return false;
  const parsedLeft = left as { hash: bigint; information: number }[];
  const parsedRight = right as { hash: bigint; information: number }[];
  if (!usable(parsedLeft) || !usable(parsedRight)) return false;

  let totalDistance = 0;
  for (let index = 0; index < FRAME_COUNT; index++) {
    const distance = hamming(parsedLeft[index]!.hash, parsedRight[index]!.hash);
    if (distance > 6) return false;
    totalDistance += distance;
  }
  return totalDistance <= 20;
}