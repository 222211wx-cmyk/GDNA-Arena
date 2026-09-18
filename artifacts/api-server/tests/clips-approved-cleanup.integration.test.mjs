import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import pg from "pg";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

let database;
let pool;
let runApprovedClipCleanup;
let getApprovedClipCleanupStatus;
let statusCli;
let retryThumbnailName;
let sha256;
let temp;
const pools = [];
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const old = () => new Date(Date.now() - 60 * 86_400_000).toISOString();
const name = (digit, kind = "clip", extension = kind === "clip" ? "mp4" : "jpg") =>
  `${kind}_${digit.repeat(32)}.${extension}`;
const exact = (objectName, overrides = {}) => ({
  name: objectName, generation: "11", metageneration: "2", size: "100",
  timeCreated: old(), updated: old(), ...overrides,
});

test.before(async () => {
  database = await isolatedPostgres();
  pool = new pg.Pool({ ...database.config, max: 8, options: "-c statement_timeout=10000 -c lock_timeout=7000" });
  pools.push(pool);
  await pool.query(`
    CREATE TABLE public.clips (
      id integer PRIMARY KEY, object_name text NOT NULL,
      thumbnail_object_name text, is_frozen boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.clip_storage_cleanup (
      object_name text PRIMARY KEY, clip_id integer, attempts integer NOT NULL DEFAULT 0,
      retry_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.content_fingerprints (
      fingerprint text PRIMARY KEY, content_type text NOT NULL,
      content_id integer NOT NULL, owner_name text NOT NULL
    );
  `);
  const sql = await readFile(new URL("../docs/clip-storage-cleanup-setup.sql", import.meta.url), "utf8");
  await pool.query(sql);
  temp = await mkdtemp(path.join(os.tmpdir(), "approved-cleanup-pg-"));
  const entry = path.join(temp, "entry.ts");
  const output = path.join(temp, "entry.mjs");
  const apiRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  await writeFile(entry, `
    export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-approved-cleanup.ts"))};
    export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-cleanup-approval.ts"))};
    export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-storage-names.ts"))};
    export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-approved-cleanup-status.ts"))};
  `);
  await build({
    entryPoints: [entry], outfile: output, bundle: true, platform: "node",
    format: "esm", logLevel: "silent", external: ["pg"],
  });
  ({ runApprovedClipCleanup, getApprovedClipCleanupStatus, retryThumbnailName, sha256 } =
    await import(pathToFileURL(output).href));
  // Any import of the executor or storage in status mode fails the subprocess.
  // The status command must work without even initializing these capabilities.
  statusCli = path.join(apiRoot, `.status-cli-test-${randomUUID()}.mjs`);
  await build({
    entryPoints: [path.join(apiRoot, "src/cli/clip-storage-cleanup-approved.ts")],
    outfile: statusCli, bundle: true, platform: "node", format: "esm",
    packages: "external", logLevel: "silent",
    plugins: [{
      name: "forbid-status-storage-and-executor",
      setup(b) {
        b.onLoad({ filter: /\/(?:clip-storage|clip-approved-cleanup|clip-approved-cleanup-gcs)\.ts$/ }, () => ({
          contents: `throw new Error("STORAGE_OR_EXECUTOR_LOADED");
            export const clipFile = () => { throw new Error("STORAGE_CALLED"); };
            export const runApprovedClipCleanup = () => { throw new Error("EXECUTOR_CALLED"); };
            export const approvedCleanupStorage = () => { throw new Error("STORAGE_CALLED"); };`,
          loader: "js",
        }));
      },
    }],
  });
});

test.after(async () => {
  await Promise.all(pools.map(value => value.end()));
  await database?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
  if (statusCli) await rm(statusCli, { force: true });
});

