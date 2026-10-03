import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Readable } from "node:stream";
import type { File } from "@google-cloud/storage";

const MAX_CONCURRENT = 2;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ALLOCATION_BYTES = 32 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 20_000;
const TEST_LIMITS_KEY = Symbol.for("gdna.clipThumbnail.testLimits");

interface RuntimeLimits {
  inputBytes: number;
  outputBytes: number;
  timeoutMs: number;
}

let activeJobs = 0;

function runtimeLimits(): RuntimeLimits {
  const defaults: RuntimeLimits = {
    inputBytes: MAX_INPUT_BYTES,
    outputBytes: MAX_OUTPUT_BYTES,
    timeoutMs: FFMPEG_TIMEOUT_MS,
  };
  if (process.env.NODE_ENV === "production") return defaults;
  const override = (globalThis as typeof globalThis & {
    [TEST_LIMITS_KEY]?: Partial<RuntimeLimits>;
  })[TEST_LIMITS_KEY];
  return { ...defaults, ...override };
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = Math.max(0, deadline - Date.now());
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Thumbnail generation timed out")), remaining);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function httpError(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) {
    response.destroy(new Error(message));
    return;
  }
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message),
    "Connection": "close",
  });
  response.end(message);
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start > requestedEnd || start >= size) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function runThumbnail(file: File, limits: RuntimeLimits, deadline: number, signal?: AbortSignal): Promise<Buffer> {
  const [metadata] = await beforeDeadline(file.getMetadata(), deadline);
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Clip has an invalid or empty object size");
  }

  const secretPath = `/${randomBytes(32).toString("hex")}`;
  const streams = new Set<Readable>();
  const sockets = new Set<Socket>();
  let inputBytes = 0;
  let bridgeFailure: Error | undefined;

  const server = createServer((request, response) => {
    if (request.url !== secretPath || (request.method !== "GET" && request.method !== "HEAD")) {
      httpError(response, 404, "Not found");
      return;
    }

    if (request.method === "HEAD") {
      response.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": size,
        "Content-Type": "application/octet-stream",
      });
      response.end();
      return;
    }

    const rangeHeader = typeof request.headers.range === "string" ? request.headers.range : undefined;
    const range = parseRange(rangeHeader, size);
    if (!range || inputBytes >= limits.inputBytes) {
      response.setHeader("Content-Range", `bytes */${size}`);
      httpError(response, 416, "Range not satisfiable");
      return;
    }

    // An open-ended request can otherwise advertise an arbitrarily large body.
    // Give ffmpeg the remaining time; it can seek with another range.
    const end = Math.min(range.end, range.start + (limits.inputBytes - inputBytes) - 1);
    const contentLength = end - range.start + 1;
    response.writeHead(rangeHeader ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Length": contentLength,
      ...(rangeHeader ? { "Content-Range": `bytes ${range.start}-${end}/${size}` } : {}),
      "Content-Type": "application/octet-stream",
      "Connection": "close",
    });

    const stream = file.createReadStream({ start: range.start, end });
    streams.add(stream);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      streams.delete(stream);
    };
    stream.on("data", (raw: Buffer | Uint8Array) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const remaining = limits.inputBytes - inputBytes;
      if (remaining <= 0 || chunk.length > remaining) {
        if (remaining > 0) {
          inputBytes += remaining;
          response.write(chunk.subarray(0, remaining));
        }
        bridgeFailure = new Error(`Clip input exceeded ${limits.inputBytes} byte processing limit`);
        stream.destroy(bridgeFailure);
        response.destroy(bridgeFailure);
        return;
      }
      inputBytes += chunk.length;
      if (!response.write(chunk)) stream.pause();
    });
    response.on("drain", () => stream.resume());
    stream.on("end", () => {
      finish();
      response.end();
    });
    stream.on("error", (error) => {
      finish();
      bridgeFailure ??= error;
      response.destroy(error);
    });
    response.on("close", () => {
      finish();
      if (!stream.destroyed) stream.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  let child: ChildProcess | undefined;
  let timeout: NodeJS.Timeout | undefined;
  const abort = () => child?.kill("SIGKILL");
  signal?.addEventListener("abort",abort,{once:true});
  try {
    await beforeDeadline(new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    }), deadline);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Thumbnail bridge did not bind a TCP port");
    if (signal?.aborted) throw new Error("Thumbnail interrupted");

    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-threads", "1",
      "-filter_threads", "1",
      "-max_alloc", String(MAX_ALLOCATION_BYTES),
      "-protocol_whitelist", "http,tcp",
      "-format_whitelist", "mov,matroska,webm",
      "-rw_timeout", "5000000",
      "-i", `http://127.0.0.1:${address.port}${secretPath}`,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-vf", "scale=480:480:force_original_aspect_ratio=decrease",
      "-an", "-sn", "-dn",
      "-threads", "1",
      "-c:v", "libwebp", "-quality", "75",
      "-f", "image2pipe", "pipe:1",
    ];
    const spawned = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    child = spawned;

    const output: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let terminalError: Error | undefined;
    spawned.stdout.on("data", (raw: Buffer | Uint8Array) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      outputBytes += chunk.length;
      if (outputBytes > limits.outputBytes) {
        terminalError ??= new Error(`Generated thumbnail exceeded ${limits.outputBytes} byte limit`);
        child?.kill("SIGKILL");
        return;
      }
      output.push(chunk);
    });
    spawned.stderr.on("data", (raw: Buffer | Uint8Array) => {
      if (stderr.length < 16_384) stderr += Buffer.from(raw).toString("utf8").slice(0, 16_384 - stderr.length);
    });

    const result = await new Promise<Buffer>((resolve, reject) => {
      spawned.once("error", reject);
      spawned.once("close", (code, signal) => {
        if (terminalError) return reject(terminalError);
        if (bridgeFailure) return reject(bridgeFailure);
        if (code !== 0) {
          return reject(new Error(`ffmpeg thumbnail generation failed (${signal ?? code}): ${stderr.trim() || "unknown error"}`));
        }
        const webp = Buffer.concat(output, outputBytes);
        if (webp.length < 20 || webp.toString("ascii", 0, 4) !== "RIFF" ||
            webp.toString("ascii", 8, 12) !== "WEBP" || webp.readUInt32LE(4) !== webp.length - 8) {
          return reject(new Error("ffmpeg did not produce a valid WebP thumbnail"));
        }
        resolve(webp);
      });
      timeout = setTimeout(() => {
        terminalError = new Error("Thumbnail generation timed out");
        child?.kill("SIGKILL");
      }, Math.max(0, deadline - Date.now()));
      timeout.unref();
    });
    return result;
  } finally {
    signal?.removeEventListener("abort",abort);
    if (timeout) clearTimeout(timeout);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of streams) stream.destroy();
    await closeServer(server, sockets);
  }
}

/**
 * Generates one bounded WebP preview from a provider-backed video object.
 *
 * At most two calls run concurrently. Additional calls reject immediately so
 * thumbnail work cannot become an unbounded in-process queue.
 */
export async function generateClipThumbnail(file: File, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw new Error("Thumbnail interrupted");
  if (activeJobs >= MAX_CONCURRENT) {
    throw new Error("Clip thumbnail generator is busy");
  }
  activeJobs++;
  try {
    const limits = runtimeLimits();
    return await runThumbnail(file, limits, Date.now() + limits.timeoutMs,signal);
  } finally {
    activeJobs--;
  }
}