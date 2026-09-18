import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "admin-clip-thumbnails-"));
const mocksPath = path.join(temp, "mocks.mjs");
const entryPath = path.join(temp, "entry.ts");
const outputPath = path.join(temp, "bundle.cjs");

await writeFile(mocksPath, `
export const state = {};
export function reset() {
  Object.assign(state, {
    clips: new Map(), admins: new Set([1]), workerActive: false,
    queries: [], logs: [],
  });
}
export function addClip(id, overrides = {}) {
  const clip = {
    id, title: "clip " + id, username: "owner-" + id,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    thumbnail_object_name: null, thumbnail_retry_attempts: 8,
    thumbnail_retry_at: new Date("2026-01-02T00:00:00.000Z"),
    is_frozen: false, object_name: "private-original-" + id + ".mp4",
    ...overrides,
  };
  state.clips.set(id, clip);
  return clip;
}
reset();
function result(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
function compact(sql) { return sql.replace(/\\s+/g, " ").trim(); }
async function query(sql, params = []) {
  const text = compact(sql);
  state.queries.push({ sql: text, params: [...params] });
  if (text.startsWith("SELECT is_admin FROM users")) {
    return result([{ is_admin: state.admins.has(params[0]) }]);
  }
  if (text.startsWith("SELECT id, title, username,")) {
    const [maxAttempts, before, limit] = params;
    const rows = [...state.clips.values()]
      .filter(c => c.thumbnail_object_name === null && c.thumbnail_retry_attempts >= maxAttempts)
      .filter(c => before === null || c.id < before)
      .sort((a, b) => b.id - a.id).slice(0, limit)
      .map(c => ({
        id: c.id, title: c.title, username: c.username, createdAt: c.created_at,
        thumbnailRetryAttempts: c.thumbnail_retry_attempts,
        thumbnailRetryAt: c.thumbnail_retry_at, isFrozen: c.is_frozen,
      }));
    return result(rows);
  }
  throw new Error("Unexpected root SQL: " + text);
}
export const pool = {
  query,
  async connect() {
    return {
      async query(sql, params = []) {
        const text = compact(sql);
        state.queries.push({ sql: text, params: [...params] });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return result();
        if (text.startsWith("SELECT pg_try_advisory_xact_lock")) {
          return result([{ acquired: !state.workerActive }]);
        }
        if (text.startsWith("UPDATE clips SET thumbnail_retry_attempts")) {
          const clip = state.clips.get(params[0]);
          if (!clip || clip.thumbnail_object_name !== null || clip.is_frozen ||
              clip.thumbnail_retry_attempts < params[1]) return result();
          clip.thumbnail_retry_attempts = 0;
          clip.thumbnail_retry_at = new Date("2026-02-01T00:00:00.000Z");
          return result([{
            id: clip.id, thumbnailRetryAttempts: 0,
            thumbnailRetryAt: clip.thumbnail_retry_at,
          }]);
        }
        throw new Error("Unexpected client SQL: " + text);
      },
      release() {},
    };
  },
};
export const logger = { info() {}, warn() {}, error() {} };
export function clipFile() { throw new Error("thumbnail generation must not run in admin HTTP"); }
export function retryThumbnailName() { throw new Error("thumbnail generation must not run in admin HTTP"); }
export function generateClipThumbnail() { throw new Error("thumbnail generation must not run in admin HTTP"); }
`);

