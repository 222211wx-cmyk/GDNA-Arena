import { pool } from "@workspace/db";
import { sendNewMessagePush } from "./firebase-call-push.js";

const MAX_MESSAGE_PUSH_RECIPIENTS = 500;

export async function fanoutMessageRecipients(
  fetchPage: (afterUserId: number, limit: number) => Promise<number[]>,
  notify: (userId: number) => Promise<void>,
  pageSize = MAX_MESSAGE_PUSH_RECIPIENTS,
): Promise<void> {
  let afterUserId = 0;
  for (;;) {
    const userIds = await fetchPage(afterUserId, pageSize);
    if (!userIds.length) return;
    await Promise.allSettled(userIds.map(notify));
    const nextAfterUserId = userIds[userIds.length - 1];
    if (nextAfterUserId <= afterUserId || userIds.length < pageSize) return;
    afterUserId = nextAfterUserId;
  }
}

/**
 * Fan out a committed message to each opted-in, unmuted room member other
 * than its author.  The SQL query intentionally returns no message content:
 * FCM receives only the privacy-safe generic contract, including for E2E
 * messages and group rooms.
 */
export async function notifyMessageRecipients(
  roomId: number,
  senderId: number,
  messageId: number,
  fromName: string,
): Promise<void> {
  if (!pool) return;
  // Keyset pagination avoids silently dropping recipients in large rooms and
  // remains stable if membership changes while fanout is in progress.
  await fanoutMessageRecipients(
    async (afterUserId, limit) => {
      const recipients = await pool.query<{ user_id: number }>(
        `SELECT m.user_id
           FROM dm_room_members m
           LEFT JOIN dm_user_settings s ON s.user_id = m.user_id
          WHERE m.room_id = $1
            AND m.user_id <> $2
            AND m.user_id > $3
            AND COALESCE(m.muted, false) = false
            AND COALESCE(s.notifications, true) = true
          ORDER BY m.user_id
          LIMIT $4`,
        [roomId, senderId, afterUserId, limit],
      );
      return recipients.rows.map(({ user_id }) => user_id);
    },
    userId => sendNewMessagePush(userId, { roomId, messageId, fromName }),
  );
}