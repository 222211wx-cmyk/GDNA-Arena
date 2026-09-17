import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import webPush from "web-push";
import { pool } from "@workspace/db";

const VAPID_ROW_ID = "primary";
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_INSTALLATION_ID_LENGTH = 128;
const MAX_KEY_LENGTH = 512;

export interface BrowserPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface IncomingCallPush {
  callId: string;
  callerName: string;
  calleeId: number;
  expiresAt: Date;
  video: boolean;
}

export interface TerminalCallPush {
  callId: string;
  calleeId: number;
  status: "answered" | "ended" | "declined" | "missed";
}

export class BrowserPushError extends Error {}

export function browserPushSessionHash(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function browserPushDeliveryKey(
  subscriptionId: number,
  callId: string,
  notificationType: "INCOMING_CALL" | "CALL_ENDED",
): string {
  return `${subscriptionId}:${notificationType}:${callId}`;
}

/** RFC 8030 Topic shared by ringing and terminal pushes so a push service may
 * replace a queued ring with its close event instead of delivering them out of order. */
export function browserCallPushTopic(callId: string): string {
  return createHash("sha256").update(`gdna-call:${callId}`).digest("base64url").slice(0, 32);
}

export function isAllowedBrowserPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_ENDPOINT_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" ||
      // Current Chromium also issues this Google Web Push endpoint. Keep the
      // allowlist exact; accepting arbitrary *.google.com would be too broad.
      host === "jmt17.google.com" ||
      host === "updates.push.services.mozilla.com" ||
      host === "push.services.mozilla.com" ||
      host === "web.push.apple.com" ||
      host === "notify.windows.com" ||
      host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function isBase64UrlKey(value: unknown, maxLength = MAX_KEY_LENGTH): value is string {
  return typeof value === "string" &&
    value.length >= 16 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

export function parseBrowserPushRegistration(value: unknown): {
  subscription: BrowserPushSubscriptionInput;
  installationId: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const subscription = body.subscription;
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) return null;
  const candidate = subscription as Record<string, unknown>;
  const keys = candidate.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return null;
  const keyValues = keys as Record<string, unknown>;
  if (!isAllowedBrowserPushEndpoint(candidate.endpoint) ||
    !isBase64UrlKey(keyValues.p256dh) ||
    !isBase64UrlKey(keyValues.auth, 128) ||
    typeof body.installationId !== "string" ||
    body.installationId.length < 1 ||
    body.installationId.length > MAX_INSTALLATION_ID_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(body.installationId)) return null;
  return {
    subscription: {
      endpoint: candidate.endpoint,
      keys: { p256dh: keyValues.p256dh, auth: keyValues.auth },
    },
    installationId: body.installationId,
  };
}

export function parseBrowserPushRemoval(value: unknown): { installationId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const installationId = (value as Record<string, unknown>).installationId;
  return typeof installationId === "string" &&
    installationId.length >= 1 &&
    installationId.length <= MAX_INSTALLATION_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(installationId)
    ? { installationId }
    : null;
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "gdna-arena-dev-secret");
  if (!secret) throw new BrowserPushError("Browser push encryption is unavailable");
  return createHash("sha256").update("browser-push:aes-gcm:v1\0").update(secret).digest();
}

function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}

function decryptJson<T>(value: string): T {
  const parts = value.split(".");
  if (parts.length !== 3) throw new BrowserPushError("Browser push key decryption failed");
  try {
    const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as T;
  } catch {
    throw new BrowserPushError("Browser push key decryption failed");
  }
}

