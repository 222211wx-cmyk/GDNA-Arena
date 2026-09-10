import { createHash, createHmac } from "node:crypto";

const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];
const CREDENTIAL_TTL_SECONDS = 60 * 60;

export interface BrowserIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type IceServerResponse =
  | { provider: "agora"; turnConfigured: false; iceServers: BrowserIceServer[] }
  | {
      provider: "webrtc";
      turnConfigured: true;
      credentialExpiresAt: number;
      iceServers: BrowserIceServer[];
    };

export class TurnConfigurationError extends Error {}

export function getConfiguredCallMediaProvider(): "agora" | "webrtc" {
  return process.env.CALL_MEDIA_PROVIDER?.trim().toLowerCase() === "webrtc"
    ? "webrtc"
    : "agora";
}

export function requireReadyCallMediaProvider(): "agora" | "webrtc" {
  const provider = getConfiguredCallMediaProvider();
  if (provider === "agora") return provider;
  const turnUrls = splitUrls(process.env.TURN_URLS);
  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim() ?? "";
  if (turnUrls.length === 0 || !turnUrls.every(validTurnUrl) || sharedSecret.length < 32) {
    throw new TurnConfigurationError("WebRTC media provider is not ready");
  }
  return provider;
}

function splitUrls(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function validStunUrl(value: string): boolean {
  return /^stuns?:[^,\s]+$/i.test(value);
}

function validTurnUrl(value: string): boolean {
  return /^turns?:[^,\s]+$/i.test(value);
}

/**
 * Reads at request time so rotated TURN secrets take effect without ever being
 * serialized to a client. Agora remains the default unless explicitly opted in.
 */
export function issueIceServerConfig(
  userId: number,
  sessionId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): IceServerResponse {
  const provider = requireReadyCallMediaProvider();
  const configuredStun = splitUrls(process.env.CALL_STUN_URLS);
  const stunUrls = configuredStun.length && configuredStun.every(validStunUrl)
    ? configuredStun
    : DEFAULT_STUN_URLS;

  if (provider !== "webrtc") {
    return {
      provider: "agora",
      turnConfigured: false,
      iceServers: stunUrls.map(urls => ({ urls })),
    };
  }

  const turnUrls = splitUrls(process.env.TURN_URLS);
  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim() ?? "";
  if (
    turnUrls.length === 0 ||
    !turnUrls.every(validTurnUrl) ||
    sharedSecret.length < 32
  ) {
    throw new TurnConfigurationError(
      "WebRTC calling is selected but TURN_URLS or TURN_SHARED_SECRET is invalid",
    );
  }

  const credentialExpiresAt = nowSeconds + CREDENTIAL_TTL_SECONDS;
  // coturn REST API format: expiry is the first username component. Including
  // the authenticated user and an irreversible session tag makes credentials
  // session-specific without disclosing the HTTP session id to coturn logs.
  const sessionTag = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  const username = `${credentialExpiresAt}:${userId}:${sessionTag}`;
  const credential = createHmac("sha1", sharedSecret).update(username).digest("base64");

  return {
    provider: "webrtc",
    turnConfigured: true,
    credentialExpiresAt,
    iceServers: [
      ...stunUrls.map(urls => ({ urls })),
      { urls: turnUrls, username, credential },
    ],
  };
}
