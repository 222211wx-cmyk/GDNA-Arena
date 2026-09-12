import { apiPath } from "./network";

export type CallMediaProvider = "webrtc";

export interface CallRtcConfig {
  provider: CallMediaProvider;
  turnConfigured: boolean;
  iceServers: RTCIceServer[];
  credentialExpiresAt?: number;
}

export function validateCallRtcConfig(value: unknown): CallRtcConfig {
  if (!value || typeof value !== "object") throw new Error("Invalid RTC configuration");
  const config = value as Partial<CallRtcConfig>;
  if (config.provider !== "webrtc") {
    throw new Error("Invalid RTC media provider");
  }
  if (!Array.isArray(config.iceServers)) throw new Error("Invalid ICE server list");
  const validServers = config.iceServers.every(server => {
    const urls = typeof server?.urls === "string" ? [server.urls] : server?.urls;
    return Array.isArray(urls) && urls.length > 0 &&
      urls.every(url => typeof url === "string" && /^(stun|stuns|turn|turns):/i.test(url));
  });
  if (!validServers) throw new Error("Invalid ICE server list");

  const hasTurn = config.iceServers.some(server => {
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    return urls.some(url => /^turns?:/i.test(url));
  });
  if (config.provider === "webrtc" && (config.turnConfigured !== true || !hasTurn)) {
    throw new Error("WebRTC provider requires TURN");
  }
  return config as CallRtcConfig;
}

export async function fetchCallRtcConfig(): Promise<CallRtcConfig> {
  const response = await fetch(apiPath("/api/rtc/ice-servers"), { credentials: "include" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `RTC configuration failed: HTTP ${response.status}`);
  return validateCallRtcConfig(body);
}

export function preferOpus(transceiver: RTCRtpTransceiver): void {
  const capabilities = RTCRtpReceiver.getCapabilities?.("audio");
  if (!capabilities || typeof transceiver.setCodecPreferences !== "function") return;
  const opus = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() === "audio/opus");
  if (!opus.length) return;
  const remaining = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() !== "audio/opus");
  transceiver.setCodecPreferences([...opus, ...remaining]);
}