await writeFile(entryPath, `
import express from "express";
import router from ${JSON.stringify(path.join(apiRoot, "src/routes/admin-clip-thumbnails.ts"))};
export { state, reset, addClip } from ${JSON.stringify(mocksPath)};
const app = express();
app.use((req, _res, next) => {
  const userId = Number(req.headers["x-test-user"]);
  req.session = userId ? { userId } : {};
  req.log = { info(fields, message) { state.logs.push({ fields, message }); } };
  next();
});
app.use(router);
export default app;
import { state } from ${JSON.stringify(mocksPath)};
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
    name: "admin-thumbnail-mocks",
    setup(plugin) {
      plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/logger$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/clip-thumbnail\.js$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/clip-storage\.js$/ }, () => ({ path: mocksPath }));
    },
  }],
});

const bundled = (await import(pathToFileURL(outputPath).href)).default;
const { default: app, state, reset, addClip } = bundled;
const server = await new Promise(resolve => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(resolve => server.close(resolve)));
const adminHeaders = { "x-test-user": "1" };

test("real admin middleware returns 401 and 403", async () => {
  reset();
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/exhausted")).status, 401);
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/exhausted", {
    headers: { "x-test-user": "2" },
  })).status, 403);
});

test("inspection validates bounds and returns path-free keyset metadata", async () => {
  reset();
  for (let id = 1; id <= 5; id++) addClip(id);
  addClip(9, { thumbnail_retry_attempts: 7 });
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/exhausted?limit=0", { headers: adminHeaders })).status, 400);
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/exhausted?limit=101", { headers: adminHeaders })).status, 400);
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/exhausted?before=0", { headers: adminHeaders })).status, 400);

  const response = await fetch(baseUrl + "/admin/clips/thumbnails/exhausted?limit=2&before=5", { headers: adminHeaders });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.clips.map(c => c.id), [4, 3]);
  assert.equal(body.nextBefore, 3);
  assert.equal(body.maxAttempts, 8);
  assert.equal(body.clips[0].createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(body.clips[0].thumbnailRetryAt, "2026-01-02T00:00:00.000Z");
  assert.equal("objectName" in body.clips[0], false);
  assert.equal("thumbnailObjectName" in body.clips[0], false);
  assert.doesNotMatch(JSON.stringify(body), /private-original/);
});

test("requeue atomically resets only an eligible exhausted clip and logs actor", async () => {
  reset();
  const clip = addClip(21);
  const response = await fetch(baseUrl + "/admin/clips/thumbnails/21/requeue", {
    method: "POST", headers: adminHeaders,
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), {
    id: 21, thumbnailRetryAttempts: 0, thumbnailRetryAt: "2026-02-01T00:00:00.000Z",
  });
  assert.equal(clip.thumbnail_retry_attempts, 0);
  assert.deepEqual(state.logs[0].fields, { actorId: 1, clipId: 21 });
  const update = state.queries.find(q => q.sql.startsWith("UPDATE clips SET thumbnail_retry_attempts"));
  assert.match(update.sql, /thumbnail_object_name IS NULL/);
  assert.match(update.sql, /is_frozen = FALSE/);
  assert.match(update.sql, /thumbnail_retry_attempts >= \$2/);
});

test("requeue rejects bad IDs, stale states, and active-worker races", async () => {
  reset();
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/nope/requeue", {
    method: "POST", headers: adminHeaders,
  })).status, 400);
  for (const [id, overrides] of [
    [31, { thumbnail_retry_attempts: 7 }],
    [32, { thumbnail_object_name: "already.jpg" }],
    [33, { is_frozen: true }],
  ]) {
    addClip(id, overrides);
    const response = await fetch(baseUrl + `/admin/clips/thumbnails/${id}/requeue`, {
      method: "POST", headers: adminHeaders,
    });
    assert.equal(response.status, 409, await response.clone().text());
  }
  addClip(34);
  state.workerActive = true;
  assert.equal((await fetch(baseUrl + "/admin/clips/thumbnails/34/requeue", {
    method: "POST", headers: adminHeaders,
  })).status, 409);
  assert.equal(state.clips.get(34).thumbnail_retry_attempts, 8);
});

test("per-admin inspection and requeue limits are enforced", async () => {
  reset();
  for (let n = 0; n < 61; n++) {
    const response = await fetch(baseUrl + "/admin/clips/thumbnails/exhausted", {
      headers: { "x-test-user": "101" },
    });
    if (n < 60) assert.equal(response.status, 403);
    else assert.equal(response.status, 403, "non-admin requests never consume the admin limiter");
  }
  state.admins.add(102);
  for (let n = 0; n < 61; n++) {
    const response = await fetch(baseUrl + "/admin/clips/thumbnails/exhausted", {
      headers: { "x-test-user": "102" },
    });
    assert.equal(response.status, n < 60 ? 200 : 429);
  }
  state.admins.add(103);
  state.workerActive = true;
  for (let n = 0; n < 11; n++) {
    const response = await fetch(baseUrl + "/admin/clips/thumbnails/88/requeue", {
      method: "POST", headers: { "x-test-user": "103" },
    });
    assert.equal(response.status, n < 10 ? 409 : 429);
  }
});