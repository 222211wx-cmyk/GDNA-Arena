import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "@workspace/db";
import { registerExpoInstallation, removeExpoInstallation, sendExpoPush, validExpoToken, validInstallation } from "./expo-push";

test("Expo and FCM tokens are never interchangeable", () => {
  assert.equal(validExpoToken("ExpoPushToken[abcdefghijklmnop1234]"), true);
  assert.equal(validExpoToken("ExponentPushToken[abcdefghijklmnop1234]"), true);
  assert.equal(validExpoToken("fcm:abcdefghijklmnop1234"), false);
  assert.equal(validExpoToken("ExpoPushToken[abc]"), false);
  assert.equal(validInstallation("../other-device-owner"), false);
});

test("registration, session-only removal, duplicate claim and failure retry", async () => {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const queries: { sql: string; values: unknown[] }[] = [];
  let claimCount = 0;
  let failProvider = false;
  let activeSession = true;
  let sendCount = 0;
  (pool as unknown as { query: typeof pool.query }).query = (async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes("SELECT sid")) return { rows: activeSession ? [{ sid: "active-session" }] : [], rowCount: activeSession ? 1 : 0 };
    if (sql.includes("SELECT id, token")) return { rows: [{ id: "1", token: "ExpoPushToken[abcdefghijklmnop1234]" }], rowCount: 1 };
    if (sql.includes("INSERT INTO expo_push_deliveries")) return { rows: [], rowCount: claimCount++ === 1 ? 0 : 1 };
    return { rows: [], rowCount: 1 };
  }) as typeof pool.query;
  globalThis.fetch = (async () => {
    sendCount++;
    if (failProvider) throw new Error("offline");
    return { ok: true, json: async () => ({ data: { status: "ok" } }) } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(registerExpoInstallation(3, "active-session", { installationId: "device_abcdefghijkl", token: "fcm-not-expo" }), /Invalid Expo/);
    await registerExpoInstallation(3, "active-session", { installationId: "device_abcdefghijkl", token: "ExpoPushToken[abcdefghijklmnop1234]" });
    await removeExpoInstallation(4, "different-session", "device_abcdefghijkl");
    const registration = queries.find(query => query.sql.includes("INSERT INTO expo_push_installations"))!;
    const removal = queries.find(query => query.sql.includes("DELETE FROM expo_push_installations WHERE user_id=$1 AND session_hash=$2 AND installation_id=$3"))!;
    assert.equal(registration.values[0], 3);
    assert.notEqual(removal.values[1], registration.values[1]);
    assert.equal(removal.values[0], 4);
    await sendExpoPush(3, "message:1", { title: "New message", body: "Open Amis", data: { type: "message" }, ttl: 30 });
    await sendExpoPush(3, "message:1", { title: "New message", body: "Open Amis", data: { type: "message" }, ttl: 30 });
    assert.equal(sendCount, 1);
    failProvider = true;
    await sendExpoPush(3, "message:2", { title: "New message", body: "Open Amis", data: { type: "message" }, ttl: 30 });
    assert.equal(queries.some(query => query.sql.includes("DELETE FROM expo_push_deliveries")), true);
    assert.equal(queries.filter(query => query.sql.includes("DELETE FROM expo_push_installations WHERE user_id=$1 AND NOT")).length, 3);
    activeSession = false; // Logout or account-switch invalidates the canonical session.
    await sendExpoPush(3, "message:3", { title: "New message", body: "Open Amis", data: {}, ttl: 30 });
    assert.equal(sendCount, 2);
  } finally {
    (pool as unknown as { query: typeof pool.query }).query = originalQuery;
    globalThis.fetch = originalFetch;
  }
});