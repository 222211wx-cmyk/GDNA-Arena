import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { ClipUploads, CHUNK_BYTES, parseUploadMetadata, type UploadMetadata, type UploadPublisher, type UploadStore, type Versioned } from "./clip-uploads.js";
import { ClipUploadError, MAX_CLIP_BYTES } from "./clip-upload-protocol.js";

export class FakeUploadStore implements UploadStore {
  manifests = new Map<string, { value: unknown; generation: string }>();
  objects = new Map<string, Buffer>();
  compositions: string[][] = [];
  generation = 0;
  failResultWrite = false;
  failPutAfterWrite = false;
  putBarrier?: () => Promise<void>;
  async read<T>(name: string): Promise<Versioned<T> | null> {
    const result = this.manifests.get(name);
    return result ? structuredClone(result) as Versioned<T> : null;
  }
  async write(name: string, value: unknown, generation: string | 0) {
    const current = this.manifests.get(name);
    if ((current?.generation ?? 0) !== generation) throw new ClipUploadError(409, "Generation conflict");
    if (this.failResultWrite && (value as { result?: unknown }).result) {
      this.failResultWrite = false;
      throw new Error("Simulated lost connection after database commit");
    }
    this.manifests.set(name, { value: structuredClone(value), generation: String(++this.generation) });
  }
  async put(name: string, bytes: Buffer) {
    this.objects.set(name, Buffer.from(bytes));
    if (this.putBarrier) await this.putBarrier();
    if (this.failPutAfterWrite) throw new Error("Simulated aborted chunk save");
  }
  async remove(name: string) { this.objects.delete(name); }
  async compose(sources: string[], target: string) {
    assert.ok(sources.length > 0 && sources.length <= 32);
    this.compositions.push([...sources]);
    if (!this.objects.has(target)) {
      this.objects.set(target, Buffer.concat(sources.map(source => {
        const bytes = this.objects.get(source);
        assert.ok(bytes, `Missing compose source ${source}`);
        return bytes;
      })));
    }
  }
  stream(name: string) { return Readable.from([this.objects.get(name)!]); }
}

export class FakePublisher implements UploadPublisher {
  clips = new Map<string, Record<string, unknown>>();
  publishedInputs: Parameters<UploadPublisher["publish"]>[0][] = [];
  tails = new Map<string, Promise<void>>();
  async lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(key, tail);
    await previous;
    try { return await action(); }
    finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
  async find(userId: number, filename: string) { return this.clips.get(`${userId}:${filename}`) ?? null; }
  async publish(input: Parameters<UploadPublisher["publish"]>[0]) {
    this.publishedInputs.push(input);
    const clip = { id: this.publishedInputs.length, title: input.title, duration_sec: 61, thumb: null };
    this.clips.set(`${input.userId}:${input.filename}`, clip);
    return clip;
  }
}

export function metadata(overrides: Partial<UploadMetadata> = {}): UploadMetadata {
  return {
    groupId: randomUUID(), partIndex: 0, partCount: 1, totalSize: 6,
    title: "عنوان الفيديو", contentType: "video/mp4", durationSec: 61,
    purpose: "story", isOriginalFootage: true, ...overrides,
  };
}
export function metadataHeader(values: Record<string, unknown>): string {
  return Object.entries(values).map(([key, value]) => `${key} ${Buffer.from(String(value)).toString("base64")}`).join(",");
}
export function fixture() {
  const store = new FakeUploadStore();
  const publisher = new FakePublisher();
  return { store, publisher, service: new ClipUploads(store, publisher) };
}
const rejectsStatus = (promise: Promise<unknown>, status: number) =>
  assert.rejects(promise, error => error instanceof ClipUploadError && error.status === status);

test("Tus metadata decodes UTF-8 and validates all bounds without trusting duration as proof", () => {
  const valid = metadata();
  assert.deepEqual(parseUploadMetadata(metadataHeader(valid as unknown as Record<string, unknown>)), valid);
  for (const update of [
    { groupId: "not-a-uuid" }, { partIndex: -1 }, { partIndex: 1 }, { partCount: 0 },
    { partCount: 4 }, { totalSize: 0 }, { totalSize: MAX_CLIP_BYTES + 1 },
    { title: "" }, { title: "x".repeat(121) }, { contentType: "text/html" },
    { durationSec: "NaN" }, { durationSec: -1 },
  ]) {
    assert.throws(() => parseUploadMetadata(metadataHeader({ ...valid, ...update })), ClipUploadError);
  }
  assert.throws(() => parseUploadMetadata("title !!!"), ClipUploadError);
  assert.throws(() => parseUploadMetadata("title /w=="), ClipUploadError);
  assert.throws(() => parseUploadMetadata("title YQ==,title Yg=="), ClipUploadError);
});

