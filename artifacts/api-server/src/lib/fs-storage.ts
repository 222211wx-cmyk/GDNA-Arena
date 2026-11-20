import { createReadStream, createWriteStream, promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import type { ClipStorageFile } from "./r2-storage.js";

/**
 * Local-disk storage rooted at STORAGE_PATH (e.g. a Hetzner volume). Bytes go
 * browser -> API -> disk; no third-party storage and no object-size ceiling.
 */
export const FS_PREFIX = "fs:";
const KEY = /^clips\/(?:original|derived)\/[A-Za-z0-9][A-Za-z0-9/._-]*$/;

export function fsRoot(): string | null {
  const root = process.env.STORAGE_PATH?.trim();
  return root ? path.resolve(root) : null;
}
export const isFsReference = (reference: string) => reference.startsWith(FS_PREFIX);
export function fsReference(key: string): string {
  if (!KEY.test(key) || key.includes("..") || key.includes("\\")) throw new Error("Invalid storage key");
  return `${FS_PREFIX}${key}`;
}
export function fsPath(reference: string): string {
  const root = fsRoot();
  if (!root) throw new Error("STORAGE_PATH is not set");
  const key = reference.slice(FS_PREFIX.length);
  fsReference(key);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return full;
}
export function uploadPartsDir(sessionId: string): string {
  const root = fsRoot();
  if (!root) throw new Error("STORAGE_PATH is not set");
  return path.join(root, ".uploads", sessionId);
}

export function fsFile(reference: string): ClipStorageFile {
  const full = fsPath(reference);
  return {
    async getMetadata() {
      const stat = await fsp.stat(full).catch(error => {
        throw Object.assign(error, { code: error.code === "ENOENT" ? 404 : error.code });
      });
      return [{ size: stat.size }];
    },
    createReadStream(range = {}) {
      return createReadStream(full, range.start !== undefined ? { start: range.start, end: range.end } : {});
    },
    createWriteStream() {
      const tmp = `${full}.${randomUUID()}.tmp`;
      let out: ReturnType<typeof createWriteStream> | undefined;
      return new Writable({
        construct(callback) {
          fsp.mkdir(path.dirname(full), { recursive: true }).then(() => {
            out = createWriteStream(tmp);
            out.once("open", () => callback());
            out.once("error", callback);
          }, callback);
        },
        write(chunk, enc, callback) { out!.write(chunk, enc, callback); },
        final(callback) { out!.end(() => fsp.rename(tmp, full).then(() => callback(), callback)); },
        destroy(error, callback) { out?.destroy(); fsp.rm(tmp, { force: true }).finally(() => callback(error)); },
      });
    },
    async delete(options = {}) {
      try { await fsp.rm(full); } catch (error) {
        if (options.ignoreNotFound && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      return undefined;
    },
  };
}
