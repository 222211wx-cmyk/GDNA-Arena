import { pool } from "@workspace/db";
import { logger } from "./logger";
import type { PoolClient } from "pg";

/** Call only AFTER the credential reset commits. False means the durable row
 * remains pending; callers must not claim Firebase cleanup has completed.
 * Holding the user UPDATE lock serializes cleanup against mirror creation's
 * SHARE lock and prevents erasing a newly-issued, post-cleanup mirror.
 */
export async function completeOfflineRecoveryRevocation(userId: number): Promise<boolean> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const pending = await client.query<{ credential_epoch: number }>(
      "SELECT credential_epoch FROM auth_offline_recovery_revocations WHERE user_id=$1 FOR UPDATE", [userId],
    );
    if (!pending.rowCount) { await client.query("COMMIT"); return true; }
    const { revokeAllCallPushSessions } = await import("./firebase-call-push");
    const completed = await revokeAllCallPushSessions(userId, {
      requireProviderConfirmation: true,
      credentialEpoch: pending.rows[0].credential_epoch,
    });
    if (completed) {
      await client.query(
        "DELETE FROM auth_offline_recovery_revocations WHERE user_id=$1 AND credential_epoch=$2",
        [userId, pending.rows[0].credential_epoch],
      );
    }
    await client.query("COMMIT");
    return completed;
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.warn({ userId }, "Offline recovery Firebase cleanup remains pending");
    return false;
  } finally { client?.release(); }
}

let started = false;
export function startOfflineRecoveryRevocationSweep(): void {
  if (started) return;
  started = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const pending = await pool.query<{ user_id: number }>(
        "SELECT user_id FROM auth_offline_recovery_revocations ORDER BY created_at LIMIT 100",
      );
      for (const { user_id } of pending.rows) await completeOfflineRecoveryRevocation(user_id);
    } catch {
      logger.warn("Offline recovery Firebase cleanup sweep unavailable");
    } finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref();
}