import type { PoolClient } from "pg";

export const FREE_MESSAGE_LIMIT = 10;
export const MESSAGING_ACTIVATION_MESSAGE = "Contactez l'AMIS pour activer";

/**
 * Reserve one authored message on the same transaction/connection as its INSERT.
 * PostgreSQL serializes concurrent UPDATEs of this user's row, across all rooms
 * and devices. A failed INSERT or rollback restores the counter automatically.
 * Activated sends also count until ten, preventing a fresh trial after revocation.
 */
export async function reserveMessageSend(client: PoolClient, userId: number): Promise<boolean> {
  const result = await client.query(
    `UPDATE users
     SET free_messages_used = LEAST($2, free_messages_used + 1)
     WHERE id = $1 AND (has_active_subscription OR free_messages_used < $2)
     RETURNING id`,
    [userId, FREE_MESSAGE_LIMIT],
  );
  return result.rows.length > 0;
}