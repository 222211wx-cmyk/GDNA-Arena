const MINIMUM_DURATION_SECONDS = 60;
const MEDIA_TIMEOUT_MS = 15_000;
const POSTER_MAX_WIDTH = 360;
const MAX_WASM_INPUT_BYTES = 512 * 1024 * 1024;

export interface PrepareClipOptions {
  compress: boolean;
  signal: AbortSignal;
  onProgress: (value: number) => void;
}

export interface PreparedClip {
  file: File;
  duration: number;
  thumbnail: Blob | null;
}

function abortError(): DOMException {
  return new DOMException("Video preparation was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata",
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
    };
    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const onSuccess = () => finish(resolve);
    const onError = () =>
      finish(() =>
        reject(
          new Error(
            "This video could not be decoded by your browser. Please choose a supported video file.",
          ),
        ),
      );

    signal.addEventListener("abort", onAbort, { once: true });
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
    timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              "Timed out while reading video metadata. Please choose a supported video file.",
            ),
          ),
        ),
      MEDIA_TIMEOUT_MS,
    );
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(null), MEDIA_TIMEOUT_MS);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(blob);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    canvas.toBlob(finish, "image/jpeg", 0.6);
  });
}

async function inspectVideo(
  file: File,
  signal: AbortSignal,
): Promise<{ duration: number; thumbnail: Blob | null }> {
  if (file.type && !file.type.startsWith("video/")) {
    throw new Error("The selected file is not a video.");
  }

  throwIfAborted(signal);
  const objectURL = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  try {
    const metadataReady = waitForVideoEvent(video, "loadedmetadata", signal);
    video.src = objectURL;
    video.load();
    await metadataReady;
    throwIfAborted(signal);

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        "The video duration could not be determined. Please choose a supported video file.",
      );
    }
    if (duration < MINIMUM_DURATION_SECONDS) {
      throw new Error("Clips must be at least 60 seconds long.");
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error(
        "The video dimensions could not be determined. Please choose a supported video file.",
      );
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, "loadeddata", signal);
    }
    throwIfAborted(signal);

    const width = Math.min(POSTER_MAX_WIDTH, video.videoWidth);
    const height = Math.max(
      1,
      Math.round((width * video.videoHeight) / video.videoWidth),
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { duration, thumbnail: null };

    context.drawImage(video, 0, 0, width, height);
    const thumbnail = await canvasToBlob(canvas, signal);
    return { duration, thumbnail };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectURL);
  }
}

function compressedName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "clip";
  return `${base}.mp4`;
}

function wasmMemoryError(cause?: unknown): Error {
  return new Error(
    "This file is too large to compress safely in this browser. Disable compression and upload the original video instead.",
    cause === undefined ? undefined : { cause },
  );
}

function looksLikeWasmMemoryFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /memory|allocation|out of bounds|Array buffer allocation|wasm/i.test(message);
}

async function compressVideo(
  file: File,
  signal: AbortSignal,
  reportProgress: (value: number) => void,
): Promise<File> {
  if (file.size > MAX_WASM_INPUT_BYTES) throw wasmMemoryError();
  throwIfAborted(signal);

  let ffmpeg: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
  const inputName = `input-${crypto.randomUUID()}`;
  const outputName = `output-${crypto.randomUUID()}.mp4`;
  const onAbort = () => ffmpeg?.terminate();

  try {
    const [{ FFmpeg }, coreModule, wasmModule] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/core?url"),
      import("@ffmpeg/core/wasm?url"),
    ]);
    throwIfAborted(signal);

    ffmpeg = new FFmpeg();
    signal.addEventListener("abort", onAbort, { once: true });
    ffmpeg.on("progress", ({ progress }) => {
      if (Number.isFinite(progress)) {
        reportProgress(15 + Math.max(0, Math.min(1, progress)) * 80);
      }
    });

    await ffmpeg.load(
      { coreURL: coreModule.default, wasmURL: wasmModule.default },
      { signal },
    );
    throwIfAborted(signal);
    reportProgress(10);

    let inputBytes: Uint8Array;
    try {
      inputBytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw wasmMemoryError(error);
    }
    throwIfAborted(signal);
    await ffmpeg.writeFile(inputName, inputBytes, { signal });
    reportProgress(15);

    const scale =
      "scale=w=min(iw\\,if(gte(iw\\,ih)\\,1280\\,720)):h=min(ih\\,if(gte(iw\\,ih)\\,720\\,1280)):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
    const exitCode = await ffmpeg.exec(
      [
        "-i",
        inputName,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        scale,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        "1500k",
        "-maxrate",
        "1500k",
        "-bufsize",
        "3000k",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputName,
      ],
      -1,
      { signal },
    );
    if (exitCode !== 0) {
      throw new Error(`Video compression failed (FFmpeg exit code ${exitCode}).`);
    }
    throwIfAborted(signal);

    const output = await ffmpeg.readFile(outputName, "binary", { signal });
    if (!(output instanceof Uint8Array) || output.byteLength === 0) {
      throw new Error("Video compression produced an empty output file.");
    }
    const outputBytes = new Uint8Array(output.byteLength);
    outputBytes.set(output);
    reportProgress(98);
    return new File([outputBytes], compressedName(file.name), {
      type: "video/mp4",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw abortError();
    }
    if (looksLikeWasmMemoryFailure(error)) throw wasmMemoryError(error);
    throw error instanceof Error
      ? error
      : new Error("Video compression failed.", { cause: error });
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (ffmpeg) {
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        // The worker may already be terminated or the file may not have been written.
      }
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        // The worker may already be terminated or the output may not exist.
      }
      ffmpeg.terminate();
    }
  }
}

export async function prepareClip(
  file: File,
  options: PrepareClipOptions,
): Promise<PreparedClip> {
  const { compress, signal, onProgress } = options;
  let lastProgress = -1;
  const reportProgress = (value: number) => {
    const next = Math.round(Math.max(0, Math.min(100, value)));
    if (next > lastProgress) {
      lastProgress = next;
      onProgress(next);
    }
  };

  throwIfAborted(signal);
  reportProgress(0);
  const { duration, thumbnail } = await inspectVideo(file, signal);
  throwIfAborted(signal);
  reportProgress(compress ? 5 : 100);

  if (!compress) return { file, duration, thumbnail };

  const preparedFile = await compressVideo(file, signal, reportProgress);
  throwIfAborted(signal);
  reportProgress(100);
  return { file: preparedFile, duration, thumbnail };
}