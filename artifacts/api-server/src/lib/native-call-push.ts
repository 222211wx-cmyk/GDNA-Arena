import { sign } from "node:crypto";
import { connect } from "node:http2";
import { pool } from "@workspace/db";
import { validInstallation } from "./expo-push";
import { logger } from "./logger";
import { getNativeCallMessaging } from "./firebase-call-push";
import { getCallStateDb } from "./call-state-db";
import {
  nativeSessionHash, validNativeToken, nativeIncomingPayload, nativeFcmMessage,
  nativeApnsHeaders, nativeCallUUID, type NativeIncomingCall, type NativeProvider,
} from "./native-call-payload";

export async function registerNativeCallInstallation(userId: number, sid: string, input: unknown) {
  const body = input as { installationId?: unknown; provider?: unknown; token?: unknown } | null;
  if (!validInstallation(body?.installationId) || !validNativeToken(body?.provider, body?.token)) {
    throw new Error("Invalid native call installation, provider or token");
  }
  if (body.provider === "apns-voip" && process.env.APNS_VOIP_ENABLED !== "true") {
    throw new Error("iOS VoIP calls are disabled; APNs registration is unavailable");
  }
  const token = body.provider === "apns-voip" ? body.token.toLowerCase() : body.token;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Check canonical session at mutation time, not a supplied user ID or stale session mirror.
    const session = await client.query(
      "SELECT sid FROM user_sessions WHERE sid=$1 AND (sess->>'userId')::int=$2 AND expire>now()",
      [sid, userId],
    );
    if (!session.rowCount) throw new Error("Not authenticated");
    // Transfer a rotated/reinstalled device token rather than leave an old account owner.
    await client.query("DELETE FROM native_call_push_installations WHERE provider=$1 AND token=$2 AND installation_id<>$3",
      [body.provider, token, body.installationId]);
    await client.query(
      `INSERT INTO native_call_push_installations (user_id,session_hash,installation_id,provider,token)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (installation_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,session_hash=EXCLUDED.session_hash,provider=EXCLUDED.provider,
       token=EXCLUDED.token,updated_at=now()`,
      [userId, nativeSessionHash(sid), body.installationId, body.provider, token],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function removeNativeCallInstallation(userId: number, sid: string, id: unknown) {
  if (!validInstallation(id)) throw new Error("Invalid native call installation");
  await pool.query(
    "DELETE FROM native_call_push_installations WHERE user_id=$1 AND session_hash=$2 AND installation_id=$3",
    [userId, nativeSessionHash(sid), id],
  );
}

export function nativeApnsConfigurationProblem(): string | null {
  if (process.env.APNS_VOIP_ENABLED !== "true") return "APNs VoIP disabled: set APNS_VOIP_ENABLED=true only after Apple provisioning";
  const required = ["APNS_VOIP_KEY_P8", "APNS_VOIP_KEY_ID", "APNS_VOIP_TEAM_ID", "APNS_VOIP_BUNDLE_ID", "APNS_VOIP_ENVIRONMENT"];
  const missing = required.filter(key => !process.env[key]?.trim());
  if (missing.length) return `APNs VoIP unavailable: missing ${missing.join(", ")}`;
  if (!["production", "sandbox"].includes(process.env.APNS_VOIP_ENVIRONMENT!)) {
    return "APNs VoIP unavailable: APNS_VOIP_ENVIRONMENT must be production or sandbox";
  }
  return null;
}

async function sendApns(token: string, payload: NonNullable<ReturnType<typeof nativeIncomingPayload>>) {
  const problem = nativeApnsConfigurationProblem();
  if (problem) { logger.warn(problem); throw new Error("APNs VoIP unavailable"); }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "ES256", kid: process.env.APNS_VOIP_KEY_ID })}.${encode({
    iss: process.env.APNS_VOIP_TEAM_ID, iat: Math.floor(Date.now() / 1000),
  })}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: process.env.APNS_VOIP_KEY_P8!.replace(/\\n/g, "\n"), dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const host = process.env.APNS_VOIP_ENVIRONMENT === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  return new Promise<void>((resolve, reject) => {
    const client = connect(`https://${host}`);
    const timer = setTimeout(() => finish(new Error("APNs VoIP timeout")), 8000);
    function finish(error?: Error) {
      clearTimeout(timer);
      client.destroy();
      if (error) reject(error); else resolve();
    }
    client.on("error", () => finish(new Error("APNs VoIP connection unavailable")));
    const request = client.request({
      ":method": "POST", ":path": `/3/device/${token}`,
      authorization: `bearer ${signingInput}.${signature}`,
      ...nativeApnsHeaders(process.env.APNS_VOIP_BUNDLE_ID!, payload.expiresAt),
    });
    let status = 0;
    request.on("response", headers => { status = Number(headers[":status"]); });
    request.on("data", () => {}); // Provider bodies may contain sensitive diagnostics; never log them.
    request.on("end", () => finish(status === 200 ? undefined : new Error(`APNs VoIP HTTP ${status}`)));
    request.on("error", () => finish(new Error("APNs VoIP request unavailable")));
    request.end(JSON.stringify({ aps: {}, ...payload }));
  });
}

