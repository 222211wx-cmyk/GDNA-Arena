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
const temp = await mkdtemp(path.join(os.tmpdir(), "clips-route-"));
const statePath = path.join(temp, "state.mjs");
const mocksPath = path.join(temp, "mocks.mjs");
const entryPath = path.join(temp, "entry.ts");
const outputPath = path.join(temp, "route.cjs");

await writeFile(statePath, `
export const state = {};
export function reset() {
  Object.assign(state, {
    objects: new Map(), reads: [], deletes: [], saves: [], queries: [],
    clips: new Map(), fingerprints: new Map(), nextClipId: 1, nextFingerprintId: 1,
    thumbnailMode: "ok", jpeg: Buffer.from([0xff, 0xd8, 0x45, 0x32, 0xff, 0xd9]),
    duration: 75.8, failClipInsert: false,
  });
}
reset();
`);

await writeFile(mocksPath, `
import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { state } from "./state.mjs";

function file(name) {
  return {
    name,
    createWriteStream() {
      const stream = new PassThrough();
      const chunks = [];
      stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      stream.on("finish", () => state.objects.set(name, Buffer.concat(chunks)));
      return stream;
    },
    createReadStream() {
      state.reads.push(name);
      const bytes = state.objects.get(name);
      if (bytes === undefined) {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => stream.destroy(Object.assign(new Error("missing"), { code: 404 })));
        return stream;
      }
      return Readable.from([bytes]);
    },
    async save(bytes, options) {
      state.saves.push({ name, options });
      if (state.thumbnailMode === "saveFail" && name.includes("/thumb_")) throw new Error("SAVE_FAILED");
      state.objects.set(name, Buffer.from(bytes));
    },
    async delete() {
      state.deletes.push(name);
      state.objects.delete(name);
    },
    async getMetadata() {
      return [{ size: state.objects.get(name)?.length ?? 0 }];
    },
  };
}

export const objectStorageClient = {
  bucket() { return { file }; },
};

function result(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
async function query(sql, params = []) {
  const compact = sql.replace(/\\s+/g, " ").trim();
  state.queries.push({ sql: compact, params: [...params] });
  if (compact === "BEGIN" || compact === "COMMIT" || compact === "ROLLBACK") return result();
  if (compact.startsWith("SELECT username FROM users")) return result([{ username: "rights-owner" }]);
  if (compact.startsWith("SELECT is_admin FROM users")) return result([{ is_admin: false }]);
  if (compact.startsWith("INSERT INTO content_fingerprints")) {
    if (state.fingerprints.has(params[0])) return result([]);
    const row = { id: state.nextFingerprintId++, owner_name: params[1], content_id: 0 };
    state.fingerprints.set(params[0], row);
    return result([{ id: row.id }]);
  }
  if (compact.startsWith("SELECT owner_name FROM content_fingerprints"))
    return result([state.fingerprints.get(params[0])].filter(Boolean));
  if (compact.startsWith("INSERT INTO clips ")) {
    if (state.failClipInsert) throw new Error("DB_PUBLISH_FAILED");
    const id = state.nextClipId++;
    const row = {
      id, user_id: params[0], username: params[1], title: params[2],
      object_name: params[3], content_type: params[4], size_bytes: params[5],
      duration_sec: params[6], thumbnail_object_name: params[7],
      created_at: "2026-01-02T03:04:05.000Z", views: 0, is_frozen: false,
    };
    state.clips.set(id, row);
    return result([row]);
  }
  if (compact.startsWith("UPDATE content_fingerprints SET content_id")) {
    for (const value of state.fingerprints.values()) if (value.id === params[1]) value.content_id = params[0];
    return result([], 1);
  }
  if (compact.includes("FROM clips WHERE is_frozen = FALSE")) {
    return result([...state.clips.values()].filter(c => !c.is_frozen)
      .sort((a, b) => b.id - a.id).slice(0, params.at(-1)));
  }
  if (compact.startsWith("SELECT thumbnail_object_name FROM clips")) {
    const clip = state.clips.get(params[0]);
    return result(clip && !clip.is_frozen ? [{ thumbnail_object_name: clip.thumbnail_object_name }] : []);
  }
  if (compact.startsWith("SELECT user_id, object_name, thumbnail_object_name FROM clips")) {
    const clip = state.clips.get(params[0]);
    return result(clip ? [clip] : []);
  }
  if (compact.startsWith("DELETE FROM clip_views")) return result([], 1);
  if (compact.startsWith("DELETE FROM clips")) {
    const existed = state.clips.delete(params[0]);
    return result(existed ? [{ id: params[0] }] : []);
  }
  throw new Error("Unexpected SQL: " + compact);
}

export const pool = {
  query,
  async connect() { return { query, release() {} }; },
};
export const logger = { info() {}, warn() {}, error() {} };

export async function generateClipThumbnail(original) {
  if (state.thumbnailMode === "generateFail") throw new Error("GENERATION_FAILED");
  const chunks = [];
  for await (const chunk of original.createReadStream()) chunks.push(chunk);
  state.thumbnailInput = Buffer.concat(chunks);
  return Buffer.from(state.jpeg);
}

export function spawn() {
  const probe = new EventEmitter();
  probe.stdout = new PassThrough();
  probe.stderr = new PassThrough();
  probe.stdin = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) {
      probe.stdout.write(String(state.duration));
      probe.stdout.end();
      queueMicrotask(() => probe.emit("close", 0));
      callback();
    },
  });
  probe.kill = () => {};
  return probe;
}
`);

