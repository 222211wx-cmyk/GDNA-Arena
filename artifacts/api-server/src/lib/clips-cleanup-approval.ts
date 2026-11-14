import { createHash, createPublicKey, verify } from "node:crypto";
import { reconcileClipStorage, type InventoryObject } from "./clips-storage-reconciliation.js";

export type ExactObject = Required<InventoryObject>;
export interface StorageOwner {
  database_id: string;
  database_name: string;
  bucket: string;
  prefix: string;
  marker_name: string;
  marker_generation: string;
  approval_public_key: string;
}
export interface CleanupApproval {
  schemaVersion: 1;
  action: "delete-reviewed-clip-generations";
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  reportSha256: string;
  databaseId: string;
  databaseName: string;
  bucket: string;
  prefix: string;
  markerGeneration: string;
  objects: ExactObject[];
}
export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ["name", "generation", "metageneration", "size", "timeCreated", "updated"] as const;
export function sameObject(a: InventoryObject, b: InventoryObject): boolean {
  return fields.every(key => typeof a[key] === "string" && a[key] === b[key]);
}
export function assertFreshApproval(approval: CleanupApproval, now = Date.now()) {
  const start = Date.parse(approval.approvedAt);
  const end = Date.parse(approval.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now ||
      end <= now || end <= start || end - start > DAY) throw new Error("APPROVAL_EXPIRED_OR_INVALID");
}

/** Signature is over the exact payload bytes, never reserialized JSON. */
export function verifyCleanupApproval(reportBytes: Buffer, envelopeBytes: Buffer, owner: StorageOwner, now = Date.now()) {
  const envelope = JSON.parse(envelopeBytes.toString("utf8"));
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string") throw new Error("INVALID_SIGNATURE_ENVELOPE");
  const payload = Buffer.from(envelope.payload, "base64");
  const key = createPublicKey(owner.approval_public_key);
  if (key.asymmetricKeyType !== "ed25519" ||
      !verify(null, payload, key, Buffer.from(envelope.signature, "base64"))) throw new Error("APPROVAL_SIGNATURE_INVALID");
  const approval: CleanupApproval = JSON.parse(payload.toString("utf8"));
  if (approval.schemaVersion !== 1 || approval.action !== "delete-reviewed-clip-generations" ||
      !UUID.test(approval.approvalId) || typeof approval.approvedBy !== "string" ||
      !approval.approvedBy.trim() || approval.approvedBy.length > 200) throw new Error("INVALID_APPROVAL");
  assertFreshApproval(approval, now);
  if (approval.databaseId !== owner.database_id || approval.databaseName !== owner.database_name ||
      approval.bucket !== owner.bucket || approval.prefix !== owner.prefix ||
      approval.markerGeneration !== owner.marker_generation) throw new Error("APPROVAL_SCOPE_MISMATCH");
  const report = JSON.parse(reportBytes.toString("utf8"));
  if (sha256(reportBytes) !== approval.reportSha256) throw new Error("REPORT_HASH_MISMATCH");
  const started = Date.parse(report.startedAt);
  const generated = Date.parse(report.generatedAt);
  if (report.schemaVersion !== 1 || report.mode !== "read-only-dry-run" || report.complete !== true ||
      !Number.isFinite(started) || !Number.isFinite(generated) ||
      started > generated || generated > Date.parse(approval.approvedAt) || now - started > DAY ||
      report.scope?.bucket !== owner.bucket || report.scope?.prefix !== owner.prefix ||
      report.ownership?.databaseId !== owner.database_id || report.ownership?.databaseName !== owner.database_name ||
      report.ownership?.markerGeneration !== owner.marker_generation ||
      !Number.isSafeInteger(report.minAgeDays) || report.minAgeDays < 30 ||
      !Array.isArray(report.candidates) || !Array.isArray(report.inventory)) throw new Error("STALE_OR_UNBOUND_REPORT");
  if (!Array.isArray(approval.objects) || !approval.objects.length || approval.objects.length > 100) throw new Error("APPROVE_1_TO_100_EXACT_OBJECTS");
  const seen = new Set<string>();
  for (const object of approval.objects) {
    if (!object || fields.some(field => typeof object[field] !== "string") ||
        !/^[1-9]\d*$/.test(object.metageneration) || seen.has(object.name)) throw new Error("INVALID_EXACT_OBJECT");
    seen.add(object.name);
    for (const entries of [report.candidates, report.inventory]) {
      const matches = entries.filter((entry: InventoryObject) => entry.name === object.name);
      if (matches.length !== 1 || matches[0].disposition !== "candidate" || !sameObject(object, matches[0])) throw new Error("OBJECT_NOT_REVIEWED_CANDIDATE");
    }
    const classified = reconcileClipStorage({
      objects: [object], clips: [], queuedNames: [], scope: report.scope,
      startedAt: report.startedAt, now: generated, minAgeDays: report.minAgeDays,
    });
    if (classified.candidates.length !== 1) throw new Error("OBJECT_NOT_ELIGIBLE");
  }
  return { approval, approvalHash: sha256(payload), minAgeDays: report.minAgeDays as number };
}