type Device = { id: string; provider: NativeProvider; token: string; session_hash: string };
export async function sendNativeIncomingCallPush(input: NativeIncomingCall): Promise<void> {
  const payload = nativeIncomingPayload(input);
  if (!payload) return;
  await deliver(input.calleeId, `call:${input.callId}`, payload);
}
export async function sendNativeCallTerminalPush(input: { callId: string; calleeId: number; status: string }): Promise<void> {
  await deliver(input.calleeId, `call-ended:${input.callId}`, {
    type: "call-ended", callId: input.callId, callUUID: nativeCallUUID(input.callId),
    recipientId: String(input.calleeId), status: input.status,
  });
}

async function activeHashes(userId: number): Promise<string[]> {
  const sessions = await pool.query<{ sid: string }>(
    "SELECT sid FROM user_sessions WHERE (sess->>'userId')::int=$1 AND expire>now()", [userId]);
  return sessions.rows.map(row => nativeSessionHash(row.sid));
}
async function deliver(userId: number, eventKey: string, payload: Record<string, string | boolean>) {
  const hashes = await activeHashes(userId);
  await pool.query("DELETE FROM native_call_push_installations WHERE user_id=$1 AND NOT (session_hash=ANY($2::text[]))",
    [userId, hashes]);
  if (!hashes.length) return;
  const devices = await pool.query<Device>(
    "SELECT id,provider,token,session_hash FROM native_call_push_installations WHERE user_id=$1 AND session_hash=ANY($2::text[]) LIMIT 500",
    [userId, hashes]);
  for (const device of devices.rows) {
    // Apple allows VoIP pushes only for actual incoming calls, never cancellation.
    if (device.provider === "apns-voip" && payload.type !== "call") continue;
    // Historical registrations cannot reactivate APNs while the feature is disabled.
    if (device.provider === "apns-voip" && process.env.APNS_VOIP_ENABLED !== "true") continue;
    const ttl = payload.type === "call" ? Date.parse(String(payload.expiresAt)) - Date.now() : 30_000;
    if (ttl <= 0 || !(await activeHashes(userId)).includes(device.session_hash)) continue;
    // Re-read after any provider delay: a queued ring must not revive a terminal invitation.
    if (payload.type === "call") {
      const snapshot = await (await getCallStateDb()).collection("callInvites").doc(String(payload.callId)).get();
      const call = snapshot.data();
      if (!call || call.toId !== userId || call.status !== "ringing" ||
        !(call.expiresAt instanceof Date) || call.expiresAt.getTime() <= Date.now()) continue;
    }
    const ownership = await pool.query(
      "SELECT id FROM native_call_push_installations WHERE id=$1 AND user_id=$2 AND session_hash=$3 AND token=$4",
      [device.id, userId, device.session_hash, device.token]);
    if (!ownership.rowCount) continue;
    const claim = await pool.query(
      `INSERT INTO native_call_push_deliveries (installation_id,event_key) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING installation_id`, [device.id, eventKey]);
    if (!claim.rowCount) continue;
    try {
      if (device.provider === "fcm") {
        await (await getNativeCallMessaging()).send(nativeFcmMessage(device.token, payload, ttl));
      } else {
        await sendApns(device.token, payload as NonNullable<ReturnType<typeof nativeIncomingPayload>>);
      }
    } catch {
      await pool.query("DELETE FROM native_call_push_deliveries WHERE installation_id=$1 AND event_key=$2", [device.id, eventKey]);
      logger.warn({ provider: device.provider }, "Native call push unavailable; check provider configuration and device registration");
    }
  }
}