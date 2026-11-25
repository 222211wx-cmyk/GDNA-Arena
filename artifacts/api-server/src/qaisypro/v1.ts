// POST|PUT /api/v1/upload — API-key upload for other systems. One streaming request into R2 multipart, any size.
// Query: filename (required), webhook (optional https URL). Header: x-api-key (or Bearer). Content-Type: application/octet-stream.
import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { r2Client, r2Config } from "../lib/r2-storage.js";
import { apiKeyFrom, apiKeysEnabled } from "./apikey.js";
import { checkWebhookUrl, sendWebhook } from "./webhook.js";
import { noteBytes, planChunk, stats } from "./upload-core.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const UNKNOWN_LENGTH_PART = 25 * 1024 * 1024; // with no Content-Length: 25 MB parts (~250 GB); send Content-Length for larger

async function handler(req: any, res: any) {
  if (!apiKeysEnabled()) return res.status(503).json({ error: "API keys are not configured (QAISYPRO_API_KEYS)" });
  const key = apiKeyFrom(req);
  if (!key) return res.status(401).json({ error: "invalid or missing API key" });
  if (!r2Config()) return res.status(503).json({ error: "R2 storage is not configured" });
  const fileName = String(req.query.filename ?? "").replace(/[^\w.\-]+/g, "_").slice(-120);
  if (!fileName) return res.status(400).json({ error: "filename query parameter required" });
  if (/^(application\/json|application\/x-www-form-urlencoded)/i.test(req.get("content-type") ?? "")) return res.status(415).json({ error: "send the file as the raw body (application/octet-stream)" });
  const hook = req.query.webhook ? String(req.query.webhook) : process.env.QAISYPRO_WEBHOOK_URL;
  if (hook) { try { await checkWebhookUrl(hook); } catch (e: any) { return res.status(400).json({ error: `webhook rejected: ${e.message}` }); } }
  const claimed = String(req.get("x-content-sha256") ?? "").toLowerCase();

  const c = r2Client(), Bucket = r2Config()!.bucket;
  const Key = `qaisypro/v1/${key.name}/${Date.now()}-${randomUUID().slice(0, 8)}-${fileName}`;
  const declared = Number(req.get("content-length"));
  const part = Number.isFinite(declared) && declared > 0 ? planChunk(declared) : UNKNOWN_LENGTH_PART;
  const hash = createHash("sha256"); let total = 0; stats.active++;
  let uploadId: string | undefined;
  try {
    const parts: { PartNumber: number; ETag: string }[] = [];
    const sendPart = async (Body: Buffer) => {
      if (!uploadId) uploadId = (await c.send(new CreateMultipartUploadCommand({ Bucket, Key }))).UploadId!;
      const PartNumber = parts.length + 1;
      for (let a = 0; ; a++) {
        try { const r = await c.send(new UploadPartCommand({ Bucket, Key, UploadId: uploadId, PartNumber, Body })); parts.push({ PartNumber, ETag: r.ETag! }); break; }
        catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** a)); }
      }
    };
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of req as AsyncIterable<Buffer>) {
      hash.update(chunk); total += chunk.length; noteBytes(chunk.length);
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk; // R2 needs equal-size parts: cut exactly `part` bytes
      while (pending.length >= part) { await sendPart(pending.subarray(0, part)); pending = pending.subarray(part); }
    }
    if (total === 0) return res.status(400).json({ error: "empty body" });
    const sha256 = hash.digest("hex");
    if (claimed && claimed !== sha256) throw Object.assign(new Error("sha256 mismatch"), { status: 422 });
    if (uploadId) {
      if (pending.length) await sendPart(pending);
      await c.send(new CompleteMultipartUploadCommand({ Bucket, Key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    } else await c.send(new PutObjectCommand({ Bucket, Key, Body: pending }));
    const result = { ok: true, key: Key, size: total, sha256 };
    res.status(201).json(result);
    if (hook) sendWebhook(hook, process.env.QAISYPRO_WEBHOOK_SECRET || key.secret, { event: "upload.complete", ...result, fileName, apiKey: key.name, at: new Date().toISOString() })
      .catch((e) => logger.warn({ err: String(e?.message ?? e) }, "qaisypro webhook failed"));
  } catch (e: any) {
    if (uploadId) await c.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId: uploadId })).catch(() => {});
    if (!res.headersSent) res.status(e.status ?? 502).json({ error: e.status ? e.message : "storage error; retry", });
  } finally { stats.active--; }
}
router.post("/v1/upload", handler);
router.put("/v1/upload", handler);
export default router;
