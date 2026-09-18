import assert from "node:assert/strict";
import test from "node:test";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { clipsFixture, eventually } from "./helpers/clips-postgres-harness.mjs";

// This suite uses a private PostgreSQL cluster and an in-memory object bucket.
// Route and worker SQL are the production implementations bundled unchanged.
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
    } finally {
      await database.close();
    }
  }
});

function remove(base, id, user = 7) {
  return fetch(`${base}/clips/${id}`, {
    method: "DELETE",
    headers: { "x-test-user": String(user) },
    signal: AbortSignal.timeout(15000),
  });
}

async function cleanupRows(f) {
  return (await f.observer.query(`
    SELECT object_name,clip_id,attempts,retry_at,created_at
    FROM clip_storage_cleanup ORDER BY object_name
  `)).rows;
}

test("DELETE durably enqueues three distinct names and retries each independently", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(100, { thumbnailObjectName: "stored_poster_100.jpg" });
  f.state.objects.set(clip.posterName, Buffer.from("deterministic-candidate"));
  const names = [clip.objectName, clip.thumbnailObjectName, clip.posterName];
  const failBefore = clip.thumbnailObjectName;
  const loseResponse = clip.posterName;
  f.state.beforeDelete = async name => {
    if (name === failBefore) throw new Error("storage outage before delete");
  };
  f.state.afterDelete = async name => {
    if (name === loseResponse) throw new Error("lost response after successful delete");
  };

  const base = await f.http();
  assert.equal((await remove(base, clip.id)).status, 204);
  await eventually(async () => (await cleanupRows(f)).length === 2,
    "the two failed acknowledgements must remain queued");

  assert.equal(f.state.objects.has(clip.objectName), false);
  assert.equal(f.state.objects.has(failBefore), true);
  assert.equal(f.state.objects.has(loseResponse), false);
  assert.deepEqual((await cleanupRows(f)).map(row => row.object_name).sort(),
    [failBefore, loseResponse].sort());
  assert.deepEqual(
    f.state.deleteCalls.map(call => call.key).sort(),
    names.slice().sort(),
    "all deduplicated names are attempted even when siblings fail",
  );
  assert.ok(f.state.deleteCalls.every(call => call.options?.ignoreNotFound === true));

  f.state.beforeDelete = async () => {};
  f.state.afterDelete = async () => {};
  await f.observer.query("UPDATE clip_storage_cleanup SET retry_at=NOW()-INTERVAL '1 second'");
  assert.equal(await f.b.runClipStorageCleanupBatch(clip.id), 2);
  assert.deepEqual(await cleanupRows(f), []);
  assert.equal(f.state.objects.size, 0);
});

