// Push notifications are disabled. Every entry point is a no-op so callers never crash.
export function isValidCallId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export class CallPushError extends Error {
  constructor(message: string) { super(message); this.name = "CallPushError"; }
}
const off = (): void => { console.log("push disabled"); };
export function startFirebaseCallExpirationSweep(): void { off(); }
export async function revokeCallPushSession(_userId: number, _sessionId: string): Promise<boolean> { off(); return true; }
export async function revokeAllCallPushSessions(_userId: number, _opts?: unknown): Promise<boolean> { off(); return true; }
export async function sendNewMessagePush(_userId: number, _msg: unknown): Promise<void> { off(); }
export async function sendAuthoritativeGroupCallPush(_msg: unknown): Promise<void> { off(); }
export function callSessionBinding(sessionId: string): string { return sessionId; }
export async function getNativeCallMessaging(): Promise<{ send(message: unknown): Promise<string> }> {
  return { send: async () => { off(); return "push-disabled"; } };
}
export async function getCallPushStatus() {
  return { enabled: false, reason: "Push disabled", callAuthorityReady: true, pushEnabled: false, pushReason: "Push disabled" };
}
export async function createCallPushSession(_u: number, _s: string, _e?: Date): Promise<{ ok: true; enabled: false }> { off(); return { ok: true, enabled: false }; }
export async function registerCallPushDevice(..._a: unknown[]): Promise<void> { off(); }
export async function removeCallPushDevice(..._a: unknown[]): Promise<void> { off(); }
export async function setCallPushFocus(..._a: unknown[]): Promise<void> { off(); }
export async function listMissedCalls(_userId: number): Promise<{ calls: never[] }> { off(); return { calls: [] }; }
export async function markMissedCallsSeen(..._a: unknown[]): Promise<void> { off(); }
export function parseFcmSendRequest(body: unknown): { kind: "call"; callId: string } | null {
  const b = body as { kind?: unknown; callId?: unknown } | null;
  return b?.kind === "call" && isValidCallId(b.callId) ? { kind: "call", callId: b.callId } : null;
}
