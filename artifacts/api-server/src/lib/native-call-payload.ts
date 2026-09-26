import { createHash } from "node:crypto";

export type NativeProvider = "fcm" | "apns-voip";
export const nativeSessionHash = (sid: string) => createHash("sha256").update(sid).digest("hex");
export function nativeCallUUID(callId: string): string {
  const hex = createHash("sha256").update(callId).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function validNativeToken(provider: unknown, token: unknown): token is string {
  return typeof token === "string" && (provider === "apns-voip"
    ? /^[a-fA-F0-9]{64}$/.test(token)
    : provider === "fcm" && /^[A-Za-z0-9_:.-]{16,4096}$/.test(token));
}
export function sanitizeNativeCallerName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 100) || "Amis";
}
export interface NativeIncomingCall {
  callId: string; callerId: number; callerName: string; calleeId: number;
  expiresAt: Date; video: boolean;
}
export function nativeIncomingPayload(input: NativeIncomingCall, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.callId) ||
    !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= now) return null;
  return {
    type: "call", callId: input.callId, callUUID: nativeCallUUID(input.callId),
    recipientId: String(input.calleeId), callerName: sanitizeNativeCallerName(input.callerName),
    handle: String(input.callerId), expiresAt: input.expiresAt.toISOString(), hasVideo: input.video,
  };
}
export function nativeFcmMessage(token: string, payload: Record<string, string | boolean>, ttl: number) {
  return { token, data: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])),
    android: { priority: "high" as const, ttl: Math.max(0, ttl) } };
}
export function nativeApnsHeaders(bundleId: string, expiresAt: string) {
  return { "apns-push-type": "voip", "apns-topic": `${bundleId}.voip`,
    "apns-priority": "10", "apns-expiration": String(Math.floor(Date.parse(expiresAt) / 1000)) };
}