async function fixture() {
  await pool.query(`
    TRUNCATE clips,clip_storage_cleanup,content_fingerprints,
      clip_orphan_cleanup_audit,clip_orphan_cleanup RESTART IDENTITY;
    DELETE FROM clip_storage_owner;
  `);
  const owner = {
    database_id: randomUUID(), database_name: database.config.database,
    bucket: "test-private-bucket", prefix: "integration/clips/",
    marker_name: "integration/.owner", marker_generation: "71",
    approval_public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  await pool.query(`
    INSERT INTO clip_storage_owner
      (singleton,database_id,database_name,bucket,prefix,marker_name,marker_generation,approval_public_key)
    VALUES (true,$1,$2,$3,$4,$5,$6,$7)
  `, [owner.database_id, owner.database_name, owner.bucket, owner.prefix,
    owner.marker_name, owner.marker_generation, owner.approval_public_key]);
  const objects = new Map();
  const calls = [];
  const storage = {
    verifyOwner: async actual => {
      if (actual.marker_name !== owner.marker_name || actual.marker_generation !== owner.marker_generation)
        throw new Error("WRONG_OWNER_MARKER");
    },
    metadata: async objectName => objects.get(objectName) ?? null,
    deleteExact: async object => {
      calls.push({ ...object });
      const current = objects.get(object.name);
      if (!current || current.generation !== object.generation) {
        const error = new Error("generation precondition");
        error.code = "412";
        throw error;
      }
      objects.delete(object.name);
    },
  };
  return { owner, objects, calls, storage };
}

function authorization(f, selected, overrides = {}) {
  const now = Date.now();
  const reportObjects = (overrides.inventory ?? selected).map(object => ({
    ...object, disposition: "candidate", reason: "old-recognized-unreferenced-object",
  }));
  const report = {
    schemaVersion: 1, mode: "read-only-dry-run", complete: true,
    scope: { bucket: f.owner.bucket, prefix: f.owner.prefix },
    ownership: {
      databaseId: f.owner.database_id, databaseName: f.owner.database_name,
      markerGeneration: f.owner.marker_generation,
    },
    startedAt: new Date(now - 30_000).toISOString(),
    generatedAt: new Date(now - 20_000).toISOString(),
    minAgeDays: 30, candidates: reportObjects, inventory: reportObjects,
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const approval = {
    schemaVersion: 1, action: "delete-reviewed-clip-generations",
    approvalId: randomUUID(), approvedBy: "integration operator",
    approvedAt: new Date(now - 10_000).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    reportSha256: sha256(reportBytes), databaseId: f.owner.database_id,
    databaseName: f.owner.database_name, bucket: f.owner.bucket, prefix: f.owner.prefix,
    markerGeneration: f.owner.marker_generation, objects: selected,
    ...overrides.approval,
  };
  const payload = Buffer.from(JSON.stringify(approval));
  const envelopeBytes = Buffer.from(JSON.stringify({
    payload: payload.toString("base64"),
    signature: sign(null, payload, privateKey).toString("base64"),
  }));
  return { reportBytes, envelopeBytes, approval };
}

async function run(f, selected, auth = authorization(f, selected)) {
  return runApprovedClipCleanup({ pool, storage: f.storage, ...auth });
}

test("successful execution writes immutable audit/tombstone state, preserves rights, and never uses ordinary queue", async () => {
  const f = await fixture();
  const object = exact(name("1"));
  f.objects.set(object.name, object);
  await pool.query("INSERT INTO content_fingerprints VALUES ('right-1','clip',99,'owner')");
  assert.deepEqual(await run(f, [object]), {
    approved: 1, deleted: 1, alreadyDeleted: 0, deferred: 0, rejected: 0,
  });
  assert.equal(f.objects.has(object.name), false);
  const tombstone = (await pool.query("SELECT * FROM clip_orphan_cleanup")).rows[0];
  assert.equal(tombstone.state, "deleted");
  assert.equal(tombstone.last_outcome, "generation-deleted");
  assert.deepEqual((await pool.query(
    "SELECT event FROM clip_orphan_cleanup_audit ORDER BY id")).rows.map(row => row.event),
  ["approved", "attempt", "deleted"]);
  assert.equal((await pool.query("SELECT count(*) FROM clip_storage_cleanup")).rows[0].count, "0");
  assert.equal((await pool.query("SELECT count(*) FROM content_fingerprints")).rows[0].count, "1");
  await assert.rejects(pool.query(
    "INSERT INTO clips(id,object_name) VALUES (99,$1)", [object.name]),
  /reserved by reviewed orphan cleanup/);
  await pool.query("INSERT INTO clips(id,object_name) VALUES (99,$1)", [name("9")]);
  await assert.rejects(pool.query(
    "UPDATE clips SET thumbnail_object_name=$1 WHERE id=99", [object.name]),
  /reserved by reviewed orphan cleanup/);
});

test("preflight is all-or-nothing when any selected generation or metadata changed", async () => {
  const f = await fixture();
  const first = exact(name("2"));
  const second = exact(name("3"));
  f.objects.set(first.name, first);
  f.objects.set(second.name, { ...second, metageneration: "99" });
  await assert.rejects(run(f, [first, second]), /OBJECT_METADATA_CHANGED/);
  assert.equal((await pool.query("SELECT count(*) FROM clip_orphan_cleanup")).rows[0].count, "0");
  assert.deepEqual(f.calls, []);
  assert.equal(f.objects.has(first.name), true);
});

test("fresh references protect live, frozen, thumbnail, deterministic and historical retry names plus ordinary queue", async () => {
  const f = await fixture();
  const original = name("4");
  const thumbnail = name("5", "thumb");
  const deterministic = retryThumbnailName(41, original);
  const historical = `thumb_retry_41_${"6".repeat(32)}.jpg`;
  const queued = name("7");
  await pool.query(`
    INSERT INTO clips(id,object_name,thumbnail_object_name,is_frozen)
      VALUES (41,$1,$2,false),(42,$3,NULL,true)
  `, [original, thumbnail, name("8")]);
  await pool.query(
    "INSERT INTO clip_storage_cleanup(object_name,clip_id) VALUES ($1,42)",
    [queued],
  );
  for (const objectName of [original, thumbnail, deterministic, historical, queued, name("8")]) {
    const object = exact(objectName);
    f.objects.set(objectName, object);
    await assert.rejects(run(f, [object]), /FRESH_REFERENCE_CHECK_HELD/, objectName);
  }
  assert.deepEqual(f.calls, []);
  assert.equal((await pool.query("SELECT count(*) FROM clip_orphan_cleanup")).rows[0].count, "0");
});

test("lost storage acknowledgement retries as already absent with durable backoff", async () => {
  const f = await fixture();
  const object = exact(name("a"));
  f.objects.set(object.name, object);
  let first = true;
  f.storage.deleteExact = async selected => {
    f.calls.push(selected);
    f.objects.delete(selected.name);
    if (first) { first = false; throw new Error("lost acknowledgement"); }
  };
  const auth = authorization(f, [object]);
  const deferred = await run(f, [object], auth);
  assert.equal(deferred.deferred, 1);
  const pending = (await pool.query("SELECT * FROM clip_orphan_cleanup")).rows[0];
  assert.equal(pending.state, "pending");
  assert.equal(pending.attempts, 1);
  assert.ok(pending.retry_at.getTime() > Date.now() + 285_000);
  assert.equal((await run(f, [object], auth)).deferred, 1, "persisted backoff is honored");
  await pool.query("UPDATE clip_orphan_cleanup SET retry_at=NOW()-INTERVAL '1 second'");
  const recovered = await run(f, [object], auth);
  assert.equal(recovered.deleted, 1);
  assert.equal((await pool.query("SELECT last_outcome FROM clip_orphan_cleanup")).rows[0].last_outcome,
    "already-absent");
});

test("database acknowledgement failure leaves the exact attempt pending and safely recovers", async () => {
  const f = await fixture();
  const object = exact(name("9"));
  f.objects.set(object.name, object);
  const auth = authorization(f, [object]);
  await pool.query(`
    CREATE OR REPLACE FUNCTION reject_deleted_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event = 'deleted' THEN RAISE EXCEPTION 'intentional commit-path failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_deleted_audit BEFORE INSERT ON clip_orphan_cleanup_audit
      FOR EACH ROW EXECUTE FUNCTION reject_deleted_audit()
  `);
  const deferred = await run(f, [object], auth);
  assert.equal(deferred.deferred, 1);
  assert.equal(f.objects.has(object.name), false, "storage completed before database acknowledgement failed");
  const pending = (await pool.query("SELECT state,attempts,last_outcome FROM clip_orphan_cleanup")).rows[0];
  assert.deepEqual(pending, { state: "pending", attempts: 1, last_outcome: "retryable-error" });
  await pool.query(`
    DROP TRIGGER reject_deleted_audit ON clip_orphan_cleanup_audit;
    DROP FUNCTION reject_deleted_audit();
    UPDATE clip_orphan_cleanup SET retry_at=NOW()-INTERVAL '1 second'
  `);
  assert.equal((await run(f, [object], auth)).deleted, 1);
  assert.equal((await pool.query("SELECT last_outcome FROM clip_orphan_cleanup")).rows[0].last_outcome,
    "already-absent");
});

test("a replacement generation is never deleted and a provider precondition failure is terminal", async () => {
  const f = await fixture();
  const object = exact(name("b"));
  f.objects.set(object.name, object);
  f.storage.deleteExact = async () => { throw new Error("outage"); };
  const auth = authorization(f, [object]);
  assert.equal((await run(f, [object], auth)).deferred, 1);
  f.objects.set(object.name, { ...object, generation: "12" });
  await pool.query("UPDATE clip_orphan_cleanup SET retry_at=NOW()-INTERVAL '1 second'");
  await assert.rejects(run(f, [object], auth), /OBJECT_METADATA_CHANGED/);
  assert.equal(f.objects.get(object.name).generation, "12");

  const g = await fixture();
  const terminal = exact(name("c"));
  g.objects.set(terminal.name, terminal);
  g.storage.deleteExact = async () => { const error = new Error("precondition"); error.code = 412; throw error; };
  const terminalAuth = authorization(g, [terminal]);
  assert.equal((await run(g, [terminal], terminalAuth)).rejected, 1);
  assert.equal((await pool.query("SELECT state FROM clip_orphan_cleanup")).rows[0].state, "rejected");
  assert.equal((await run(g, [terminal], terminalAuth)).rejected, 1);
});

test("a rejected exact object can be reauthorized by a newer signature without changing its pin", async () => {
  const f = await fixture();
  const object = exact(name("d"));
  f.objects.set(object.name, object);
  f.storage.deleteExact = async () => { const error = new Error("hold"); error.code = "412"; throw error; };
  assert.equal((await run(f, [object])).rejected, 1);
  f.storage.deleteExact = async selected => { f.calls.push(selected); f.objects.delete(selected.name); };
  const newer = authorization(f, [object]);
  assert.equal((await run(f, [object], newer)).deleted, 1);
  const row = (await pool.query("SELECT * FROM clip_orphan_cleanup")).rows[0];
  assert.equal(row.generation, object.generation);
  assert.deepEqual(row.expected, object);
  assert.deepEqual((await pool.query(
    "SELECT event FROM clip_orphan_cleanup_audit ORDER BY id")).rows.map(value => value.event),
  ["approved", "attempt", "rejected", "reauthorized", "attempt", "deleted"]);
});

test("wrong storage owner marker aborts before tombstones or deletes", async () => {
  const f = await fixture();
  const object = exact(name("e"));
  f.objects.set(object.name, object);
  f.storage.verifyOwner = async () => { throw new Error("WRONG_OWNER_MARKER"); };
  await assert.rejects(run(f, [object]), /WRONG_OWNER_MARKER/);
  assert.equal((await pool.query("SELECT count(*) FROM clip_orphan_cleanup")).rows[0].count, "0");
  assert.deepEqual(f.calls, []);
});

test("publication and retry row locks block while approved cleanup owns its fences", async () => {
  const f = await fixture();
  const object = exact(name("f"));
  f.objects.set(object.name, object);
  let releaseMetadata;
  const held = new Promise(resolve => { releaseMetadata = resolve; });
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const originalMetadata = f.storage.metadata;
  f.storage.metadata = async objectName => {
    enteredResolve();
    await held;
    return originalMetadata(objectName);
  };
  const auth = authorization(f, [object]);
  const cleanup = run(f, [object], auth);
  await entered;
  let inserted = false;
  const publication = pool.query(
    "INSERT INTO clips(id,object_name) VALUES (500,$1)", [name("0")],
  ).then(() => { inserted = true; });
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(inserted, false, "publication waits for the EXCLUSIVE clips fence");
  releaseMetadata();
  await cleanup;
  await publication;

  const locker = await pool.connect();
  await locker.query("BEGIN");
  await locker.query("SELECT * FROM clip_orphan_cleanup WHERE object_name=$1 FOR UPDATE", [object.name]);
  let completed = false;
  const retry = run(f, [object], auth).then(
    value => { completed = true; return value; },
    error => { completed = true; throw error; },
  );
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(completed, false, "retry waits for the tombstone row lock");
  await locker.query("COMMIT");
  locker.release();
  assert.equal((await retry).alreadyDeleted, 1);
});

async function statusFixture() {
  const f = await fixture();
  const approvalId = randomUUID();
  const expiredId = randomUUID();
  const rows = [
    { digit: "1", state: "pending", future: false, event: "approved", outcome: null },
    { digit: "2", state: "pending", future: true, event: "deferred", outcome: "retryable-error" },
    { digit: "3", state: "rejected", future: false, event: "rejected", outcome: "safety-hold", expired: true },
    { digit: "4", state: "deleted", future: false, event: "deleted", outcome: "generation-deleted", expired: true },
    { digit: "5", state: "pending", future: false, event: "attempt", outcome: null, expired: true },
  ];
  for (const row of rows) {
    const object = exact(name(row.digit), { generation: "90071992547409931234" });
    f.objects.set(object.name, object);
    const approval = {
      approvalId: row.expired ? expiredId : approvalId,
      expiresAt: new Date(Date.now() + (row.expired ? -3600_000 : 3600_000)).toISOString(),
      credentials: "SECRET_SENTINEL", approvedBy: "PRIVATE_OPERATOR_SENTINEL",
    };
    await pool.query(`
      INSERT INTO clip_orphan_cleanup
        (object_name,generation,approval_sha256,report_sha256,approval,expected,state,attempts,retry_at,last_outcome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()+$9*INTERVAL '1 hour',$10)
    `, [object.name, object.generation, (row.expired ? "e" : "a").repeat(64), "f".repeat(64),
      approval, object, row.state, row.event === "approved" ? 0 : 1, row.future ? 1 : -1, row.outcome]);
    // Equal timestamps: event sequence ID, not timestamp, determines latest.
    for (const event of ["approved", row.event]) {
      await pool.query(`
        INSERT INTO clip_orphan_cleanup_audit(object_name,approval_sha256,event,details,created_at,db_actor)
        VALUES ($1,$2,$3,$4,'2026-01-01','PRIVATE_ACTOR_SENTINEL')
      `, [object.name, (row.expired ? "e" : "a").repeat(64), event,
        { credentials: "SECRET_SENTINEL", approval }]);
    }
    // A different signed approval's event must never mask this approval's result.
    await pool.query(`INSERT INTO clip_orphan_cleanup_audit(object_name,approval_sha256,event)
      VALUES ($1,$2,'rejected')`, [object.name, "b".repeat(64)]);
  }
  return { ...f, approvalId, expiredId };
}

async function snapshot() {
  const tables = ["clips", "clip_storage_cleanup", "clip_orphan_cleanup", "clip_orphan_cleanup_audit"];
  return Promise.all(tables.map(async table =>
    (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows));
}

test("status classifies exact generations, retries and expiry with no database or storage changes", async () => {
  const f = await statusFixture();
  const before = await snapshot();
  const objectsBefore = [...f.objects];
  const queries = [];
  const guardedPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, params) {
          queries.push(sql);
          if (sql.includes("SELECT CURRENT_TIMESTAMP")) {
            assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
            // PostgreSQL itself blocks enqueue even with the test superuser.
            await assert.rejects(client.query("INSERT INTO clip_storage_cleanup(object_name) VALUES ('forbidden')"),
              error => error.code === "25006");
            // That deliberate failure aborts the transaction. Restart the same read-only snapshot.
            await client.query("ROLLBACK");
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          }
          return client.query(sql, params);
        },
        release: destroy => client.release(destroy),
      };
    },
  };
  const report = await getApprovedClipCleanupStatus(guardedPool);
  assert.deepEqual(report.actions.map(a => a.status), ["pending", "deferred", "rejected", "completed", "pending"]);
  assert.deepEqual({ ...report.summary, nextRetryAt: null }, {
    total: 5, pending: 2, deferred: 1, rejected: 1, completed: 1, needsAttention: 4,
    expiredActions: 3, expiredApprovals: 1, unknownExpiryActions: 0, nextRetryAt: null,
  });
  assert.equal(report.actions[1].lastOutcome, "retryable-error");
  assert.equal(report.actions[1].latestEvent, "deferred");
  assert.equal(report.actions[3].latestEvent, "deleted");
  assert.equal(report.actions[3].nextRetryAt, null);
  assert.ok(report.actions.every(a => a.generation === "90071992547409931234"));
  assert.ok(new Date(report.actions[1].nextRetryAt) > new Date(report.generatedAt));
  assert.ok(new Date(report.summary.nextRetryAt) < new Date(report.generatedAt));
  assert.ok(!queries.some(sql => /\b(INSERT|UPDATE|DELETE|LOCK)\b/i.test(sql)));
  assert.doesNotMatch(JSON.stringify(report), /SECRET_SENTINEL|PRIVATE_OPERATOR_SENTINEL|PRIVATE_ACTOR_SENTINEL|credentials|db_actor/);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual([...f.objects], objectsBefore);
  assert.deepEqual(f.calls, []);
});

