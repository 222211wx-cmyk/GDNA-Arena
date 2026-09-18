import assert from "node:assert/strict";
import test from "node:test";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { clipsFixture } from "./helpers/clips-postgres-harness.mjs";

let database;
const originalDir = process.env.PRIVATE_OBJECT_DIR;
test.before(async () => {
  database = await isolatedPostgres();
  process.env.PRIVATE_OBJECT_DIR = "/test-only/objects";
});
test.after(async () => {
  if (originalDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
  else process.env.PRIVATE_OBJECT_DIR = originalDir;
  await database?.close();
});

test("final publication: server code/name, duplicate content allowed, audio and video >=60, no upper duration", async t => {
  const f = await clipsFixture(t, database);
  const input = { userId: 7, filename: "uploaded.mp4", title: "movie.part.one.mp4",
    size: 3, sha256: "same-bytes", contentType: "video/mp4" };
  f.state.objects.set(input.filename, Buffer.from("abc"));
  f.state.duration = 59.999;
  for (const contentType of ["video/mp4", "audio/mpeg"]) {
    await assert.rejects(f.a.publishClip({ ...input, contentType }), /خاص دقيقة الفوق/);
  }
  f.state.duration = 60;
  const first = await f.a.publishClip(input);
  assert.match(first.code, /^HELX-\d{6}$/);
  assert.equal(first.name, "movie.part.one");
  assert.equal(first.duration, 60);
  assert.equal(first.processingStatus, "ready");
  f.state.duration = 90001;
  const second = await f.a.publishClip({ ...input, contentType: "audio/mpeg", purpose: "anything" });
  assert.equal(second.duration, 90001);
  assert.notEqual(first.code, second.code);
  assert.equal((await f.observer.query("SELECT count(*) FROM content_fingerprints")).rows[0].count, "0");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_original_registrations")).rows[0].count, "0");
  const base = await f.http();
  const feed = await (await fetch(`${base}/clips/feed`)).json();
  assert.equal(feed.clips[0].code, second.code);
  assert.equal(feed.clips[0].name, "movie.part.one");
  assert.equal(feed.clips[0].duration, 90001);
});

test("compression: durable reserved output, replica exclusion, deletion fence and atomic URL swap", async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(1);
  await f.observer.query(`UPDATE clips SET code='HELX-123456', size_bytes=2147483648,
    upload_object_name=object_name, processing_status='queued' WHERE id=1`);
  const entered = f.gate(), release = f.gate();
  f.state.compress = async input => {
    assert.equal(input.size, 2147483648, "size is BIGINT, not int32");
    const row = (await f.observer.query("SELECT processing_output_object FROM clips WHERE id=1")).rows[0];
    assert.equal(row.processing_output_object, input.outputFilename, "pending output is durable BEFORE encoder");
    entered.release();
    await release.promise;
    f.state.objects.set(input.outputFilename, Buffer.from("encoded"));
    return { filename: input.outputFilename, contentType: "video/mp4", size: 7 };
  };
  const running = f.track(f.a.runClipCompressionBatch());
  await entered.promise;
  assert.equal(await f.b.runClipCompressionBatch(), 0);
  const base = await f.http(f.b);
  assert.equal((await fetch(`${base}/clips/1`, { method: "DELETE", headers: { "x-test-user": "7" } })).status, 409);
  const erasure = await f.observer.connect();
  try {
    await erasure.query("BEGIN");
    await assert.rejects(f.b.deleteAccountClips(erasure, 7), error => error.status === 409);
    await erasure.query("ROLLBACK");
  } finally { erasure.release(); }
  assert.equal((await f.observer.query("SELECT object_name FROM clips WHERE id=1")).rows[0].object_name, clip.objectName);
  release.release();
  assert.equal(await running, 1);
  const row = (await f.observer.query("SELECT * FROM clips WHERE id=1")).rows[0];
  assert.match(row.object_name, /^clip_compressed_/);
  assert.equal(row.code, "HELX-123456");
  assert.equal(row.duration_sec, 61);
  assert.equal(row.processing_status, "ready");
  assert.equal(row.processing_output_object, null);
  assert.equal(row.upload_object_name, clip.objectName);
  const queued = (await f.observer.query("SELECT object_name FROM clip_storage_cleanup")).rows;
  assert.ok(!queued.some(row => row.object_name === clip.objectName), "compression never queues original deletion");
  await f.a.runClipStorageCleanupBatch();
  assert.ok(f.state.objects.has(clip.objectName), "original remains intact after all background cleanup");
  // Even a stale outbox row from an earlier implementation must not override a
  // surviving original reference.
  await f.observer.query("INSERT INTO clip_storage_cleanup (object_name,clip_id) VALUES ($1,1)", [clip.objectName]);
  assert.equal(await f.a.runClipStorageCleanupBatch(), 0);
  assert.ok(f.state.objects.has(clip.objectName));
  assert.equal((await fetch(`${base}/clips/1`, { method: "DELETE", headers: { "x-test-user": "7" } })).status, 204);
  assert.equal(f.state.objects.has(clip.objectName), false, "explicit owner deletion releases original");
  assert.equal(f.state.objects.has(row.object_name), false, "explicit owner deletion releases derived playback");
});

