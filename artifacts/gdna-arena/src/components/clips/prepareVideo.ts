import type { FFmpeg } from "@ffmpeg/ffmpeg";

export type PreparationProgress = (percent: number) => void;

export type ClipPreparationPhase = "loading" | "compressing" | "verifying";
export type ClipPreparationProgress = {
  phase: ClipPreparationPhase;
  percent: number;
};

export type PreparedClip = {
  /** The selected camera/library file is deliberately retained for explicit fallback. */
  originalFile: File;
  /** This is the only value callers should pass to uploadClip after success. */
  uploadFile: File;
  compressed: true;
  sourceDuration: number;
  outputDuration: number;
  width: number;
  height: number;
};

export const MAX_BROWSER_COMPRESSION_SOURCE_BYTES = 512 * 1024 * 1024;
export const MAX_BROWSER_COMPRESSION_OUTPUT_BYTES = 256 * 1024 * 1024;
export const MAX_BROWSER_COMPRESSION_DURATION_SECONDS = 30 * 60;
export const MEDIA_METADATA_TIMEOUT_MS = 30_000;

const AUDIO_BITRATE = 128_000;
const MIN_VIDEO_BITRATE = 350_000;
const MAX_VIDEO_BITRATE = 1_600_000;
const OUTPUT_BUDGET_RATIO = 0.85;
const CORE_LOAD_TIMEOUT_MS = 2 * 60_000;
const MAX_TRANSCODE_TIMEOUT_MS = 2 * 60 * 60_000;

export class VideoPreparationUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoPreparationUnsupportedError";
  }
}

function metadata(
  media: HTMLMediaElement,
  url: string,
  signal: AbortSignal,
  timeoutMs = MEDIA_METADATA_TIMEOUT_MS,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.onloadedmetadata = media.onerror = null;
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const aborted = () => finish(signal.reason instanceof Error
      ? signal.reason : new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(
      () => finish(new Error("انتهت مهلة قراءة بيانات الفيديو")),
      timeoutMs,
    );
    media.onloadedmetadata = () => finish();
    media.onerror = () => finish(new Error("تعذر قراءة الفيديو المحدد"));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    media.src = url;
  });
}

export async function mediaDuration(file: File, signal: AbortSignal) {
  const media = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
  const url = URL.createObjectURL(file);
  try {
    await metadata(media, url, signal);
    if (!Number.isFinite(media.duration) || media.duration <= 0) {
      throw new Error("مدة الملف غير صالحة");
    }
    return media.duration;
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(url);
  }
}

export function videoOutputSize(sourceWidth: number, sourceHeight: number) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error("أبعاد الفيديو غير صالحة");
  const scale = Math.min(1, 720 / Math.min(sourceWidth, sourceHeight));
  return {
    width: Math.max(2, Math.floor(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.floor(sourceHeight * scale / 2) * 2),
  };
}

export function browserCompressionUnavailableReason(file: File, durationSeconds?: number): string | null {
  if (!file.type.startsWith("video/")) return "ضغط المتصفح متاح للفيديو فقط";
  if (file.size > MAX_BROWSER_COMPRESSION_SOURCE_BYTES) {
    return "هذا الفيديو كبير جداً للضغط الآمن داخل المتصفح. ارفع الملف الأصلي.";
  }
  if (durationSeconds !== undefined && durationSeconds > MAX_BROWSER_COMPRESSION_DURATION_SECONDS) {
    return "هذا الفيديو طويل جداً للضغط الآمن داخل المتصفح. ارفع الملف الأصلي.";
  }
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    return "متصفحك لا يدعم ضغط الفيديو الآمن. يمكنك رفع الملف الأصلي.";
  }
  return null;
}

export function compressionCandidateError(originalBytes: number, candidateBytes: number): string | null {
  if (candidateBytes >= originalBytes) {
    return "النسخة المضغوطة ليست أصغر من الملف الأصلي. استخدم الملف الأصلي.";
  }
  if (candidateBytes <= 0 || candidateBytes > MAX_BROWSER_COMPRESSION_OUTPUT_BYTES) {
    return "حجم الفيديو المضغوط غير صالح. استخدم الملف الأصلي.";
  }
  return null;
}

