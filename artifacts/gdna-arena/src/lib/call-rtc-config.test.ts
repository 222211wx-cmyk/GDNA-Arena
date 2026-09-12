import { describe, expect, it } from "vitest";
import { validateCallRtcConfig } from "./call-rtc-config";

describe("validateCallRtcConfig", () => {
  it("accepts the authenticated WebRTC/TURN response", () => {
    expect(validateCallRtcConfig({
      provider: "webrtc",
      turnConfigured: true,
      iceServers: [{ urls: "turns:turn.example.test:443", username: "citizen", credential: "token" }],
    }).provider).toBe("webrtc");
  });

  it("will not route WebRTC without a TURN server", () => {
    expect(() => validateCallRtcConfig({
      provider: "webrtc",
      turnConfigured: true,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })).toThrow("requires TURN");
  });
});
