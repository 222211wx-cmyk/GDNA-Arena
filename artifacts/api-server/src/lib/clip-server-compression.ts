import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { File } from "@google-cloud/storage";
import {
  DEFAULT_CLIP_TEMP_ROOT,
  ensureClipTempRoot,
  markActiveClipTempDirectory,
} from "./clip-temp-cleanup.js";

export const COMPRESS_ABOVE_BYTES = 100 * 1024 * 1024;
export const FFMPEG_NICE_LEVEL = 10;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const STORAGE_CHUNK_BYTES = 5 * 1024 * 1024;

export interface StoredClipMedia {
  filename: string;
  contentType: string;
  size: number;
}

export interface ClipCompressionInput extends StoredClipMedia {
  /** The caller durably reserves this immutable object before starting work. */
  outputFilename?: string;
  /** Abort when the queue owner loses its database/advisory-lock connection. */
  signal?: AbortSignal;
  /** New publication jobs transcode every clip; legacy callers retain the size/savings policy. */
  force?: boolean;
}

/**
 * A cleanup outage must not hide an unreferenced generated object. The queue
 * owner can durably schedule orphanFilename for cleanup before retrying.
 * The original object is never included in this error or deleted here.
 */
export class ClipCompressionCleanupError extends Error {
  constructor(readonly orphanFilename: string, operationError: unknown, cleanupError: unknown) {
    super("Compressed object cleanup failed; durable cleanup is required", {
      cause: new AggregateError([operationError, cleanupError]),
    });
    this.name = "ClipCompressionCleanupError";
  }
}

type CompressionFile = Pick<File, "createReadStream" | "createWriteStream" | "delete">;
export interface ClipCompressionDependencies {
  file(name: string): CompressionFile;
  temporaryRoot?: string;
  transcode?: typeof transcodeClipFile;
  idleTimeoutMs?: number;
}

async function copyMedia(source: Readable, destination: Writable, idleTimeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = () => controller.abort(new Error("Clip compression storage transfer stalled"));
  const timer = setTimeout(timeout, idleTimeoutMs);
  timer.unref();
  const activity = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      timer.refresh();
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, activity, destination, { signal: controller.signal });
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * A seekable source/destination permits MP4/MOV tail metadata and +faststart.
 * No -t/-shortest or total execution deadline: a 24-hour recording is allowed.
 * Only a stalled encoder is timed out. The caller must serialize jobs.
 *
 * Disk use is source + encoded file; codec working memory depends on source
 * dimensions, not file length. Insufficient disk/codec resources fail explicitly
 * and the caller retains the original. This is not a promise of instant encoding.
 */