test("status supports exact combined filters, empty results and safe unknown outcomes", async () => {
  const f = await statusFixture();
  const filtered = await getApprovedClipCleanupStatus(pool, { approvalId: f.approvalId.toUpperCase(), objectName: name("2") });
  assert.equal(filtered.summary.total, 1);
  assert.equal(filtered.actions[0].status, "deferred");
  assert.equal((await getApprovedClipCleanupStatus(pool, { approvalId: f.expiredId })).summary.total, 3);
  assert.equal((await getApprovedClipCleanupStatus(pool, { objectName: "' OR true --" })).summary.total, 0);
  assert.equal((await getApprovedClipCleanupStatus(pool, { approvalId: randomUUID() })).summary.total, 0);
  await assert.rejects(getApprovedClipCleanupStatus(pool, { approvalId: "' OR true --" }), /INVALID_APPROVAL_ID/);
  await pool.query(`UPDATE clip_orphan_cleanup SET last_outcome='SECRET_SENTINEL',
    approval=jsonb_set(approval,'{expiresAt}','"not a date"') WHERE object_name=$1`, [name("1")]);
  const unknown = await getApprovedClipCleanupStatus(pool, { objectName: name("1") });
  assert.equal(unknown.actions[0].lastOutcome, "unknown");
  assert.equal(unknown.actions[0].approvalExpiry, "unknown");
  assert.equal(unknown.summary.unknownExpiryActions, 1);
  assert.doesNotMatch(JSON.stringify(unknown), /SECRET_SENTINEL/);
});

