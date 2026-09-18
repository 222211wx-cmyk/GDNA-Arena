import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const apiRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "approved-cleanup-unit-"));
const entry = path.join(temp, "entry.ts");
const bundle = path.join(temp, "bundle.mjs");
await writeFile(entry, `
export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-cleanup-approval.ts"))};
export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-cleanup-owner.ts"))};
export * from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-approved-cleanup-gcs.ts"))};
`);
await build({
  entryPoints: [entry], outfile: bundle, bundle: true, platform: "node",
  format: "esm", logLevel: "silent", external: ["pg"],
});
const { approvedCleanupStorage, readStorageOwner, sha256, verifyCleanupApproval } =
  await import(pathToFileURL(bundle).href);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const owner = {
  database_id: randomUUID(),
  database_name: "reviewed_cleanup_test",
  bucket: "private-clips",
  prefix: "tenant/clips/",
  marker_name: "tenant/.clip-owner",
  marker_generation: "91",
  approval_public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const day = 86_400_000;
const object = (name = `clip_${"a".repeat(32)}.mp4`, overrides = {}) => ({
  name, generation: "17", metageneration: "3", size: "42",
  timeCreated: new Date(Date.now() - 60 * day).toISOString(),
  updated: new Date(Date.now() - 60 * day).toISOString(),
  ...overrides,
});

function materials(objects = [object()], options = {}) {
  const now = options.now ?? Date.now();
  const inventory = (options.inventory ?? objects).map(value => ({
    ...value, disposition: "candidate", reason: "old-recognized-unreferenced-object",
  }));
  const report = {
    schemaVersion: 1, mode: "read-only-dry-run", complete: true,
    scope: { bucket: owner.bucket, prefix: owner.prefix },
    ownership: {
      databaseId: owner.database_id, databaseName: owner.database_name,
      markerGeneration: owner.marker_generation,
    },
    startedAt: new Date(now - 60_000).toISOString(),
    generatedAt: new Date(now - 30_000).toISOString(),
    minAgeDays: 30, candidates: inventory, inventory,
    ...options.report,
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const approval = {
    schemaVersion: 1, action: "delete-reviewed-clip-generations",
    approvalId: randomUUID(), approvedBy: "security operator",
    approvedAt: new Date(now - 10_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    reportSha256: sha256(reportBytes),
    databaseId: owner.database_id, databaseName: owner.database_name,
    bucket: owner.bucket, prefix: owner.prefix,
    markerGeneration: owner.marker_generation, objects,
    ...options.approval,
  };
  const payload = Buffer.from(JSON.stringify(approval));
  const envelopeBytes = Buffer.from(JSON.stringify({
    payload: payload.toString("base64"),
    signature: sign(null, payload, options.privateKey ?? privateKey).toString("base64"),
  }));
  return { report, approval, reportBytes, envelopeBytes, now };
}

test("accepts an Ed25519 signature over exact payload bytes and an explicit candidate subset", () => {
  const first = object(`clip_${"1".repeat(32)}.mp4`);
  const second = object(`thumb_${"2".repeat(32)}.jpg`, { generation: "19" });
  const m = materials([second], { inventory: [first, second] });
  const verified = verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now);
  assert.deepEqual(verified.approval.objects, [second]);
  assert.equal(verified.approvalHash, sha256(Buffer.from(JSON.parse(m.envelopeBytes).payload, "base64")));
});

test("rejects tampered report bytes, payloads, signatures, and non-Ed25519 owners", () => {
  const m = materials();
  assert.throws(() => verifyCleanupApproval(Buffer.concat([m.reportBytes, Buffer.from(" ")]), m.envelopeBytes, owner, m.now),
    /REPORT_HASH_MISMATCH/);
  const envelope = JSON.parse(m.envelopeBytes);
  envelope.payload = Buffer.from(envelope.payload, "base64").toString("utf8")
    .replace("security operator", "other operator");
  envelope.payload = Buffer.from(envelope.payload).toString("base64");
  assert.throws(() => verifyCleanupApproval(m.reportBytes, Buffer.from(JSON.stringify(envelope)), owner, m.now),
    /APPROVAL_SIGNATURE_INVALID/);
  const badSignature = JSON.parse(m.envelopeBytes);
  badSignature.signature = Buffer.alloc(64, 7).toString("base64");
  assert.throws(() => verifyCleanupApproval(m.reportBytes, Buffer.from(JSON.stringify(badSignature)), owner, m.now),
    /APPROVAL_SIGNATURE_INVALID/);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey
    .export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes,
    { ...owner, approval_public_key: rsa }, m.now), /APPROVAL_SIGNATURE_INVALID/);
});

test("binds approval and report to database, bucket, prefix, and marker generation", () => {
  for (const [field, value] of [
    ["databaseId", randomUUID()], ["databaseName", "other"], ["bucket", "other"],
    ["prefix", "other/clips/"], ["markerGeneration", "92"],
  ]) {
    const m = materials(undefined, { approval: { [field]: value } });
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
      /APPROVAL_SCOPE_MISMATCH/, field);
  }
  for (const report of [
    { scope: { bucket: "other", prefix: owner.prefix } },
    { ownership: { databaseId: randomUUID(), databaseName: owner.database_name, markerGeneration: "91" } },
  ]) {
    const m = materials(undefined, { report });
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
      /STALE_OR_UNBOUND_REPORT/);
  }
});

