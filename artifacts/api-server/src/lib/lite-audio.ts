import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureClipTempRoot, markActiveClipTempDirectory, CLIP_TEMP_PREFIX } from "./clips-temp-cleanup";
import { LITE_MEDIA_MAX_BYTES } from "./lite-media-storage";

export const AUDIO_MAX_DURATION = 600;
export const AUDIO_SOURCE_MAX_BYTES = 128 * 1024 * 1024;
export class PermanentAudioError extends Error {}
const LOCAL_MEDIA_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,mp3,aac,flac,wav,avi,mpeg,mpegts";

async function command(binary: string, args: string[], signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.length > 65536) child.kill("SIGKILL");
    });
    child.stderr.on("data", () => {});
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(output) : reject(new Error(`${binary} media processing failed`)));
  });
}

async function probe(path: string, signal: AbortSignal) {
  const data = JSON.parse(await command("ffprobe", ["-v", "error", "-max_alloc", "33554432",
    "-protocol_whitelist", "file", "-format_whitelist", LOCAL_MEDIA_FORMATS,
    "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,duration",
    "-of", "json", path], signal));
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > AUDIO_MAX_DURATION) {
    throw new PermanentAudioError("Audio requires an actual duration between 0 and 600 seconds");
  }
  const audio = data.streams?.find((stream: any) => stream.codec_type === "audio");
  if (!audio) throw new PermanentAudioError("This clip has no audio track");
  return { duration, codec: String(audio.codec_name), format: String(data.format?.format_name),
    hasVideo: data.streams.some((stream: any) => stream.codec_type === "video") };
}

/** Decode only server-owned local bytes, no network protocols or client-supplied paths. */
export async function generateLiteAudio(source: Readable, signal?: AbortSignal, temporaryRoot?: string) {
  // SDK reads may fail while the private work directory is being prepared.
  source.on("error", () => {});
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000);
  const root = await ensureClipTempRoot(temporaryRoot);
  const directory = await mkdtemp(join(root, CLIP_TEMP_PREFIX));
  try {
    await markActiveClipTempDirectory(directory);
    const input = join(directory, "source");
    let downloaded = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        downloaded += chunk.length;
        done(downloaded > AUDIO_SOURCE_MAX_BYTES ? new PermanentAudioError("Source exceeds 128 MiB audio processing limit") : null, chunk);
      },
    });
    await pipeline(source, bounded, createWriteStream(input, { mode: 0o600 }), { signal: abort });
    const info = await probe(input, abort);
    // Reuse actual audio-only source bytes when already small; never label video as audio.
    const sourceMime = !info.hasVideo && (
      info.format === "mp3" ? "audio/mpeg" :
      info.format === "ogg" && ["opus", "vorbis"].includes(info.codec) ? "audio/ogg" :
      info.format === "aac" ? "audio/aac" :
      info.format.includes("mp4") && info.codec === "aac" ? "audio/mp4" : null);
    if (sourceMime && downloaded <= LITE_MEDIA_MAX_BYTES) {
      return { bytes: await readFile(input), mime: sourceMime, durationSec: info.duration, reused: true };
    }
    const output = join(directory, "audio.m4a");
    await command("ffmpeg", ["-v", "error", "-nostdin", "-max_alloc", "33554432", "-threads", "1",
      "-filter_threads", "1", "-protocol_whitelist", "file", "-format_whitelist", LOCAL_MEDIA_FORMATS,
      "-i", input, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-threads", "1",
      "-c:a", "aac", "-b:a", "24k", "-ac", "1", "-ar", "22050", "-t", String(AUDIO_MAX_DURATION + 1),
      "-fs", String(LITE_MEDIA_MAX_BYTES), "-movflags", "+faststart", "-y", output], abort);
    if ((await stat(output)).size > LITE_MEDIA_MAX_BYTES) throw new PermanentAudioError("Encoded audio exceeds safety cap");
    const actual = await probe(output, abort);
    if (actual.hasVideo || actual.codec !== "aac" || Math.abs(actual.duration - info.duration) > 1) {
      throw new PermanentAudioError("Audio verification failed or output was truncated");
    }
    return { bytes: await readFile(output), mime: "audio/mp4", durationSec: actual.duration, reused: false };
  } finally { source.destroy(); await rm(directory, { recursive: true, force: true }); }
}
