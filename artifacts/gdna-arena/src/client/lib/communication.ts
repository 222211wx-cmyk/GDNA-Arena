// Placeholder: original module is missing from the repository. Replace with the real implementation.
import AgoraRTC from "agora-rtc-sdk-ng";
import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";

export { AgoraRTC };
export const createAgoraClient = (): IAgoraRTCClient => AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
export const fetchAgoraToken = async (
  _channel: string,
  _deviceId?: string,
): Promise<{ appId: string; token: string; uid: number }> => {
  throw new Error("fetchAgoraToken is not implemented");
};
export const publishPeerConnection = (_pc: RTCPeerConnection | null): void => {};
