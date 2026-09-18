import type { Pool } from "pg";

export interface CleanupStatusFilters {
  approvalId?: string;
  objectName?: string;
}
type StatusRow = {
  objectName: string; generation: string; approvalId: string;
  approvalSha256: string; state: "pending" | "rejected" | "deleted";
  attempts: number; retryAt: Date; expiresAt: string | null;
  lastOutcome: string | null; latestEvent: string | null; latestEventAt: Date | null;
};
const events = new Set(["approved", "reauthorized", "attempt", "deleted", "already-absent", "rejected", "deferred"]);
const outcomes = new Set(["generation-deleted", "already-absent", "safety-hold", "retryable-error"]);
const safeCode = (value: string | null, allowed: Set<string>) =>
  value === null ? null : allowed.has(value) ? value : "unknown";

/**
 * Database evidence only, never authorization. No storage adapter, owner reader,
 * executor, approval payload, arbitrary audit details, or credentials are loaded.
 */
export async function getApprovedClipCleanupStatus(pool: Pool, filters: CleanupStatusFilters = {}) {
  if (filters.approvalId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.approvalId)) {
    throw new Error("INVALID_APPROVAL_ID");
  }
  if (filters.objectName !== undefined && (!filters.objectName || filters.objectName.length > 1024)) {
    throw new Error("INVALID_OBJECT_NAME");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const { rows: [clock] } = await client.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now");
    const { rows } = await client.query<StatusRow>(`
      SELECT q.object_name AS "objectName", q.generation,
        q.approval->>'approvalId' AS "approvalId", q.approval_sha256 AS "approvalSha256",
        q.state, q.attempts, q.retry_at AS "retryAt",
        q.approval->>'expiresAt' AS "expiresAt", q.last_outcome AS "lastOutcome",
        a.event AS "latestEvent", a.created_at AS "latestEventAt"
      FROM public.clip_orphan_cleanup q
      LEFT JOIN LATERAL (
        SELECT event, created_at
        FROM public.clip_orphan_cleanup_audit
        WHERE object_name=q.object_name AND approval_sha256=q.approval_sha256
        ORDER BY id DESC LIMIT 1
      ) a ON true
      WHERE ($1::text IS NULL OR lower(q.approval->>'approvalId')=lower($1))
        AND ($2::text IS NULL OR q.object_name=$2)
      ORDER BY q.object_name, q.generation
    `, [filters.approvalId ?? null, filters.objectName ?? null]);
    const now = clock.now.getTime();
    const actions = rows.map(row => {
      const expiry = Date.parse(row.expiresAt ?? "");
      const approvalExpiry = !Number.isFinite(expiry) ? "unknown" : expiry <= now ? "expired" : "unexpired";
      const status = row.state === "deleted" ? "completed" : row.state === "rejected" ? "rejected"
        : row.retryAt.getTime() > now ? "deferred" : "pending";
      return {
        objectName: row.objectName, generation: row.generation,
        approvalId: row.approvalId, approvalSha256: row.approvalSha256,
        status, attempts: row.attempts,
        nextRetryAt: row.state === "pending" ? row.retryAt.toISOString() : null,
        approvalExpiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null,
        approvalExpiry, needsAttention: status !== "completed",
        lastOutcome: safeCode(row.lastOutcome, outcomes),
        latestEvent: safeCode(row.latestEvent, events),
        latestEventAt: row.latestEventAt?.toISOString() ?? null,
      };
    });
    const summary = {
      total: actions.length, pending: 0, deferred: 0, rejected: 0, completed: 0,
      needsAttention: 0, expiredActions: 0, expiredApprovals: 0,
      unknownExpiryActions: 0, nextRetryAt: null as string | null,
    };
    const expired = new Set<string>();
    for (const action of actions) {
      summary[action.status as "pending" | "deferred" | "rejected" | "completed"]++;
      if (action.needsAttention) summary.needsAttention++;
      if (action.approvalExpiry === "expired") {
        summary.expiredActions++;
        expired.add(action.approvalSha256);
      }
      if (action.approvalExpiry === "unknown") summary.unknownExpiryActions++;
      if (action.nextRetryAt && (!summary.nextRetryAt || action.nextRetryAt < summary.nextRetryAt)) {
        summary.nextRetryAt = action.nextRetryAt;
      }
    }
    summary.expiredApprovals = expired.size;
    await client.query("COMMIT");
    return {
      schemaVersion: 1, mode: "read-only-status", generatedAt: clock.now.toISOString(),
      summary, actions,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release(true);
  }
}

export function formatApprovedClipCleanupStatus(report: Awaited<ReturnType<typeof getApprovedClipCleanupStatus>>) {
  const s = report.summary;
  return [
    `Approved clip cleanup — read-only status at ${report.generatedAt}`,
    `Actions: ${s.total} | Pending: ${s.pending} | Deferred: ${s.deferred} | Rejected: ${s.rejected} | Completed: ${s.completed}`,
    `Needs attention: ${s.needsAttention} | Expired approvals: ${s.expiredApprovals} (${s.expiredActions} actions) | Unknown expiry: ${s.unknownExpiryActions}`,
    `Earliest recorded retry: ${s.nextRetryAt ?? "none"}`,
    "Recorded retry times are not scheduled execution or permission to delete. Fresh signed approval and report are still required.",
    ...report.actions.map(action => [
      `${JSON.stringify(action.objectName)} generation=${JSON.stringify(action.generation)} ${action.status}`,
      `  approval=${JSON.stringify(action.approvalId)} attempts=${action.attempts} expiry=${action.approvalExpiresAt ?? "unknown"} (${action.approvalExpiry})`,
      `  nextRetry=${action.nextRetryAt ?? "none"} outcome=${action.lastOutcome ?? "none"} latestEvent=${action.latestEvent ?? "none"} at=${action.latestEventAt ?? "none"}`,
    ].join("\n")),
  ].join("\n");
}