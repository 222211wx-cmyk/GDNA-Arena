import type { CallRecord } from "./call-signal-store";

export function canIssueAgoraCallToken(
  call: CallRecord | null, userId: number, sessionTag: string, deviceId: string, now = Date.now(),
): boolean {
  if (!call || call.endedAt || call.transport.provider !== "agora" ||
      (call.status !== "ringing" && call.status !== "answered") ||
      (call.status === "ringing" && call.expiresAt.getTime() <= now)) return false;
  if (call.caller.id === userId) {
    return call.callerSessionTag === sessionTag && call.callerDeviceId === deviceId;
  }
  return call.status === "answered" && call.callee.id === userId &&
    call.answerer?.userId === userId && call.answerer.sessionTag === sessionTag &&
    call.answerer.deviceId === deviceId;
}