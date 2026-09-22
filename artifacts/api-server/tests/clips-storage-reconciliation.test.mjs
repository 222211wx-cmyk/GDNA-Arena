import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "clip-reconciliation-"));

const libraryEntry = path.join(temp, "library-entry.ts");
const libraryBundle = path.join(temp, "library.mjs");
await writeFile(libraryEntry, `
export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-storage-reconciliation.ts"))};
export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-storage-inventory.ts"))};
`);
await build({
  entryPoints: [libraryEntry],
  outfile: libraryBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});

const {
  MIN_ORPHAN_AGE_DAYS,
  collectClipInventory,
  readClipReferences,
  reconcileClipStorage,
} = await import(pathToFileURL(libraryBundle).href);

const now = Date.parse("2026-06-01T00:00:00.000Z");
const day = 86_400_000;
const old = new Date(now - 60 * day).toISOString();
const cutoff = new Date(now - 30 * day).toISOString();
const young = new Date(now - 2 * day).toISOString();
const hex = n => n.toString(16).padStart(32, "0");
const valid = (name, overrides = {}) => ({
  name,
  generation: "1",
  size: "10",
  timeCreated: old,
  updated: old,
  ...overrides,
});

test("reconciliation protects both historical JPEG and new WebP retry reservations", () => {
  const source = `clip_${hex(40)}.mp4`;
  const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
  const names = ["jpg", "webp"].map(ext => `thumb_retry_40_${hash}.${ext}`);
  const report = reconcileClipStorage({
    objects: names.map(name => valid(name)),
    clips: [{ id: 40, object_name: source, thumbnail_object_name: null }],
    queuedNames: [], scope: { bucket: "private", prefix: "app/clips/" },
    startedAt: "2026-06-01T00:00:00.000Z", now,
  });
  assert.equal(report.candidates.length, 0);
  assert.ok(report.inventory.every(item => item.reason === "deterministic-retry-candidate"));
});

test("reconciliation protects retained originals and reserved compression outputs", () => {
  const source = `clip_${hex(40)}.mp4`;
  const derived = `clip_${hex(41)}.mp4`;
  const pending = `clip_${hex(42)}.mp4`;
  const report = reconcileClipStorage({
    objects: [valid(source), valid(derived), valid(pending)],
    clips: [{
      id: 40, object_name: derived, upload_object_name: source,
      processing_output_object: pending, thumbnail_object_name: null,
    }],
    queuedNames: [source],
    scope: { bucket: "private", prefix: "app/clips/" },
    startedAt: "2026-06-01T00:00:00.000Z", now,
  });
  assert.equal(report.candidates.length, 0);
  assert.equal(report.inventory.find(item => item.name === source).reason, "retained-original");
  assert.equal(report.inventory.find(item => item.name === pending).reason, "pending-compression-output");
});