export async function transcodeClipFile(
  sourcePath: string,
  destinationPath: string,
  kind: "video" | "audio",
  options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): Promise<void> {
  if (options.signal?.aborted) throw options.signal.reason;
  const args = [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror",
    "-max_alloc", String(256 * 1024 * 1024),
    // Uploaded media must not turn ffmpeg into an outbound HTTP/SSRF client.
    "-protocol_whitelist", "file,pipe", "-threads", "2", "-i", sourcePath,
    ...(kind === "video" ? [
      "-map", "0:v:0", "-map", "0:a?",
      "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-filter_threads", "1", "-c:v", "libx264", "-preset", "fast",
      "-crf", "28", "-pix_fmt", "yuv420p", "-threads", "2",
    ] : ["-map", "0:a", "-vn"]),
    "-c:a", "aac", "-b:a", "128k",
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "+faststart", "-progress", "pipe:1", "-stats_period", "5",
    "-nostats", "-y", destinationPath,
  ];
  await new Promise<void>((resolve, reject) => {
    // Lower CPU scheduling priority without weakening the queue's global
    // concurrency lock. `nice` uses execvp, so ffmpeg still receives args
    // directly (there is no shell or uploaded-data interpolation).
    const child = spawn("nice", ["-n", String(FFMPEG_NICE_LEVEL), "ffmpeg", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let progress = "";
    let failure: unknown;
    let lastTime = -1;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (reason: unknown) => {
      if (failure !== undefined) return;
      failure = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
    };
    const idleTimer = setTimeout(() => stop(new Error("ffmpeg compression stalled")),
      options.idleTimeoutMs ?? IDLE_TIMEOUT_MS);
    idleTimer.unref();
    const abort = () => stop(options.signal?.reason ?? new Error("Clip compression cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    // Close the race between the initial aborted check and listener attachment.
    if (options.signal?.aborted) abort();
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      progress = (progress + chunk.toString()).slice(-16384);
      const lines = progress.split("\n");
      progress = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("out_time_us=")) continue;
        const time = Number(line.slice("out_time_us=".length));
        if (Number.isFinite(time) && time > lastTime) {
          lastTime = time;
          idleTimer.refresh();
        }
      }
    });
    child.once("error", error => { failure ??= error; });
    // Wait for close even after cancellation, before removing files in use.
    child.once("close", (code, signal) => {
      clearTimeout(idleTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      if (failure !== undefined) reject(failure);
      else if (code !== 0) {
        reject(new Error(`ffmpeg compression failed (${signal ?? code}): ${stderr.trim() || "unknown error"}`));
      } else resolve();
    });
  });
}

/** Dependency injection keeps tests off production storage. */
export function createStoredClipCompressor(deps: ClipCompressionDependencies) {
  return async (input: ClipCompressionInput): Promise<StoredClipMedia | null> => {
    input.signal?.throwIfAborted();
    if (!input.force && input.size <= COMPRESS_ABOVE_BYTES) return null;
    if (!Number.isSafeInteger(input.size) || input.size < 0) throw new Error("Invalid clip size");
    if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*|r2:clips\/[a-zA-Z0-9/._-]+)$/.test(input.filename) ||
        input.filename.includes("..")) throw new Error("Invalid stored clip filename");
    const kind = input.contentType.startsWith("audio/") ? "audio" :
      input.contentType.startsWith("video/") ? "video" : null;
    if (!kind) throw new Error("Clip compression requires audio or video");
    const extension = kind === "video" ? ".mp4" : ".m4a";
    const contentType = kind === "video" ? "video/mp4" : "audio/mp4";
    if (input.outputFilename !== undefined && (
      !/^(?:r2:clips\/derived\/)?clip_(?:compressed_)?[a-f0-9]{32}\.(mp4|m4a)$/.test(input.outputFilename) ||
      !input.outputFilename.endsWith(extension) ||
      input.outputFilename === input.filename
    )) throw new Error("Invalid reserved clip output filename");
    const temporaryRoot = await ensureClipTempRoot(deps.temporaryRoot ?? DEFAULT_CLIP_TEMP_ROOT);
    const directory = await mkdtemp(join(temporaryRoot, "clip-compress-"));
    try {
      await markActiveClipTempDirectory(directory);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    const source = join(directory, "source");
    const encoded = join(directory, `encoded${extension}`);
    let target: CompressionFile | undefined;
    let filename: string | undefined;
    let uploadAttempted = false;
    let targetAlreadyExisted = false;
    try {
      try {
        input.signal?.throwIfAborted();
        await copyMedia(
          deps.file(input.filename).createReadStream(),
          createWriteStream(source, { flags: "wx", mode: 0o600 }),
          deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
          input.signal,
        );
        input.signal?.throwIfAborted();
        await (deps.transcode ?? transcodeClipFile)(source, encoded, kind, {
          idleTimeoutMs: deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
          signal: input.signal,
        });
        input.signal?.throwIfAborted();
        const [original, output] = await Promise.all([stat(source), stat(encoded)]);
        input.signal?.throwIfAborted();
        if (!output.size) throw new Error("ffmpeg produced an empty clip");
        // Compare actual bytes, not an untrusted declared size. Never publish a
        // larger alternative or a synthetic URL when compression is ineffective.
        if (!input.force && output.size >= original.size) return null;
        // Follow the existing clip object-name contract used by reconciliation.
        filename = input.outputFilename ?? `clip_${randomUUID().replaceAll("-", "")}${extension}`;
        target = deps.file(filename);
        uploadAttempted = true;
        let outputStream: ReturnType<File["createWriteStream"]>;
        try {
          outputStream = target.createWriteStream({
            resumable: true,
            chunkSize: STORAGE_CHUNK_BYTES,
            timeout: deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType, cacheControl: "private, max-age=3600" },
          });
        } catch (error) {
          targetAlreadyExisted = Number((error as { code?: unknown })?.code) === 412;
          throw error;
        }
        // Keep ownership information even when abort or temp cleanup masks the
        // original pipeline error. A rejected create does not authorize delete.
        outputStream.once("error", (error: Error & { code?: unknown }) => {
          if (Number(error.code) === 412) targetAlreadyExisted = true;
        });
        await copyMedia(createReadStream(encoded), outputStream,
          deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS, input.signal);
        input.signal?.throwIfAborted();
        return { filename, contentType, size: output.size };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } catch (error) {
      // Never delete a pre-existing object on a failed creation precondition.
      if (uploadAttempted && target && filename && !targetAlreadyExisted &&
        Number((error as { code?: unknown })?.code) !== 412) {
        try { await target.delete({ ignoreNotFound: true }); }
        catch (cleanupError) {
          throw new ClipCompressionCleanupError(filename, error, cleanupError);
        }
      }
      throw error;
    }
  };
}

export async function compressStoredClip(input: ClipCompressionInput): Promise<StoredClipMedia | null> {
  input.signal?.throwIfAborted();
  // Bypass even storage initialization for ordinary uploads.
  if (!input.force && input.size <= COMPRESS_ABOVE_BYTES) return null;
  const { clipFile } = await import("./clip-storage.js");
  return createStoredClipCompressor({ file: clipFile })(input);
}