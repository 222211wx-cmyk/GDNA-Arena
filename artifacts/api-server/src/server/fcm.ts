import {
  registerCallPushDevice,
  sendAuthenticatedFcmPush,
  type FcmSendRequest,
} from "../lib/firebase-call-push";

/** Thin entrypoints preserve the existing session-bound device and derived-recipient implementation. */
export async function registerFcmDevice(userId: number, sessionId: string, payload: { token: unknown; installationId: unknown; focused: unknown }): Promise<void> {
  await registerCallPushDevice(userId, sessionId, payload);
  console.info("[FCM] device registered", { userId });
}

export async function sendDerivedFcm(userId: number, request: FcmSendRequest) {
  const result = await sendAuthenticatedFcmPush(userId, request);
  console.info("[FCM] send requested", { userId });
  return result;
}