test("reconciliation protects every live reference and conservatively classifies inventory", () => {
  const liveOriginal = `clip_${hex(1)}.mp4`;
  const frozenOriginal = `clip_${hex(2)}.mov`;
  const storedThumbnail = `thumb_${hex(3)}.jpg`;
  const deterministicHash = crypto.createHash("sha256")
    .update(liveOriginal).digest("hex").slice(0, 32);
  const deterministicRetry = `thumb_retry_7_${deterministicHash}.jpg`;
  const alternateRetry = `thumb_retry_7_${hex(99)}.jpg`;
  const queued = `clip_${hex(4)}.webm`;

  const objects = [
    valid(liveOriginal),
    valid(frozenOriginal),
    valid(storedThumbnail),
    valid(deterministicRetry),
    valid(alternateRetry),
    valid(queued),
    valid(".uploads/session-expired-2019-01-01"),
    valid("clip_upload_expired_20190101"),
    valid(`clip_${hex(10)}.mp4`, { size: "11" }),
    valid(`clip_${hex(11)}.mov`, { size: "12" }),
    valid(`clip_${hex(12)}.webm`, { size: "13" }),
    valid(`thumb_${hex(13)}.jpg`, { size: "14" }),
    valid(`thumb_retry_999_${hex(14)}.jpg`, { size: "15" }),
    valid(`clip_${hex(15)}.mp4`, { timeCreated: young, updated: young }),
    valid(`thumb_${hex(16)}.jpg`, { updated: young }),
    valid(`clip_${hex(17)}.mp4`, { timeCreated: cutoff, updated: cutoff, size: "17" }),
    { name: `clip_${hex(18)}.mp4` },
    valid(`clip_${hex(19)}.mp4`, { generation: "0" }),
    valid(`thumb_${hex(20)}.jpg`, { size: "-1" }),
    valid(`thumb_${hex(21)}.jpg`, { timeCreated: "not-a-date" }),
    valid(`thumb_${hex(22)}.jpg`, { timeCreated: young, updated: old }),
    valid("../" + `clip_${hex(23)}.mp4`),
    valid("nested/" + `clip_${hex(24)}.mp4`),
    valid("/outside/" + `thumb_${hex(25)}.jpg`),
    valid("clip_not-a-hash.mp4"),
  ];

  const report = reconcileClipStorage({
    objects,
    clips: [
      { id: 7, object_name: liveOriginal, thumbnail_object_name: storedThumbnail },
      // Reconciliation intentionally receives all clips; frozen rows are not filtered.
      { id: 8, object_name: frozenOriginal, thumbnail_object_name: null, is_frozen: true },
    ],
    queuedNames: [queued],
    scope: { bucket: "private", prefix: "app/clips/" },
    startedAt: "2026-06-01T00:00:00.000Z",
    now,
  });

  const byName = new Map(report.inventory.map(object => [object.name, object]));
  const expect = (name, disposition, reason) => {
    assert.deepEqual(
      [byName.get(name)?.disposition, byName.get(name)?.reason],
      [disposition, reason],
      name,
    );
  };
  expect(liveOriginal, "protected", "live-original");
  expect(frozenOriginal, "protected", "live-original");
  expect(storedThumbnail, "protected", "stored-thumbnail");
  expect(deterministicRetry, "protected", "deterministic-retry-candidate");
  expect(alternateRetry, "protected", "retry-for-live-clip");
  expect(queued, "protected", "already-queued");
  expect(".uploads/session-expired-2019-01-01", "protected", "resumable-upload-namespace");
  expect("clip_upload_expired_20190101", "protected", "resumable-upload-namespace");
  for (const name of [
    `clip_${hex(10)}.mp4`, `clip_${hex(11)}.mov`, `clip_${hex(12)}.webm`,
    `thumb_${hex(13)}.jpg`, `thumb_retry_999_${hex(14)}.jpg`,
    `clip_${hex(17)}.mp4`,
  ]) expect(name, "candidate", "old-recognized-unreferenced-object");
  expect(`clip_${hex(15)}.mp4`, "held", "too-recent-or-pending");
  expect(`thumb_${hex(16)}.jpg`, "held", "too-recent-or-pending");
  for (const name of [
    `clip_${hex(18)}.mp4`, `clip_${hex(19)}.mp4`, `thumb_${hex(20)}.jpg`,
    `thumb_${hex(21)}.jpg`, `thumb_${hex(22)}.jpg`,
  ]) expect(name, "held", "missing-or-invalid-metadata");
  for (const name of [
    "../" + `clip_${hex(23)}.mp4`, "nested/" + `clip_${hex(24)}.mp4`,
    "/outside/" + `thumb_${hex(25)}.jpg`, "clip_not-a-hash.mp4",
  ]) expect(name, "held", "unrecognized-name");

  assert.deepEqual(report.candidates.map(object => object.name), [
    `clip_${hex(10)}.mp4`, `clip_${hex(11)}.mov`, `clip_${hex(12)}.webm`,
    `clip_${hex(17)}.mp4`, `thumb_${hex(13)}.jpg`,
    `thumb_retry_999_${hex(14)}.jpg`,
  ]);
  assert.equal(report.summary.candidateBytes, String(11 + 12 + 13 + 17 + 14 + 15));
  assert.equal(report.mode, "read-only-dry-run");
  assert.equal(report.complete, true);
  assert.equal(report.approvalRequired, true);
  assert.equal(report.cutoff, cutoff);
  assert.deepEqual(report.inventory.map(object => object.name),
    [...report.inventory.map(object => object.name)].sort((a, b) => a.localeCompare(b)));
});

test("reconciliation rejects duplicates and unsafe minimum ages", () => {
  const base = {
    clips: [],
    queuedNames: [],
    scope: { bucket: "private", prefix: "app/clips/" },
    startedAt: new Date(now).toISOString(),
    now,
  };
  const duplicate = valid(`clip_${hex(30)}.mp4`);
  assert.throws(
    () => reconcileClipStorage({ ...base, objects: [duplicate, { ...duplicate }] }),
    /Duplicate object in inventory/,
  );
  for (const minAgeDays of [0, MIN_ORPHAN_AGE_DAYS - 1, 30.5, NaN, Infinity]) {
    assert.throws(
      () => reconcileClipStorage({ ...base, objects: [], minAgeDays }),
      /min-age-days must be an integer/,
    );
  }
  assert.equal(reconcileClipStorage({
    ...base, objects: [], minAgeDays: MIN_ORPHAN_AGE_DAYS,
  }).minAgeDays, MIN_ORPHAN_AGE_DAYS);
});