function readVint(bytes: Uint8Array, offset: number) {
  if (offset >= bytes.length) throw new Error("Invalid WebM element");
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && !(bytes[offset] & mask)) { width++; mask >>= 1; }
  if (width > 8 || offset + width > bytes.length) throw new Error("Invalid WebM element size");
  let value = bytes[offset] & (mask - 1);
  let unknown = value === mask - 1;
  for (let index = 1; index < width; index++) {
    value = value * 256 + bytes[offset + index];
    unknown = unknown && bytes[offset + index] === 0xff;
  }
  return { width, value, unknown };
}

function writeVint(bytes: Uint8Array, offset: number, width: number, value: number) {
  const maximum = 2 ** (7 * width) - 2;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error("WebM metadata is too large");
  }
  for (let index = width - 1; index >= 0; index--) {
    bytes[offset + index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  bytes[offset] |= 1 << (8 - width);
}

function matches(bytes: Uint8Array, offset: number, id: readonly number[]) {
  return id.every((value, index) => bytes[offset + index] === value);
}

/** Retained for source compatibility; FFmpeg's MP4 path does not call it. */
export function webmWithDuration(bytes: Uint8Array, durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
      bytes.byteLength > MAX_BROWSER_COMPRESSION_OUTPUT_BYTES) {
    throw new Error("تعذر تثبيت مدة الفيديو المضغوط");
  }
  const infoId = [0x15, 0x49, 0xa9, 0x66] as const;
  const clusterId = [0x1f, 0x43, 0xb6, 0x75] as const;
  let infoOffset = -1;
  const scanEnd = Math.min(bytes.length - 5, 4 * 1024 * 1024);
  for (let offset = 0; offset <= scanEnd; offset++) {
    if (matches(bytes, offset, clusterId)) break;
    if (matches(bytes, offset, infoId)) { infoOffset = offset; break; }
  }
  if (infoOffset < 0) throw new Error("تعذر العثور على بيانات مدة WebM");
  const sizeOffset = infoOffset + infoId.length;
  const size = readVint(bytes, sizeOffset);
  if (size.unknown) throw new Error("بيانات WebM غير مدعومة");
  const payloadOffset = sizeOffset + size.width;
  const payloadEnd = payloadOffset + size.value;
  if (payloadEnd > bytes.length) throw new Error("بيانات WebM غير مكتملة");
  let timecodeScale = 1_000_000;
  for (let offset = payloadOffset; offset + 4 <= payloadEnd; offset++) {
    if (!matches(bytes, offset, [0x2a, 0xd7, 0xb1])) continue;
    const scaleSize = readVint(bytes, offset + 3);
    if (!scaleSize.unknown && scaleSize.value >= 1 && scaleSize.value <= 8) {
      let value = 0;
      for (let index = 0; index < scaleSize.value; index++) {
        value = value * 256 + bytes[offset + 3 + scaleSize.width + index];
      }
      if (value > 0) timecodeScale = value;
    }
    break;
  }
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(
    3,
    durationSeconds * 1_000_000_000 / timecodeScale,
    false,
  );
  const result = new Uint8Array(bytes.length + duration.length);
  result.set(bytes.subarray(0, payloadEnd));
  result.set(duration, payloadEnd);
  result.set(bytes.subarray(payloadEnd), payloadEnd + duration.length);
  writeVint(result, sizeOffset, size.width, size.value + duration.length);
  return result;
}

export function ffmpegVideoBitrate(durationSeconds: number) {
  const budget = MAX_BROWSER_COMPRESSION_OUTPUT_BYTES * 8 * OUTPUT_BUDGET_RATIO / durationSeconds;
  return Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE, Math.floor(budget - AUDIO_BITRATE)));
}

export function ffmpegCompressionArguments(
  width: number,
  height: number,
  durationSeconds: number,
) {
  const bitrate = ffmpegVideoBitrate(durationSeconds);
  return [
    "-i", "source",
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", `scale=${width}:${height}`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-b:v", String(bitrate),
    "-maxrate", String(bitrate),
    "-bufsize", String(bitrate * 2),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "prepared.mp4",
  ];
}

