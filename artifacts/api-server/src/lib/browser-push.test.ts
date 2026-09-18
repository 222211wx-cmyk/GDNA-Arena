import assert from "node:assert/strict";
import test from "node:test";
import {
  browserPushDeliveryKey,
  browserCallPushTopic,
  browserPushSessionHash,
  BrowserPushRenewalConflictError,
  isAllowedBrowserPushEndpoint,
  parseBrowserPushRegistration,
  parseBrowserPushRenewal,
  renewBrowserPushSubscriptionWithClient,
} from "./browser-push";

test("browser push endpoints use only known provider hosts", () => {
  assert.equal(isAllowedBrowserPushEndpoint("https://fcm.googleapis.com/fcm/send/example"), true);
  assert.equal(isAllowedBrowserPushEndpoint("https://jmt17.google.com/fcm/send/example"), true);
  assert.equal(isAllowedBrowserPushEndpoint("https://jmt17.google.com.evil.example/push"), false);
  assert.equal(isAllowedBrowserPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/example"), true);
  assert.equal(isAllowedBrowserPushEndpoint("https://web.push.apple.com/Q/example"), true);
  assert.equal(isAllowedBrowserPushEndpoint("https://wns.notify.windows.com/w/?token=example"), true);
  assert.equal(isAllowedBrowserPushEndpoint("https://example.com/push"), false);
  assert.equal(isAllowedBrowserPushEndpoint("https://fcm.googleapis.com.evil.example/push"), false);
  assert.equal(isAllowedBrowserPushEndpoint("http://fcm.googleapis.com/push"), false);
  assert.equal(isAllowedBrowserPushEndpoint("https://user@fcm.googleapis.com/push"), false);
});

test("registration parser rejects malformed keys and installation ids", () => {
  const valid = {
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/example",
      keys: { p256dh: "abcdefghijklmnop", auth: "abcdefghijklmnop" },
    },
    installationId: "browser-installation:1",
  };
  assert.deepEqual(parseBrowserPushRegistration(valid), valid);
  assert.equal(parseBrowserPushRegistration({ ...valid, installationId: "../other" }), null);
  assert.equal(parseBrowserPushRegistration({
    ...valid,
    subscription: { ...valid.subscription, keys: { p256dh: "bad!", auth: "short" } },
  }), null);
});

const validRenewal = {
  oldEndpoint: "https://fcm.googleapis.com/fcm/send/old",
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/new",
    keys: { p256dh: "abcdefghijklmnop", auth: "abcdefghijklmnop" },
  },
};

test("renewal parser strictly validates both provider endpoints and keys", () => {
  assert.deepEqual(parseBrowserPushRenewal(validRenewal), validRenewal);
  assert.equal(parseBrowserPushRenewal({
    ...validRenewal,
    oldEndpoint: "https://example.com/stolen",
  }), null);
  assert.equal(parseBrowserPushRenewal({
    ...validRenewal,
    subscription: { ...validRenewal.subscription, endpoint: "https://fcm.googleapis.com.evil.example/new" },
  }), null);
  assert.equal(parseBrowserPushRenewal({
    ...validRenewal,
    subscription: { ...validRenewal.subscription, keys: { p256dh: "bad!", auth: "short" } },
  }), null);
  assert.equal(parseBrowserPushRenewal({ subscription: validRenewal.subscription }), null);
});

type Binding = { endpoint: string; user_id: number; session_hash: string };

function renewalClient(bindings: Binding[], updateRowCount = 1) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    client: {
      async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("SELECT endpoint, user_id, session_hash")) {
          return { rows: bindings as T[], rowCount: bindings.length };
        }
        if (sql.includes("UPDATE browser_push_subscriptions")) {
          return { rows: [] as T[], rowCount: updateRowCount };
        }
        return { rows: [] as T[], rowCount: null };
      },
    },
  };
}

test("renewal atomically changes only a binding owned by the current user and session", async () => {
  const sessionHash = browserPushSessionHash("session-a");
  const mock = renewalClient([{
    endpoint: validRenewal.oldEndpoint,
    user_id: 7,
    session_hash: sessionHash,
  }]);
  await renewBrowserPushSubscriptionWithClient(mock.client, {
    ...validRenewal,
    userId: 7,
    sessionId: "session-a",
  });
  assert.match(mock.calls[0].sql, /^BEGIN$/);
  const update = mock.calls.find(call => call.sql.includes("UPDATE browser_push_subscriptions"));
  assert.ok(update);
  assert.deepEqual(update.values?.slice(0, 1), [validRenewal.subscription.endpoint]);
  assert.equal(update.values?.[2], validRenewal.oldEndpoint);
  assert.equal(update.values?.[3], 7);
  assert.equal(update.values?.[4], sessionHash);
  assert.doesNotMatch(update.sql, /installation_id\s*=/);
  assert.match(mock.calls.at(-1)?.sql ?? "", /^COMMIT$/);
});

