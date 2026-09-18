import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "clips-thumbnail-retry-"));
const statePath = path.join(temp, "state.mjs");
const mocksPath = path.join(temp, "mocks.mjs");
const entryPath = path.join(temp, "entry.ts");
const outputPath = path.join(temp, "bundle.cjs");

await writeFile(statePath, `
export const state = {};
let generateResolve;
export function reset() {
  Object.assign(state, {
    now: Date.parse("2026-01-01T00:00:00Z"),
    clips: new Map(), objects: new Map(), rights: new Map(),
    queries: [], deletes: [], writes: [], generateCalls: [],
    generateMode: "ok", jpeg: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    advisoryLock: false, rowLockOwner: null, rowLockWaiters: [],
  });
  generateResolve = undefined;
}
export function addClip(id, overrides = {}) {
  const clip = {
    id, user_id: 7, username: "owner", title: "clip " + id,
    object_name: "original_" + id + ".mp4", thumbnail_object_name: null,
    content_type: "video/mp4", duration_sec: 61, views: 0,
    created_at: "2026-01-01T00:00:00.000Z", is_frozen: false,
    thumbnail_retry_attempts: 0, thumbnail_retry_at: state.now,
    ...overrides,
  };
  state.clips.set(id, clip);
  state.objects.set(clip.object_name, Buffer.from("original-" + id));
  state.rights.set("fingerprint-" + id, { content_id: id, owner_name: "owner" });
  return clip;
}
export function releaseGeneration() {
  if (generateResolve) generateResolve();
}
export function waitForGeneration() {
  return new Promise(resolve => { generateResolve = resolve; });
}
reset();
`);

