import { describe, expect, it } from "vitest";
import { validateCallRtcConfig } from "./call-rtc-config";

describe("validateCallRtcConfig", () => {
  it("accepts the default Agora/STUN response", () => {
    expect(validateCallRtcConfig({
      provider: "agora",
      turnConfigured: false,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    }).provider).toBe("agora");
  });

  it("will not route WebRTC without a TURN server", () => {
    expect(() => validateCallRtcConfig({
      provider: "webrtc",
      turnConfigured: true,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })).toThrow("requires TURN");
  });
});
