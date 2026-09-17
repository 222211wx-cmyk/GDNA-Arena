import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { issueIceServerConfig, TurnConfigurationError } from "./turn-config";

const originalEnv = { ...process.env };

test("independent TURN diagnostics issue relay credentials while Agora is selected", () => {
  try {
    process.env.CALL_MEDIA_PROVIDER = "agora";
    process.env.TURN_URLS = "turn:relay.example.test:3478?transport=udp";
    process.env.TURN_SHARED_SECRET = "test-only-shared-secret-with-32-characters";
    const result = issueIceServerConfig(7, "session-a", 1000, "webrtc");
    assert.equal(result.provider, "webrtc");
    assert.equal(result.turnConfigured, true);
    assert.equal(result.iceServers.some(server => !!server.credential), true);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("ICE config preserves Agora and returns STUN only by default", () => {
  try {
    delete process.env.CALL_MEDIA_PROVIDER;
    const result = issueIceServerConfig(7, "session-a", 1000);
    assert.equal(result.provider, "agora");
    assert.equal(result.turnConfigured, false);
    assert.equal(result.iceServers.every(server => String(server.urls).startsWith("stun:")), true);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("ICE config fails closed when WebRTC is explicitly misconfigured", () => {
  try {
    process.env.CALL_MEDIA_PROVIDER = "webrtc";
    delete process.env.TURN_URLS;
    delete process.env.TURN_SHARED_SECRET;
    assert.throws(() => issueIceServerConfig(7, "session-a", 1000), TurnConfigurationError);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("ICE config issues coturn REST credentials without exposing its secret", () => {
  try {
    process.env.CALL_MEDIA_PROVIDER = "webrtc";
    process.env.TURN_URLS = "turn:turn.example.com:3478,turns:turn.example.com:443?transport=tcp";
    process.env.TURN_SHARED_SECRET = "a-secret-that-is-at-least-thirty-two-bytes";
    const result = issueIceServerConfig(42, "session-a", 1000);
    assert.equal(result.provider, "webrtc");
    if (result.provider !== "webrtc") throw new Error("unexpected provider");
    const turn = result.iceServers.at(-1)!;
    assert.equal(turn.username, "4600:42:fa57a52dbf081902");
    assert.equal(turn.credential,
      createHmac("sha1", process.env.TURN_SHARED_SECRET)
        .update("4600:42:fa57a52dbf081902")
        .digest("base64"),
    );
    assert.equal(JSON.stringify(result).includes(process.env.TURN_SHARED_SECRET), false);
  } finally {
    process.env = { ...originalEnv };
  }
});
