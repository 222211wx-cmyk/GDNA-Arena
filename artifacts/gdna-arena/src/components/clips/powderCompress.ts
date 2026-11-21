// Powder compression: re-encode the chosen video in the browser before upload.
// "powder" = 480p @ 500 kbps, "normal" = 720p @ 1 Mbps. Resolution is applied to
// the short side so portrait clips keep their 9:16 shape.

export type CompressionMode = "powder" | "normal";

export const COMPRESSION_PROFILES: Record<CompressionMode, { shortSide: number; videoBps: number; audioBps: number }> = {
  powder: { shortSide: 480, videoBps: 500_000, audioBps: 64_000 },
  normal: { shortSide: 720, videoBps: 1_000_000, audioBps: 96_000 },
};

const MP4_TYPES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"];

export function supportedMp4Type(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MP4_TYPES.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function targetSize(width: number, height: number, shortSide: number) {
  const scale = Math.min(1, shortSide / Math.min(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

const toMB = (bytes: number) => {
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
};

/** "قبل: 48 MB -> من بعد: 2.6 MB | وفرتي 94% ✅" */
export function formatSavings(before: number, after: number): string {
  const saved = before > 0 ? Math.max(0, Math.floor((1 - after / before) * 100)) : 0;
  return `قبل: ${toMB(before)} -> من بعد: ${toMB(after)} | وفرتي ${saved}% ✅`;
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Cancelled", "AbortError");
}

/** Real-time transcode through canvas + MediaRecorder. Throws if MP4 recording is unavailable. */
export async function compressVideo(
  file: File,
  mode: CompressionMode,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<File> {
  signal.throwIfAborted();
  const mimeType = supportedMp4Type();
  if (!mimeType) throw new Error("Compression indisponible sur ce navigateur");
  const profile = COMPRESSION_PROFILES[mode];
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  let audioContext: AudioContext | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Vidéo illisible"));
    });
    signal.throwIfAborted();
    const { width, height } = targetSize(video.videoWidth || 640, video.videoHeight || 360, profile.shortSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Compression indisponible sur ce navigateur");
    const stream = canvas.captureStream(30);
    // Route audio into the recorder without playing it through the speakers.
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    } catch { /* silent clip or no WebAudio: record video only */ }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: profile.videoBps,
      audioBitsPerSecond: profile.audioBps,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Échec de la compression"));
    });

    let raf = 0;
    const draw = () => {
      ctx.drawImage(video, 0, 0, width, height);
      if (video.duration > 0) onProgress(Math.min(99, (video.currentTime / video.duration) * 100));
      raf = requestAnimationFrame(draw);
    };
    const stop = () => { cancelAnimationFrame(raf); video.pause(); if (recorder.state !== "inactive") recorder.stop(); };
    const ended = new Promise<void>(resolve => { video.onended = () => resolve(); });
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
    });

    recorder.start(1000);
    await video.play();
    draw();
    try {
      await Promise.race([ended, aborted]);
    } finally {
      stop();
    }
    await finished;
    signal.throwIfAborted();
    onProgress(100);
    const base = file.name.replace(/\.[^.]+$/, "") || "clip";
    return new File(chunks, `${base}-${mode}.mp4`, { type: "video/mp4", lastModified: Date.now() });
  } finally {
    void audioContext?.close().catch(() => {});
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
