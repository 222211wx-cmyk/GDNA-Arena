import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

export const FREE_MESSAGE_LIMIT = 10;
export const MESSAGING_ACTIVATION_MESSAGE = "Contactez l'AMIS pour activer";

interface MessagingQuota {
  has_active_subscription: boolean;
  free_messages_used: number;
}

/**
 * Caller must have an open transaction. Lock before counting so a concurrent
 * send has committed its INSERT before this statement takes its snapshot.
 * Publish adds the counter with default zero, but does not backfill historical
 * messages. Only raise the persisted cursor; deleting messages never lowers it.
 */
async function reconcileMessagingQuota(client: PoolClient, userId: number): Promise<MessagingQuota | null> {
  const locked = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (!locked.rows.length) return null;
  const { rows } = await client.query<MessagingQuota>(
    `UPDATE users
     SET free_messages_used = GREATEST(
       free_messages_used,
       LEAST($2, (SELECT COUNT(*) FROM dm_messages WHERE user_id = $1))
     )
     WHERE id = $1
     RETURNING has_active_subscription, free_messages_used`,
    [userId, FREE_MESSAGE_LIMIT],
  );
  return rows[0] ?? null;
}

/** Persist historical usage before returning eligibility/status, without reserving a send. */
export async function getMessagingQuota(userId: number): Promise<MessagingQuota | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quota = await reconcileMessagingQuota(client, userId);
    await client.query("COMMIT");
    return quota;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reserve one authored message on the same transaction/connection as its INSERT.
 * PostgreSQL serializes reconciliation and reservation on the user's row across all rooms
 * and devices. A failed INSERT or rollback restores the counter automatically.
 * Activated sends also count until ten, preventing a fresh trial after revocation.
 */
export async function reserveMessageSend(client: PoolClient, userId: number): Promise<boolean> {
  if (!await reconcileMessagingQuota(client, userId)) return false;
  const result = await client.query(
    `UPDATE users
     SET free_messages_used = GREATEST(free_messages_used, LEAST($2, free_messages_used + 1))
     WHERE id = $1 AND (has_active_subscription OR free_messages_used < $2)
     RETURNING id`,
    [userId, FREE_MESSAGE_LIMIT],
  );
  return result.rows.length > 0;
}