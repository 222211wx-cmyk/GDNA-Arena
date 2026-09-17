import assert from "node:assert/strict";
import test from "node:test";
import {
  browserPushDeliveryKey,
  browserCallPushTopic,
  browserPushSessionHash,
  isAllowedBrowserPushEndpoint,
  parseBrowserPushRegistration,
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