test("inventory collector paginates completely and enforces caps and token progress", async () => {
  const calls = [];
  const pages = new Map([
    [undefined, { objects: [{ name: "one" }], nextPageToken: "second" }],
    ["second", { objects: [{ name: "two" }], nextPageToken: "third" }],
    ["third", { objects: [{ name: "three" }] }],
  ]);
  assert.deepEqual(await collectClipInventory(async token => {
    calls.push(token);
    return pages.get(token);
  }), [{ name: "one" }, { name: "two" }, { name: "three" }]);
  assert.deepEqual(calls, [undefined, "second", "third"]);

  await assert.rejects(
    collectClipInventory(async token => token
      ? { objects: [{ name: "two" }] }
      : { objects: [{ name: "one" }], nextPageToken: "next" }, 1),
    /exceeds max-objects; no report produced/,
  );
  await assert.rejects(
    collectClipInventory(async token => ({
      objects: [], nextPageToken: token ? "loop" : "loop",
    })),
    /Repeated storage page token; no report produced/,
  );
  const pageFailure = new Error("storage page failed");
  await assert.rejects(
    collectClipInventory(async token => {
      if (token) throw pageFailure;
      return { objects: [{ name: "partial-must-not-escape" }], nextPageToken: "next" };
    }),
    error => error === pageFailure,
  );
  for (const cap of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(collectClipInventory(async () => ({ objects: [] }), cap), /Invalid max-objects/);
  }
});

test("reference reader uses a read-only snapshot, reads every clip and queue, and never touches fingerprints", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT id")) return {
        rows: [
          { id: 1, object_name: "public", thumbnail_object_name: "thumb" },
          { id: 2, object_name: "frozen", thumbnail_object_name: null, is_frozen: true },
        ],
      };
      if (sql.startsWith("SELECT object_name")) return { rows: [{ object_name: "queued" }] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await readClipReferences(client), {
    clips: [
      { id: 1, object_name: "public", thumbnail_object_name: "thumb" },
      { id: 2, object_name: "frozen", thumbnail_object_name: null, is_frozen: true },
    ],
    queuedNames: ["queued"],
  });
  assert.deepEqual(queries, [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SET LOCAL statement_timeout = '30s'",
    "SELECT id, object_name, thumbnail_object_name, upload_object_name, processing_output_object FROM clips",
    "SELECT object_name FROM clip_storage_cleanup",
    "COMMIT",
  ]);
  const joined = queries.join("\n");
  assert.doesNotMatch(joined, /\bWHERE\b|\bis_frozen\b/i);
  assert.doesNotMatch(joined, /fingerprint/i);
  assert.doesNotMatch(joined, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});

test("reference reader rolls back and exposes no partial references when a read fails", async () => {
  for (const failingPrefix of [
    "SET LOCAL", "SELECT id", "SELECT object_name", "COMMIT",
  ]) {
    const queries = [];
    const failure = new Error("database read failed");
    const client = {
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith(failingPrefix)) throw failure;
        if (sql.startsWith("SELECT id")) return { rows: [{ id: 1 }] };
        return { rows: [] };
      },
    };
    await assert.rejects(readClipReferences(client), error => error === failure);
    assert.equal(queries.at(-1), "ROLLBACK");
  }
});