function vapidSubject(): string {
  const subject = process.env.WEB_PUSH_SUBJECT ??
    (process.env.NODE_ENV === "production" ? "" : "mailto:web-push@localhost.invalid");
  if (!subject || (!subject.startsWith("mailto:") && !/^https:\/\//.test(subject))) {
    throw new BrowserPushError("WEB_PUSH_SUBJECT is not configured");
  }
  return subject;
}

async function durableVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (!pool) throw new BrowserPushError("Browser push database is unavailable");
  const generated = webPush.generateVAPIDKeys();
  await pool.query(
    `INSERT INTO browser_push_vapid_keys (id, public_key, encrypted_private_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [VAPID_ROW_ID, generated.publicKey, encryptJson({ privateKey: generated.privateKey })],
  );
  const result = await pool.query<{
    public_key: string;
    encrypted_private_key: string;
  }>(
    `SELECT public_key, encrypted_private_key
       FROM browser_push_vapid_keys
      WHERE id = $1`,
    [VAPID_ROW_ID],
  );
  const row = result.rows[0];
  if (!row) throw new BrowserPushError("Browser push VAPID identity is unavailable");
  const privateValue = decryptJson<{ privateKey?: unknown }>(row.encrypted_private_key);
  if (typeof privateValue.privateKey !== "string") {
    throw new BrowserPushError("Browser push key decryption failed");
  }
  return { publicKey: row.public_key, privateKey: privateValue.privateKey };
}

export async function getBrowserPushConfig(): Promise<{ enabled: true; publicKey: string }> {
  const keys = await durableVapidKeys();
  vapidSubject();
  return { enabled: true, publicKey: keys.publicKey };
}

export async function registerBrowserPushSubscription(input: {
  userId: number;
  sessionId: string;
  installationId: string;
  subscription: BrowserPushSubscriptionInput;
}): Promise<void> {
  await durableVapidKeys();
  const sessionHash = browserPushSessionHash(input.sessionId);
  const encryptedKeys = encryptJson(input.subscription.keys);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const endpointOwner = await client.query<{ user_id: number; session_hash: string }>(
      `SELECT user_id, session_hash
         FROM browser_push_subscriptions
        WHERE endpoint = $1
        FOR UPDATE`,
      [input.subscription.endpoint],
    );
    const owner = endpointOwner.rows[0];
    if (owner && (owner.user_id !== input.userId || owner.session_hash !== sessionHash)) {
      throw new BrowserPushError("Push endpoint is already registered to another session");
    }
    await client.query(
      `DELETE FROM browser_push_subscriptions
        WHERE user_id = $1 AND session_hash = $2 AND installation_id = $3
          AND endpoint <> $4`,
      [input.userId, sessionHash, input.installationId, input.subscription.endpoint],
    );
    await client.query(
      `INSERT INTO browser_push_subscriptions
         (user_id, session_hash, installation_id, endpoint, encrypted_keys)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET installation_id = EXCLUDED.installation_id,
             encrypted_keys = EXCLUDED.encrypted_keys,
             updated_at = NOW()`,
      [input.userId, sessionHash, input.installationId, input.subscription.endpoint, encryptedKeys],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeBrowserPushSubscription(input: {
  userId: number;
  sessionId: string;
  installationId: string;
}): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM browser_push_subscriptions
      WHERE user_id = $1 AND session_hash = $2 AND installation_id = $3`,
    [input.userId, browserPushSessionHash(input.sessionId), input.installationId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sendBrowserIncomingCallPush(input: IncomingCallPush): Promise<void> {
  const remainingSeconds = Math.floor((input.expiresAt.getTime() - Date.now()) / 1_000);
  const ttl = Math.min(30, remainingSeconds);
  if (ttl <= 0) return;

  const payload = JSON.stringify({
    type: "INCOMING_CALL",
    callId: input.callId,
    callerName: input.callerName,
    video: input.video,
    expiresAt: input.expiresAt.toISOString(),
    url: `/messages?callId=${encodeURIComponent(input.callId)}`,
  });
  await sendBrowserCallPayload(input.calleeId, input.callId, "INCOMING_CALL", payload, ttl);
}

/** Closes ringing cards on every callee installation after a durable terminal transition. */
export async function sendBrowserCallTerminalPush(input: TerminalCallPush): Promise<void> {
  await sendBrowserCallPayload(
    input.calleeId,
    input.callId,
    "CALL_ENDED",
    JSON.stringify({
      type: "CALL_ENDED",
      callId: input.callId,
      status: input.status,
      url: `/messages?callId=${encodeURIComponent(input.callId)}`,
    }),
    30,
  );
}

async function sendBrowserCallPayload(
  calleeId: number,
  callId: string,
  notificationType: "INCOMING_CALL" | "CALL_ENDED",
  payload: string,
  ttl: number,
): Promise<void> {
  const queueKey = `${calleeId}:${callId}`;
  const previous = callDeliveryQueues.get(queueKey) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() =>
    sendBrowserCallPayloadNow(calleeId, callId, notificationType, payload, ttl));
  callDeliveryQueues.set(queueKey, current);
  try {
    await current;
  } finally {
    if (callDeliveryQueues.get(queueKey) === current) callDeliveryQueues.delete(queueKey);
  }
}

const callDeliveryQueues = new Map<string, Promise<void>>();

async function sendBrowserCallPayloadNow(
  calleeId: number,
  callId: string,
  notificationType: "INCOMING_CALL" | "CALL_ENDED",
  payload: string,
  ttl: number,
): Promise<void> {
  const keys = await durableVapidKeys();
  const activeSessions = await pool.query<{ sid: string }>(
    `SELECT sid FROM user_sessions
      WHERE (sess->>'userId')::int = $1 AND expire > NOW()`,
    [calleeId],
  );
  const activeHashes = activeSessions.rows.map(row => browserPushSessionHash(row.sid));
  if (!activeHashes.length) {
    await pool.query(`DELETE FROM browser_push_subscriptions WHERE user_id = $1`, [calleeId]);
    return;
  }

  await pool.query(
    `DELETE FROM browser_push_subscriptions
      WHERE user_id = $1 AND NOT (session_hash = ANY($2::text[]))`,
    [calleeId, activeHashes],
  );
  const subscriptions = await pool.query<{
    id: number;
    endpoint: string;
    encrypted_keys: string;
  }>(
    `SELECT id, endpoint, encrypted_keys
       FROM browser_push_subscriptions
      WHERE user_id = $1 AND session_hash = ANY($2::text[])`,
    [calleeId, activeHashes],
  );
  console.info("[WEB_PUSH] Matching active installations", {
    notificationType, sessions: activeHashes.length, installations: subscriptions.rowCount,
  });
  webPush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);

  await Promise.allSettled(subscriptions.rows.map(async subscription => {
    if (!isAllowedBrowserPushEndpoint(subscription.endpoint)) {
      await pool.query(`DELETE FROM browser_push_subscriptions WHERE id = $1`, [subscription.id]);
      return;
    }
    // Keep the same tuple represented by the database uniqueness constraint.
    browserPushDeliveryKey(subscription.id, callId, notificationType);
    const claim = await pool.query(
      `INSERT INTO browser_push_deliveries (subscription_id, call_id, notification_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (subscription_id, call_id, notification_type) DO NOTHING
       RETURNING id`,
      [subscription.id, callId, notificationType],
    );
    if (!claim.rowCount) return;
    const subscriptionKeys = decryptJson<{ p256dh?: unknown; auth?: unknown }>(subscription.encrypted_keys);
    if (typeof subscriptionKeys.p256dh !== "string" || typeof subscriptionKeys.auth !== "string") return;
    try {
      const delivered = await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscriptionKeys.p256dh, auth: subscriptionKeys.auth },
      }, payload, {
        TTL: ttl,
        timeout: 5_000,
        urgency: "high",
        // Incoming and terminal events intentionally share a topic. If cancel
        // races the initial ring through a provider, the later close replaces
        // the queued ring and cannot leave a stale OS prompt behind.
        topic: browserCallPushTopic(callId),
      });
      console.info("[WEB_PUSH] Provider accepted delivery", { notificationType, statusCode: delivered.statusCode });
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null &&
        "statusCode" in error ? (error as { statusCode?: unknown }).statusCode : undefined;
      console.warn("[WEB_PUSH] Delivery failed", {
        notificationType,
        statusCode: typeof statusCode === "number" ? statusCode : null,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      if (statusCode === 404 || statusCode === 410) {
        await pool.query(`DELETE FROM browser_push_subscriptions WHERE id = $1`, [subscription.id]);
      }
      throw error;
    }
  }));
}