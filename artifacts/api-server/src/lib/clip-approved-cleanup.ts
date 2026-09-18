import type { Pool, PoolClient } from "pg";
import { assertFreshApproval, sameObject, verifyCleanupApproval, type ExactObject, type StorageOwner } from "./clip-cleanup-approval.js";
import { readStorageOwner } from "./clip-cleanup-owner.js";
import { reconcileClipStorage } from "./clip-storage-reconciliation.js";

/** The adapter is deliberately incapable of listing or deleting a whole bucket. */
export interface ApprovedCleanupStorage {
  verifyOwner(owner: StorageOwner): Promise<void>;
  metadata(name: string): Promise<ExactObject | null>;
  deleteExact(object: ExactObject): Promise<void>;
}
class SafetyHold extends Error {}
type QueueRow = { generation: string; expected: ExactObject; approval_sha256: string; state: string; attempts: number; due: boolean };

async function beginFenced(client: PoolClient) {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  // EXCLUSIVE conflicts with the thumbnail worker's SELECT FOR UPDATE as well
  // as publication/deletion. Always acquire in this order to avoid deadlocks.
  await client.query("LOCK TABLE clips IN EXCLUSIVE MODE");
  await client.query("LOCK TABLE clip_storage_cleanup IN SHARE ROW EXCLUSIVE MODE");
}
async function audit(client: PoolClient, name: string, hash: string, event: string, details: object = {}) {
  await client.query(
    "INSERT INTO clip_orphan_cleanup_audit (object_name, approval_sha256, event, details) VALUES ($1,$2,$3,$4::jsonb)",
    [name, hash, event, JSON.stringify(details)],
  );
}
async function checkReferences(client: PoolClient, object: ExactObject, owner: StorageOwner, minAgeDays: number) {
  const clips = await client.query("SELECT id, object_name, thumbnail_object_name FROM clips");
  const queue = await client.query("SELECT object_name FROM clip_storage_cleanup");
  const report = reconcileClipStorage({
    objects: [object], clips: clips.rows, queuedNames: queue.rows.map(row => row.object_name),
    scope: owner, startedAt: new Date().toISOString(), minAgeDays,
  });
  if (report.candidates.length !== 1) throw new SafetyHold("FRESH_REFERENCE_CHECK_HELD");
}
async function checkMetadata(storage: ApprovedCleanupStorage, object: ExactObject, missingAllowed: boolean) {
  const current = await storage.metadata(object.name);
  if (!current && missingAllowed) return false;
  if (!current || !sameObject(current, object)) throw new SafetyHold("OBJECT_METADATA_CHANGED");
  return true;
}

/**
 * Separately invoked operator queue. No timer, API route, or ordinary cleanup
 * worker can execute it. Durable name tombstones fence delayed delete requests.
 * Every retry supplies and re-verifies the signed approval and original report.
 */
