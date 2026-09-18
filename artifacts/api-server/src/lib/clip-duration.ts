import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { Readable } from "node:stream";
import type { File } from "@google-cloud/storage";

const TEST_LIMITS_KEY = Symbol.for("gdna.clipDuration.testLimits");
const DEFAULT_LIMITS = { inputBytes: 64 * 1024 * 1024, outputBytes: 4096, timeoutMs: 30_000 };
let activeJobs = 0;

export class ClipProbeBusyError extends Error {
  constructor() { super("Clip duration verifier is busy"); }
}

/**
 * Read-only verification of the original object. Like the thumbnail bridge,
 * loopback HTTP ranges let ffprobe seek to MP4/MOV tail metadata without
 * downloading the entire video. Limits bound work, NOT the media's duration.
 */
export async function verifiedDuration(file: File, expectedKind?: "audio" | "video" | "media"): Promise<number> {
  if (activeJobs >= 2) throw new ClipProbeBusyError();
  activeJobs++;
  try {
    const overrides = process.env.NODE_ENV === "production" ? undefined :
      (globalThis as typeof globalThis & {
        [TEST_LIMITS_KEY]?: Partial<typeof DEFAULT_LIMITS>;
      })[TEST_LIMITS_KEY];
    return await probe(file, { ...DEFAULT_LIMITS, ...overrides }, expectedKind);
  } finally {
    activeJobs--;
  }
}

