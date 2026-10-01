import { pool } from "@workspace/db";

/** Historical trial size, retained only to interpret legacy usage records. */
export const FREE_MESSAGE_LIMIT = 10;

interface MessagingQuota {
  has_active_subscription: boolean;
  free_messages_used: number;
}

/** Read legacy records without reconciling, resetting or granting subscriptions.
 * Direct messaging is unlimited by policy; these records no longer gate sends.
 */
export async function getMessagingQuota(userId: number): Promise<MessagingQuota | null> {
  const { rows } = await pool.query<MessagingQuota>(
    `SELECT has_active_subscription, free_messages_used
     FROM users WHERE id = $1 AND password_hash <> 'DELETED'`,
    [userId],
  );
  return rows[0] ?? null;
}