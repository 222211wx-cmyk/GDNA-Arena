import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { File } from "@google-cloud/storage";
import { clipFile } from "./clip-storage";
import { isR2Reference } from "./r2-storage";

export const LITE_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
export const mediaHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export type MediaFile = Pick<File, "createReadStream" | "createWriteStream">;
export type MediaResolver = (name: string) => MediaFile;

export async function readMediaBounded(name: string, max: number, signal?: AbortSignal, file: MediaResolver = clipFile) {
  const chunks: Buffer[] = [];
  let size = 0;
  const collect = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > max) { done(new Error("Media exceeds byte limit")); return; }
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  await pipeline(file(name).createReadStream(), collect,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  return Buffer.concat(chunks);
}

/** Both names are durably reserved by the queue owner BEFORE this writes bytes. */
export async function storeVerifiedMedia(bytes: Buffer, mime: string, primary: string, mirror: string | null,
  signal?: AbortSignal, file: MediaResolver = clipFile) {
  if (!bytes.length || bytes.length > LITE_MEDIA_MAX_BYTES) throw new Error("Invalid Lite media size");
  if (isR2Reference(primary) && (!mirror || isR2Reference(mirror))) throw new Error("R2 Lite media requires an App Storage mirror");
  const sha256 = mediaHash(bytes);
  for (const name of [primary, mirror].filter((value): value is string => Boolean(value))) {
    await pipeline(Readable.from([bytes]), file(name).createWriteStream({
      resumable: false, timeout: 20000,
      metadata: { contentType: mime, cacheControl: "private, no-store" },
      preconditionOpts: { ifGenerationMatch: 0 },
    }), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const stored = await readMediaBounded(name, bytes.length, signal, file);
    if (stored.length !== bytes.length || mediaHash(stored) !== sha256) throw new Error("Stored media verification failed");
  }
  return { sha256, sizeBytes: bytes.length, mirrorVerified: Boolean(mirror) };
}

export type VerifiedMedia = {
  output_object: string; mirror_object: string | null; mirror_verified_at: unknown;
  sha256: string; size_bytes: number;
};
export async function readVerifiedMedia(row: VerifiedMedia, file: MediaResolver = clipFile) {
  if (!Number.isSafeInteger(row.size_bytes) || row.size_bytes < 1 || row.size_bytes > LITE_MEDIA_MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error("Invalid media manifest");
  const read = async (name: string) => {
    const bytes = await readMediaBounded(name, row.size_bytes, undefined, file);
    if (bytes.length !== row.size_bytes || mediaHash(bytes) !== row.sha256) throw new Error("Media identity mismatch");
    return bytes;
  };
  try { return await read(row.output_object); }
  catch (error) {
    if (!isR2Reference(row.output_object) || !row.mirror_verified_at || !row.mirror_object ||
      isR2Reference(row.mirror_object)) throw error;
    return read(row.mirror_object);
  }
}