type VideoFacts = {
  duration: number;
  width: number;
  height: number;
};

type ProbeFacts = {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  hasAudio: boolean;
  audioCodec?: string;
};

export function ffprobeInvocationError(exitCode: number, report: string | Uint8Array) {
  // The packaged core returns -1 even when ffprobe successfully writes -o.
  // A readable, non-empty report is therefore the success signal.
  return typeof report === "string" && report.trim()
    ? null
    : `تعذر التحقق من مسارات الفيديو (ffprobe ${exitCode})`;
}

async function probeFile(
  ffmpeg: FFmpeg,
  path: string,
  reportPath: string,
  signal: AbortSignal,
): Promise<ProbeFacts> {
  // ffmpeg-core 0.12.10 reports -1 for a successful ffprobe invocation that
  // writes a valid -o file. The report itself is the authoritative result.
  const exitCode = await ffmpeg.ffprobe([
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    path,
    "-o", reportPath,
  ], 60_000, { signal });
  let report: Awaited<ReturnType<FFmpeg["readFile"]>>;
  try {
    report = await ffmpeg.readFile(reportPath, "utf8", { signal });
  } catch {
    throw new Error(`تعذر التحقق من مسارات الفيديو (ffprobe ${exitCode})`);
  }
  const invocationError = ffprobeInvocationError(exitCode, report);
  if (invocationError) throw new Error(invocationError);
  if (typeof report !== "string") throw new Error("بيانات التحقق من الفيديو غير صالحة");
  const parsed = JSON.parse(report) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find(stream => stream.codec_type === "video");
  const audio = parsed.streams?.find(stream => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? video?.duration);
  if (!video?.codec_name || !Number.isFinite(duration) || duration <= 0 ||
      !video.width || !video.height) {
    throw new Error("بيانات التحقق من الفيديو غير مكتملة");
  }
  return {
    duration,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
  };
}

export function preparedProbeError(
  source: Pick<ProbeFacts, "duration" | "hasAudio">,
  output: ProbeFacts,
  expectedSize: { width: number; height: number },
) {
  const tolerance = Math.max(1.5, source.duration * 0.01);
  if (Math.abs(output.duration - source.duration) > tolerance) {
    return "مدة الفيديو المضغوط لا تطابق الملف الأصلي";
  }
  if (output.width !== expectedSize.width || output.height !== expectedSize.height) {
    return "أبعاد الفيديو المضغوط غير صحيحة";
  }
  if (output.videoCodec !== "h264") return "الفيديو المضغوط ليس H.264 صالحاً";
  if (source.hasAudio && (!output.hasAudio || output.audioCodec !== "aac")) {
    return "لم يحافظ الضغط على مسار الصوت بصيغة AAC";
  }
  return null;
}

