export type PreparationProgress = (percent: number) => void;

export class VideoPreparationUnsupportedError extends Error {}

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
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || bytes.byteLength > 512 * 1024 * 1024) {
    throw new Error("تعذر تثبيت مدة الفيديو المضغوط");
  }
  const infoId = [0x15, 0x49, 0xa9, 0x66] as const;
  const clusterId = [0x1f, 0x43, 0xb6, 0x75] as const;
  let infoOffset = -1;
  // Info is before the first Cluster. Limit the metadata scan rather than
  // interpreting arbitrary encoded frame bytes as EBML.
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

function metadata(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      video.onloadedmetadata = video.onerror = null;
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const aborted = () => finish(new DOMException("Aborted", "AbortError"));
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish(new Error("تعذر قراءة الفيديو المحدد"));
    signal.addEventListener("abort", aborted, { once: true });
    video.src = url;
  });
}

export async function mediaDuration(file: File, signal: AbortSignal) {
  const media = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
  const url = URL.createObjectURL(file);
  try {
    await metadata(media as HTMLVideoElement, url, signal);
    if (!Number.isFinite(media.duration) || media.duration <= 0) throw new Error("مدة الملف غير صالحة");
    return media.duration;
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareVideo(file: File, signal: AbortSignal, onProgress: PreparationProgress): Promise<File> {
  if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined" ||
      typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new VideoPreparationUnsupportedError("متصفحك لا يدعم ضغط الفيديو. يمكنك اختيار رفع الملف الأصلي.");
  }
  const mimeType = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new VideoPreparationUnsupportedError("متصفحك لا يدعم صيغة الضغط المطلوبة. يمكنك اختيار رفع الملف الأصلي.");

  const video = document.createElement("video");
  video.muted = false;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  let output: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  try {
    await metadata(video, url, signal);
    const { width, height } = videoOutputSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new VideoPreparationUnsupportedError("تعذر تهيئة ضغط الفيديو في هذا المتصفح");
    // Route the decoded source audio directly to a recording destination before
    // playback. Do not connect it to speakers and do not mute the source signal.
    // Unlike video.captureStream(), this exposes the audio track before play().
    audioContext = new AudioContext();
    const audioSource = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);
    await audioContext.resume();
    if (audioContext.state !== "running") {
      throw new VideoPreparationUnsupportedError("تعذر تشغيل مسار الصوت للضغط. يمكنك اختيار رفع الملف الأصلي.");
    }
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new VideoPreparationUnsupportedError("تعذر إنشاء مسار الصوت للفيديو. يمكنك اختيار رفع الملف الأصلي.");
    }
    signal.throwIfAborted();
    await video.play();
    context.drawImage(video, 0, 0, width, height);
    // Start the canvas clock only after audio initialization and decoding.
    // Otherwise a buffered blank frame can add a leading video-only delay.
    output = canvas.captureStream(30);
    output.addTrack(audioTrack);
    const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 800_000 });
    const chunks: Blob[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("فشل ضغط الفيديو"));
      recorder.onstop = () => resolve();
    });
    const abort = () => {
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    recorder.start(1000);
    const draw = () => {
      if (video.ended || signal.aborted) return;
      context.drawImage(video, 0, 0, width, height);
      onProgress(Math.min(99, Math.floor(video.currentTime / video.duration * 100)));
      requestAnimationFrame(draw);
    };
    draw();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error("تعذر تشغيل الفيديو أثناء الضغط"));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    if (recorder.state !== "inactive") recorder.stop();
    await completed;
    signal.removeEventListener("abort", abort);
    onProgress(100);
    const outputType = recorder.mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
    let blob = new Blob(chunks, { type: outputType });
    if (!blob.size) throw new Error("لم ينتج المتصفح فيديو مضغوطاً");
    if (outputType === "video/webm") {
      const raw = new Uint8Array(await blob.arrayBuffer());
      blob = new Blob([webmWithDuration(raw, video.duration)], { type: outputType });
    }
    const extension = outputType === "video/mp4" ? "mp4" : "webm";
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-480p.${extension}`, {
      type: outputType, lastModified: Date.now(),
    });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    output?.getTracks().forEach(track => track.stop());
    if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
    URL.revokeObjectURL(url);
  }
}