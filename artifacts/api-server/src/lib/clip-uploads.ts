import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ClipUploadError, CLIP_EXT, MAX_CLIP_BYTES } from "./clip-upload-protocol.js";

export const CHUNK_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validUploadId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
export interface UploadMetadata {
  groupId: string;
  partIndex: number;
  partCount: number;
  totalSize: number;
  title: string;
  contentType: string;
  durationSec: number;
}
export interface UploadSession {
  id: string;
  userId: number;
  metadata: UploadMetadata;
  length: number;
  offset: number;
  expires: number;
  state: "active" | "sealed" | "cancelled";
  chunks: { name: string; size: number }[];
}
interface UploadGroup {
  userId: number;
  metadata: Omit<UploadMetadata, "partIndex">;
  expires: number;
  slots: (string | null)[];
  state: "active" | "sealed" | "cancelled" | "published";
  result?: Record<string, unknown>;
}
export interface Versioned<T> { value: T; generation: string }
export interface UploadStore {
  read<T>(name: string): Promise<Versioned<T> | null>;
  write(name: string, value: unknown, generation: string | 0): Promise<void>;
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(name: string): Promise<void>;
  compose(sources: string[], target: string, contentType: string): Promise<void>;
  stream(name: string): Readable;
}
export interface UploadPublisher {
  lock<T>(key: string, action: () => Promise<T>): Promise<T>;
  find(userId: number, objectName: string): Promise<Record<string, unknown> | null>;
  publish(input: { userId: number; filename: string; title: string; contentType: string; size: number; sha256: string }): Promise<Record<string, unknown>>;
}
function fail(status: number, message: string): never { throw new ClipUploadError(status, message); }
export function unsignedInteger(raw: string | undefined, name: string): number {
  if (!raw || !/^(0|[1-9]\d*)$/.test(raw)) fail(400, `Invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail(400, `Invalid ${name}`);
  return value;
}
export function parseUploadMetadata(header: string | undefined): UploadMetadata {
  if (!header || header.length > 4096) fail(400, "Upload-Metadata is required (maximum 4096 bytes)");
  const entries: Record<string, string> = Object.create(null);
  for (const item of header.split(",")) {
    const match = /^([A-Za-z][A-Za-z0-9]*) ([A-Za-z0-9+/]*={0,2})$/.exec(item.trim());
    if (!match || Object.hasOwn(entries, match[1])) fail(400, "Invalid Upload-Metadata");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64") !== match[2]) fail(400, "Invalid metadata base64");
    try { entries[match[1]] = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail(400, "Invalid metadata UTF-8"); }
  }
  const groupId = entries.groupId?.toLowerCase();
  if (!validUploadId(groupId)) fail(400, "Invalid groupId");
  const partIndex = unsignedInteger(entries.partIndex, "partIndex");
  const partCount = unsignedInteger(entries.partCount, "partCount");
  const totalSize = unsignedInteger(entries.totalSize, "totalSize");
  if (partCount < 1 || partCount > 3 || partIndex >= partCount) fail(400, "Invalid part bounds");
  if (totalSize < partCount || totalSize > MAX_CLIP_BYTES) fail(413, "Video must be between 1 byte and 2 GiB");
  const title = entries.title?.trim();
  if (!title || title.length > 120) fail(400, "Title is required (maximum 120 characters)");
  if (!Object.hasOwn(CLIP_EXT, entries.contentType ?? "")) fail(415, "Unsupported video contentType");
  const durationSec = Number(entries.durationSec);
  if (!entries.durationSec?.trim() || !Number.isFinite(durationSec) || durationSec < 0) fail(400, "Invalid durationSec");
  return { groupId, partIndex, partCount, totalSize, title, contentType: entries.contentType, durationSec };
}
function common(metadata: UploadMetadata) {
  const { partIndex: _partIndex, ...rest } = metadata;
  return rest;
}
function sameMetadata(a: UploadMetadata, b: Omit<UploadMetadata, "partIndex">) {
  return JSON.stringify(common(a)) === JSON.stringify(b);
}
const sessionKey = (id: string) => `.uploads/sessions/${id}.json`;
const groupKey = (userId: number, groupId: string) => `.uploads/groups/${userId}/${groupId}.json`;
const lockKey = (userId: number, groupId: string) => `clip-upload:${userId}:${groupId}`;

export class ClipUploads {
  constructor(private store: UploadStore, private publisher: UploadPublisher) {}

  async session(id: string, userId: number): Promise<Versioned<UploadSession>> {
    if (!validUploadId(id)) fail(404, "Upload not found");
    const stored = await this.store.read<UploadSession>(sessionKey(id));
    // Deliberately conceal another user's session existence.
    if (!stored || stored.value.userId !== userId) fail(404, "Upload not found");
    if (stored.value.expires <= Date.now()) fail(410, "Upload expired");
    if (stored.value.state === "cancelled") fail(410, "Upload cancelled");
    const group = await this.store.read<UploadGroup>(groupKey(userId, stored.value.metadata.groupId));
    if (!group || group.value.state === "cancelled") fail(410, "Upload group cancelled or missing");
    return stored;
  }

  async create(userId: number, metadata: UploadMetadata, length: number): Promise<UploadSession> {
    if (!Number.isSafeInteger(length) || length <= 0 || length > metadata.totalSize) fail(400, "Invalid Upload-Length");
    return this.publisher.lock(lockKey(userId, metadata.groupId), async () => {
      const key = groupKey(userId, metadata.groupId);
      const stored = await this.store.read<UploadGroup>(key);
      const group: UploadGroup = stored?.value ?? {
        userId, metadata: common(metadata), expires: Date.now() + UPLOAD_TTL_MS,
        slots: Array(metadata.partCount).fill(null), state: "active",
      };
      if (group.expires <= Date.now()) fail(410, "Upload group expired");
      if (!sameMetadata(metadata, group.metadata)) fail(409, "Group metadata differs");
      if (group.state !== "active") fail(409, "Upload group is no longer active");
      const previous = group.slots[metadata.partIndex];
      if (previous) {
        const session = await this.session(previous, userId);
        if (session.value.length !== length) fail(409, "Part length differs");
        return session.value;
      }
      let reserved = length;
      for (const id of group.slots) if (id) reserved += (await this.session(id, userId)).value.length;
      if (reserved > metadata.totalSize) fail(400, "Parts exceed totalSize");
      if (group.slots.filter(Boolean).length === metadata.partCount - 1 && reserved !== metadata.totalSize) fail(400, "Part lengths must sum to totalSize");
      const session: UploadSession = {
        id: randomUUID(), userId, metadata, length, offset: 0, expires: group.expires, state: "active", chunks: [],
      };
      await this.store.write(sessionKey(session.id), session, 0);
      group.slots[metadata.partIndex] = session.id;
      await this.store.write(key, group, stored?.generation ?? 0);
      return session;
    });
  }

  /** Called before touching the request stream, including ownership and offset checks. */
  async checkPatch(id: string, userId: number, offset: number) {
    const stored = await this.session(id, userId);
    if (stored.value.state !== "active") fail(409, "Upload is sealed");
    if (offset !== stored.value.offset) fail(409, "Upload offset conflict; resume with HEAD");
    return stored;
  }

  async append(stored: Versioned<UploadSession>, bytes: Buffer): Promise<number> {
    const session = stored.value;
    if (bytes.length === 0 || bytes.length > CHUNK_BYTES || session.offset + bytes.length > session.length) fail(413, "Invalid chunk size (maximum 5 MiB)");
    const name = `.uploads/chunks/${session.id}/${randomUUID()}`;
    try {
      await this.store.put(name, bytes, "application/octet-stream");
      const next = { ...session, offset: session.offset + bytes.length, chunks: [...session.chunks, { name, size: bytes.length }] };
      await this.store.write(sessionKey(session.id), next, stored.generation);
      return next.offset;
    } catch (error) {
      // If the save acknowledgement was lost, HEAD is authoritative. Never delete
      // a chunk which the current durable manifest references.
      const current = await this.store.read<UploadSession>(sessionKey(session.id)).catch(() => undefined);
      if (current !== undefined && !current?.value.chunks.some(chunk => chunk.name === name)) {
        await this.store.remove(name).catch(() => {});
      }
      throw error;
    }
  }

  async cancel(id: string, userId: number): Promise<void> {
    if (!validUploadId(id)) fail(404, "Upload not found");
    const initial = await this.store.read<UploadSession>(sessionKey(id));
    if (!initial || initial.value.userId !== userId) fail(404, "Upload not found");
    await this.publisher.lock(lockKey(userId, initial.value.metadata.groupId), async () => {
      const key = groupKey(userId, initial.value.metadata.groupId);
      const group = await this.store.read<UploadGroup>(key);
      const objectName = this.objectName(initial.value);
      if (group?.value.state === "published" || await this.publisher.find(userId, objectName)) fail(409, "Clip already published");
      if (group && group.value.state !== "cancelled") await this.store.write(key, { ...group.value, state: "cancelled" }, group.generation);
      // Cancel the whole logical file. Persist inactive state for every part
      // before deleting any bytes; a retry continues an interrupted cleanup.
      const chunks: string[] = [];
      for (const partId of group?.value.slots ?? [id]) {
        if (!partId) continue;
        let cancelled = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          const stored = await this.store.read<UploadSession>(sessionKey(partId));
          if (!stored) { cancelled = true; break; }
          try {
            if (stored.value.state !== "cancelled") await this.store.write(sessionKey(partId), { ...stored.value, state: "cancelled" }, stored.generation);
          } catch (error) {
            if (error instanceof ClipUploadError && error.status === 409) continue;
            throw error;
          }
          chunks.push(...stored.value.chunks.map(chunk => chunk.name));
          cancelled = true;
          break;
        }
        if (!cancelled) fail(409, "Concurrent update; retry cancellation");
      }
      await Promise.all(chunks.map(name => this.store.remove(name)));
      await this.store.remove(objectName);
    });
  }

  private objectName(session: UploadSession) {
    return `clip_upload_${session.userId}_${session.metadata.groupId}${CLIP_EXT[session.metadata.contentType]}`;
  }

  async complete(userId: number, ids: unknown): Promise<Record<string, unknown>> {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || ids.some(id => !validUploadId(id)) || new Set(ids).size !== ids.length) fail(400, "uploadIds must contain 1–3 unique IDs in part order");
    const first = (await this.session(ids[0], userId)).value;
    return this.publisher.lock(lockKey(userId, first.metadata.groupId), async () => {
      const key = groupKey(userId, first.metadata.groupId);
      let group = await this.store.read<UploadGroup>(key);
      if (!group || group.value.state === "cancelled") fail(410, "Upload group cancelled or missing");
      if (JSON.stringify(ids) !== JSON.stringify(group.value.slots)) fail(409, "Expected every group part in order");
      const sessions = await Promise.all(ids.map(id => this.session(id, userId)));
      let size = 0;
      for (const [index, { value: session }] of sessions.entries()) {
        if (!sameMetadata(session.metadata, group.value.metadata) || session.metadata.partIndex !== index ||
            session.metadata.partCount !== ids.length || session.offset !== session.length ||
            session.chunks.reduce((sum, chunk) => sum + chunk.size, 0) !== session.length) fail(409, "Parts are incomplete or inconsistent");
        size += session.length;
      }
      if (size !== first.metadata.totalSize || size > MAX_CLIP_BYTES) fail(409, "Completed size differs from totalSize");
      if (group.value.result) return group.value.result;
      const filename = this.objectName(first);
      // Recover a crash/lost acknowledgement between PG COMMIT and GCS result save.
      const existing = await this.publisher.find(userId, filename);
      if (existing) {
        await this.store.write(key, { ...group.value, state: "published", result: existing }, group.generation);
        return existing;
      }
      for (const stored of sessions) {
        if (stored.value.state === "active") await this.store.write(sessionKey(stored.value.id), { ...stored.value, state: "sealed" }, stored.generation);
      }
      if (group.value.state === "active") {
        await this.store.write(key, { ...group.value, state: "sealed" }, group.generation);
        group = (await this.store.read<UploadGroup>(key))!;
      }
      const intermediates: string[] = [];
      let sources = sessions.flatMap(session => session.value.chunks.map(chunk => chunk.name));
      let level = 0;
      while (sources.length > 32) {
        const next: string[] = [];
        for (let i = 0; i < sources.length; i += 32) {
          const target = `.uploads/composed/${userId}/${first.metadata.groupId}/${level}-${i / 32}`;
          await this.store.compose(sources.slice(i, i + 32), target, first.metadata.contentType);
          next.push(target); intermediates.push(target);
        }
        sources = next; level++;
      }
      await this.store.compose(sources, filename, first.metadata.contentType);
      const hash = createHash("sha256");
      let actualSize = 0;
      for await (const bytes of this.store.stream(filename)) {
        actualSize += bytes.length;
        if (actualSize > size) fail(409, "Stored video exceeds expected size");
        hash.update(bytes);
      }
      if (actualSize !== size) fail(409, "Stored video is incomplete");
      const result = await this.publisher.publish({
        userId, filename, title: first.metadata.title, contentType: first.metadata.contentType,
        size, sha256: hash.digest("hex"),
      });
      await this.store.write(key, { ...group.value, state: "published", result }, group.generation);
      // Only temporary bytes are removed, after both the publication and result are durable.
      await Promise.all([...sessions.flatMap(s => s.value.chunks.map(c => c.name)), ...intermediates].map(name => this.store.remove(name).catch(() => {})));
      return result;
    });
  }
}