test("outage backoff persists across fresh replicas and destroyed database sessions without a retry cap", { timeout: 30000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(110, { thumbnailObjectName: "stored_poster_110.jpg" });
  f.state.objects.set(clip.posterName, Buffer.from("candidate"));
  const rights = (await f.observer.query(
    "SELECT * FROM content_fingerprints ORDER BY fingerprint",
  )).rows;
  f.state.beforeDelete = async () => { throw new Error("bucket unavailable"); };

  const base = await f.http();
  assert.equal((await remove(base, clip.id)).status, 204);
  await eventually(async () => {
    const rows = await cleanupRows(f);
    return rows.length === 3 && rows.every(row => row.attempts === 1);
  }, "the immediate best-effort pass must persist its claims");

  const fresh = await f.freshReplica();
  assert.equal(await fresh.runClipStorageCleanupBatch(clip.id), 0,
    "a newly loaded replica respects persisted retry_at");

  for (let attempt = 1; attempt <= 11; attempt++) {
    const rows = await cleanupRows(f);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.attempts === attempt));
    const expected = Math.min(300 * 2 ** (attempt - 1), 24 * 60 * 60);
    for (const row of rows) {
      const seconds = (row.retry_at.getTime() - Date.now()) / 1000;
      assert.ok(seconds <= expected && seconds > expected - 8,
        `attempt ${attempt} should persist approximately ${expected}s; got ${seconds}`);
    }
    assert.equal((await f.observer.query("SELECT count(*) FROM clips")).rows[0].count, "0");
    assert.deepEqual(
      (await f.observer.query("SELECT * FROM content_fingerprints ORDER BY fingerprint")).rows,
      rights,
    );
    if (attempt === 11) break;

    // Destroy a real backend between attempts; eligibility is database state,
    // not module memory or a pooled session.
    const connection = await fresh.pool.connect();
    await connection.query("SELECT pg_backend_pid()");
    connection.release(true);
    await f.observer.query(`
      UPDATE clip_storage_cleanup SET retry_at=NOW()-INTERVAL '1 second'
      WHERE clip_id=$1
    `, [clip.id]);
    assert.equal(await fresh.runClipStorageCleanupBatch(clip.id), 0);
  }
  assert.equal(f.state.objects.size, 3);
  f.state.beforeDelete = async () => {};
  await f.observer.query("UPDATE clip_storage_cleanup SET retry_at=NOW()-INTERVAL '1 second'");
  const recovered = await f.freshReplica();
  assert.equal(await recovered.runClipStorageCleanupBatch(), 3);
  assert.deepEqual(await cleanupRows(f), []);
  assert.equal(f.state.objects.size, 0);
  assert.equal(await recovered.runClipThumbnailRetryBatch(), 0, "deleted clips cannot be regenerated");
  assert.deepEqual(
    (await f.observer.query("SELECT * FROM content_fingerprints ORDER BY fingerprint")).rows,
    rights,
  );
});

test("restart after storage success but failed database acknowledgement finishes cleanup", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(115);
  const rights = (await f.observer.query("SELECT * FROM content_fingerprints")).rows;
  await f.observer.query(`
    CREATE FUNCTION reject_cleanup_ack() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'intentional acknowledgement failure'; END $$;
    CREATE TRIGGER reject_cleanup_ack BEFORE DELETE ON clip_storage_cleanup
    FOR EACH STATEMENT EXECUTE FUNCTION reject_cleanup_ack();
  `);
  const base = await f.http();
  assert.equal((await remove(base, clip.id)).status, 204, "committed deletion still succeeds");
  const queued = await cleanupRows(f);
  assert.equal(queued.length, 2);
  assert.equal(queued.find(row => row.object_name === clip.objectName).attempts, 1);
  assert.equal(f.state.objects.has(clip.objectName), false, "storage succeeded before DB failure");
  assert.equal((await f.observer.query("SELECT * FROM clips")).rowCount, 0);

  await f.observer.query("DROP TRIGGER reject_cleanup_ack ON clip_storage_cleanup");
  const fresh = await f.freshReplica();
  assert.equal(await fresh.runClipStorageCleanupBatch(), 1, "unattempted candidate is still due");
  assert.equal((await cleanupRows(f)).length, 1, "failed ack retains its persisted backoff");
  await f.observer.query("UPDATE clip_storage_cleanup SET retry_at=NOW()-INTERVAL '1 second'");
  assert.equal(await fresh.runClipStorageCleanupBatch(), 1, "missing original is safely re-deleted");
  assert.deepEqual(await cleanupRows(f), []);
  assert.equal(await fresh.runClipThumbnailRetryBatch(), 0);
  assert.deepEqual((await f.observer.query("SELECT * FROM content_fingerprints")).rows, rights);
});

