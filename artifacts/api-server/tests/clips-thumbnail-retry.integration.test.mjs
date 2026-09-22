import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { clipsFixture, eventually } from "./helpers/clips-postgres-harness.mjs";

// No live API, object bucket, DATABASE_URL, or production fixtures are used.
let database;
const originalObjectDir = process.env.PRIVATE_OBJECT_DIR;
test.before(async () => {
  database = await isolatedPostgres();
  process.env.PRIVATE_OBJECT_DIR = "/test-only/objects";
});
test.after(async () => {
  if (originalObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
  else process.env.PRIVATE_OBJECT_DIR = originalObjectDir;
  if (database) {
    try {
      const leaked = await database.admin.query(
        "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'clip_retry_%'",
      );
      assert.deepEqual(leaked.rows, [], "all temporary schemas must be removed");
    } finally { await database.close(); }
  }
});

test("new WebP posters persist and stream correct MIME while legacy JPEG remains unchanged", async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(501);
  const legacy = await f.seed(502, { thumbnailObjectName: "thumb_historical.jpg" });
  const encode = codec => {
    const result = spawnSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32",
      "-frames:v", "1", "-threads", "1", "-c:v", codec, "-f", "image2pipe", "pipe:1",
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const webp = encode("libwebp");
  const jpeg = encode("mjpeg");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  f.state.generate = async () => webp;
  f.state.objects.set(legacy.thumbnailObjectName, jpeg);
  assert.equal(await f.a.runClipThumbnailRetryBatch(), 1);
  assert.match(clip.posterName, /\.webp$/);
  assert.match(clip.legacyPosterName, /\.jpg$/);
  assert.notEqual(clip.posterName, clip.legacyPosterName);
  assert.equal(f.state.writeMetadata.get(clip.posterName).contentType, "image/webp");
  const base = await f.http();
  for (const [id, mime, bytes] of [[501, "image/webp", webp], [502, "image/jpeg", jpeg]]) {
    const response = await fetch(`${base}/clips/thumbnail/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  assert.deepEqual(f.state.writes, [clip.posterName], "legacy JPEG must never be overwritten");
});

test("separate replicas exclude one another using a real advisory lock, then hand off", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(1);
  const writing = f.gate();
  const release = f.gate();
  f.state.beforeWrite = async () => { writing.release(); await release.promise; };
  const first = f.track(f.a.runClipThumbnailRetryBatch());
  await writing.promise;
  const locks = await f.observer.query(`
    SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a USING (pid)
    WHERE l.locktype='advisory' AND l.granted AND a.application_name=$1
  `, [f.a.label]);
  assert.equal(locks.rowCount, 1, "first replica must really own the advisory lock");
  assert.equal(await f.b.runClipThumbnailRetryBatch(), 0);
  assert.equal(f.state.generations.length, 1, "losing replica must not generate");
  assert.equal((await f.observer.query(
    "SELECT thumbnail_retry_attempts FROM clips WHERE id=1",
  )).rows[0].thumbnail_retry_attempts, 1, "losing replica must not reserve work");
  const replicaB = await f.b.pool.query("SELECT pg_backend_pid() AS pid");
  assert.notEqual(replicaB.rows[0].pid, locks.rows[0].pid);

  release.release();
  assert.equal(await first, 1);
  assert.ok(f.state.objects.has(clip.posterName));
  await f.seed(2);
  assert.equal(await f.b.runClipThumbnailRetryBatch(), 1, "lock released for next replica");
  assert.equal(await f.a.runClipThumbnailRetryBatch(), 0, "published posters are not retried");
  assert.equal(f.state.writes.length, 2);
});

test("FOR UPDATE SKIP LOCKED bypasses a locked oldest row without consuming its attempt", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  await f.seed(10);
  await f.seed(11);
  const blocker = await f.observer.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM clips WHERE id=10 FOR UPDATE");
    assert.equal(await f.a.runClipThumbnailRetryBatch(), 1,
      "worker must process the unlocked row while the oldest remains locked");
    const { rows } = await f.observer.query(
      "SELECT id,thumbnail_retry_attempts,thumbnail_object_name FROM clips ORDER BY id",
    );
    assert.equal(rows[0].thumbnail_retry_attempts, 0);
    assert.equal(rows[0].thumbnail_object_name, null);
    assert.equal(rows[1].thumbnail_retry_attempts, 1);
    assert.ok(rows[1].thumbnail_object_name);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  assert.equal(await f.b.runClipThumbnailRetryBatch(), 1, "released row becomes eligible");
});

test("failed generation backoff survives real disconnects, doubles, and stops after eight attempts", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(20);
  await f.seed(21);
  await f.observer.query("UPDATE clips SET is_frozen=TRUE WHERE id=21");
  const rights = (await f.observer.query("SELECT * FROM content_fingerprints ORDER BY fingerprint")).rows;
  f.state.generate = async () => { throw new Error("intentional media failure"); };
  const pids = new Set();
  for (let attempt = 1; attempt <= 8; attempt++) {
    assert.equal(await f.a.runClipThumbnailRetryBatch(), 0);
    const before = (await f.observer.query(`
      SELECT thumbnail_retry_attempts, thumbnail_retry_at, thumbnail_object_name,
        EXTRACT(EPOCH FROM (thumbnail_retry_at - NOW()))::float AS seconds
      FROM clips WHERE id=20
    `)).rows[0];
    assert.equal(before.thumbnail_retry_attempts, attempt);
    assert.equal(before.thumbnail_object_name, null);
    const delay = 300 * 2 ** (attempt - 1);
    assert.ok(before.seconds <= delay && before.seconds > delay - 5,
      `attempt ${attempt} persists ${delay}s backoff; got ${before.seconds}`);
    // Destroy the actual worker connection, rather than merely release to pool.
    const old = await f.a.pool.connect();
    pids.add((await old.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    old.release(true);
    assert.equal(pids.size, attempt, "each attempt uses a new PostgreSQL backend");
    assert.equal(await f.b.runClipThumbnailRetryBatch(), 0, "another replica respects persisted backoff");
    assert.equal(await f.a.runClipThumbnailRetryBatch(), 0, "reconnected worker respects persisted backoff");
    const after = (await f.observer.query(`
      SELECT thumbnail_retry_attempts, thumbnail_retry_at FROM clips WHERE id=20
    `)).rows[0];
    assert.equal(after.thumbnail_retry_attempts, attempt);
    assert.equal(after.thumbnail_retry_at.getTime(), before.thumbnail_retry_at.getTime());
    // Advance eligibility in the fixture, not the worker's SQL or clock.
    await f.observer.query("UPDATE clips SET thumbnail_retry_at=NOW()-INTERVAL '1 second' WHERE id=20");
  }
  assert.equal(await f.b.runClipThumbnailRetryBatch(), 0, "exhausted clip is not claimed even when due");
  assert.equal(f.state.generations.length, 8);
  assert.equal((await f.observer.query(
    "SELECT thumbnail_retry_attempts FROM clips WHERE id=21",
  )).rows[0].thumbnail_retry_attempts, 0);
  assert.deepEqual(f.state.objects.get(clip.objectName), Buffer.from("original-20"));
  assert.deepEqual(f.state.deletes, []);
  assert.deepEqual((await f.observer.query("SELECT * FROM content_fingerprints ORDER BY fingerprint")).rows, rights);
});

test("DELETE blocks on publication, then removes original and poster but preserves rights", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(30);
  await f.observer.query("INSERT INTO clip_views (clip_id,viewer_ip) VALUES (30,'fixture-viewer')");
  const rights = (await f.observer.query("SELECT * FROM content_fingerprints")).rows;
  const writing = f.gate();
  const release = f.gate();
  f.state.beforeWrite = async () => { writing.release(); await release.promise; };
  const base = await f.http(f.b);
  const worker = f.track(f.a.runClipThumbnailRetryBatch());
  await writing.promise;
  let settled = false;
  const deletion = f.track(fetch(`${base}/clips/30`, {
    method: "DELETE", headers: { "x-test-user": "7" },
    signal: AbortSignal.timeout(10000),
  }).then(response => { settled = true; return response; }));
  // Observe PostgreSQL's actual wait graph, not an arbitrary sleep or mock flag.
  await eventually(async () => {
    const wait = await f.observer.query(`
      SELECT d.pid, w.pid AS worker_pid FROM pg_stat_activity d
      JOIN pg_stat_activity w ON w.pid=ANY(pg_blocking_pids(d.pid))
      WHERE d.application_name=$1 AND w.application_name=$2 AND d.wait_event_type='Lock'
    `, [f.b.label, f.a.label]);
    if (!wait.rowCount) return false;
    assert.notEqual(wait.rows[0].pid, wait.rows[0].worker_pid);
    return true;
  }, "DELETE must wait on the worker's row lock in a separate backend");
  assert.equal(settled, false);
  assert.equal(f.state.objects.has(clip.objectName), true);
  assert.equal(f.state.objects.has(clip.posterName), false);
  assert.deepEqual(f.state.deletes, []);
  release.release();
  assert.equal(await worker, 1);
  assert.equal((await deletion).status, 204);
  await eventually(() => f.state.deletes.length === 3, "original and both thumbnail formats must be removed");
  assert.deepEqual(f.state.writes, [clip.posterName], "publication must complete before deletion");
  assert.deepEqual([...f.state.deletes].sort(), [clip.objectName, clip.posterName, clip.legacyPosterName].sort());
  assert.equal(f.state.objects.size, 0);
  assert.equal((await f.observer.query("SELECT * FROM clips")).rowCount, 0);
  assert.equal((await f.observer.query("SELECT * FROM clip_views")).rowCount, 0);
  assert.deepEqual((await f.observer.query("SELECT * FROM content_fingerprints")).rows, rights);
  assert.equal(await f.a.runClipThumbnailRetryBatch(), 0, "no later retry recreates a deleted poster");
  assert.equal(f.state.objects.size, 0);
});

test("DELETE rejects non-owners, handles missing clips, and allows admins without deleting rights", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(40);
  const base = await f.http();
  const remove = (id, user) => fetch(`${base}/clips/${id}`, {
    method: "DELETE", headers: { "x-test-user": String(user) },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await remove(40, 0)).status, 401);
  assert.equal((await remove(40, 8)).status, 403);
  assert.equal((await remove(999, 7)).status, 404);
  assert.equal((await f.observer.query("SELECT * FROM clips")).rowCount, 1);
  assert.equal(f.state.objects.has(clip.objectName), true);
  assert.deepEqual(f.state.deletes, []);
  // A failed publication may leave this stable candidate without a DB pointer.
  f.state.objects.set(clip.posterName, Buffer.from("interrupted-publication"));
  assert.equal((await remove(40, 9)).status, 204);
  assert.equal((await f.observer.query("SELECT * FROM clips")).rowCount, 0);
  assert.equal((await f.observer.query("SELECT * FROM content_fingerprints")).rowCount, 1);
  assert.equal(f.state.objects.size, 0);
  assert.deepEqual([...f.state.deletes].sort(), [clip.objectName, clip.posterName, clip.legacyPosterName].sort());
});

test("repaired routes keep feed, retitle, streaming, and view accounting separate", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  await f.seed(50);
  const base = await f.http();
  const feed = await fetch(`${base}/clips/feed`);
  assert.equal(feed.status, 200);
  assert.equal((await feed.json()).clips[0].id, 50);
  // Express JSON middleware is deliberately installed by this test's app harness.
  const retitle = await fetch(`${base}/clips/50`, {
    method: "PATCH", headers: { "x-test-user": "7", "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Retitled fixture" }),
  });
  assert.equal(retitle.status, 200);
  assert.equal((await retitle.json()).clip.title, "Retitled fixture");
  const stream = await fetch(`${base}/clips/stream/50`, { headers: { Range: "bytes=0-3" } });
  assert.equal(stream.status, 206);
  assert.equal(stream.headers.get("content-range"), "bytes 0-3/11");
  assert.equal(await stream.text(), "orig");
  const head = await fetch(`${base}/clips/stream/50?download=1`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "11");
  assert.match(head.headers.get("content-disposition"), /attachment; filename="clip-50.mp4"/);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(`${base}/clips/stream/50`, {
    headers: { Range: "bytes=999-1000" },
  })).status, 416);
  for (let n = 0; n < 2; n++) {
    const view = await fetch(`${base}/clips/50/view`, { method: "POST" });
    assert.equal(view.status, 200);
    assert.deepEqual(await view.json(), { views: 1 }, "same viewer is counted only once");
  }
  assert.equal((await f.observer.query("SELECT earnings FROM clips WHERE id=50")).rows[0].earnings, "0.0100");
  await f.observer.query("UPDATE clips SET is_frozen=TRUE WHERE id=50");
  assert.equal((await fetch(`${base}/clips/stream/50`)).status, 404);
});