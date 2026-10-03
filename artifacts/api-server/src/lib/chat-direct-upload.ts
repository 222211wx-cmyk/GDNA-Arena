import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, r2Config } from "./r2-storage";

const CHUNK = 5 * 1024 * 1024;
type Ticket = { user: number; room: number; size: number; name: string; upload: string; expires: number };
function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Upload signing unavailable");
  return createHmac("sha256", secret).update(value).digest();
}
function encode(ticket: Ticket) {
  const body = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
export function readChatTicket(value: string, user: number): Ticket {
  const [body, sig] = value.split(".");
  const supplied = Buffer.from(sig || "", "base64url");
  const expected = signature(body || "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid upload ticket");
  const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
  if (ticket.user !== user || ticket.expires < Date.now()) throw new Error("Upload expired");
  return ticket;
}
function params(name: string) {
  const config = r2Config();
  if (!config) throw new Error("R2 storage unavailable");
  return { Bucket: config.bucket, Key: `chat/private/${name}` };
}
export async function beginChatUpload(user: number, room: number, size: number) {
  const name = `r2chat-${randomUUID()}.enc`;
  const base = params(name);
  // Verify signing configuration before allocating storage.
  signature(name);
  const directTicket: Ticket = { user, room, size, name, upload: "direct-put", expires: Date.now() + 3600_000 };
  const url = await getSignedUrl(r2Client(), new PutObjectCommand({
    ...base, ContentType: "application/octet-stream", ContentLength: size, IfNoneMatch: "*",
  }), { expiresIn: 3600 });
  return { ticket: encode(directTicket), url };
}
/** Historical multipart completion remains supported for already-issued tickets. */
export async function beginLegacyChatUpload(user: number, room: number, size: number) {
  const name = `r2chat-${randomUUID()}.enc`;
  const base = params(name);
  const created = await r2Client().send(new CreateMultipartUploadCommand({ ...base, ContentType: "application/octet-stream" }));
  if (!created.UploadId) throw new Error("Upload initialization failed");
  const ticket: Ticket = { user, room, size, name, upload: created.UploadId, expires: Date.now() + 3600_000 };
  try {
    const urls = await Promise.all(Array.from({ length: Math.ceil(size / CHUNK) }, (_, i) =>
      getSignedUrl(r2Client(), new UploadPartCommand({ ...base, UploadId: ticket.upload, PartNumber: i + 1,
        ContentLength: Math.min(CHUNK, size - i * CHUNK) }), { expiresIn: 3600 })));
    return { ticket: encode(ticket), urls, chunkSize: CHUNK };
  } catch (error) { await abortChatUpload(ticket).catch(() => {}); throw error; }
}
export async function abortChatUpload(ticket: Ticket) {
  // Do not delete a completed direct object: a lost response may already be in a message.
  if (ticket.upload === "direct-put") return;
  await r2Client().send(new AbortMultipartUploadCommand({ ...params(ticket.name), UploadId: ticket.upload }));
}
export async function completeChatUpload(ticket: Ticket) {
  const base = params(ticket.name);
  if (ticket.upload === "direct-put") {
    const head = await r2Client().send(new HeadObjectCommand(base));
    if (head.ContentLength !== ticket.size || head.ContentType !== "application/octet-stream") throw new Error("Incomplete upload");
    return `/api/messages/files/${ticket.name}`;
  }
  let parts;
  try {
    const listed = await r2Client().send(new ListPartsCommand({ ...base, UploadId: ticket.upload }));
    parts = listed.Parts;
  } catch (error) {
    // A lost completion response is retryable without overwriting the object.
    const head = await r2Client().send(new HeadObjectCommand(base)).catch(() => null);
    if (head?.ContentLength === ticket.size) return `/api/messages/files/${ticket.name}`;
    throw error;
  }
  const count = Math.ceil(ticket.size / CHUNK);
  if (!parts || parts.length !== count || parts.some((p, i) => p.PartNumber !== i + 1 ||
      !p.ETag || p.Size !== Math.min(CHUNK, ticket.size - i * CHUNK))) throw new Error("Incomplete upload");
  await r2Client().send(new CompleteMultipartUploadCommand({ ...base, UploadId: ticket.upload,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })) } }));
  return `/api/messages/files/${ticket.name}`;
}
export function getDirectChatObject(name: string) {
  return r2Client().send(new GetObjectCommand(params(name)));
}
export function deleteDirectChatObject(name: string) {
  return r2Client().send(new DeleteObjectCommand(params(name)));
}