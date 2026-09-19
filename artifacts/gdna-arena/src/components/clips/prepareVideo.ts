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

export class VideoPreparationUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoPreparationUnsupportedError";
  }
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
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error("WebM metadata is too large");
  for (let index = width - 1; index >= 0; index--) {
    bytes[offset + index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  bytes[offset] |= 1 << (8 - width);
}

function matches(bytes: Uint8Array, offset: number, id: readonly number[]) {
  return id.every((value, index) => bytes[offset + index] === value);
}

/**
 * MediaRecorder's streaming WebM omits Segment Info/Duration. Add that bounded
 * metadata without touching encoded video/audio frames, so server-side ffprobe
 * can independently verify a finite duration.
 */
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
    if (matches(bytes, offset, [0x2a, 0xd7, 0xb1])) {
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
  }
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, durationSeconds * 1_000_000_000 / timecodeScale, false);
  const result = new Uint8Array(bytes.length + duration.length);
  result.set(bytes.subarray(0, payloadEnd));
  result.set(duration, payloadEnd);
  result.set(bytes.subarray(payloadEnd), payloadEnd + duration.length);
  writeVint(result, sizeOffset, size.width, size.value + duration.length);
  return result;
}

export function videoOutputSize(sourceWidth: number, sourceHeight: number) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error("أبعاد الفيديو غير صالحة");
  const scale = Math.min(1, 480 / Math.min(sourceWidth, sourceHeight));
  return {
    width: Math.max(2, Math.floor(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.floor(sourceHeight * scale / 2) * 2),
  };
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
    if (!Number.isFinite(media.duration) || media.duration <= 0) throw new Error("مدة الملف غير صالحة");
    return media.duration;
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(url);
  }
}

async function playWithTimeout(video: HTMLVideoElement, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const timer = window.setTimeout(
      () => finish(new Error("انتهت مهلة تشغيل الفيديو للتحقق")),
      MEDIA_METADATA_TIMEOUT_MS,
    );
    const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    video.play().then(() => finish(), finish);
  });
}

function captureStreamSupported() {
  const prototype = HTMLMediaElement.prototype as HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  return typeof prototype.captureStream === "function" || typeof prototype.mozCaptureStream === "function";
}

function selectedMimeType() {
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(type => MediaRecorder.isTypeSupported(type));
}

export function browserCompressionUnavailableReason(file: File, durationSeconds?: number): string | null {
  if (!file.type.startsWith("video/")) return "ضغط المتصفح متاح للفيديو فقط";
  if (file.size > MAX_BROWSER_COMPRESSION_SOURCE_BYTES) {
    return "هذا الفيديو كبير جداً للضغط الآمن داخل المتصفح. ارفع الملف الأصلي.";
  }
  if (durationSeconds !== undefined && durationSeconds > MAX_BROWSER_COMPRESSION_DURATION_SECONDS) {
    return "هذا الفيديو طويل جداً للضغط الآمن داخل المتصفح. ارفع الملف الأصلي.";
  }
  if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined" ||
      typeof HTMLCanvasElement.prototype.captureStream !== "function" || !captureStreamSupported()) {
    return "متصفحك لا يدعم التحقق الآمن من الفيديو المضغوط. يمكنك رفع الملف الأصلي.";
  }
  if (!selectedMimeType()) return "متصفحك لا يدعم صيغة الضغط المطلوبة. يمكنك رفع الملف الأصلي.";
  return null;
}

export function compressionCandidateError(originalBytes: number, candidateBytes: number): string | null {
  if (candidateBytes >= originalBytes) {
    return "النسخة المضغوطة ليست أصغر من الملف الأصلي. استخدم الملف الأصلي.";
  }
  return null;
}