test("renewal cannot transfer another user or session binding", async () => {
  for (const binding of [
    { endpoint: validRenewal.oldEndpoint, user_id: 8, session_hash: browserPushSessionHash("session-a") },
    { endpoint: validRenewal.oldEndpoint, user_id: 7, session_hash: browserPushSessionHash("session-b") },
  ]) {
    const mock = renewalClient([binding]);
    await assert.rejects(
      renewBrowserPushSubscriptionWithClient(mock.client, {
        ...validRenewal, userId: 7, sessionId: "session-a",
      }),
      BrowserPushRenewalConflictError,
    );
    assert.equal(mock.calls.some(call => call.sql.includes("UPDATE browser_push_subscriptions")), false);
    assert.match(mock.calls.at(-1)?.sql ?? "", /^ROLLBACK$/);
  }
});

test("renewal rejects destination collisions without overwriting either binding", async () => {
  const sessionHash = browserPushSessionHash("session-a");
  for (const destinationOwner of [
    { user_id: 9, session_hash: browserPushSessionHash("session-c") },
    { user_id: 7, session_hash: sessionHash },
  ]) {
    const mock = renewalClient([
      { endpoint: validRenewal.oldEndpoint, user_id: 7, session_hash: sessionHash },
      { endpoint: validRenewal.subscription.endpoint, ...destinationOwner },
    ]);
    await assert.rejects(
      renewBrowserPushSubscriptionWithClient(mock.client, {
        ...validRenewal, userId: 7, sessionId: "session-a",
      }),
      BrowserPushRenewalConflictError,
    );
    assert.equal(mock.calls.some(call => call.sql.includes("UPDATE browser_push_subscriptions")), false);
  }
});

test("successful renewal retry is idempotent only for the same user and session", async () => {
  const sessionHash = browserPushSessionHash("session-a");
  const ownDestination = renewalClient([{
    endpoint: validRenewal.subscription.endpoint,
    user_id: 7,
    session_hash: sessionHash,
  }]);
  await renewBrowserPushSubscriptionWithClient(ownDestination.client, {
    ...validRenewal, userId: 7, sessionId: "session-a",
  });
  const update = ownDestination.calls.find(call => call.sql.includes("UPDATE browser_push_subscriptions"));
  assert.equal(update?.values?.[2], validRenewal.subscription.endpoint);

  const foreignDestination = renewalClient([{
    endpoint: validRenewal.subscription.endpoint,
    user_id: 7,
    session_hash: browserPushSessionHash("session-b"),
  }]);
  await assert.rejects(
    renewBrowserPushSubscriptionWithClient(foreignDestination.client, {
      ...validRenewal, userId: 7, sessionId: "session-a",
    }),
    BrowserPushRenewalConflictError,
  );
  assert.equal(foreignDestination.calls.some(call => call.sql.includes("UPDATE browser_push_subscriptions")), false);
});

test("session bindings are deterministic SHA-256 values", () => {
  const first = browserPushSessionHash("session-a");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, browserPushSessionHash("session-a"));
  assert.notEqual(first, browserPushSessionHash("session-b"));
});

test("delivery dedupe is scoped to call, type, and subscription", () => {
  const key = browserPushDeliveryKey(7, "call-1", "INCOMING_CALL");
  assert.equal(key, browserPushDeliveryKey(7, "call-1", "INCOMING_CALL"));
  assert.notEqual(key, browserPushDeliveryKey(8, "call-1", "INCOMING_CALL"));
  assert.notEqual(key, browserPushDeliveryKey(7, "call-2", "INCOMING_CALL"));
  assert.notEqual(key, browserPushDeliveryKey(7, "call-1", "CALL_ENDED"));
});

test("incoming and terminal delivery share a provider-safe call topic", () => {
  const incomingTopic = browserCallPushTopic("call-1");
  const terminalTopic = browserCallPushTopic("call-1");
  assert.equal(incomingTopic, terminalTopic);
  assert.match(incomingTopic, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(incomingTopic, browserCallPushTopic("call-2"));
});