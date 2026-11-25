// QAISYPRO Core (Heart) — resumable chunked upload straight into R2 multipart.
// Each 10 MB chunk is one R2 part, so progress lives in R2 itself and survives
// network cuts, tab closes and server restarts. Additive: touches no other route.
import { createHash } from "node:crypto";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { r2Client, r2Config } from "../lib/r2-storage.js";

export const CHUNK_BYTES = 10 * 1024 * 1024;
const MAX_PARTS = 10_000;
const MB = 1024 * 1024;

export type Session = {
  id: string; userId: number | string; key: string; uploadId: string;
  fileName: string; size: number; chunkSize: number; totalChunks: number;
  contentType: string; createdAt: string; completedAt?: string;
};

export const stats = { bytesIn: 0, chunks: 0, active: 0, startedAt: Date.now(), recent: [] as [number, number][] };
export function noteBytes(n: number) {
  stats.bytesIn += n; stats.chunks++;
  const now = Date.now(); stats.recent.push([now, n]);
  while (stats.recent.length && now - stats.recent[0][0] > 10_000) stats.recent.shift();
}

const bucket = () => { const c = r2Config(); if (!c) throw new Error("R2 not configured"); return c.bucket; };
const metaKey = (id: string) => `qaisypro/sessions/${id}/meta.json`;
const shaKey = (id: string, n: number) => `qaisypro/sessions/${id}/${String(n).padStart(5, "0")}.sha`;

export const sessionId = (userId: unknown, name: string, size: number, lastModified: number) =>
  createHash("sha256").update(`${userId}|${name}|${size}|${lastModified}`).digest("hex").slice(0, 32);

export const planChunk = (size: number, requested?: number) => {
  let c = Math.max(CHUNK_BYTES, Math.floor((requested ?? CHUNK_BYTES) / MB) * MB);
  if (Math.ceil(size / c) > MAX_PARTS) c = Math.ceil(size / MAX_PARTS / MB) * MB; // no size ceiling
  return c;
};

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const r = await r2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: metaKey(id) }));
    return JSON.parse(await r.Body!.transformToString());
  } catch (e: any) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export async function openSession(p: {
  userId: number | string; fileName: string; size: number; lastModified: number;
  contentType?: string; chunkSize?: number;
}): Promise<Session> {
  const id = sessionId(p.userId, p.fileName, p.size, p.lastModified);
  const existing = await loadSession(id);
  if (existing) return existing; // resume
  const safe = p.fileName.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  const key = `qaisypro/uploads/${id}/${safe}`;
  const contentType = p.contentType || "application/octet-stream";
  const mp = await r2Client().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }));
  const chunkSize = planChunk(p.size, p.chunkSize);
  const s: Session = {
    id, userId: p.userId, key, uploadId: mp.UploadId!, fileName: p.fileName, size: p.size,
    chunkSize, totalChunks: Math.max(1, Math.ceil(p.size / chunkSize)), contentType,
    createdAt: new Date().toISOString(),
  };
  await r2Client().send(new PutObjectCommand({ Bucket: bucket(), Key: metaKey(id), Body: JSON.stringify(s), ContentType: "application/json" }));
  return s;
}

async function allParts(s: Session): Promise<Part[]> {
  const out: Part[] = []; let marker: string | undefined;
  do {
    const r = await r2Client().send(new ListPartsCommand({ Bucket: bucket(), Key: s.key, UploadId: s.uploadId, PartNumberMarker: marker }));
    out.push(...(r.Parts ?? [])); marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
  } while (marker);
  return out;
}

async function allShas(s: Session): Promise<Map<number, string>> {
  const m = new Map<number, string>(); let token: string | undefined;
  do {
    const r = await r2Client().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `qaisypro/sessions/${s.id}/`, ContinuationToken: token }));
    await Promise.all((r.Contents ?? []).filter(o => o.Key!.endsWith(".sha")).map(async o => {
      const g = await r2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: o.Key! }));
      m.set(parseInt(o.Key!.split("/").pop()!, 10), (await g.Body!.transformToString()).trim());
    }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return m;
}

export async function progress(s: Session) {
  if (s.completedAt) return { received: Array.from({ length: s.totalChunks }, (_, i) => i + 1), fingerprints: {} as Record<number, string>, complete: true };
  const [parts, shas] = await Promise.all([allParts(s), allShas(s)]);
  const received = parts.map(p => p.PartNumber!).filter(n => shas.has(n)).sort((a, b) => a - b);
  return { received, fingerprints: Object.fromEntries(received.map(n => [n, shas.get(n)!])), complete: false };
}

export const expectedLen = (s: Session, index: number) =>
  index < s.totalChunks ? s.chunkSize : s.size - s.chunkSize * (s.totalChunks - 1);

export async function putChunk(s: Session, index: number, body: Buffer, claimedSha: string) {
  if (!Number.isInteger(index) || index < 1 || index > s.totalChunks) throw new HttpError(400, "bad chunk index");
  if (body.length !== expectedLen(s, index)) throw new HttpError(400, `chunk ${index} must be ${expectedLen(s, index)} bytes`);
  const sha = createHash("sha256").update(body).digest("hex");
  if (sha !== claimedSha.toLowerCase()) throw new HttpError(422, "fingerprint mismatch — resend chunk");
  const r = await r2Client().send(new UploadPartCommand({ Bucket: bucket(), Key: s.key, UploadId: s.uploadId, PartNumber: index, Body: body, ContentLength: body.length }));
  // fingerprint is written after the part, so "fingerprint present" implies "part stored"
  await r2Client().send(new PutObjectCommand({ Bucket: bucket(), Key: shaKey(s.id, index), Body: sha }));
  noteBytes(body.length);
  return { index, sha256: sha, etag: r.ETag };
}

export async function completeSession(s: Session) {
  if (s.completedAt) return { key: s.key, size: s.size };
  const p = await progress(s);
  const missing = Array.from({ length: s.totalChunks }, (_, i) => i + 1).filter(n => !p.received.includes(n));
  if (missing.length) throw new HttpError(409, "chunks missing", { missing });
  const parts = (await allParts(s)).sort((a, b) => a.PartNumber! - b.PartNumber!);
  await r2Client().send(new CompleteMultipartUploadCommand({
    Bucket: bucket(), Key: s.key, UploadId: s.uploadId,
    MultipartUpload: { Parts: parts.map(x => ({ PartNumber: x.PartNumber!, ETag: x.ETag! })) },
  }));
  s.completedAt = new Date().toISOString();
  await r2Client().send(new PutObjectCommand({ Bucket: bucket(), Key: metaKey(s.id), Body: JSON.stringify(s), ContentType: "application/json" }));
  return { key: s.key, size: s.size };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: object = {}) { super(message); }
}