async function recordedStreamHasAudio(video: HTMLVideoElement, signal: AbortSignal) {
  const capture = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const stream = capture.captureStream?.() ?? capture.mozCaptureStream?.();
  if (!stream) return false;
  try {
    video.muted = true;
    await playWithTimeout(video, signal);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const timer = window.setTimeout(() => finish(), 200);
      const abort = () => {
        finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    return stream.getAudioTracks().some(track => track.readyState === "live");
  } finally {
    video.pause();
    stream.getTracks().forEach(track => track.stop());
  }
}

async function verifyPreparedVideo(
  file: File,
  expected: { duration: number; width: number; height: number },
  signal: AbortSignal,
) {
  const video = document.createElement("video");
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  try {
    await metadata(video, url, signal);
    const tolerance = Math.max(1.5, expected.duration * 0.025);
    if (!Number.isFinite(video.duration) || Math.abs(video.duration - expected.duration) > tolerance) {
      throw new Error("مدة الفيديو المضغوط لا تطابق الملف الأصلي");
    }
    if (video.videoWidth !== expected.width || video.videoHeight !== expected.height) {
      throw new Error("أبعاد الفيديو المضغوط غير صحيحة");
    }
    if (!await recordedStreamHasAudio(video, signal)) {
      throw new Error("لم يحافظ الضغط على مسار الصوت");
    }
    return video.duration;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function recordVideo(
  file: File,
  signal: AbortSignal,
  onProgress: PreparationProgress,
): Promise<{ file: File; duration: number; width: number; height: number }> {
  const reason = browserCompressionUnavailableReason(file);
  if (reason) throw new VideoPreparationUnsupportedError(reason);
  const mimeType = selectedMimeType()!;
  const video = document.createElement("video");
  video.muted = false;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  let output: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  try {
    await metadata(video, url, signal);
    const duration = video.duration;
    const durationReason = browserCompressionUnavailableReason(file, duration);
    if (durationReason) throw new VideoPreparationUnsupportedError(durationReason);
    const { width, height } = videoOutputSize(video.videoWidth, video.videoHeight);
    if (document.visibilityState === "hidden") {
      throw new Error("لا يمكن ضغط الفيديو والصفحة مخفية. الملف الأصلي ما زال محفوظاً.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new VideoPreparationUnsupportedError("تعذر تهيئة ضغط الفيديو في هذا المتصفح");
    audioContext = new AudioContext();
    const audioSource = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);
    await audioContext.resume();
    if (audioContext.state !== "running") {
      throw new VideoPreparationUnsupportedError("تعذر تشغيل مسار الصوت للضغط. يمكنك رفع الملف الأصلي.");
    }
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new VideoPreparationUnsupportedError("تعذر إنشاء مسار الصوت للفيديو. يمكنك رفع الملف الأصلي.");
    }
    signal.throwIfAborted();
    await playWithTimeout(video, signal);
    context.drawImage(video, 0, 0, width, height);
    output = canvas.captureStream(30);
    output.addTrack(audioTrack);
    const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 800_000 });
    const chunks: Blob[] = [];
    let outputBytes = 0;
    let recordingError: Error | undefined;
    let rejectPlayback: ((reason: unknown) => void) | undefined;
    const failRecording = (error: Error) => {
      if (recordingError) return;
      recordingError = error;
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
      rejectPlayback?.(error);
    };
    const completed = new Promise<void>((resolve) => {
      recorder.ondataavailable = event => {
        if (!event.data.size || recordingError) return;
        outputBytes += event.data.size;
        if (outputBytes > MAX_BROWSER_COMPRESSION_OUTPUT_BYTES) {
          failRecording(new Error("الفيديو المضغوط كبير جداً للتحقق الآمن. ارفع الملف الأصلي."));
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => {
        failRecording(new Error("فشل ضغط الفيديو"));
      };
      recorder.onstop = () => resolve();
    });
    const abort = () => {
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        failRecording(new Error("توقف الضغط لأن الصفحة أصبحت مخفية. الملف الأصلي ما زال محفوظاً."));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", hidden);
    recorder.start(1000);
    let animationFrame = 0;
    const draw = () => {
      if (video.ended || signal.aborted) return;
      context.drawImage(video, 0, 0, width, height);
      onProgress(Math.min(99, Math.floor(video.currentTime / duration * 100)));
      animationFrame = requestAnimationFrame(draw);
    };
    draw();
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          rejectPlayback = undefined;
          signal.removeEventListener("abort", aborted);
          error ? reject(error) : resolve();
        };
        rejectPlayback = reason => finish(reason);
        video.onended = () => finish();
        video.onerror = () => finish(new Error("تعذر تشغيل الفيديو أثناء الضغط"));
        const aborted = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
        else if (recordingError) finish(recordingError);
      });
      if (recorder.state !== "inactive") recorder.stop();
      await completed;
    } finally {
      signal.removeEventListener("abort", abort);
      document.removeEventListener("visibilitychange", hidden);
      cancelAnimationFrame(animationFrame);
      if (recorder.state !== "inactive") recorder.stop();
      await completed;
    }
    signal.throwIfAborted();
    if (recordingError) throw recordingError;
    const outputType = recorder.mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
    let blob = new Blob(chunks, { type: outputType });
    if (!blob.size) throw new Error("لم ينتج المتصفح فيديو مضغوطاً");
    if (blob.size > MAX_BROWSER_COMPRESSION_OUTPUT_BYTES) {
      throw new Error("الفيديو المضغوط كبير جداً للتحقق الآمن. ارفع الملف الأصلي.");
    }
    if (outputType === "video/webm") {
      const raw = new Uint8Array(await blob.arrayBuffer());
      blob = new Blob([webmWithDuration(raw, duration)], { type: outputType });
    }
    const extension = outputType === "video/mp4" ? "mp4" : "webm";
    onProgress(100);
    return {
      file: new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-480p.${extension}`, {
        type: outputType, lastModified: Date.now(),
      }),
      duration,
      width,
      height,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    output?.getTracks().forEach(track => track.stop());
    if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
    URL.revokeObjectURL(url);
  }
}

/**
 * Optional, real-time browser compression. It never replaces or mutates the
 * selected File. Callers must only upload uploadFile after this resolves; on
 * any error they must ask before falling back to originalFile.
 */
export async function prepareClipForUpload(
  originalFile: File,
  signal: AbortSignal,
  onProgress: (progress: ClipPreparationProgress) => void,
): Promise<PreparedClip> {
  onProgress({ phase: "loading", percent: 0 });
  const recorded = await recordVideo(originalFile, signal, percent => {
    onProgress({ phase: "compressing", percent });
  });
  const savingsError = compressionCandidateError(originalFile.size, recorded.file.size);
  if (savingsError) throw new Error(savingsError);
  onProgress({ phase: "verifying", percent: 0 });
  const outputDuration = await verifyPreparedVideo(recorded.file, recorded, signal);
  signal.throwIfAborted();
  onProgress({ phase: "verifying", percent: 100 });
  return {
    originalFile,
    uploadFile: recorded.file,
    compressed: true,
    sourceDuration: recorded.duration,
    outputDuration,
    width: recorded.width,
    height: recorded.height,
  };
}

/** Compatibility wrapper; new entry code should use prepareClipForUpload. */
export async function prepareVideo(file: File, signal: AbortSignal, onProgress: PreparationProgress): Promise<File> {
  const result = await prepareClipForUpload(file, signal, progress => {
    const weighted = progress.phase === "loading" ? 0 :
      progress.phase === "compressing" ? progress.percent * 0.9 :
        90 + progress.percent * 0.1;
    onProgress(Math.round(weighted));
  });
  return result.uploadFile;
}