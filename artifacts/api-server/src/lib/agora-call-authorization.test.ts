import assert from "node:assert/strict";
import test from "node:test";
import type { CallRecord } from "./call-signal-store";
import { canIssueAgoraCallToken } from "./agora-call-authorization";

const call = {
  caller: { id: 1 }, callee: { id: 2 }, callerSessionTag: "caller-session",
  callerDeviceId: "caller-device", status: "ringing", transport: { provider: "agora" },
  expiresAt: new Date(2000),
} as CallRecord;

test("only initiating caller can fetch a ringing channel token", () => {
  assert.equal(canIssueAgoraCallToken(call, 1, "caller-session", "caller-device", 1000), true);
  assert.equal(canIssueAgoraCallToken(call, 1, "other-session", "caller-device", 1000), false);
  assert.equal(canIssueAgoraCallToken(call, 1, "caller-session", "other-device", 1000), false);
  assert.equal(canIssueAgoraCallToken(call, 2, "callee-session", "callee-device", 1000), false);
});

test("callee must explicitly answer on the selected device/session", () => {
  const answered: CallRecord = { ...call, status: "answered", answerer: {
    userId: 2, sessionTag: "callee-session", deviceId: "callee-device",
  } };
  assert.equal(canIssueAgoraCallToken(answered, 2, "callee-session", "callee-device"), true);
  assert.equal(canIssueAgoraCallToken(answered, 2, "other-session", "callee-device"), false);
  assert.equal(canIssueAgoraCallToken(answered, 2, "callee-session", "losing-device"), false);
  assert.equal(canIssueAgoraCallToken({ ...answered, endedAt: new Date() }, 2, "callee-session", "callee-device"), false);
});

test("expired, terminal, wrong-provider and unknown calls never mint tokens", () => {
  for (const candidate of [null, call, { ...call, status: "declined" as const },
    { ...call, transport: { provider: "webrtc" as const, version: 1 as const } }]) {
    assert.equal(canIssueAgoraCallToken(candidate, 1, "caller-session", "caller-device", 3000), false);
  }
});