import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "@workspace/db";
import {
  nativeCallUUID, nativeIncomingPayload, nativeSessionHash, nativeFcmMessage, nativeApnsHeaders, validNativeToken,
} from "./native-call-payload";
import { registerNativeCallInstallation, removeNativeCallInstallation, sendNativeCallTerminalPush } from "./native-call-push";

test("native call payload is bounded, expires, sanitizes and has deterministic UUID", () => {
  const input = { callId: "call_1", callerId: 1, calleeId: 2, callerName: "\u202eAlice\n", video: true, expiresAt: new Date(2000) };
  const payload = nativeIncomingPayload(input, 1000)!;
  assert.equal(payload.callerName, "Alice");
  assert.equal(payload.expiresAt, "1970-01-01T00:00:02.000Z");
  assert.equal(payload.recipientId, "2");
  assert.equal(payload.handle, "1");
  assert.equal(payload.hasVideo, true);
  assert.match(payload.callUUID, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(payload.callUUID, nativeCallUUID("call_1"));
  assert.notEqual(payload.callUUID, nativeCallUUID("call_2"));
  assert.equal(nativeIncomingPayload(input, 2000), null);
  assert.equal(nativeIncomingPayload({ ...input, expiresAt: new Date(NaN) }, 0), null);
  assert.equal(nativeIncomingPayload({ ...input, callId: "../bad" }, 0), null);
  assert.equal(nativeIncomingPayload({ ...input, callerName: "x".repeat(200) }, 0)?.callerName.length, 100);
  const fcm = nativeFcmMessage("token", payload, 1000);
  assert.equal("notification" in fcm, false);
  assert.equal(fcm.android.priority, "high");
  assert.equal(fcm.data.hasVideo, "true");
  assert.equal(fcm.android.ttl, 1000);
  assert.deepEqual(nativeApnsHeaders("com.gdna.arena.mobile", payload.expiresAt), {
    "apns-push-type": "voip", "apns-topic": "com.gdna.arena.mobile.voip", "apns-priority": "10", "apns-expiration": "2",
  });
  assert.equal(validNativeToken("apns-voip", "a".repeat(64)), true);
  assert.equal(validNativeToken("fcm", "ExpoPushToken[abcdefghijklmnop]"), false);
  assert.equal(validNativeToken("apns-voip", "wrong"), false);
});

test("canonical session binding, account transfer, dedupe, and no terminal VoIP", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const queries: { sql: string; values: unknown[] }[] = [];
  let active = true;
  let devices = [{ id: "1", provider: "apns-voip", token: "a".repeat(64), session_hash: nativeSessionHash("session") }];
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes("SELECT sid")) return { rows: active ? [{ sid: "session" }] : [], rowCount: active ? 1 : 0 };
    if (sql.includes("SELECT id,provider")) return { rows: devices, rowCount: devices.length };
    if (sql.includes("INSERT INTO native_call_push_deliveries")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  };
  pool.query = query as typeof pool.query;
  pool.connect = (async () => ({ query, release() {} })) as unknown as typeof pool.connect;
  try {
    const body = { installationId: "device_abcdefghijkl", provider: "apns-voip", token: "a".repeat(64) };
    active = false;
    await assert.rejects(registerNativeCallInstallation(2, "session", body), /Not authenticated/);
    assert.equal(queries.some(q => q.sql.includes("INSERT INTO native_call_push_installations")), false);
    active = true;
    await registerNativeCallInstallation(2, "session", body);
    const registration = queries.find(q => q.sql.includes("INSERT INTO native_call_push_installations"))!;
    assert.deepEqual(registration.values.slice(0, 2), [2, nativeSessionHash("session")]);
    assert.ok(queries.some(q => q.sql.includes("installation_id<>$3")));
    await removeNativeCallInstallation(3, "other-session", body.installationId);
    const removal = queries.find(q => q.sql.includes("WHERE user_id=$1 AND session_hash=$2 AND installation_id=$3"))!;
    assert.deepEqual(removal.values, [3, nativeSessionHash("other-session"), body.installationId]);
    await sendNativeCallTerminalPush({ callId: "call_1", calleeId: 2, status: "ended" });
    assert.equal(queries.some(q => q.sql.includes("INSERT INTO native_call_push_deliveries")), false);
    devices = [{ ...devices[0], provider: "fcm" }];
    await sendNativeCallTerminalPush({ callId: "call_1", calleeId: 2, status: "ended" });
    const claim = queries.find(q => q.sql.includes("INSERT INTO native_call_push_deliveries"))!;
    assert.match(claim.sql, /ON CONFLICT DO NOTHING/);
    assert.deepEqual(claim.values, ["1", "call-ended:call_1"]);
    // A zero-row claim skips provider work entirely, even without credentials.
    active = false;
    queries.length = 0;
    await sendNativeCallTerminalPush({ callId: "call_1", calleeId: 2, status: "ended" });
    assert.equal(queries.some(q => q.sql.includes("SELECT id,provider")), false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});