export async function runApprovedClipCleanup(input: {
  pool: Pool; storage: ApprovedCleanupStorage; reportBytes: Buffer; envelopeBytes: Buffer;
}) {
  const { pool, storage, reportBytes, envelopeBytes } = input;
  const client = await pool.connect();
  const result = { approved: 0, deleted: 0, alreadyDeleted: 0, deferred: 0, rejected: 0 };
  try {
    await beginFenced(client);
    let owner = await readStorageOwner(client);
    let verified = verifyCleanupApproval(reportBytes, envelopeBytes, owner);
    await storage.verifyOwner(owner);
    // Preflight the entire selection before committing any new tombstones.
    for (const object of verified.approval.objects) {
      const prior = await client.query<QueueRow>(
        "SELECT *, retry_at <= NOW() AS due FROM clip_orphan_cleanup WHERE object_name=$1 FOR UPDATE", [object.name],
      );
      const row = prior.rows[0];
      if (row && (row.generation !== object.generation || !sameObject(row.expected, object))) throw new SafetyHold("NAME_ALREADY_RESERVED_FOR_DIFFERENT_OBJECT");
      if (row?.state === "deleted" && row.approval_sha256 === verified.approvalHash) continue;
      await checkReferences(client, object, owner, verified.minAgeDays);
      await checkMetadata(storage, object, !!row && row.attempts > 0);
      if (!row) {
        await client.query(
          `INSERT INTO clip_orphan_cleanup (object_name,generation,approval_sha256,report_sha256,approval,expected)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
          [object.name, object.generation, verified.approvalHash, verified.approval.reportSha256,
            JSON.stringify(verified.approval), JSON.stringify(object)],
        );
        await audit(client, object.name, verified.approvalHash, "approved", { approval: verified.approval, expected: object });
      } else if (row.approval_sha256 !== verified.approvalHash) {
        // Reauthorization cannot change the pinned generation or metadata.
        await client.query(
          `UPDATE clip_orphan_cleanup SET approval_sha256=$2,report_sha256=$3,approval=$4::jsonb,
           state='pending',retry_at=NOW(),last_outcome=NULL WHERE object_name=$1`,
          [object.name, verified.approvalHash, verified.approval.reportSha256, JSON.stringify(verified.approval)],
        );
        await audit(client, object.name, verified.approvalHash, "reauthorized", { approval: verified.approval });
      }
    }
    assertFreshApproval(verified.approval);
    await client.query("COMMIT");
    result.approved = verified.approval.objects.length;

    for (const object of verified.approval.objects) {
      // Commit attempt/backoff BEFORE I/O. A crash or lost acknowledgement leaves
      // exactly this generation pending; a new command cannot delete its replacement.
      await beginFenced(client);
      owner = await readStorageOwner(client);
      verified = verifyCleanupApproval(reportBytes, envelopeBytes, owner);
      await storage.verifyOwner(owner);
      const claimed = await client.query<QueueRow>(
        "SELECT *, retry_at <= NOW() AS due FROM clip_orphan_cleanup WHERE object_name=$1 FOR UPDATE", [object.name],
      );
      const row = claimed.rows[0];
      if (!row || row.approval_sha256 !== verified.approvalHash || !sameObject(row.expected, object)) throw new SafetyHold("QUEUE_APPROVAL_CHANGED");
      if (row.state === "deleted") { result.alreadyDeleted++; await client.query("COMMIT"); continue; }
      if (row.state === "rejected") { result.rejected++; await client.query("COMMIT"); continue; }
      if (!row.due) { result.deferred++; await client.query("COMMIT"); continue; }
      const attempt = row.attempts + 1;
      await client.query(
        `UPDATE clip_orphan_cleanup SET attempts=$2,
         retry_at=NOW() + INTERVAL '1 second' * LEAST(86400, 300 * POWER(2, LEAST($2::integer - 1, 9)))
         WHERE object_name=$1`, [object.name, attempt],
      );
      await audit(client, object.name, verified.approvalHash, "attempt", { attempt, generation: object.generation });
      await client.query("COMMIT");
      try {
        await beginFenced(client);
        owner = await readStorageOwner(client);
        verified = verifyCleanupApproval(reportBytes, envelopeBytes, owner);
        await storage.verifyOwner(owner);
        const current = await client.query("SELECT * FROM clip_orphan_cleanup WHERE object_name=$1 FOR UPDATE", [object.name]);
        if (current.rows[0]?.attempts !== attempt || current.rows[0]?.approval_sha256 !== verified.approvalHash ||
            current.rows[0]?.state !== "pending") throw new SafetyHold("QUEUE_ATTEMPT_CHANGED");
        await checkReferences(client, object, owner, verified.minAgeDays);
        const exists = await checkMetadata(storage, object, true);
        assertFreshApproval(verified.approval);
        if (exists) await storage.deleteExact(object);
        await client.query(
          "UPDATE clip_orphan_cleanup SET state='deleted',last_outcome=$2 WHERE object_name=$1",
          [object.name, exists ? "generation-deleted" : "already-absent"],
        );
        await audit(client, object.name, verified.approvalHash, exists ? "deleted" : "already-absent", { attempt, generation: object.generation });
        await client.query("COMMIT");
        result.deleted++;
      } catch (error) {
        await client.query("ROLLBACK");
        const held = error instanceof SafetyHold || String((error as { code?: unknown }).code) === "412";
        // Never log credentials / provider response bodies. Keep a durable,
        // fenced outcome even when the original storage acknowledgement is lost.
        await client.query("BEGIN");
        const changed = await client.query(
          `UPDATE clip_orphan_cleanup SET state=$4,last_outcome=$5
           WHERE object_name=$1 AND approval_sha256=$2 AND attempts=$3 AND state='pending' RETURNING object_name`,
          [object.name, verified.approvalHash, attempt, held ? "rejected" : "pending", held ? "safety-hold" : "retryable-error"],
        );
        if (changed.rowCount) await audit(client, object.name, verified.approvalHash, held ? "rejected" : "deferred", { attempt });
        await client.query("COMMIT");
        if (held) result.rejected++; else result.deferred++;
      }
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // A broken connection or ambiguous lock acquisition must never return to a pool.
    client.release(true);
  }
}