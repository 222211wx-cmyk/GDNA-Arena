import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { finalClipReceipt } from "./clips-thumbnail-response.js";
import type { File, CreateWriteStreamOptions } from "@google-cloud/storage";
import {
  CLIP_EXT, ClipUploadError, MAX_NEW_CLIP_BYTES, NEW_CLIP_TOO_LARGE, resolveClipUploadType,
} from "../lib/clip-upload-protocol.js";

export const SIMPLE_CLIP_MAX_BYTES = MAX_NEW_CLIP_BYTES;
export const SIMPLE_CLIP_CHUNK_BYTES = 5 * 1024 * 1024;
export const SIMPLE_CLIP_TIMEOUT_MS = 5 * 60 * 1000; // Inactivity only, never a media/upload-duration limit.
export const SIMPLE_CLIP_TOO_LARGE = NEW_CLIP_TOO_LARGE;
export const SIMPLE_AUDIO_TOO_LARGE = NEW_CLIP_TOO_LARGE;
export const SIMPLE_CLIP_WRITE_OPTIONS: CreateWriteStreamOptions = {
  resumable: true,
  chunkSize: SIMPLE_CLIP_CHUNK_BYTES,
  timeout: SIMPLE_CLIP_TIMEOUT_MS,
  preconditionOpts: { ifGenerationMatch: 0 },
};

interface StoredUpload extends Express.Multer.File { sha256?: string }
export interface SimpleClipUploadDependencies {
  file(name: string): Pick<File, "createWriteStream">;
  /** Must check DB references before deleting, including ambiguous COMMITs. */
  cleanup(name: string): Promise<void>;
  publish(input: {
    userId: number; filename: string; title: string; contentType: string; size: number; sha256: string;
    purpose?: unknown; originalReference?: unknown;
    rightsHolderName?: unknown; rightsHolderRole?: unknown; isOriginalFootage?: unknown;
  }): Promise<{ id: number; [key: string]: unknown }>;
  log(error: unknown, message: string): void;
}

export function createSimpleClipUploadRouter(deps: SimpleClipUploadDependencies): IRouter {
  const router = Router();
  const signals = new WeakMap<Request, AbortSignal>();
  const contentTypes = new WeakMap<Request, string>();
  const storage: multer.StorageEngine = {
    _handleFile(req, file, cb) {
      const normalizedType = resolveClipUploadType(file.mimetype, file.originalname);
      if (!normalizedType) { cb(new ClipUploadError(415, "صيغة الصوت أو الفيديو غير مدعومة")); return; }
      file.mimetype = normalizedType;
      contentTypes.set(req, normalizedType);
      const sizeMessage = SIMPLE_CLIP_TOO_LARGE;
      const filename = `clip_${randomUUID().replace(/-/g, "")}${CLIP_EXT[file.mimetype] ?? ".bin"}`;
      let stream: ReturnType<File["createWriteStream"]>;
      try {
        stream = deps.file(filename).createWriteStream({
          ...SIMPLE_CLIP_WRITE_OPTIONS,
          metadata: { contentType: file.mimetype, cacheControl: "private, max-age=3600" },
        });
      } catch (error) { cb(error as Error); return; }
      const hash = createHash("sha256");
      let size = 0, settled = false;
      const signal = signals.get(req);
      const detach = () => {
        req.off("aborted", aborted);
        signal?.removeEventListener("abort", timedOut);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        detach();
        file.stream.unpipe(stream);
        stream.destroy();
        file.stream.resume();
        void deps.cleanup(filename).catch(cleanupError => deps.log(cleanupError, "Simple clip cleanup deferred"))
          .finally(() => cb(error));
      };
      const aborted = () => fail(new ClipUploadError(400, "Upload interrupted"));
      const timedOut = () => fail(new ClipUploadError(408, "Upload timed out"));
      req.once("aborted", aborted);
      signal?.addEventListener("abort", timedOut, { once: true });
      file.stream.on("limit", () => fail(new ClipUploadError(413, sizeMessage)));
      file.stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        hash.update(chunk);
      });
      file.stream.on("error", fail);
      stream.on("error", fail);
      stream.on("finish", () => {
        if (settled) return;
        settled = true;
        detach();
        cb(null, { filename, size, sha256: hash.digest("hex") } as Partial<StoredUpload>);
      });
      if (signal?.aborted) { timedOut(); return; }
      file.stream.pipe(stream);
    },
    _removeFile(_req, file, cb) {
      if (!file.filename) { cb(null); return; }
      deps.cleanup(file.filename).then(() => cb(null), error => cb(error));
    },
  };
  // Bound only multipart metadata/counts; the streamed file has no product-size cap.
  const upload = multer({ storage, limits: { files: 1, fields: 6, fieldSize: 1024, parts: 8 } });
  router.post(["/clip/upload", "/clip/upload-simple", "/clip/upload-final"], (req, res) => {
    const userId = (req.session as { userId?: number } | undefined)?.userId;
    if (!userId) { res.status(401).json({ error: "يجب تسجيل الدخول" }); return; }
    if (!req.is("multipart/form-data")) { res.status(415).json({ error: "Expected multipart/form-data with file" }); return; }
    const controller = new AbortController();
    signals.set(req, controller.signal);
    const onTimeout = () => {
      controller.abort();
      if (!res.headersSent && !res.destroyed) res.status(408).json({ error: "Upload timed out" });
    };
    req.setTimeout(SIMPLE_CLIP_TIMEOUT_MS);
    res.setTimeout(SIMPLE_CLIP_TIMEOUT_MS);
    req.once("timeout", onTimeout);
    res.once("timeout", onTimeout);
    const finish = () => {
      signals.delete(req);
      contentTypes.delete(req);
      req.off("timeout", onTimeout);
      res.off("timeout", onTimeout);
      req.setTimeout(0);
      res.setTimeout(0);
    };
    res.once("close", () => { controller.abort(); finish(); });
    upload.single("file")(req, res, async (error: unknown) => {
      const file = req.file as StoredUpload | undefined;
      try {
        if (error) throw error;
        if (controller.signal.aborted) throw new ClipUploadError(408, "Upload timed out");
        if (!file?.filename || !file.sha256 || !file.size) throw new ClipUploadError(400, "الفيديو مطلوب");
        const title = file.originalname;
        const clip = await deps.publish({
          userId, filename: file.filename, title: title || "كليب",
          contentType: file.mimetype, size: file.size, sha256: file.sha256,
          purpose: req.body?.purpose, originalReference: req.body?.originalReference,
          rightsHolderName: req.body?.rightsHolderName, rightsHolderRole: req.body?.rightsHolderRole,
          isOriginalFootage: req.body?.isOriginalFootage,
        });
        if (!res.headersSent && !res.destroyed) res.json(finalClipReceipt(clip));
      } catch (caught) {
        if (file?.filename) await deps.cleanup(file.filename).catch(cleanupError => deps.log(cleanupError, "Simple clip cleanup deferred"));
        const isLimit = (caught as { code?: string }).code === "LIMIT_FILE_SIZE";
        const status = isLimit ? 413 : caught instanceof ClipUploadError ? caught.status : caught instanceof multer.MulterError ? 400 : 500;
        deps.log(caught, "Simple clip upload failed");
        if (!res.headersSent && !res.destroyed) res.status(status).json({
          error: status === 413 ? SIMPLE_CLIP_TOO_LARGE : caught instanceof ClipUploadError ? caught.message : "فشل الرفع",
        });
      } finally { finish(); }
    });
  });
  return router;
}