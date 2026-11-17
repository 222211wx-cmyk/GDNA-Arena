// Placeholder: original module is missing from the repository. Replace with the real implementation.
import { stub, type StubFn } from "./_stub";

export type FirebaseStatus = any;
export type MissedCall = any;
export const PUSH_LOGOUT_EVENT: any = stub("PUSH_LOGOUT_EVENT");
export interface CallFirebase {
  enabled: boolean;
  pushEnabled: boolean;
  pushReason?: string;
  ready: Promise<void>;
  cleanup: () => Promise<void>;
  enableMessaging: (isCurrent: () => boolean) => Promise<NotificationPermission | { permission: NotificationPermission; cleanup: () => Promise<void> }>;
  [key: string]: any;
}
export const createCallFirebase = async (..._args: Array<((...a: any[]) => any) | {} | null | undefined>): Promise<CallFirebase> => ({
  enabled: false,
  pushEnabled: false,
  ready: Promise.resolve(),
  cleanup: async () => {},
  enableMessaging: async () => "default" as NotificationPermission,
});
export const fetchMissedCalls: StubFn = stub("fetchMissedCalls");
export const markMissedCallsSeen: StubFn = stub("markMissedCallsSeen");