async function browserVideoFacts(file: File, signal: AbortSignal): Promise<VideoFacts> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  try {
    await metadata(video, url, signal);
    if (!Number.isFinite(video.duration) || video.duration <= 0 ||
        video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("بيانات الفيديو غير صالحة");
    }
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function verifyPreparedVideo(
  file: File,
  expected: VideoFacts,
  signal: AbortSignal,
) {
  const actual = await browserVideoFacts(file, signal);
  const tolerance = Math.max(1.5, expected.duration * 0.01);
  if (Math.abs(actual.duration - expected.duration) > tolerance) {
    throw new Error("مدة الفيديو المضغوط لا تطابق الملف الأصلي");
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error("أبعاد الفيديو المضغوط غير صحيحة");
  }
  return actual.duration;
}

/**
 * Optional FFmpeg.wasm compression. Merely importing this module does not load
 * FFmpeg, its worker, or its ~30 MB core; that only happens after this explicit
 * opt-in function is called.
 */
export async function prepareClipForUpload(
  originalFile: File,
  signal: AbortSignal,
  onProgress: (progress: ClipPreparationProgress) => void,
): Promise<PreparedClip> {
  const initialReason = browserCompressionUnavailableReason(originalFile);
  if (initialReason) throw new VideoPreparationUnsupportedError(initialReason);
  signal.throwIfAborted();
  onProgress({ phase: "loading", percent: 0 });

  const source = await browserVideoFacts(originalFile, signal);
  const durationReason = browserCompressionUnavailableReason(originalFile, source.duration);
  if (durationReason) throw new VideoPreparationUnsupportedError(durationReason);
  const outputSize = videoOutputSize(source.width, source.height);

  const { createFFmpegRuntime } = await import("./ffmpegRuntime");
  signal.throwIfAborted();
  const runtime = await createFFmpegRuntime();
  const { ffmpeg } = runtime;
  const terminate = () => ffmpeg.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const progress = ({ progress: ratio }: { progress: number }) => {
    if (!Number.isFinite(ratio)) return;
    onProgress({ phase: "compressing", percent: Math.min(99, Math.max(0, Math.floor(ratio * 100))) });
  };
  ffmpeg.on("progress", progress);

  try {
    let loadTimer = 0;
    await Promise.race([
      runtime.load(signal),
      new Promise<never>((_, reject) => {
        loadTimer = window.setTimeout(
          () => reject(new Error("انتهت مهلة تحميل محرك ضغط الفيديو")),
          CORE_LOAD_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(loadTimer));
    signal.throwIfAborted();
    onProgress({ phase: "loading", percent: 100 });
    onProgress({ phase: "compressing", percent: 0 });

    const sourceBuffer = await originalFile.arrayBuffer();
    signal.throwIfAborted();
    await ffmpeg.writeFile("source", new Uint8Array(sourceBuffer), { signal });
    const sourceProbe = await probeFile(ffmpeg, "source", "source-probe.json", signal);
    const timeoutMs = Math.min(
      MAX_TRANSCODE_TIMEOUT_MS,
      Math.max(120_000, Math.ceil(source.duration * 20_000)),
    );
    const exitCode = await ffmpeg.exec(
      ffmpegCompressionArguments(outputSize.width, outputSize.height, source.duration),
      timeoutMs,
      { signal },
    );
    signal.throwIfAborted();
    if (exitCode !== 0) throw new Error("فشل FFmpeg في ضغط الفيديو ضمن المهلة الآمنة");

    const outputProbe = await probeFile(ffmpeg, "prepared.mp4", "output-probe.json", signal);
    const probeError = preparedProbeError(sourceProbe, outputProbe, outputSize);
    if (probeError) throw new Error(probeError);
    const bytes = await ffmpeg.readFile("prepared.mp4", "binary", { signal });
    if (typeof bytes === "string") throw new Error("أعاد FFmpeg فيديو غير صالح");
    const candidateError = compressionCandidateError(originalFile.size, bytes.byteLength);
    if (candidateError) throw new Error(candidateError);
    const output = new File(
      [new Uint8Array(bytes).buffer],
      `${originalFile.name.replace(/\.[^.]+$/, "")}-720p.mp4`,
      { type: "video/mp4", lastModified: Date.now() },
    );
    onProgress({ phase: "compressing", percent: 100 });
    onProgress({ phase: "verifying", percent: 0 });
    const outputDuration = await verifyPreparedVideo(
      output,
      { ...outputSize, duration: source.duration },
      signal,
    );
    signal.throwIfAborted();
    onProgress({ phase: "verifying", percent: 100 });
    return {
      originalFile,
      uploadFile: output,
      compressed: true,
      sourceDuration: source.duration,
      outputDuration,
      ...outputSize,
    };
  } finally {
    signal.removeEventListener("abort", terminate);
    ffmpeg.off("progress", progress);
    // Always releases the WASM heap/worker; abort invokes this immediately too.
    ffmpeg.terminate();
  }
}

/** Compatibility wrapper used by existing clip entry code. */
export async function prepareVideo(
  file: File,
  signal: AbortSignal,
  onProgress: PreparationProgress,
): Promise<File> {
  const result = await prepareClipForUpload(file, signal, progress => {
    const weighted = progress.phase === "loading" ? progress.percent * 0.1 :
      progress.phase === "compressing" ? 10 + progress.percent * 0.8 :
        90 + progress.percent * 0.1;
    onProgress(Math.round(weighted));
  });
  return result.uploadFile;
}