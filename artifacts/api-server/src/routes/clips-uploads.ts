import { Router, json, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { ClipUploads, CHUNK_BYTES, parseUploadMetadata, unsignedInteger } from "../lib/clps-uploads.js";
import { ClipUploadError, MAX_NEW_CLIP_BYTES } from "../lib/clips-upload-protocol.js";
import { logger } from "../lib/logger.js";
import { finalClipReceipt } from "./clips-thumbnail-response.js";

export function uploadAuth(req: Request, res: Response, next: NextFunction): void {
  if (!(req.session as { userId?: number } | undefined)?.userId) {
    res.status(401).json({ error: "يجب تسجيل الدخول" });
    return;
  }
  next();
}
const userId = (req: Request) => (req.session as unknown as { userId: number }).userId;
const paramId = (req: Request) => String(req.params.id);
const asyncRoute = (action: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { void action(req, res).catch(next); };

export function createClipsUploadsRouter(service: ClipUploads): IRouter {
  const router = Router();
  router.use("/clips/uploads", (_req, res, next) => {
    res.set("Tus-Resumable", "1.0.0");
    res.set("Cache-Control", "no-store");
    next();
  }, uploadAuth);
  router.options("/clips/uploads{/:id}", (_req, res) => {
    res.set({
      "Tus-Version": "1.0.0", "Tus-Extension": "creation,termination,expiration",
    }).status(204).end();
  });
  router.post("/clip/upload-final", uploadAuth, (req, res, next) => {
    if (!req.is("application/json")) { next("route"); return; }
    json({ limit: "4kb" })(req, res, next);
  }, asyncRoute(async (req, res) => {
    const clip = await service.completeGroup(userId(req), req.body?.groupId);
    res.json(finalClipReceipt(clip));
  }));
  // Completion is JSON, not a Tus concatenation extension.
  router.post("/clips/uploads/complete", json({ limit: "4kb" }), asyncRoute(async (req, res) => {
    const clip = await service.complete(userId(req), req.body?.uploadIds, req.body?.isOriginalFootage);
    res.json({ clip });
  }));
  router.use("/clips/uploads", (req, res, next) => {
    if (req.header("Tus-Resumable") !== "1.0.0") {
      res.set("Tus-Version", "1.0.0").status(412).json({ error: "Tus-Resumable: 1.0.0 is required" });
      return;
    }
    next();
  });
  const creationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 18, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => String(userId(req)),
    message: { error: "Upload creation limit reached: 18 parts per hour" },
  });
  router.post("/clips/uploads", creationLimiter, asyncRoute(async (req, res) => {
    if (req.header("Upload-Defer-Length") || req.header("Upload-Concat")) throw new ClipUploadError(400, "Deferred length and Tus concatenation are not supported");
    // Creation-with-upload is deliberately not advertised or accepted.
    if (req.header("Transfer-Encoding") || unsignedInteger(req.header("Content-Length") ?? "0", "Content-Length") !== 0) throw new ClipUploadError(400, "Creation request must not contain bytes");
    const metadata = parseUploadMetadata(req.header("Upload-Metadata"));
    const session = await service.create(userId(req), metadata, unsignedInteger(req.header("Upload-Length"), "Upload-Length"));
    res.set({
      Location: `${req.baseUrl}/clips/uploads/${session.id}`,
      "Upload-Offset": String(session.offset), "Upload-Length": String(session.length),
      "Upload-Expires": new Date(session.expires).toUTCString(),
    }).status(201).end();
  }));
  router.head("/clips/uploads/:id", asyncRoute(async (req, res) => {
    const { value: session } = await service.session(paramId(req), userId(req));
    res.set({
      "Upload-Offset": String(session.offset), "Upload-Length": String(session.length),
      "Upload-Expires": new Date(session.expires).toUTCString(),
    }).status(200).end();
  }));
  router.patch("/clips/uploads/:id", asyncRoute(async (req, res) => {
    if (req.header("Content-Type") !== "application/offset+octet-stream") throw new ClipUploadError(415, "Expected application/offset+octet-stream");
    // At 13.7 KiB/s one 5 MiB chunk takes over six minutes. A total five-minute
    // deadline would make progress impossible: bound inactivity, not elapsed time.
    req.setTimeout(5 * 60_000, () => req.destroy());
    res.once("finish", () => req.setTimeout(0));
    const stored = await service.checkPatch(paramId(req), userId(req), unsignedInteger(req.header("Upload-Offset"), "Upload-Offset"));
    const lengthHeader = req.header("Content-Length");
    const declared = lengthHeader === undefined ? undefined : unsignedInteger(lengthHeader, "Content-Length");
    const maximum = Math.min(CHUNK_BYTES, stored.value.length - stored.value.offset);
    if (declared !== undefined && (declared <= 0 || declared > maximum)) throw new ClipUploadError(413, "Chunk exceeds remaining length or 5 MiB");
    // Only one bounded chunk is held, never the full video; auth/ownership/offset
    // are resolved before the stream is read. No temporary disk is involved.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of req) {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += bytes.length;
      if (size > maximum) throw new ClipUploadError(413, "Chunk exceeds remaining length or 5 MiB");
      chunks.push(bytes);
    }
    if (req.aborted || (declared !== undefined && size !== declared)) throw new ClipUploadError(400, "Upload interrupted");
    const offset = await service.append(stored, Buffer.concat(chunks, size));
    res.set({ "Upload-Offset": String(offset), "Upload-Expires": new Date(stored.value.expires).toUTCString() }).status(204).end();
  }));
  router.delete("/clips/uploads/:id", asyncRoute(async (req, res) => {
    await service.cancel(paramId(req), userId(req));
    res.status(204).end();
  }));
  router.use(["/clips/uploads", "/clip/upload-final"], (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof ClipUploadError ? error.status : Number((error as { status?: number }).status) || 500;
    if (status === 503) res.set("Retry-After", "2");
    if (status >= 500) logger.error({ err: error }, "[clips] resumable upload failed");
    if (!res.headersSent) res.status(status).json({ error: error instanceof ClipUploadError ? error.message : status < 500 ? "Invalid request body" : "Upload failed; retry or resume with HEAD" });
  });
  return router;
}
