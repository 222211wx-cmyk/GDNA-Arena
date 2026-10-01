import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { withLiveSession } from "./session-security";

export const validInstallation = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
export const validExpoToken = (value: unknown): value is string =>
  typeof value === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$/.test(value);
const sessionHash = (sid: string) => createHash("sha256").update(sid).digest("hex");

export async function registerExpoInstallation(userId: number, sid: string, input: unknown) {
  const body = input as { installationId?: unknown; token?: unknown } | null;
  if (!validInstallation(body?.installationId) || !validExpoToken(body?.token)) {
    throw new Error("Invalid Expo push installation or token");
  }
  // One physical installation can only belong to one authenticated session/account.
  // An old session cannot delete a newer registration.
  await withLiveSession(userId, sid, client => client.query(
    `INSERT INTO expo_push_installations (user_id, session_hash, installation_id, token)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (installation_id) DO UPDATE
       SET user_id=EXCLUDED.user_id, session_hash=EXCLUDED.session_hash,
           token=EXCLUDED.token, updated_at=now()`,
    [userId, sessionHash(sid), body.installationId, body.token],
  ));
}

export async function removeExpoInstallation(userId: number, sid: string, installationId: unknown) {
  if (!validInstallation(installationId)) throw new Error("Invalid Expo push installation");
  await pool.query(
    `DELETE FROM expo_push_installations WHERE user_id=$1 AND session_hash=$2 AND installation_id=$3`,
    [userId, sessionHash(sid), installationId],
  );
}

type Notification = {
  title: string;
  body: string;
  data: Record<string, string>;
  ttl: number;
};

export async function sendExpoPush(userId: number, eventKey: string, notification: Notification): Promise<void> {
  // Canonical PG sessions, not just a client-provided account ID, authorize delivery.
  const sessions = await pool.query<{ sid: string }>(
    `SELECT s.sid FROM user_sessions s JOIN users u ON u.id=$1
     WHERE s.sess->>'userId'=$1::text AND s.expire>now()
       AND COALESCE(s.sess->>'credentialEpoch','0')=u.credential_epoch::text`,
    [userId],
  );
  const hashes = sessions.rows.map(row => sessionHash(row.sid));
  await pool.query(
    `DELETE FROM expo_push_installations WHERE user_id=$1 AND NOT (session_hash=ANY($2::text[]))`,
    [userId, hashes],
  );
  if (!hashes.length) return;
  const devices = await pool.query<{ id: string; token: string }>(
    `SELECT e.id, e.token FROM expo_push_installations e
     WHERE e.user_id=$1 AND e.session_hash=ANY($2::text[])
       AND ($3::boolean=false OR NOT EXISTS (
         SELECT 1 FROM native_call_push_installations n
         WHERE n.installation_id=e.installation_id AND n.user_id=e.user_id
           AND n.session_hash=e.session_hash AND n.provider='fcm'
       )) LIMIT 500`,
    [userId, hashes, notification.data.type === "call"],
  );
  for (const device of devices.rows) {
    await pool.query(
      "DELETE FROM expo_push_deliveries WHERE installation_id=$1 AND created_at < now() - interval '7 days'",
      [device.id],
    );
    const claimed = await pool.query(
      `INSERT INTO expo_push_deliveries (installation_id,event_key) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING installation_id`,
      [device.id, eventKey],
    );
    if (!claimed.rowCount) continue;
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ to: device.token, title: notification.title, body: notification.body,
          data: notification.data, ttl: notification.ttl, sound: "default", channelId: "amis" }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
      const ticket = await response.json() as { data?: { status?: string; details?: { error?: string } } };
      if (ticket.data?.details?.error === "DeviceNotRegistered") {
        await pool.query("DELETE FROM expo_push_installations WHERE id=$1 AND token=$2", [device.id, device.token]);
        continue;
      }
      if (ticket.data?.status !== "ok") throw new Error("Expo push rejected the notification");
    } catch {
      await pool.query("DELETE FROM expo_push_deliveries WHERE installation_id=$1 AND event_key=$2", [device.id, eventKey]);
      // Never log tokens, bodies or private contents.
      logger.warn("Expo push delivery unavailable");
    }
  }
}