test("already-missing objects are acknowledged idempotently and duplicate names are enqueued once", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(120);
  await f.observer.query(
    "UPDATE clips SET thumbnail_object_name=object_name WHERE id=$1",
    [clip.id],
  );
  f.state.objects.set(clip.posterName, Buffer.from("candidate"));
  f.state.objects.clear();

  const base = await f.http();
  assert.equal((await remove(base, clip.id)).status, 204);
  await eventually(async () => (await cleanupRows(f)).length === 0,
    "ignoreNotFound deletes should clear every queue row");
  assert.equal(f.state.deleteCalls.length, 2);
  assert.deepEqual(
    f.state.deleteCalls.map(call => call.key).sort(),
    [clip.objectName, clip.posterName].sort(),
  );
  assert.ok(f.state.deleteCalls.every(call => call.options?.ignoreNotFound === true));
  assert.equal(await f.b.runClipStorageCleanupBatch(clip.id), 0);
  assert.equal(f.state.deleteCalls.length, 2, "acknowledged work is not processed twice");
});

test("concurrent replicas claim disjoint bounded batches", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const names = Array.from({ length: 24 }, (_, index) => `queued_${String(index).padStart(2, "0")}.bin`);
  await f.observer.query(`
    INSERT INTO clip_storage_cleanup (object_name,clip_id,retry_at)
    SELECT object_name,700,NOW()-INTERVAL '1 second' FROM unnest($1::text[]) object_name
  `, [names]);
  for (const name of names) f.state.objects.set(name, Buffer.from(name));

  const entered = f.gate();
  const release = f.gate();
  let blocked = false;
  const calls = new Map();
  f.state.beforeDelete = async name => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    if (!blocked) {
      blocked = true;
      entered.release();
      await release.promise;
    }
  };
  const first = f.track(f.a.runClipStorageCleanupBatch());
  await entered.promise;
  const second = f.track(f.b.runClipStorageCleanupBatch());
  assert.equal(await second, 12, "the other replica claims the next due batch");
  assert.equal((await cleanupRows(f)).length, 12, "first replica still owns its claimed rows");
  release.release();
  assert.equal(await first, 12);

  assert.deepEqual(await cleanupRows(f), []);
  assert.equal(calls.size, 24);
  assert.ok([...calls.values()].every(count => count === 1),
    "SKIP LOCKED claims never process one object in both replicas");
  assert.equal(f.state.objects.size, 0);
});

test("queue insertion failure rolls back clip and dependent-row deletion atomically", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(130, { thumbnailObjectName: "stored_poster_130.jpg" });
  await f.observer.query("INSERT INTO clip_views (clip_id,viewer_ip) VALUES (130,'rollback-viewer')");
  await f.observer.query(`
    CREATE FUNCTION reject_clip_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'intentional cleanup enqueue rejection'; END $$;
    CREATE TRIGGER reject_clip_cleanup_insert BEFORE INSERT ON clip_storage_cleanup
    FOR EACH STATEMENT EXECUTE FUNCTION reject_clip_cleanup();
  `);

  const base = await f.http();
  assert.equal((await remove(base, clip.id)).status, 500);
  assert.equal((await f.observer.query("SELECT count(*) FROM clips WHERE id=130")).rows[0].count, "1");
  assert.equal((await f.observer.query("SELECT count(*) FROM clip_views WHERE clip_id=130")).rows[0].count, "1");
  assert.deepEqual(await cleanupRows(f), []);
  assert.deepEqual(f.state.deleteCalls, []);
  assert.equal(f.state.objects.has(clip.objectName), true);
});

test("unauthorized and missing deletion never enqueue cleanup", { timeout: 20000 }, async t => {
  const f = await clipsFixture(t, database);
  const clip = await f.seed(140);
  const base = await f.http();

  assert.equal((await remove(base, clip.id, 0)).status, 401);
  assert.equal((await remove(base, clip.id, 8)).status, 403);
  assert.equal((await remove(base, 999, 7)).status, 404);
  assert.deepEqual(await cleanupRows(f), []);
  assert.deepEqual(f.state.deleteCalls, []);
  assert.equal((await f.observer.query("SELECT count(*) FROM clips WHERE id=140")).rows[0].count, "1");
  assert.equal(f.state.objects.has(clip.objectName), true);
});