test("rights metadata defaults legacy callers to story and validates original declarations", () => {
  const valid = metadata();
  const legacy = { ...valid } as Partial<UploadMetadata>;
  delete legacy.purpose;
  assert.equal(parseUploadMetadata(metadataHeader(legacy)).purpose, "story");
  assert.throws(
    () => parseUploadMetadata(metadataHeader({ ...legacy, purpose: "original" })),
    (error: unknown) => error instanceof ClipUploadError && error.status === 400,
  );
  const original = parseUploadMetadata(metadataHeader({
    ...legacy, purpose: "original", originalReference: "  catalog ref 123  ",
    rightsHolderName: "  Producer Name  ", rightsHolderRole: "producer",
  }));
  assert.equal(original.purpose, "original");
  assert.equal(original.originalReference, "catalog ref 123");
  assert.equal(original.rightsHolderName, "Producer Name");
  assert.equal(original.rightsHolderRole, "producer");
  for (const originalReference of ["  ", "x".repeat(201)]) {
    assert.throws(
      () => parseUploadMetadata(metadataHeader({
        ...legacy, purpose: "original", originalReference,
        rightsHolderName: "Owner Name", rightsHolderRole: "owner",
      })),
      ClipUploadError,
    );
  }
  for (const update of [
    { rightsHolderName: " " }, { rightsHolderRole: "uploader" },
  ]) {
    assert.throws(() => parseUploadMetadata(metadataHeader({
      ...legacy, purpose: "original", originalReference: "catalog ref",
      rightsHolderName: "Owner Name", rightsHolderRole: "owner", ...update,
    })), ClipUploadError);
  }
});

test("original-footage metadata is strict, durable, and completion cannot override it", async () => {
  const legacy = metadata() as Partial<UploadMetadata>;
  delete legacy.isOriginalFootage;
  assert.equal(parseUploadMetadata(metadataHeader(legacy)).isOriginalFootage, true);
  assert.equal(parseUploadMetadata(metadataHeader({ ...legacy, isOriginalFootage: "false" })).isOriginalFootage, false);
  assert.throws(() => parseUploadMetadata(metadataHeader({ ...legacy, isOriginalFootage: "yes" })), ClipUploadError);

  const { service } = fixture();
  const session = await service.create(1, metadata({ isOriginalFootage: false }), 6);
  await service.append(await service.checkPatch(session.id, 1, 0), Buffer.from("abcdef"));
  await rejectsStatus(service.complete(1, [session.id], true), 409);
  await service.complete(1, [session.id], false);
});

test("part lengths and metadata must be consistent for an entire group", async () => {
  const { service } = fixture();
  const meta = metadata({ partCount: 2 });
  const first = await service.create(1, meta, 3);
  assert.equal((await service.create(1, meta, 3)).id, first.id, "duplicate creation resumes the original part");
  await rejectsStatus(service.create(1, meta, 4), 409);
  await rejectsStatus(service.create(1, { ...meta, partIndex: 1, title: "different" }, 3), 409);
  await rejectsStatus(service.create(1, { ...meta, partIndex: 1 }, 2), 400);
  await rejectsStatus(service.create(1, { ...meta, partIndex: 1 }, 4), 400);
  await rejectsStatus(service.create(1, metadata(), 0), 400);
});

test("offset survives service restart; ownership, offset and chunk bounds are server enforced", async () => {
  const { service, store, publisher } = fixture();
  const session = await service.create(1, metadata(), 6);
  await rejectsStatus(service.session(session.id, 2), 404);
  await rejectsStatus(service.checkPatch(session.id, 2, 0), 404);
  await rejectsStatus(service.cancel(session.id, 2), 404);
  await rejectsStatus(service.complete(2, [session.id]), 404);
  const snapshot = await service.checkPatch(session.id, 1, 0);
  assert.equal(await service.append(snapshot, Buffer.from("abc")), 3);
  const restarted = new ClipUploads(store, publisher);
  assert.equal((await restarted.session(session.id, 1)).value.offset, 3);
  await rejectsStatus(restarted.checkPatch(session.id, 1, 0), 409);
  await rejectsStatus(restarted.append(await restarted.checkPatch(session.id, 1, 3), Buffer.alloc(4)), 413);
  await rejectsStatus(restarted.append(await restarted.checkPatch(session.id, 1, 3), Buffer.alloc(CHUNK_BYTES + 1)), 413);
  await rejectsStatus(restarted.complete(1, [session.id]), 409);
});

test("CAS makes simultaneous PATCHes atomic and cleans the losing chunk", async () => {
  const { service, store } = fixture();
  const session = await service.create(1, metadata(), 6);
  const a = await service.checkPatch(session.id, 1, 0);
  const b = await service.checkPatch(session.id, 1, 0);
  const results = await Promise.allSettled([service.append(a, Buffer.from("abc")), service.append(b, Buffer.from("xyz"))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await service.session(session.id, 1)).value.offset, 3);
  assert.equal(store.objects.size, 1);
});

