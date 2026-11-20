import yauzl from "yauzl";
import { createWriteStream, promises as fsp } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";

export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_TOTAL_BYTES = 2_000_000_000; // zip-bomb guard, not a product limit

export interface ExtractedFile { name: string; size: number }

/** Returns a safe relative path, or null for entries that must be skipped. */
export function safeEntryName(raw: string): string | null {
  if (raw.includes("\\") || raw.includes("\0") || raw.endsWith("/")) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) return null;
  const parts = normalized.split("/");
  if (parts.some(part => part === "" || part === "." || part === ".." || part.startsWith("."))) return null;
  if (parts[0] === "__MACOSX") return null;
  return normalized;
}

/** Extract regular files only (no symlinks, no path escapes) into destDir. */
export function extractZip(zipPath: string, destDir: string): Promise<ExtractedFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) { reject(openError ?? new Error("Invalid zip")); return; }
      const files: ExtractedFile[] = [];
      let entries = 0, total = 0;
      const fail = (error: Error) => { zip.close(); reject(error); };
      zip.on("error", fail);
      zip.on("end", () => resolve(files));
      zip.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          if (++entries > ZIP_MAX_ENTRIES) throw new Error("Zip has too many entries");
          const name = safeEntryName(entry.fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (!name || (mode !== 0 && mode !== 0o100000)) { zip.readEntry(); return; }
          total += entry.uncompressedSize;
          if (total > ZIP_MAX_TOTAL_BYTES) throw new Error("Zip expands beyond the allowed size");
          const target = path.join(destDir, name);
          await fsp.mkdir(path.dirname(target), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
            zip.openReadStream(entry, (e, s) => (e || !s ? rej(e ?? new Error("Unreadable entry")) : res(s))));
          let size = 0;
          const guard = new Transform({
            transform(chunk, _enc, cb) {
              size += chunk.length;
              cb(size > entry.uncompressedSize ? new Error("Zip entry larger than declared") : null, chunk);
            },
          });
          await pipeline(stream, guard, createWriteStream(target, { flags: "wx" }));
          files.push({ name, size });
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}