await writeFile(mocksPath, `
import crypto from "node:crypto";
import { Writable, Readable } from "node:stream";
import { state, reset, addClip, releaseGeneration, waitForGeneration } from "./state.mjs";
export { state, reset, addClip, releaseGeneration };

function result(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
function compact(sql) { return sql.replace(/\\s+/g, " ").trim(); }
function unlock(client) {
  if (state.rowLockOwner !== client.id) return;
  state.rowLockOwner = null;
  const waiters = state.rowLockWaiters.splice(0);
  for (const wake of waiters) wake();
}
async function lockRow(client) {
  while (state.rowLockOwner !== null && state.rowLockOwner !== client.id) {
    await new Promise(resolve => state.rowLockWaiters.push(resolve));
  }
  state.rowLockOwner = client.id;
}

let nextClientId = 1;
async function clientQuery(client, sql, params = []) {
  const text = compact(sql);
  state.queries.push({ clientId: client.id, sql: text, params: [...params] });
  if (text === "BEGIN") { client.inTx = true; return result(); }
  if (text === "COMMIT") { client.inTx = false; unlock(client); return result(); }
  if (text === "ROLLBACK") { client.inTx = false; unlock(client); return result(); }
  if (text.startsWith("SET ")) return result();
  if (text.startsWith("SELECT pg_try_advisory_lock")) {
    if (state.advisoryLock) return result([{ acquired: false }]);
    state.advisoryLock = true;
    return result([{ acquired: true }]);
  }
  if (text.startsWith("SELECT pg_advisory_unlock")) {
    state.advisoryLock = false;
    return result([{ pg_advisory_unlock: true }]);
  }
  if (text.startsWith("WITH candidate AS")) {
    const candidates = [...state.clips.values()].filter(clip =>
      clip.thumbnail_object_name === null && !clip.is_frozen &&
      clip.thumbnail_retry_attempts < params[0] && clip.thumbnail_retry_at <= state.now
    ).sort((a, b) => a.thumbnail_retry_at - b.thumbnail_retry_at || a.id - b.id);
    const clip = candidates[0];
    if (!clip) return result();
    const oldAttempts = clip.thumbnail_retry_attempts;
    clip.thumbnail_retry_attempts++;
    clip.thumbnail_retry_at = state.now + 5 * 60_000 * 2 ** oldAttempts;
    return result([{ id: clip.id, thumbnail_retry_attempts: clip.thumbnail_retry_attempts }]);
  }
  if (text.startsWith("SELECT object_name FROM clips")) {
    const clip = state.clips.get(params[0]);
    if (!clip || clip.thumbnail_object_name !== null || clip.is_frozen) return result();
    if (state.rowLockOwner !== null && state.rowLockOwner !== client.id) return result();
    await lockRow(client);
    return result([{ object_name: clip.object_name }]);
  }
  if (text.startsWith("UPDATE clips SET thumbnail_object_name")) {
    if (state.generateMode === "updateFail") throw new Error("UPDATE_FAILED");
    const clip = state.clips.get(params[0]);
    if (clip && clip.thumbnail_object_name === null) clip.thumbnail_object_name = params[1];
    return result([], clip ? 1 : 0);
  }
  if (text.includes("FROM clips WHERE is_frozen = FALSE")) {
    const rows = [...state.clips.values()].filter(clip => !clip.is_frozen)
      .sort((a, b) => b.id - a.id).slice(0, params.at(-1));
    return result(rows);
  }
  if (text.startsWith("SELECT thumbnail_object_name FROM clips")) {
    const clip = state.clips.get(params[0]);
    return result(clip && !clip.is_frozen ? [{ thumbnail_object_name: clip.thumbnail_object_name }] : []);
  }
  if (text.startsWith("SELECT user_id, object_name, thumbnail_object_name FROM clips")) {
    await lockRow(client);
    const clip = state.clips.get(params[0]);
    return result(clip ? [{ ...clip }] : []);
  }
  if (text.startsWith("SELECT is_admin FROM users")) return result([{ is_admin: false }]);
  if (text.startsWith("DELETE FROM clip_views")) return result([], 1);
  if (text.startsWith("DELETE FROM clips")) {
    const existed = state.clips.delete(params[0]);
    return result(existed ? [{ id: params[0] }] : []);
  }
  throw new Error("Unexpected SQL: " + text);
}

async function rootQuery(sql, params = []) {
  const client = { id: 0, inTx: false };
  return clientQuery(client, sql, params);
}
export const pool = {
  query: rootQuery,
  async connect() {
    const client = { id: nextClientId++, inTx: false };
    client.query = (sql, params) => clientQuery(client, sql, params);
    client.release = () => unlock(client);
    return client;
  },
};

function storageKey(name) { return name.split("/clips/").at(-1); }
export function clipFile(name) {
  return {
    name,
    createReadStream() {
      const value = state.objects.get(storageKey(name));
      if (value === undefined) {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => stream.destroy(Object.assign(new Error("missing"), { code: 404 })));
        return stream;
      }
      return Readable.from([value]);
    },
    createWriteStream() {
      const chunks = [];
      return new Writable({
        write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
        final(callback) {
          const key = storageKey(name);
          state.writes.push(key);
          state.objects.set(key, Buffer.concat(chunks));
          callback();
        },
      });
    },
    async delete() {
      const key = storageKey(name);
      state.deletes.push(key);
      state.objects.delete(key);
    },
  };
}
export function retryThumbnailName(id, objectName) {
  const key = crypto.createHash("sha256").update(objectName).digest("hex").slice(0, 32);
  return "thumb_retry_" + id + "_" + key + ".jpg";
}
export async function generateClipThumbnail(original) {
  state.generateCalls.push(original.name);
  if (state.generateMode === "fail") throw new Error("GENERATION_FAILED");
  if (state.generateMode === "wait") await waitForGeneration();
  return Buffer.from(state.jpeg);
}
export const logger = { info() {}, warn() {}, error() {} };
export function spawn() { throw new Error("spawn should not be called"); }
`);

await writeFile(entryPath, `
import express from "express";
import router from ${JSON.stringify(path.join(apiRoot, "src/routes/clips.ts"))};
export { runClipThumbnailRetryBatch } from ${JSON.stringify(path.join(apiRoot, "src/jobs/clip-thumbnail-retry.ts"))};
export { state, reset, addClip, releaseGeneration } from ${JSON.stringify(mocksPath)};
const app = express();
app.use((req, _res, next) => {
  const userId = Number(req.headers["x-test-user"]);
  req.session = userId ? { userId } : {};
  next();
});
app.use(express.json());
app.use(router);
export default app;
`);

await build({
  entryPoints: [entryPath],
  outfile: outputPath,
  platform: "node",
  format: "cjs",
  bundle: true,
  nodePaths: [path.join(apiRoot, "node_modules"), path.resolve(apiRoot, "../../node_modules")],
  logLevel: "silent",
  plugins: [{
    name: "clip-thumbnail-retry-mocks",
    setup(plugin) {
      plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /(?:^|\/)chatStorage$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/logger$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/clip-thumbnail\.js$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/clip-storage\.js$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /^node:child_process$/ }, () => ({ path: mocksPath }));
    },
  }],
});

