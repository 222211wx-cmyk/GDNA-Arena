import assert from "node:assert/strict";
import test from "node:test";
import {
  durableTerminalStatus,
  durableTerminalUpdate,
  evaluateDeferredCallDecline,
  firebaseReadiness,
  isPushSessionActive,
  newMessagePushPayload,
  shouldRevokeFirebaseRefreshTokens,
} from "./firebase-call-push.js";

test("caller cancellation and timeout map a ringing invitation to canonical missed", () => {
  assert.equal(durableTerminalStatus("ringing", true), "missed");
  assert.deepEqual(
    durableTerminalUpdate("missed", new Date("2026-01-01T00:00:00.000Z")),
    { status: "missed", endedAt: new Date("2026-01-01T00:00:00.000Z") },
  );
});

test("callee rejection maps a ringing invitation to canonical declined", () => {
  assert.equal(durableTerminalStatus("ringing", false), "declined");
});

test("an accepted WebSocket call ends without changing durable answered status", () => {
  assert.equal(durableTerminalStatus("accepted", true), "ended");
  const endedAt = new Date("2026-01-01T00:01:00.000Z");
  assert.deepEqual(durableTerminalUpdate("ended", endedAt), { endedAt });
});

test("missing VAPID disables push without disabling Firestore readiness", () => {
  assert.deepEqual(firebaseReadiness(true, true, false), {
    enabled: true,
    pushEnabled: false,
    pushReason: "Firebase web push VAPID key is not configured",
  });
});

test("HTTP/WS decline authorization is callee-only", () => {
  const decision = evaluateDeferredCallDecline({
    calleeId: 41,
    invitationCalleeId: 42,
    status: "ringing",
    expiresAt: new Date("2026-01-01T00:01:00.000Z"),
  }, new Date("2026-01-01T00:00:00.000Z"));
  assert.deepEqual(decision, { outcome: "not-callee", changed: false });
});

test("decline is idempotent after expiry and terminal completion", () => {
  const expired = evaluateDeferredCallDecline({
    calleeId: 42,
    invitationCalleeId: 42,
    status: "ringing",
    expiresAt: new Date("2026-01-01T00:00:00.000Z"),
  }, new Date("2026-01-01T00:00:30.000Z"));
  assert.deepEqual(expired, { outcome: "expired", changed: true, status: "missed" });

  const repeated = evaluateDeferredCallDecline({
    calleeId: 42,
    invitationCalleeId: 42,
    status: "missed",
    expiresAt: new Date("2026-01-01T00:00:00.000Z"),
  }, new Date("2026-01-01T00:00:31.000Z"));
  assert.deepEqual(repeated, { outcome: "finished", changed: false, status: "missed" });
});

test("message push payload is generic, addressable, and never includes plaintext", () => {
  assert.deepEqual(newMessagePushPayload({
    roomId: 42,
    messageId: 99,
    fromName: "alice",
  }), {
    type: "NEW_MESSAGE",
    roomId: "42",
    messageId: "99",
    fromName: "alice",
    title: "رسالة جديدة",
    body: "لديك رسالة جديدة",
    url: "/messages?roomId=42",
  });
});

test("background fanout requires an unrevoked, unexpired registration session", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(isPushSessionActive({
    revokedAt: null,
    expiresAt: new Date(now + 1_000),
  }, now), true);
  assert.equal(isPushSessionActive({
    revokedAt: null,
    expiresAt: new Date(now),
  }, now), false);
  assert.equal(isPushSessionActive({
    revokedAt: new Date(now - 1_000),
    expiresAt: new Date(now + 1_000),
  }, now), false);
  assert.equal(isPushSessionActive({
    expiresAt: new Date(now + 1_000),
  }, now), false);
});

test("refresh-token revocation is reserved for all-session cleanup", () => {
  assert.equal(shouldRevokeFirebaseRefreshTokens(), true);
  assert.equal(shouldRevokeFirebaseRefreshTokens("old-session-id"), false);
});
