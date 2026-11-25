import { Router, raw, json, type IRouter } from "express";
import { CLIENT_JS } from "./client.js";
import { jobs, startExtract } from "./extract.js";
import { r2Config } from "../lib/r2-storage.js";
import {
  CHUNK_BYTES, HttpError, completeSession, loadSession, openSession, progress, putChunk, stats, type Session,
} from "./upload-core.js";

const router: IRouter = Router();
const uid = (req: any) => req.session?.userId ?? null;

async function owned(req: any, id: string): Promise<Session> {
  const s = /^[0-9a-f]{32}$/.test(id) ? await loadSession(id) : null;
  if (!s || String(s.userId) !== String(uid(req))) throw new HttpError(404, "session not found");
  return s;
}
const guard = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
  try {
    if (!uid(req)) throw new HttpError(401, "Authentication required");
    if (!r2Config()) throw new HttpError(503, "R2 storage is not configured");
    res.set("Cache-Control", "no-store");
    await fn(req, res);
  } catch (e: any) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message, ...e.extra });
    else res.status(502).json({ error: "storage error — retry", detail: String(e?.name ?? e) });
  }
};

// Open-or-resume. Same file (name+size+lastModified) always maps to the same session.
router.post("/qaisypro/status", json(), guard(async (req, res) => {
  const { sessionId, fileName, size, lastModified, contentType } = req.body ?? {};
  let s: Session;
  if (sessionId) s = await owned(req, String(sessionId));
  else {
    if (typeof fileName !== "string" || !Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, "fileName and size required");
    s = await openSession({ userId: uid(req), fileName, size, lastModified: Number(lastModified) || 0, contentType });
  }
  const p = await progress(s);
  res.json({ sessionId: s.id, chunkSize: s.chunkSize, totalChunks: s.totalChunks, parallel: 8, ...p });
}));
router.get("/qaisypro/status/:id", guard(async (req, res) => {
  const s = await owned(req, String(req.params.id));
  res.json({ sessionId: s.id, chunkSize: s.chunkSize, totalChunks: s.totalChunks, ...(await progress(s)) });
}));

router.put("/qaisypro/chunk", raw({ type: () => true, limit: "64mb" }), guard(async (req, res) => {
  const s = await owned(req, String(req.query.sessionId));
  const sha = String(req.get("x-chunk-sha256") ?? "");
  if (!/^[0-9a-f]{64}$/i.test(sha)) throw new HttpError(400, "X-Chunk-Sha256 required");
  stats.active++;
  try { res.json(await putChunk(s, Number(req.query.index), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), sha)); }
  finally { stats.active--; }
}));

router.post("/qaisypro/complete", json(), guard(async (req, res) => {
  const s = await owned(req, String(req.body?.sessionId));
  res.json({ ok: true, ...(await completeSession(s)) });
}));

// Extract a completed upload (zip, tar, tar.gz, gz, 7z, rar, ...) into R2, file by file.
router.post("/qaisypro/extract", json(), guard(async (req, res) => {
  const s = await owned(req, String(req.body?.sessionId));
  if (!s.completedAt) throw new HttpError(409, "upload not complete yet");
  const job = startExtract(s);
  res.status(202).json({ jobId: job.id, statusUrl: `/api/qaisypro/extract/${job.id}`, format: job.format });
}));
router.get("/qaisypro/extract/:jobId", guard(async (req, res) => {
  const job = jobs.get(String(req.params.jobId));
  if (!job || String(job.userId) !== String(uid(req))) throw new HttpError(404, "job not found");
  res.json(job);
}));
router.get("/qaisypro/client.js", (_req, res) => { res.type("text/javascript").send(CLIENT_JS); });
router.get("/qaisypro/health", (_req, res) => { res.json({ ok: true, chunkBytes: CHUNK_BYTES, r2: Boolean(r2Config()) }); });

export default router;