const bundled = (await import(pathToFileURL(outputPath).href)).default;
const { default: app, state, reset, addClip, releaseGeneration, runClipThumbnailRetryBatch } = bundled;
process.env.PRIVATE_OBJECT_DIR = "/private-test-bucket/app";
const server = await new Promise(resolve => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(resolve => server.close(resolve)));

function stableName(id, objectName) {
  const key = crypto.createHash("sha256").update(objectName).digest("hex").slice(0, 32);
  return `thumb_retry_${id}_${key}.jpg`;
}

test("retry worker uses three-item batches and is idempotent across runs", async () => {
  reset();
  for (let id = 1; id <= 5; id++) addClip(id);
  assert.equal(await runClipThumbnailRetryBatch(), 3);
  assert.deepEqual([...state.clips.values()].filter(c => c.thumbnail_object_name).map(c => c.id), [1, 2, 3]);
  assert.equal(state.writes.length, 3);

  assert.equal(await runClipThumbnailRetryBatch(), 2);
  assert.equal(state.writes.length, 5);
  assert.equal(await runClipThumbnailRetryBatch(), 0);
  assert.equal(state.writes.length, 5);
  assert.equal(new Set(state.writes).size, 5);
});

test("failed retries back off, cap at eight, and exclude frozen clips", async () => {
  reset();
  const failed = addClip(10);
  const frozen = addClip(11, { is_frozen: true });
  state.generateMode = "fail";
  const expectedDelays = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = state.now;
    assert.equal(await runClipThumbnailRetryBatch(), 0);
    expectedDelays.push(failed.thumbnail_retry_at - before);
    state.now = failed.thumbnail_retry_at;
  }
  assert.deepEqual(expectedDelays, Array.from({ length: 8 }, (_, n) => 5 * 60_000 * 2 ** n));
  assert.equal(failed.thumbnail_retry_attempts, 8);
  assert.equal(await runClipThumbnailRetryBatch(), 0);
  assert.equal(state.generateCalls.length, 8);
  assert.equal(frozen.thumbnail_retry_attempts, 0);
});

test("a failed generation preserves the original and permanent rights record", async () => {
  reset();
  const clip = addClip(20);
  const original = Buffer.from(state.objects.get(clip.object_name));
  const rights = { ...state.rights.get("fingerprint-20") };
  state.generateMode = "updateFail";
  assert.equal(await runClipThumbnailRetryBatch(), 0);
  assert.deepEqual(state.objects.get(clip.object_name), original);
  assert.deepEqual(state.rights.get("fingerprint-20"), rights);
  assert.equal(clip.thumbnail_object_name, null);
  assert.equal(state.objects.has(stableName(clip.id, clip.object_name)), true,
    "an interrupted write remains at the stable retry candidate");
  assert.deepEqual(state.deletes, []);
});

test("feed and thumbnail GET never invoke retry generation", async () => {
  reset();
  addClip(30);
  const feed = await fetch(baseUrl + "/clips/feed");
  assert.equal(feed.status, 200);
  assert.equal((await feed.json()).clips[0].thumb, null);
  assert.equal((await fetch(baseUrl + "/clips/thumbnail/30")).status, 404);
  assert.equal(state.generateCalls.length, 0);
  assert.equal(state.clips.get(30).thumbnail_retry_attempts, 0);
});

test("DELETE waits for the worker row lock and removes the stable candidate", async () => {
  reset();
  const clip = addClip(40);
  state.generateMode = "wait";
  const worker = runClipThumbnailRetryBatch();
  while (state.generateCalls.length === 0) await new Promise(resolve => setImmediate(resolve));

  let deleteSettled = false;
  const deletion = fetch(baseUrl + "/clips/40", {
    method: "DELETE", headers: { "x-test-user": "7" },
  }).then(response => { deleteSettled = true; return response; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(deleteSettled, false, "DELETE must wait while retry owns FOR UPDATE");

  releaseGeneration();
  assert.equal(await worker, 1);
  const response = await deletion;
  assert.equal(response.status, 204);
  const retryName = stableName(clip.id, clip.object_name);
  assert.equal(state.clips.has(clip.id), false);
  assert.equal(state.objects.has(retryName), false);
  assert.equal(state.objects.has(clip.object_name), false);
  assert.equal(state.deletes.filter(name => name === retryName).length, 1);
  assert.equal(state.rights.has("fingerprint-40"), true);
  assert.ok(state.queries.some(query =>
    query.sql.startsWith("SELECT user_id, object_name, thumbnail_object_name FROM clips") &&
    query.sql.endsWith("FOR UPDATE")));
});