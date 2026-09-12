export type NotificationCallAction = "answer" | "decline";

export interface PendingNotificationCallAction {
  callId: string;
  action: NotificationCallAction;
  accountId: number;
  expiresAt: number;
  resumeSent: boolean;
}

export function readNotificationCallAction(search: string): Omit<PendingNotificationCallAction, "accountId" | "expiresAt" | "resumeSent"> | null {
  const params = new URLSearchParams(search);
  const callId = params.get("callId");
  const action = params.get("action");
  if (!callId || !/^[A-Za-z0-9_-]{1,128}$/.test(callId) || (action !== "answer" && action !== "decline")) {
    return null;
  }
  return { callId, action };
}

export function canApplyNotificationCallAction(
  pending: PendingNotificationCallAction | null,
  accountId: number | undefined,
  incomingCallId: string | undefined,
  now = Date.now(),
): boolean {
  return !!pending && pending.accountId === accountId && pending.callId === incomingCallId && pending.expiresAt > now;
}

/** Terminal snapshots/events can only tear down their own exact call id. */
export function shouldClearTerminalCall(currentCallId: string | null, terminalCallId: string): boolean {
  return currentCallId !== null && currentCallId === terminalCallId;
}