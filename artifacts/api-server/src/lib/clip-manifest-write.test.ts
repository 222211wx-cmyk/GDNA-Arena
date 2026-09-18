import assert from "node:assert/strict";
import test from "node:test";
import { createClipManifestWriter, MANIFEST_MUTATION_INTERVAL_MS, MANIFEST_WRITE_MAX_ATTEMPTS } from "./clip-manifest-write.js";
import { ClipUploadError } from "./clip-upload-protocol.js";
import { ClipUploads, type UploadStore } from "./clip-uploads.js";

function fixture(save: (name: string, json: string, generation: string | 0) => Promise<void>) {
  let time = 0;
  const sleeps: number[] = [];
  const writer = createClipManifestWriter({
    save, now: () => time, random: () => 0,
    sleep: async milliseconds => { sleeps.push(milliseconds); time += milliseconds; },
  });
  return { writer, sleeps, now: () => time };
}
const providerError = (code: number) => Object.assign(new Error(`Storage ${code}`), { code });

test("429 retry preserves exact serialized value and generation", async () => {
  const calls: unknown[][] = [];
  const f = fixture(async (...args) => {
    calls.push(args);
    if (calls.length <= 3) throw providerError(429);
  });
  await f.writer("session", { offset: 1048576 }, "generation-7");
  assert.equal(calls.length, 4);
  for (const args of calls) assert.deepEqual(args, ["session", '{"offset":1048576}', "generation-7"]);
  assert.deepEqual(f.sleeps, [1200, 2400, 4800]);
});

test("sequential same-object mutations are paced; unrelated manifests are not delayed", async () => {
  const starts: [string, number][] = [];
  const f = fixture(async name => { starts.push([name, f.now()]); });
  await f.writer("a", { offset: 1 }, "1");
  await f.writer("b", { offset: 1 }, "1");
  await f.writer("a", { offset: 2 }, "2");
  assert.deepEqual(starts, [["a", 0], ["b", 0], ["a", MANIFEST_MUTATION_INTERVAL_MS]]);
});

test("429 then stale CAS412 is never blindly overwritten or retried with a newer generation", async () => {
  const generations: (string | 0)[] = [];
  const f = fixture(async (_name, _json, generation) => {
    generations.push(generation);
    throw providerError(generations.length === 1 ? 429 : 412);
  });
  await assert.rejects(f.writer("session", { offset: 1 }, "old-generation"),
    error => error instanceof ClipUploadError && error.status === 409);
  assert.deepEqual(generations, ["old-generation", "old-generation"]);
});

test("persistent429 is bounded and returns explicit resumable503", async () => {
  let attempts = 0;
  const f = fixture(async () => { attempts++; throw providerError(429); });
  await assert.rejects(f.writer("session", { offset: 1 }, "1"),
    error => error instanceof ClipUploadError && error.status === 503 && /HEAD/.test(error.message));
  assert.equal(attempts, MANIFEST_WRITE_MAX_ATTEMPTS);
  assert.ok(f.sleeps.reduce((sum, value) => sum + value, 0) < 30_000);
});

test("non-throttle storage errors are surfaced immediately", async () => {
  let attempts = 0;
  const failure = providerError(403);
  const f = fixture(async () => { attempts++; throw failure; });
  await assert.rejects(f.writer("session", {}, 0), error => error === failure);
  assert.equal(attempts, 1);
});

test("simultaneous same-manifest writes serialize and still retain their original CAS tokens", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const calls: (string | 0)[] = [];
  const f = fixture(async (_name, _json, generation) => {
    calls.push(generation);
    if (calls.length === 1) { started(); await blocked; }
    else throw providerError(412);
  });
  const first = f.writer("session", { offset: 1 }, "1");
  await entered;
  const second = f.writer("session", { offset: 2 }, "1");
  assert.deepEqual(calls, ["1"]);
  const rejected = assert.rejects(second, error => error instanceof ClipUploadError && error.status === 409);
  release();
  await first;
  await rejected;
  assert.deepEqual(calls, ["1", "1"]);
  assert.deepEqual(f.sleeps, [1200]);
});

test("append with lost acknowledgement429 then412 preserves the committed chunk for HEAD recovery", async () => {
  const chunks = new Map<string, Buffer>();
  let current: any;
  let attempts = 0;
  const f = fixture(async (_name, json, generation) => {
    attempts++;
    assert.equal(generation, "1");
    if (attempts === 1) {
      current = { value: JSON.parse(json), generation: "2" };
      throw providerError(429); // Commit succeeded, acknowledgement was lost.
    }
    throw providerError(412);
  });
  const store = {
    write: f.writer,
    async put(name: string, bytes: Buffer) { chunks.set(name, bytes); },
    async read() { return current; },
    async remove(name: string) { chunks.delete(name); },
  } as unknown as UploadStore;
  const service = new ClipUploads(store, {} as any);
  await assert.rejects(service.append({
    generation: "1",
    value: { id: "session", offset: 0, length: 3, chunks: [] } as any,
  }, Buffer.from("abc")), error => error instanceof ClipUploadError && error.status === 409);
  assert.equal(current.value.offset, 3);
  assert.equal(chunks.size, 1);
  assert.deepEqual(chunks.get(current.value.chunks[0].name), Buffer.from("abc"));
});