async function probe(file: File, limits: typeof DEFAULT_LIMITS, expectedKind?: "audio" | "video" | "media"): Promise<number> {
  const secretPath = `/${randomBytes(32).toString("hex")}`;
  const streams = new Set<Readable>();
  const sockets = new Set<Socket>();
  const controller = new AbortController();
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let failure: Error | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  let inputBytes = 0;
  let requests = 0;
  let size = 0;
  const stopIO = () => {
    for (const stream of streams) stream.destroy();
    for (const socket of sockets) socket.destroy();
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    stopIO();
    rejectFailure(error);
  };
  const onClientError = (error: NodeJS.ErrnoException) => {
    // Seeking/early exit closes an unread HTTP response. TCP resets and broken
    // writes are expected here, unlike an error from the GCS source itself.
    if (error.code !== "ECONNRESET" && error.code !== "EPIPE") fail(error);
  };
  const server = createServer((request, response) => {
    response.on("error", onClientError);
    if (failure) { response.destroy(); return; }
    if (request.url !== secretPath || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(404).end();
      return;
    }
    if (++requests > 64) { fail(new Error("MEDIA_PROBE_REQUEST_LIMIT")); return; }
    if (request.method === "HEAD") {
      response.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": size }).end();
      return;
    }
    const range = request.headers.range;
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : undefined;
    const start = match ? Number(match[1]) : 0;
    const requestedEnd = match?.[2] ? Number(match[2]) : size - 1;
    if ((range && !match) || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) ||
        start > requestedEnd || start >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    const remaining = limits.inputBytes - inputBytes;
    if (remaining <= 0) { fail(new Error("MEDIA_PROBE_INPUT_LIMIT")); return; }
    // ffprobe reads serially; also cap live upstream streams if a client overlaps requests.
    if (streams.size >= 2) { fail(new Error("MEDIA_PROBE_STREAM_LIMIT")); return; }
    const end = Math.min(requestedEnd, size - 1, start + remaining - 1);
    response.writeHead(range ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      "Content-Type": "application/octet-stream",
      "Connection": "close",
    });
    try {
      const stream = file.createReadStream({ start, end });
      streams.add(stream);
      let ended = false;
      stream.on("error", fail);
      stream.on("close", () => {
        streams.delete(stream);
        if (!ended && !response.destroyed) fail(new Error("MEDIA_PROBE_SOURCE_CLOSED"));
      });
      stream.on("data", (chunk: Buffer) => {
        inputBytes += chunk.length;
        if (inputBytes > limits.inputBytes) { fail(new Error("MEDIA_PROBE_INPUT_LIMIT")); return; }
        if (!response.write(chunk)) stream.pause();
      });
      stream.on("end", () => {
        ended = true;
        response.end();
      });
      response.on("drain", () => stream.resume());
      // A seek or early ffprobe exit must cancel the old GCS download immediately.
      response.on("close", () => stream.destroy());
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  server.on("error", fail);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", onClientError);
    socket.on("close", () => sockets.delete(socket));
  });
  const timer = setTimeout(() => fail(new Error("MEDIA_PROBE_TIMEOUT")), limits.timeoutMs);
  // Keep the deadline alive even if only an unresolved metadata lookup remains.
  try {
    const [metadata] = await Promise.race([file.getMetadata(), failed]);
    size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("INVALID_MEDIA_SIZE");
    await Promise.race([
      new Promise<void>((resolve) => server.listen({
        port: 0, host: "127.0.0.1", signal: controller.signal,
      }, resolve)),
      failed,
    ]);
    if (failure) throw failure;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("MEDIA_PROBE_BRIDGE_FAILED");
    const spawned = spawn("ffprobe", [
      "-v", "error", "-threads", "1",
      "-max_alloc", String(32 * 1024 * 1024),
      "-protocol_whitelist", "http,tcp",
      // Real media containers, never playlists/concat scripts capable of
      // redirecting the probe to attacker-selected network addresses.
      "-format_whitelist", "mov,matroska,webm,mp3,aac,ogg,wav,flac,avi,mpeg,mpegts,asf,flv,aiff,ac3,eac3,amr,ape,au,tta,wv,rm,h264,hevc,av1,m4v,mjpeg",
      "-rw_timeout", "5000000",
      "-probesize", "5000000", "-analyzeduration", "5000000",
      "-show_entries", expectedKind ? "format=duration:stream=codec_type:stream_disposition=attached_pic" : "format=duration",
      "-of", expectedKind ? "json" : "default=noprint_wrappers=1:nokey=1",
      `http://127.0.0.1:${address.port}${secretPath}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    child = spawned;
    // No stdin pipe: early ffprobe exit can never cause an unhandled stdin EPIPE.
    let output = "";
    let outputBytes = 0;
    let errors = "";
    spawned.on("error", fail);
    spawned.stdout.on("error", fail);
    spawned.stderr.on("error", fail);
    spawned.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > limits.outputBytes) { fail(new Error("MEDIA_PROBE_OUTPUT_LIMIT")); return; }
      output += chunk.toString("utf8");
    });
    spawned.stderr.on("data", (chunk: Buffer) => {
      if (errors.length < 16_384) errors += chunk.toString("utf8").slice(0, 16_384 - errors.length);
    });
    childClosed = new Promise<void>((resolve) => spawned.once("close", () => resolve()));
    const result = new Promise<number>((resolve, reject) => {
      spawned.once("close", (code) => {
        let duration = Number(output.trim());
        if (expectedKind && !failure) {
          try {
            const media = JSON.parse(output) as {
              format?: { duration?: string };
              streams?: { codec_type?: string; disposition?: { attached_pic?: number } }[];
            };
            const hasAudio = media.streams?.some(stream => stream.codec_type === "audio") === true;
            const hasRealVideo = media.streams?.some(
              stream => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
            ) === true;
            // MIME is merely upload metadata. Require the corresponding stream
            // kind so audio-only MP4/MP3 bytes cannot opt into footage policy,
            // and album artwork cannot be treated as moving video.
            if ((expectedKind === "media" && !hasAudio && !hasRealVideo) ||
                (expectedKind === "audio" && (!hasAudio || hasRealVideo)) ||
                (expectedKind === "video" && !hasRealVideo)) {
              reject(new Error(expectedKind === "audio" ? "INVALID_AUDIO_STREAMS" : "INVALID_VIDEO_STREAMS"));
              return;
            }
            duration = Number(media.format?.duration);
          } catch {
            reject(new Error("INVALID_AUDIO_METADATA"));
            return;
          }
        }
        if (failure) reject(failure);
        else if (code !== 0 || !output.trim() || !Number.isFinite(duration) || duration <= 0) {
          reject(new Error(`INVALID_MEDIA_DURATION: ${errors.trim()}`));
        } else resolve(duration);
      });
    });
    return await Promise.race([result, failed]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    stopIO();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Do not release a concurrency slot until the child is actually reaped.
    await childClosed;
  }
}