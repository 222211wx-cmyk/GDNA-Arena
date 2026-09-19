// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { enqueueFile, listQueue, readQueue, removeQueue, saveQueue } from "./uploadQueue";
import { discardQueuedUpload, markQueuedPaused, runQueuedUpload, uploadClip, UPLOAD_CHUNK_BYTES, MAX_CLIP_BYTES, validateClipSize } from "./clipUpload";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const metadata = { title: "Mon clip", contentType: "video/mp4", durationSec: null };
function locks() {
  const tails = new Map<string, Promise<unknown>>();
  return { request: vi.fn((key: string, options: unknown, callback?: () => Promise<unknown>) => {
    const work = typeof options === "function" ? options as () => Promise<unknown> : callback!;
    const task = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    tails.set(key, task);
    return task;
  }) };
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: true, locks: locks() });
  vi.stubGlobal("XMLHttpRequest", undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function api(parts: { partNumber: number; etag: string; size: number }[] = []) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const mock = vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body instanceof Blob ? {} : JSON.parse(String(options?.body ?? "{}"));
    calls.push({ url: String(url), body });
    if (String(url).endsWith("auth/me")) return Response.json({ id: 7 });
    if (options?.method === "PUT") return new Response("", { headers: { ETag: '"new-etag"' } });
    if (body.action === "initiate") return Response.json({ sessionId: "session-7", partSize: UPLOAD_CHUNK_BYTES });
    if (body.action === "inspect") return Response.json({ state: "active", parts });
    if (body.action === "part") return Response.json({ url: "https://r2.example/part" });
    if (body.action === "abort") return new Response(null, { status: 204 });
    return Response.json({ ok: true, code: "HELX-123456", clip: { title: "Mon clip" } });
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

describe("durable original-byte upload queue", () => {
  it("accepts exactly 10 GiB and rejects one byte more without allocating media", () => {
    expect(MAX_CLIP_BYTES).toBe(10_737_418_240);
    expect(() => validateClipSize(MAX_CLIP_BYTES)).not.toThrow();
    expect(() => validateClipSize(MAX_CLIP_BYTES + 1)).toThrow("10 GiB");
  });

  it("202 releases bytes but persists owner job; resumed status alone verifies ready", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    const { mock, calls } = api();
    const normal = mock.getMockImplementation()!;
    let state = "queued";
    mock.mockImplementation(async (url, options) => {
      if (String(url).endsWith("upload/complete")) return Response.json({ sessionId: "session-7", state: "queued" }, { status: 202 });
      if (String(url).includes("upload/status/")) return Response.json({ sessionId: "session-7", state,
        receipt: state === "ready" ? { ok: true, code: "HELX-123456", clip: { title: "Mon clip" } } : undefined });
      return normal(url, options);
    });
    const progress = vi.fn();
    expect(await runQueuedUpload(record.id, 7, new AbortController().signal, progress)).toBeNull();
    expect(progress).toHaveBeenLastCalledWith(100, 3, 0, "processing");
    expect((await readQueue(record.id, 7)).file).toBeUndefined();
    expect((await listQueue(7))[0]).toMatchObject({ serverOwned: true, status: "processing" });
    const transfers = calls.filter(call => call.body.action === "part").length;
    expect(await runQueuedUpload(record.id, 7, new AbortController().signal, progress)).toBeNull();
    state = "ready";
    expect((await runQueuedUpload(record.id, 7, new AbortController().signal, progress))?.code).toBe("HELX-123456");
    expect(calls.filter(call => call.body.action === "part")).toHaveLength(transfers);
    expect(await listQueue(7)).toEqual([]);
    expect(mock.mock.calls.filter(([url]) => String(url).endsWith("upload/complete"))).toHaveLength(1);
  });

  it("keeps failed processing metadata for explicit cleanup and fences account switches", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    const { mock } = api();
    const normal = mock.getMockImplementation()!;
    let owner = 7;
    mock.mockImplementation(async (url, options) => {
      if (String(url).endsWith("auth/me")) return Response.json({ id: owner });
      if (String(url).endsWith("upload/complete")) return Response.json({ state: "queued" }, { status: 202 });
      if (String(url).includes("upload/status/")) return Response.json({ state: "failed", error: "Media invalide" });
      return normal(url, options);
    });
    await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn());
    owner = 8;
    await expect(runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn())).rejects.toThrow("autre compte");
    expect(mock.mock.calls.some(([url]) => String(url).includes("upload/status/"))).toBe(false);
    owner = 7;
    await expect(runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn())).rejects.toThrow("Media invalide");
    expect((await listQueue(7))[0]).toMatchObject({ status: "failed", error: "Media invalide" });
    await discardQueuedUpload(record.id, 7);
    expect(await listQueue(7)).toEqual([]);
  });
  it("restores exact Blob bytes without reselect; same metadata never reuses another file", async () => {
    const first = await enqueueFile(new File(["AAA-middle-AAA"], "same.mp4"), metadata, 7);
    const second = await enqueueFile(new File(["AAA-changed-AA"], "same.mp4"), metadata, 7);
    expect(first.id).not.toBe(second.id);
    expect(await (await readQueue(first.id, 7)).file.text()).toBe("AAA-middle-AAA");
    expect(await (await readQueue(second.id, 7)).file.text()).toBe("AAA-changed-AA");
    expect(await listQueue(8)).toEqual([]);
    await expect(readQueue(first.id, 8)).rejects.toThrow();
    await expect(removeQueue(first.id, 8)).rejects.toThrow();
    expect(await listQueue(7)).toHaveLength(2);
  });

  it("makes quota failure explicitly foreground-only and never claims persistence", async () => {
    api();
    vi.stubGlobal("indexedDB", { open: () => { throw new DOMException("Quota dépassé", "QuotaExceededError"); } });
    const warning = vi.fn();
    await expect(uploadClip(new File(["abc"], "a.mp4"), metadata, new AbortController().signal, vi.fn())).rejects.toThrow("premier plan");
    const result = await uploadClip(new File(["abc"], "a.mp4"), metadata, new AbortController().signal, vi.fn(), { onForegroundOnly: warning });
    expect(result.code).toBe("HELX-123456");
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/quota/i));
  });

  it("reconciles stale ETags and removes original bytes only after confirmed finalize", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    record.sessionId = "session-7"; record.completed = [[1, '"stale"']];
    await saveQueue(record);
    const { calls } = api([]);
    await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn());
    expect(calls.filter(call => call.body.action === "part")).toHaveLength(1);
    const finalized = calls.find(call => call.url.endsWith("upload/complete"))!;
    expect(finalized.body.parts).toEqual([{ partNumber: 1, etag: '"new-etag"' }]);
    expect(calls.filter(call => call.body.action).every(call => call.body.expectedOwnerId === 7)).toBe(true);
    expect(await listQueue(7)).toEqual([]);
    await expect(readQueue(record.id, 7)).rejects.toThrow();
    await expect(saveQueue(record)).rejects.toThrow();
  });

  it("reopening skips authoritative completed parts and publishes stored original", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    record.sessionId = "session-7"; await saveQueue(record);
    const { calls } = api([{ partNumber: 1, etag: '"remote"', size: 3 }]);
    await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn());
    expect(calls.some(call => call.body.action === "part")).toBe(false);
  });

  it("pause retains bytes and excludes background sync; discard aborts remote then deletes", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    const { calls } = api();
    await markQueuedPaused(record.id, 7);
    expect(await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn(), false)).toBeNull();
    expect(await (await readQueue(record.id, 7)).file.text()).toBe("abc");
    await discardQueuedUpload(record.id, 7);
    expect(calls.some(call => call.body.action === "abort")).toBe(true);
    expect(await listQueue(7)).toEqual([]);
  });

  it("a worker and foreground share the same lock and cannot PUT twice", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    const { calls } = api();
    const results = await Promise.allSettled([
      runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn()),
      runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn(), false),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter(call => call.url === "https://r2.example/part")).toHaveLength(1);
  });

  it("rejects a changed authenticated account before initiate", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 8);
    const { calls } = api();
    await expect(runQueuedUpload(record.id, 8, new AbortController().signal, vi.fn())).rejects.toThrow("autre compte");
    expect(calls.some(call => call.body.action)).toBe(false);
  });

  it("reconciles a lost finalization response without reuploading consumed multipart parts", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    record.sessionId = "session-7"; record.completed = [[1, '"remote"']]; await saveQueue(record);
    const { calls, mock } = api();
    const normal = mock.getMockImplementation()!;
    mock.mockImplementation(async (url, options) => {
      if (String(options?.body).includes('"inspect"')) return Response.json({ state: "completing", parts: [] });
      return normal(url, options);
    });
    await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn());
    expect(calls.some(call => call.body.action === "part")).toBe(false);
    expect(calls.find(call => call.url.endsWith("upload/complete"))?.body.parts).toEqual([{ partNumber: 1, etag: '"remote"' }]);
  });

  it("pause aborts an in-flight worker PUT, keeps bytes, and resumes from inspect", async () => {
    const record = await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    const { mock } = api();
    const normal = mock.getMockImplementation()!;
    const started = Promise.withResolvers<void>();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === "PUT") {
        started.resolve();
        return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Paused", "AbortError")), { once: true }));
      }
      return normal(url, options);
    });
    const running = runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn());
    const stopped = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    await markQueuedPaused(record.id, 7);
    await stopped;
    const stored = await readQueue(record.id, 7);
    expect(stored.record.status).toBe("paused");
    expect(await stored.file.text()).toBe("abc");
    mock.mockImplementation(normal);
    expect((await runQueuedUpload(record.id, 7, new AbortController().signal, vi.fn()))?.code).toBe("HELX-123456");
  });

  it("canonical worker sync runs persisted files and sends actual progress and completion messages", async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const messages: { type: string; owner: number }[] = [];
    vi.stubGlobal("addEventListener", (name: string, callback: (event: unknown) => void) => handlers.set(name, callback));
    vi.stubGlobal("clients", { matchAll: async () => [{ postMessage: (message: { type: string; owner: number }) => messages.push(message) }] });
    const { mock } = api();
    await enqueueFile(new File(["abc"], "a.mp4"), metadata, 7);
    await import("./uploadWorker");
    let pending: Promise<unknown> | undefined;
    handlers.get("sync")!({ tag: "helixly-clips-upload", waitUntil: (work: Promise<unknown>) => { pending = work; } });
    await pending;
    expect(messages.some(message => message.type === "CLIP_UPLOAD_PROGRESS")).toBe(true);
    expect(messages.some(message => message.type === "CLIP_UPLOAD_DONE" && message.owner === 7)).toBe(true);
    expect(await listQueue(7)).toEqual([]);
    const normal = mock.getMockImplementation()!;
    mock.mockImplementation(async (url, options) => String(url).endsWith("upload/complete")
      ? Response.json({ state: "queued" }, { status: 202 }) : normal(url, options));
    const queued = await enqueueFile(new File(["xyz"], "b.mp4"), metadata, 7);
    messages.length = 0;
    handlers.get("sync")!({ tag: "helixly-clips-upload", waitUntil: (work: Promise<unknown>) => { pending = work; } });
    await pending;
    expect(messages.some(message => message.type === "CLIP_UPLOAD_DONE")).toBe(false);
    expect((await readQueue(queued.id, 7)).file).toBeUndefined();
    mock.mockClear();
    handlers.get("sync")!({ tag: "helixly-clips-upload", waitUntil: (work: Promise<unknown>) => { pending = work; } });
    await pending;
    expect(mock.mock.calls.some(([url]) => String(url).includes("upload/status/"))).toBe(false);
  });

  it("ships no browser encoding imports, runtime, assets, or checkbox", () => {
    const src = path.resolve(import.meta.dirname, "../..");
    const entry = readFileSync(path.join(src, "clip-entry.ts"), "utf8");
    expect(entry).not.toMatch(/prepareVideo|ffmpeg|id="compress"|compression recommandée/);
    const names = readdirSync(import.meta.dirname);
    expect(names.some(name => /prepareVideo|ffmpegRuntime/.test(name))).toBe(false);
    const pkg = readFileSync(path.resolve(src, "../package.json"), "utf8");
    expect(pkg).not.toContain("@ffmpeg/");
  });
});