test("an aborted chunk save is cleaned without moving the durable offset", async () => {
  const { service, store } = fixture();
  const session = await service.create(1, metadata(), 6);
  store.failPutAfterWrite = true;
  await assert.rejects(service.append(await service.checkPatch(session.id, 1, 0), Buffer.from("abc")));
  assert.equal((await service.session(session.id, 1)).value.offset, 0);
  assert.equal(store.objects.size, 0);
});

test("a lost manifest acknowledgement preserves a committed chunk for HEAD recovery", async () => {
  const { service, store } = fixture();
  const session = await service.create(1, metadata(), 6);
  const originalWrite = store.write.bind(store);
  store.write = async (name, value, generation) => {
    await originalWrite(name, value, generation);
    if (name.includes("/sessions/") && (value as { offset?: number }).offset === 3) {
      throw new Error("Connection lost after successful CAS");
    }
  };
  await assert.rejects(service.append(await service.checkPatch(session.id, 1, 0), Buffer.from("abc")));
  assert.equal((await service.session(session.id, 1)).value.offset, 3);
  assert.equal(store.objects.size, 1);
  assert.equal([...store.objects.values()][0].toString(), "abc");
});

test("ordered multipart completion recursively composes <=32 sources and hashes actual bytes", async () => {
  const { service, store, publisher } = fixture();
  const base = metadata({ partCount: 3, totalSize: 70 });
  const lengths = [20, 30, 20];
  const ids: string[] = [];
  const actual: Buffer[] = [];
  for (const [partIndex, length] of lengths.entries()) {
    const session = await service.create(1, { ...base, partIndex }, length);
    ids.push(session.id);
    for (let offset = 0; offset < length; offset++) {
      const bytes = Buffer.from([actual.length]);
      actual.push(bytes);
      await service.append(await service.checkPatch(session.id, 1, offset), bytes);
    }
  }
  await rejectsStatus(service.complete(1, [ids[1], ids[0], ids[2]]), 409);
  await rejectsStatus(service.complete(1, [ids[0], ids[0]]), 400);
  const result = await service.complete(1, ids);
  const original = Buffer.concat(actual);
  assert.equal(publisher.publishedInputs[0].sha256, createHash("sha256").update(original).digest("hex"));
  assert.deepEqual(store.objects.get(publisher.publishedInputs[0].filename), original);
  assert.equal(store.compositions.length, 4);
  assert.equal(store.objects.size, 1, "only original video remains after finalization");
  assert.deepEqual(await new ClipUploads(store, publisher).complete(1, ids), result);
  assert.equal(publisher.publishedInputs.length, 1);
});

test("concurrent completion and a DB-commit/manifest-write crash do not duplicate publication", async () => {
  const { service, store, publisher } = fixture();
  const session = await service.create(1, metadata(), 6);
  await service.append(await service.checkPatch(session.id, 1, 0), Buffer.from("abcdef"));
  store.failResultWrite = true;
  await assert.rejects(service.complete(1, [session.id]), /database commit/);
  assert.equal(publisher.publishedInputs.length, 1);
  await rejectsStatus(service.cancel(session.id, 1), 409);
  assert.ok(store.objects.has(publisher.publishedInputs[0].filename), "cancel must not delete a committed original");
  const restarted = new ClipUploads(store, publisher);
  const [a, b] = await Promise.all([restarted.complete(1, [session.id]), restarted.complete(1, [session.id])]);
  assert.deepEqual(a, b);
  assert.equal(publisher.publishedInputs.length, 1);
});

test("cancellation marks every part inactive before cleanup and wins over an in-flight PATCH", async () => {
  const { service, store } = fixture();
  const base = metadata({ partCount: 2 });
  const a = await service.create(1, base, 3);
  const b = await service.create(1, { ...base, partIndex: 1 }, 3);
  await service.append(await service.checkPatch(a.id, 1, 0), Buffer.from("abc"));
  let chunkStarted!: () => void;
  const started = new Promise<void>(resolve => { chunkStarted = resolve; });
  let finishChunk!: () => void;
  store.putBarrier = async () => { chunkStarted(); await new Promise<void>(resolve => { finishChunk = resolve; }); };
  const append = service.append(await service.checkPatch(b.id, 1, 0), Buffer.from("def"));
  await started;
  await service.cancel(a.id, 1);
  await rejectsStatus(service.session(a.id, 1), 410);
  await rejectsStatus(service.session(b.id, 1), 410);
  finishChunk();
  await rejectsStatus(append, 409);
  assert.equal(store.objects.size, 0);
  await rejectsStatus(service.complete(1, [a.id, b.id]), 410);
  await service.cancel(b.id, 1);
});

test("expired manifests cannot be resumed or finalized", async () => {
  const { service, store } = fixture();
  const session = await service.create(1, metadata(), 6);
  const key = `.uploads/sessions/${session.id}.json`;
  const stored = store.manifests.get(key)!;
  (stored.value as { expires: number }).expires = Date.now() - 1;
  await rejectsStatus(service.session(session.id, 1), 410);
  await rejectsStatus(service.checkPatch(session.id, 1, 0), 410);
  await rejectsStatus(service.complete(1, [session.id]), 410);
});