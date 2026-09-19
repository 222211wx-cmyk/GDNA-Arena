import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";

/**
 * Kept behind a dynamic import by prepareVideo. Vite emits both core files as
 * hashed, base-path-aware assets, so production never creates a CDN/CORS
 * dependency. Distribution/source notice:
 * public/third-party/ffmpeg-core-NOTICE.txt
 */
export async function createFFmpegRuntime() {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  return {
    ffmpeg,
    load: (signal: AbortSignal) => ffmpeg.load(
      // Always provide the worker URL. Without this, FFmpeg constructs
      // ./worker.js relative to Vite's optimized dependency file in dev,
      // where that sibling does not exist.
      { coreURL, wasmURL, classWorkerURL },
      { signal },
    ),
  };
}