test("explicit account erasure queues original and derived bytes only for its owner", async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(1);
  const derived = "clip_compressed_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4";
  f.state.objects.set(derived, Buffer.from("encoded"));
  await f.observer.query("UPDATE clips SET upload_object_name=object_name, object_name=$1 WHERE id=1", [derived]);
  const client = await f.observer.connect();
  try {
    await client.query("BEGIN");
    await f.a.deleteAccountClips(client, 8);
    await client.query("COMMIT");
    assert.equal((await f.observer.query("SELECT count(*) FROM clips")).rows[0].count, "1");
    await client.query("BEGIN");
    await f.a.deleteAccountClips(client, 7);
    await client.query("COMMIT");
  } finally { client.release(); }
  assert.equal((await f.observer.query("SELECT count(*) FROM clips")).rows[0].count, "0");
  assert.ok(f.state.objects.has(clip.objectName), "storage work only follows the committed deletion");
  await f.a.runClipStorageCleanupBatch();
  assert.equal(f.state.objects.has(clip.objectName), false);
  assert.equal(f.state.objects.has(derived), false);
  await f.observer.query("UPDATE users SET password_hash='DELETED' WHERE id=7");
  f.state.objects.set("after-erasure.mp4", Buffer.from("abc"));
  await assert.rejects(f.a.publishClip({
    userId: 7, filename: "after-erasure.mp4", title: "after.mp4", contentType: "video/mp4", size: 3, sha256: "",
  }), error => error.status === 401);
});

test("compression failure/backoff survives a new replica; no-benefit completes without retry", async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(1);
  await f.observer.query(`UPDATE clips SET processing_status='queued', size_bytes=110000000 WHERE id=1`);
  f.state.compress = async () => { throw Error("Encoder unavailable"); };
  assert.equal(await f.a.runClipCompressionBatch(), 0);
  let row = (await f.observer.query("SELECT * FROM clips WHERE id=1")).rows[0];
  assert.equal(row.processing_status, "queued");
  assert.equal(row.processing_attempts, 1);
  assert.equal(row.object_name, clip.objectName);
  const fresh = await f.freshReplica();
  assert.equal(await fresh.runClipCompressionBatch(), 0);
  await f.observer.query("UPDATE clips SET processing_retry_at=NOW()-INTERVAL '1 minute' WHERE id=1");
  f.state.compress = async () => null;
  assert.equal(await fresh.runClipCompressionBatch(), 1);
  row = (await f.observer.query("SELECT * FROM clips WHERE id=1")).rows[0];
  assert.equal(row.processing_status, "unchanged");
  assert.equal(row.object_name, clip.objectName);
  assert.equal(await fresh.runClipCompressionBatch(), 0);
});