test("CLI status uses SELECT-only role, exports JSON without storage, rejects mixed modes and never overwrites files", async () => {
  const f = await statusFixture();
  await pool.query(`CREATE ROLE status_reader LOGIN;
    GRANT USAGE ON SCHEMA public TO status_reader;
    GRANT SELECT ON clip_orphan_cleanup,clip_orphan_cleanup_audit TO status_reader`);
  const reader = new pg.Pool({ ...database.config, user: "status_reader" });
  pools.push(reader);
  assert.equal((await getApprovedClipCleanupStatus(reader)).summary.total, 5);
  await assert.rejects(reader.query("INSERT INTO clip_orphan_cleanup(object_name) VALUES ('forbidden')"), /permission denied/);
  await assert.rejects(reader.query("DELETE FROM clip_orphan_cleanup"), /permission denied/);
  const url = new URL("postgresql://status_reader@localhost/postgres");
  url.searchParams.set("host", database.config.host);
  // No inherited storage configuration, signing keys, or real database URL.
  const env = { PATH: process.env.PATH, DATABASE_URL: url.href };
  const exec = promisify(execFile);
  const before = await snapshot();
  const output = path.join(temp, "status.json");
  const { stdout, stderr } = await exec(process.execPath, [
    statusCli, "--status", "--json", "--approval-id", f.approvalId, "--object-name", name("2"), "--output", output,
  ], { env });
  const report = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(report.summary.total, 1);
  assert.equal(report.actions[0].status, "deferred");
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), report);
  const human = await exec(process.execPath, [statusCli, "--status"], { env });
  assert.match(human.stdout, /Pending: 2.*Deferred: 1.*Rejected: 1.*Completed: 1/);
  for (const args of [
    ["--status", "--execute-approved-generations"],
    ["--status", "--report", "/does-not-exist"],
    ["--status", "--approval", "/does-not-exist"],
    ["--json"], ["--status", "--output", output],
    ["--status", "--approval-id", "invalid"],
  ]) {
    await assert.rejects(exec(process.execPath, [statusCli, ...args], { env }), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.doesNotMatch(error.stderr, /SECRET_SENTINEL|postgresql:|STORAGE_OR_EXECUTOR_LOADED/);
      return true;
    });
  }
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), report);
  assert.deepEqual(await snapshot(), before);
  assert.equal(f.objects.size, 5);
  assert.deepEqual(f.calls, []);
});