const cliMock = path.join(temp, "cli-mock.mjs");
const cliBundle = path.join(temp, "cli.mjs");
await writeFile(cliMock, `
const prefix = process.env.TEST_PREFIX ?? "tenant/clips/";
const bucket = {
  name: "private-test",
  async getFiles(options) {
    if (options.prefix !== "tenant/clips/" || options.autoPaginate !== false ||
        options.versions !== false || options.maxResults !== 1000)
      throw new Error("UNRESTRICTED_STORAGE_LIST");
    if (process.env.TEST_MODE === "page-failure") {
      if (options.pageToken === "next") throw new Error("PAGE_FAILURE");
      return [[{ name: prefix + "clip_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4",
        metadata: { generation: "1", size: "1", timeCreated: "2020-01-01T00:00:00Z",
          updated: "2020-01-01T00:00:00Z" } }], { pageToken: "next" }];
    }
    if (!options.pageToken) return [[], { pageToken: "last" }];
    return [[], undefined];
  },
};
export function clipFile() { return { bucket, name: prefix }; }
export class Pool {
  constructor(options) {
    if (options.options !== "-c default_transaction_read_only=on" ||
        options.max !== 1 || options.application_name !== "clip-storage-reconciliation-read-only")
      throw new Error("DATABASE_NOT_FORCED_READ_ONLY");
  }
  async connect() {
    return {
      async query(sql) {
        if (process.env.TEST_MODE === "db-failure" && sql.startsWith("SELECT id"))
          throw new Error("DB_FAILURE");
        return { rows: [] };
      },
      release() {},
    };
  }
  async end() {}
}
`);
await build({
  entryPoints: [path.join(apiRoot, "src/cli/clip-storage-reconcile.ts")],
  outfile: cliBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [{
    name: "reconciliation-cli-test-doubles",
    setup(plugin) {
      plugin.onResolve({ filter: /^pg$/ }, () => ({ path: cliMock }));
      plugin.onResolve({ filter: /\/clip-storage\.js$/ }, () => ({ path: cliMock }));
    },
  }],
});

async function absent(file) {
  await assert.rejects(access(file), error => error?.code === "ENOENT");
}

async function runCli(mode, output, extraEnv = {}) {
  try {
    await execFileAsync(process.execPath, [cliBundle, "--output", output], {
      env: { ...process.env, DATABASE_URL: "postgres://not-used", TEST_MODE: mode, ...extraEnv },
    });
    assert.fail("CLI unexpectedly succeeded");
  } catch (error) {
    assert.notEqual(error.code, "ERR_ASSERTION");
    return { stdout: error.stdout, stderr: error.stderr };
  }
}

test("actual CLI restricts scope and never emits a report after paginated storage failure", async () => {
  const invalidOutput = path.join(temp, "invalid-scope.json");
  const invalid = await runCli("unused", invalidOutput, { TEST_PREFIX: "../clips/" });
  assert.match(invalid.stderr, /Invalid clip storage scope/);
  assert.equal(invalid.stdout, "");
  await absent(invalidOutput);

  const pagedOutput = path.join(temp, "paged-failure.json");
  const paged = await runCli("page-failure", pagedOutput);
  assert.match(paged.stderr, /PAGE_FAILURE/);
  assert.equal(paged.stdout, "");
  await absent(pagedOutput);
});

test("actual CLI produces neither report nor success output when the database read fails", async () => {
  const output = path.join(temp, "db-failure.json");
  const result = await runCli("db-failure", output);
  assert.match(result.stderr, /Reconciliation failed; no usable report\. DB_FAILURE/);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /postgres:\/\/not-used/);
  await absent(output);
});

test("actual CLI writes a private read-only report once and rejects apply mode", async () => {
  const output = path.join(temp, "successful-report.json");
  const environment = {
    ...process.env,
    DATABASE_URL: "postgres://test.invalid/never-connected",
    TEST_MODE: "success",
    TEST_PREFIX: "tenant/clips/",
  };
  const first = await execFileAsync(process.execPath, [cliBundle, "--output", output], {
    env: environment,
  });
  assert.equal(first.stderr, "");
  const reportText = await readFile(output, "utf8");
  const report = JSON.parse(reportText);
  assert.deepEqual(report.scope, { bucket: "private-test", prefix: "tenant/clips/" });
  assert.equal(report.mode, "read-only-dry-run");
  assert.equal(report.complete, true);
  assert.deepEqual(report.summary, {
    totalObjects: 0,
    candidate: 0,
    protected: 0,
    held: 0,
    reasons: {},
    candidateBytes: "0",
  });
  assert.deepEqual(JSON.parse(first.stdout), { mode: report.mode, summary: report.summary });
  assert.equal((await stat(output)).mode & 0o777, 0o600);

  await assert.rejects(
    execFileAsync(process.execPath, [cliBundle, "--output", output], { env: environment }),
    error => {
      assert.match(error.stderr, /EEXIST|file already exists/);
      assert.equal(error.stdout, "");
      return true;
    },
  );
  assert.equal(await readFile(output, "utf8"), reportText, "an existing report must not be overwritten");

  const applyOutput = path.join(temp, "apply-must-not-exist.json");
  await assert.rejects(
    execFileAsync(process.execPath, [cliBundle, "--output", applyOutput, "--apply"], {
      env: environment,
    }),
    error => {
      assert.match(error.stderr, /Unknown option '--apply'/);
      assert.equal(error.stdout, "");
      return true;
    },
  );
  await absent(applyOutput);
});

test.after(async () => {
  await rm(temp, { recursive: true, force: true });
});