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
  await assert.rejects(f.a.publishClip({ ...input, size: 2 ** 31 + 1 }),
    error => error.status === 413 && /2 GiB/.test(error.message));
  f.state.objects.set(input.filename, Buffer.from("abc"));
  f.state.duration = 59.999;
  for (const contentType of ["video/mp4", "audio/mpeg"]) {
    await assert.rejects(f.a.publishClip({ ...input, contentType }), /خاص دقيقة الفوق/);
  }
  f.state.duration = 60;
  const first = await f.a.publishClip({ ...input, displayTitle: "  اسم/نسخة.v1  " });
  assert.match(first.code, /^HELX-\d{6}$/);
  assert.equal(first.name, "اسم/نسخة.v1");
  assert.equal(first.duration, 60);
  assert.equal(first.processingStatus, "queued");
  assert.equal((await f.observer.query("SELECT original_name FROM clips WHERE id=$1", [first.id])).rows[0].original_name, "movie.part.one.mp4");
  await assert.rejects(
    f.a.publishClip({ ...input, displayTitle: " ".repeat(3) }),
    error => error.status === 400 && /blank/.test(error.message),
  );
  await assert.rejects(
    f.a.publishClip({ ...input, displayTitle: "ع".repeat(121) }),
    error => error.status === 400 && /120/.test(error.message),
  );
  await assert.rejects(
    f.a.publishClip({ ...input, displayTitle: 42 }),
    error => error.status === 400 && /text/.test(error.message),
  );
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

test("clip saves persist across sessions, shares are auth-bound and idempotent, and search keeps cursors", async t => {
  const f = await clipsFixture(t, database);
  await f.seed(1);
  await f.seed(2);
  await f.observer.query(
    `UPDATE clips SET title=CASE id WHEN 1 THEN 'Ocean Signal' ELSE 'Desert Echo' END,
       code=CASE id WHEN 1 THEN 'HELX-100001' ELSE 'HELX-100002' END,
       processing_status='queued'`,
  );
  const base = await f.http();

  assert.equal((await fetch(`${base}/clips/1/save`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/clips/1/share`, { method: "POST" })).status, 401);

  const save = await (await fetch(`${base}/clips/1/save`, {
    method: "POST", headers: { "x-test-user": "7" },
  })).json();
  assert.deepEqual(save, { saved: true, saveCount: 1 });

  // A new HTTP request represents a fresh session backed by the same citizen id.
  const persisted = await (await fetch(`${base}/clips/1/engagement`, {
    headers: { "x-test-user": "7" },
  })).json();
  assert.equal(persisted.engagement.saved, true);
  assert.equal(persisted.engagement.saveCount, 1);
  const otherCitizen = await (await fetch(`${base}/clips/1/engagement`, {
    headers: { "x-test-user": "8" },
  })).json();
  assert.equal(otherCitizen.engagement.saved, false);
  assert.equal(otherCitizen.engagement.saveCount, 1);

  for (let attempt = 0; attempt < 2; attempt++) {
    const shared = await (await fetch(`${base}/clips/1/share`, {
      method: "POST", headers: { "x-test-user": "7" },
    })).json();
    assert.deepEqual(shared, { shared: true, shareCount: 1 });
  }
  const secondCitizenShare = await (await fetch(`${base}/clips/1/share`, {
    method: "POST", headers: { "x-test-user": "8" },
  })).json();
  assert.deepEqual(secondCitizenShare, { shared: true, shareCount: 2 });

  const search = await (await fetch(`${base}/clips/feed?q=ocean&limit=1`)).json();
  assert.equal(search.clips.length, 1);
  assert.equal(search.clips[0].id, 1);
  assert.deepEqual(search.clips[0].author, {
    id: 7, username: "fixture-owner", avatarUrl: null,
  });
  assert.equal(search.clips[0].saveCount, 1);
  assert.equal(search.clips[0].shareCount, 2);
  assert.equal(search.clips[0].saved, false);
  assert.equal(search.hasMore, false);

  const firstPage = await (await fetch(`${base}/clips/feed?q=fixture-owner&limit=1`)).json();
  assert.equal(firstPage.clips[0].id, 2);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextBefore, 2);
  const secondPage = await (await fetch(
    `${base}/clips/feed?q=fixture-owner&limit=1&before=${firstPage.nextBefore}`,
  )).json();
  assert.equal(secondPage.clips[0].id, 1);

  const byCode = await (await fetch(`${base}/clip/by-code/HELX-100001`, {
    headers: { "x-test-user": "7" },
  })).json();
  assert.equal(byCode.clip.saved, true);
  assert.equal(byCode.clip.saveCount, 1);
  assert.equal(byCode.clip.shareCount, 2);

  await f.observer.query("UPDATE clips SET is_frozen=TRUE WHERE id=1");
  assert.equal((await fetch(`${base}/clips/1/engagement`)).status, 404);
  assert.equal((await fetch(`${base}/clip/by-code/HELX-100001`)).status, 404);
  assert.equal((await fetch(`${base}/clips/1/save`, {
    method: "POST", headers: { "x-test-user": "7" },
  })).status, 404);
  assert.equal((await fetch(`${base}/clips/1/share`, {
    method: "POST", headers: { "x-test-user": "7" },
  })).status, 404);
  const frozenSearch = await (await fetch(`${base}/clips/feed?q=Ocean`)).json();
  assert.equal(frozenSearch.clips.length, 0);
});

test("compression: durable reserved output, replica exclusion, deletion fence and atomic URL swap", async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(1);
  await f.observer.query(`UPDATE clips SET code='HELX-123456', size_bytes=2147483648,
    upload_object_name=object_name, processing_status='queued' WHERE id=1`);
  const entered = f.gate(), release = f.gate();
  f.state.compress = async input => {
    assert.equal(input.force, true, "every new job transcodes, including small uploads");
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
  await f.seed(2);
  await f.observer.query("UPDATE clips SET user_id=8,username='other-owner' WHERE id=2");
  await f.observer.query("INSERT INTO clip_bookmarks (clip_id,user_id) VALUES (2,7),(2,8)");
  await f.observer.query("INSERT INTO clip_shares (clip_id,user_id) VALUES (2,7),(2,8)");
  const derived = "clip_compressed_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4";
  f.state.objects.set(derived, Buffer.from("encoded"));
  await f.observer.query("UPDATE clips SET upload_object_name=object_name, object_name=$1 WHERE id=1", [derived]);
  const client = await f.observer.connect();
  try {
    await client.query("BEGIN");
    await f.a.deleteAccountClips(client, 9);
    await client.query("COMMIT");
    assert.equal((await f.observer.query("SELECT count(*) FROM clips")).rows[0].count, "2");
    await client.query("BEGIN");
    await f.a.deleteAccountClips(client, 7);
    await client.query("COMMIT");
  } finally { client.release(); }
  assert.equal((await f.observer.query("SELECT count(*) FROM clips WHERE user_id=7")).rows[0].count, "0");
  assert.equal((await f.observer.query("SELECT count(*) FROM clips WHERE user_id=8")).rows[0].count, "1");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_bookmarks WHERE user_id=7")).rows[0].count, "0");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_shares WHERE user_id=7")).rows[0].count, "0");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_bookmarks WHERE user_id=8")).rows[0].count, "1");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_shares WHERE user_id=8")).rows[0].count, "1");
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