await writeFile(entryPath, `
import express from "express";
import router from ${JSON.stringify(path.join(apiRoot, "src/routes/clips.ts"))};
export { state, reset } from ${JSON.stringify(statePath)};
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
    name: "clips-route-mocks",
    setup(plugin) {
      plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/chatStorage$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/logger$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/lib\/clip-thumbnail\.js$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /^node:child_process$/ }, () => ({ path: mocksPath }));
    },
  }],
});

const bundledRoute = (await import(pathToFileURL(outputPath).href)).default;
const { default: app, state, reset } = bundledRoute;
process.env.PRIVATE_OBJECT_DIR = "/private-test-bucket/app";

const server = await new Promise(resolve => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(resolve => server.close(resolve)));

async function publish(bytes, { title = "Original work", userId = 7 } = {}) {
  const body = new FormData();
  body.append("title", title);
  body.append("durationSec", "75");
  body.append("video", new Blob([bytes], { type: "video/mp4" }), "original.mp4");
  return fetch(`${baseUrl}/clips`, {
    method: "POST",
    headers: { "x-test-user": String(userId) },
    body,
  });
}

function storedObject(name) {
  const key = [...state.objects.keys()].find(candidate => candidate.endsWith(`/clips/${name}`));
  return key === undefined ? undefined : state.objects.get(key);
}

function deletedObject(name) {
  return state.deletes.some(candidate => candidate.endsWith(`/clips/${name}`));
}

test("clips route thumbnail and ownership integration", async t => {
  await t.test("publishes the exact fingerprint, stores JPEG, feeds a scoped URL, and serves only the JPEG", async () => {
    reset();
    const original = Buffer.from("same original file bytes\\0\\1\\2", "utf8");
    const response = await publish(original);
    assert.equal(response.status, 200);
    const { clip } = await response.json();
    assert.equal(clip.thumb, `/api/clips/thumbnail/${clip.id}`);
    assert.equal("thumbnail_object_name" in clip, false);

    const fingerprintInsert = state.queries.find(q => q.sql.startsWith("INSERT INTO content_fingerprints"));
    assert.equal(fingerprintInsert.params[0], crypto.createHash("sha256").update(original).digest("hex"));
    const savedClip = state.clips.get(clip.id);
    assert.deepEqual(storedObject(savedClip.object_name), original);
    assert.deepEqual(state.thumbnailInput, original);
    assert.deepEqual(storedObject(savedClip.thumbnail_object_name), state.jpeg);
    assert.equal(state.saves[0].options.metadata.contentType, "image/jpeg");

    const feedResponse = await fetch(`${baseUrl}/clips/feed`);
    const feed = await feedResponse.json();
    assert.equal(feed.clips[0].thumb, `/api/clips/thumbnail/${clip.id}`);
    assert.equal("thumbnail_object_name" in feed.clips[0], false);

    state.reads.length = 0;
    const jpegResponse = await fetch(`${baseUrl}/clips/thumbnail/${clip.id}`);
    assert.equal(jpegResponse.status, 200);
    assert.equal(jpegResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(jpegResponse.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await jpegResponse.arrayBuffer()), state.jpeg);
    assert.equal(state.reads.length, 1);
    assert.equal(state.reads[0].endsWith(`/clips/${savedClip.thumbnail_object_name}`), true);
  });

  await t.test("returns 404 for missing or frozen thumbnails without reading storage", async () => {
    reset();
    state.clips.set(8, { id: 8, thumbnail_object_name: "thumb_frozen.jpg", is_frozen: true });
    state.objects.set("thumb_frozen.jpg", state.jpeg);
    assert.equal((await fetch(`${baseUrl}/clips/thumbnail/8`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/clips/thumbnail/999`)).status, 404);
    assert.deepEqual(state.reads, []);
  });

  await t.test("publishes a valid original without a thumb when generation or JPEG save fails", async () => {
    for (const mode of ["generateFail", "saveFail"]) {
      reset();
      state.thumbnailMode = mode;
      const original = Buffer.from(`fallback-original-${mode}`);
      const response = await publish(original);
      assert.equal(response.status, 200, mode);
      const { clip } = await response.json();
      assert.equal(clip.thumb, null);
      const stored = state.clips.get(clip.id);
      assert.equal(stored.thumbnail_object_name, null);
      assert.deepEqual(storedObject(stored.object_name), original);
      if (mode === "saveFail") assert.equal(deletedObject(state.saves[0].name.split("/").at(-1)), true);
    }
  });

  await t.test("checks delete ownership, then removes thumbnail and video but retains fingerprint", async () => {
    reset();
    const response = await publish(Buffer.from("delete-owned-original"));
    const { clip } = await response.json();
    const stored = state.clips.get(clip.id);
    const fingerprintCount = state.fingerprints.size;

    const denied = await fetch(`${baseUrl}/clips/${clip.id}`, {
      method: "DELETE", headers: { "x-test-user": "99" },
    });
    assert.equal(denied.status, 403);
    assert.ok(storedObject(stored.object_name));
    assert.ok(storedObject(stored.thumbnail_object_name));

    const allowed = await fetch(`${baseUrl}/clips/${clip.id}`, {
      method: "DELETE", headers: { "x-test-user": "7" },
    });
    assert.equal(allowed.status, 204);
    assert.equal(deletedObject(stored.thumbnail_object_name), true);
    assert.equal(deletedObject(stored.object_name), true);
    assert.equal(state.clips.has(clip.id), false);
    assert.equal(state.fingerprints.size, fingerprintCount);
    assert.equal(state.queries.some(q => q.sql.startsWith("DELETE FROM content_fingerprints")), false);
  });

  await t.test("cleans both uploaded objects on duplicate and failed DB publication", async () => {
    reset();
    const bytes = Buffer.from("duplicate-original");
    state.fingerprints.set(crypto.createHash("sha256").update(bytes).digest("hex"), {
      id: 41, owner_name: "first-owner", content_id: 1,
    });
    const duplicate = await publish(bytes);
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /first-owner/);
    assert.equal(state.objects.size, 0);
    assert.ok(state.deletes.some(name => name.includes("/clip_")));
    assert.ok(state.deletes.some(name => name.includes("/thumb_")));

    reset();
    state.failClipInsert = true;
    const failed = await publish(Buffer.from("db-failed-original"));
    assert.equal(failed.status, 500);
    assert.equal(state.objects.size, 0);
    assert.ok(state.deletes.some(name => name.includes("/clip_")));
    assert.ok(state.deletes.some(name => name.includes("/thumb_")));
  });
});