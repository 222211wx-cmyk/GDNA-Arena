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
    duration: 75.8, failClipInsert: false, originals: [], registrations: [],
    visualSignature: { version: 1, frames: ["candidate"] },
    thumbnailInput: null,
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
  if (compact.startsWith("SELECT pg_advisory_xact_lock")) return result([{ pg_advisory_xact_lock: null }]);
  if (compact.startsWith("SELECT count(*)::int AS count FROM clips")) {
    const count = [...state.clips.values()].filter(clip => clip.user_id === params[0]).length;
    return result([{ count }]);
  }
  if (compact.startsWith("SELECT username FROM users")) return result([{ username: "rights-owner" }]);
  if (compact.startsWith("SELECT EXISTS (SELECT user_id, duration_seconds, visual_signature")) {
    return result([{ exists: state.originals.length > 0 }]);
  }
  if (compact.startsWith("SELECT user_id, duration_seconds, visual_signature FROM clip_original_registrations")) return result(state.originals);
  if (compact.startsWith("SELECT is_admin FROM users")) return result([{ is_admin: false }]);
  if (compact.startsWith("INSERT INTO content_fingerprints")) {
    if (state.fingerprints.has(params[0])) return result([]);
    const row = { id: state.nextFingerprintId++, owner_name: params[1], content_id: 0 };
    state.fingerprints.set(params[0], row);
    return result([{ id: row.id }]);
  }
  if (compact.startsWith("SELECT owner_name FROM content_fingerprints"))
    return result([state.fingerprints.get(params[0])].filter(Boolean));
  if (compact.startsWith("SELECT id FROM clips WHERE object_name")) {
    const clip = [...state.clips.values()].find(value => value.object_name === params[0]);
    return result(clip ? [{ id: clip.id }] : []);
  }
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
  if (compact.startsWith("INSERT INTO clip_original_registrations")) {
    const row = { id: state.registrations.length + 1, created_at: new Date("2026-01-02T03:04:05Z") };
    state.registrations.push({
      clip_id: params[0], user_id: params[1], original_reference: params[2],
      rights_holder_name: params[3], rights_holder_role: params[4],
      duration_seconds: params[5], visual_signature: params[6],
    });
    return result([row]);
  }
  if (compact.includes("FROM clips c") && compact.includes("c.is_frozen = FALSE")) {
    return result([...state.clips.values()].filter(c => !c.is_frozen)
      .map(c => ({ ...c, rights_purpose: "story", rights_registered_at: null }))
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

export async function extractClipVisualSignature() {
  return state.visualSignature;
}
export function matchesOriginalVideo(a, b) {
  return Math.abs(a.durationSeconds - b.durationSeconds) <= 0.5 &&
    JSON.stringify(a.signature) === JSON.stringify(b.signature);
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
      plugin.onResolve({ filter: /(?:^|\/)chatStorage(?:\.js)?$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/(?:lib\/)?logger(?:\.js)?$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/clip-thumbnail\.js$/ }, () => ({ path: mocksPath }));
      plugin.onResolve({ filter: /\/clip-original-signature\.js$/ }, () => ({ path: mocksPath }));
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

async function publish(bytes, {
  title = "Original work", userId = 7, purpose, originalReference,
  rightsHolderName, rightsHolderRole,
} = {}) {
  const body = new FormData();
  body.append("title", title);
  body.append("durationSec", "75");
  if (purpose !== undefined) body.append("purpose", purpose);
  if (originalReference !== undefined) body.append("originalReference", originalReference);
  if (rightsHolderName !== undefined) body.append("rightsHolderName", rightsHolderName);
  if (rightsHolderRole !== undefined) body.append("rightsHolderRole", rightsHolderRole);
  body.append("video", new Blob([bytes], { type: "video/mp4" }), "original.mp4");
  return fetch(`${baseUrl}/clips`, {
    method: "POST",
    headers: { "x-test-user": String(userId) },
    body,
  });
}

async function publishSimple(bytes) {
  const body = new FormData();
  body.append("title", "Fast story");
  body.append("file", new Blob([bytes], { type: "video/mp4" }), "story.mp4");
  return fetch(`${baseUrl}/clip/upload`, {
    method: "POST", headers: { "x-test-user": "7" }, body,
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
    assert.deepEqual(clip.rights, { purpose: "story" });
    assert.equal(clip.thumb, `/api/clips/thumbnail/${clip.id}`);
    assert.equal("thumbnail_object_name" in clip, false);

    const fingerprintInsert = state.queries.find(q => q.sql.startsWith("INSERT INTO content_fingerprints"));
    assert.equal(fingerprintInsert.params[0], crypto.createHash("sha256").update(original).digest("hex"));
    const lockKeys = state.queries
      .filter(q => q.sql.startsWith("SELECT pg_advisory_xact_lock"))
      .map(q => q.params[0]);
    assert.deepEqual(lockKeys, [
      "clip-original-duration:v1:75", "clip-original-duration:v1:76", "clip-publish-user:7",
    ]);
    assert.equal(lockKeys.includes("clip-original-policy:v1"), false,
      "unrelated video durations are never serialized by one global lock");
    const savedClip = state.clips.get(clip.id);
    assert.deepEqual(storedObject(savedClip.object_name), original);
    assert.deepEqual(state.thumbnailInput, original);
    assert.deepEqual(storedObject(savedClip.thumbnail_object_name), state.jpeg);
    assert.equal(state.saves[0].options.metadata.contentType, "image/jpeg");

    const feedResponse = await fetch(`${baseUrl}/clips/feed`);
    const feed = await feedResponse.json();
    assert.equal(feed.clips[0].thumb, `/api/clips/thumbnail/${clip.id}`);
    assert.equal(feed.clips[0].rights_purpose, "story");
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

  await t.test("declares originals privately and blocks only another citizen's full matching visuals", async () => {
    reset();
    const declaredResponse = await publish(Buffer.from("declared-original"), {
      purpose: "original", originalReference: "  private catalog #42  ",
      rightsHolderName: "  Producer Forty Two  ", rightsHolderRole: "producer",
    });
    assert.equal(declaredResponse.status, 200);
    const declared = (await declaredResponse.json()).clip;
    assert.deepEqual(declared.rights, {
      purpose: "original",
      registrationId: 1,
      registeredAt: "2026-01-02T03:04:05.000Z",
      rightsHolderName: "Producer Forty Two",
      rightsHolderRole: "producer",
      status: "declared",
    });
    assert.equal(state.registrations[0].original_reference, "private catalog #42");
    assert.equal(state.registrations[0].rights_holder_name, "Producer Forty Two");

    state.originals = [{
      user_id: 8, duration_seconds: state.duration,
      visual_signature: { version: 1, frames: ["candidate"] },
    }];
    const rejected = await publish(Buffer.from("transcoded-full-copy"), { userId: 9 });
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).error, /حقوق النشر/);

    state.visualSignature = { version: 1, frames: ["different-visuals"] };
    const allowed = await publish(Buffer.from("same-music-new-visuals"), { userId: 9 });
    assert.equal(allowed.status, 200,
      "same duration does not block a story when its visuals differ; audio is not perceptually compared");
    await allowed.json();
  });

  await t.test("rejects malformed original flags while legacy publishing defaults to story", async () => {
    reset();
    const missing = await publish(Buffer.from("missing-reference"), { purpose: "original" });
    assert.equal(missing.status, 400);
    await missing.json();
    const short = await publish(Buffer.from("short-reference"), {
      purpose: "original", originalReference: " x ",
    });
    assert.equal(short.status, 400);
    await short.json();
    const invalid = await publish(Buffer.from("invalid-purpose"), { purpose: "verified" });
    assert.equal(invalid.status, 400);
    await invalid.json();
    const legacy = await publish(Buffer.from("legacy-story"));
    assert.equal(legacy.status, 200);
    assert.deepEqual((await legacy.json()).clip.rights, { purpose: "story" });
  });

  await t.test("simple direct publishing defers only thumbnail work", async () => {
    reset();
    const response = await publishSimple(Buffer.from("fast-direct-story"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.clip.thumb, null);
    assert.equal(state.thumbnailInput, null, "simple publication does not wait for thumbnail decoding");
    assert.equal(state.clips.get(body.clip.id).thumbnail_object_name, null);
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
    assert.match((await duplicate.json()).error, /Exact-byte duplicate/);
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