test("rejects stale reports and expired, future, or overlong approvals", () => {
  const now = Date.now();
  const cases = [
    { approval: { expiresAt: new Date(now).toISOString() } },
    { approval: { approvedAt: new Date(now + 1).toISOString(), expiresAt: new Date(now + 1000).toISOString() } },
    { approval: { approvedAt: new Date(now - day).toISOString(), expiresAt: new Date(now + day).toISOString() } },
  ];
  for (const options of cases) {
    const m = materials(undefined, { now, ...options });
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, now),
      /APPROVAL_EXPIRED_OR_INVALID/);
  }
  for (const report of [
    { startedAt: new Date(now - day - 1).toISOString() },
    { generatedAt: new Date(now).toISOString() },
    { complete: false },
  ]) {
    const m = materials(undefined, { now, report });
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, now),
      /STALE_OR_UNBOUND_REPORT/);
  }
});

test("requires exact generation and all metadata in both report lists", () => {
  for (const mutate of [
    value => ({ ...value, generation: "18" }),
    value => ({ ...value, metageneration: "4" }),
    value => ({ ...value, size: "43" }),
    value => ({ ...value, updated: new Date(Date.now() - 59 * day).toISOString() }),
  ]) {
    const selected = object();
    const m = materials([selected], { inventory: [mutate(selected)] });
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
      /OBJECT_NOT_REVIEWED_CANDIDATE/);
  }
});

test("rejects duplicate selections, duplicate report entries, and protected or unsafe names", () => {
  const selected = object();
  let m = materials([selected, selected], {
    inventory: [selected],
    report: {
      candidates: [{ ...selected, disposition: "candidate", reason: "old-recognized-unreferenced-object" }],
    },
  });
  assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
    /INVALID_EXACT_OBJECT/);
  m = materials([selected], { inventory: [selected, selected] });
  assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
    /OBJECT_NOT_REVIEWED_CANDIDATE/);
  for (const name of [
    ".uploads/resumable", "clip_upload_session",
    "../clip_" + "a".repeat(32) + ".mp4",
    "ordinary-unrecognized-object.bin",
  ]) {
    m = materials([object(name)]);
    assert.throws(() => verifyCleanupApproval(m.reportBytes, m.envelopeBytes, owner, m.now),
      /OBJECT_NOT_ELIGIBLE/, name);
  }
});

test("GCS adapter pins exact string preconditions, never falls back after 412, and bounds the owner marker", async () => {
  const calls = [];
  const markerBytes = Buffer.from(JSON.stringify({
    databaseId: owner.database_id, databaseName: owner.database_name,
    bucket: owner.bucket, prefix: owner.prefix,
  }));
  let downloadedMarker = markerBytes;
  let markerMetadata = {
    generation: owner.marker_generation, size: String(markerBytes.length),
  };
  let deleteError;
  const bucket = {
    name: owner.bucket,
    file(fileName, options) {
      calls.push({ fileName, options });
      return {
        async getMetadata() { return [markerMetadata]; },
        async download() { return [downloadedMarker]; },
        async delete(deleteOptions) {
          calls.push({ deleteOptions });
          if (deleteError) throw deleteError;
        },
      };
    },
  };
  const adapter = approvedCleanupStorage({ bucket, name: owner.prefix });
  await adapter.verifyOwner(owner);
  assert.deepEqual(calls.slice(0, 2), [
    { fileName: owner.marker_name, options: undefined },
    { fileName: owner.marker_name, options: { generation: owner.marker_generation } },
  ]);

  calls.length = 0;
  const selected = object();
  const precondition = new Error("precondition failed");
  precondition.code = 412;
  deleteError = precondition;
  await assert.rejects(adapter.deleteExact(selected), error => error === precondition);
  assert.deepEqual(calls, [
    {
      fileName: owner.prefix + selected.name,
      options: {
        preconditionOpts: {
          ifGenerationMatch: selected.generation,
          ifMetagenerationMatch: selected.metageneration,
        },
      },
    },
    { deleteOptions: { ignoreNotFound: true } },
  ], "412 is returned after one precisely preconditioned request, with no generation selector or fallback");

  markerMetadata = { generation: "72", size: String(markerBytes.length) };
  await assert.rejects(adapter.verifyOwner(owner), /OWNERSHIP_MARKER_CHANGED/);
  markerMetadata = { generation: owner.marker_generation, size: "4097" };
  await assert.rejects(adapter.verifyOwner(owner), /OWNERSHIP_MARKER_CHANGED/);
  markerMetadata = { generation: owner.marker_generation, size: "1" };
  downloadedMarker = Buffer.alloc(4097);
  await assert.rejects(adapter.verifyOwner(owner), /OWNERSHIP_MARKER_TOO_LARGE/);
});

test("owner reader locks and rejects the wrong database or unsafe marker", async () => {
  const queries = [];
  const good = { ...owner, actual_database: owner.database_name };
  const client = { async query(sql) { queries.push(sql); return { rows: [good] }; } };
  assert.deepEqual(await readStorageOwner(client), good);
  assert.match(queries[0], /tgenabled='A'/);
  assert.match(queries[1], /FOR SHARE/);
  await assert.rejects(readStorageOwner({ query: async () => ({ rows: [] }) }),
    /PUBLICATION_GUARD_NOT_INSTALLED/);
  for (const bad of [
    { ...good, actual_database: "wrong" },
    { ...good, marker_name: `${good.prefix}owner` },
    { ...good, marker_generation: "0" },
  ]) {
    await assert.rejects(readStorageOwner({ query: async () => ({ rows: [bad] }) }),
      /UNVERIFIED_DATABASE_OWNERSHIP/);
  }
});

test.after(async () => rm(temp, { recursive: true, force: true }));