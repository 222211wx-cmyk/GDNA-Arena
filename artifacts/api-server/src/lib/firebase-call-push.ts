import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { DEFERRED_INVITATION_TTL_MS } from "./deferred-call-policy";
import { parseServiceAccount, selectServiceAccount } from "./firebase-service-account.mjs";

const FOCUS_FRESH_MS = 30_000;
const DEVICE_BATCH_SIZE = 500;
const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 5;
const INCOMING_PUSH_TTL_SECONDS = 30;
const MISSED_PUSH_TTL_SECONDS = 86_400;

export function isValidCallId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

type CallType = "video" | "voice";
type CallStatus = "ringing" | "answered" | "declined" | "missed";
type DeferredTerminalStatus = "declined" | "missed" | "ended";

export interface CallerIdentity {
  id: number;
  name: string;
  avatar: string | null;
}

export interface DeferredCallInvitation {
  callId: string;
  caller: CallerIdentity;
  calleeId: number;
  type: CallType;
  createdAt?: Date;
  expiresAt?: Date;
}

export type DeferredCallDeclineOutcome =
  | "declined"
  | "expired"
  | "finished"
  | "not-found"
  | "not-callee";

export interface DeferredCallDeclineResult {
  callId: string;
  outcome: DeferredCallDeclineOutcome;
  changed: boolean;
  status?: CallStatus;
  callerId?: number;
  callerName?: string;
  callerAvatar?: string | null;
  calleeId?: number;
  type?: CallType;
}

interface FirebaseServices {
  db: Firestore;
  auth: Auth;
  messaging: Messaging;
}

interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}

export interface CallPushStatus {
  enabled: boolean;
  reason?: string;
  firebase?: PublicFirebaseConfig;
  /** Durable Firestore invitations can work without browser push credentials. */
  pushEnabled?: boolean;
  pushReason?: string;
  vapidPublicKey?: string;
}

export function firebaseReadiness(
  serviceAccountConfigured: boolean,
  webConfigConfigured: boolean,
  vapidConfigured: boolean,
): Pick<CallPushStatus, "enabled" | "reason" | "pushEnabled" | "pushReason"> {
  if (!serviceAccountConfigured) {
    return { enabled: false, reason: "Firebase service account is not configured" };
  }
  if (!webConfigConfigured) {
    return { enabled: false, reason: "Firebase web configuration is not configured" };
  }
  if (!vapidConfigured) {
    return {
      enabled: true,
      pushEnabled: false,
      pushReason: "Firebase web push VAPID key is not configured",
    };
  }
  return { enabled: true, pushEnabled: true };
}

export class CallPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallPushError";
  }
}

let servicesPromise: Promise<FirebaseServices> | undefined;

/**
 * Maps the WebSocket's terminal state to the durable invitation contract.
 * `ended` is intentionally transport-only: an answered Firestore invitation
 * keeps status=answered and records its completion with endedAt.
 */
export function durableTerminalStatus(
  wsStatus: "ringing" | "accepting" | "accepted",
  callerInitiated: boolean,
): DeferredTerminalStatus {
  if (wsStatus === "accepted") return "ended";
  return callerInitiated ? "missed" : "declined";
}

export function durableTerminalUpdate(
  status: DeferredTerminalStatus,
  endedAt: Date,
): { status?: Exclude<CallStatus, "ringing" | "answered">; endedAt: Date } {
  return status === "ended" ? { endedAt } : { status, endedAt };
}

function sessionTag(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

function asPublicConfig(): PublicFirebaseConfig | null {
  const raw = process.env.FIREBASE_WEB_CONFIG?.trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const keys = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"] as const;
    if (!keys.every(key => typeof value[key] === "string" && value[key].trim().length > 0)) return null;
    return {
      apiKey: value.apiKey as string,
      authDomain: value.authDomain as string,
      projectId: value.projectId as string,
      messagingSenderId: value.messagingSenderId as string,
      appId: value.appId as string,
    };
  } catch {
    return null;
  }
}

let lastAccountParseError: string | null = null;

function readServiceAccount(): Record<string, unknown> | null {
  return parseServiceAccount(selectServiceAccount(process.env)).account;
}

function adminConfigurationProblem(): string | null {
  const { error } = parseServiceAccount(selectServiceAccount(process.env));
  if (error && error !== lastAccountParseError) console.error("[Firebase]", error);
  lastAccountParseError = error;
  return error;
}

function clientConfigurationProblem(): string | null {
  const config = asPublicConfig();
  if (!config) return "Firebase web configuration is not configured";
  const account = readServiceAccount();
  if (account && account.project_id !== config.projectId) {
    return "Firebase service account and web configuration belong to different projects";
  }
  return null;
}

function pushConfigurationProblem(): string | null {
  const adminProblem = adminConfigurationProblem();
  if (adminProblem) return adminProblem;
  const clientProblem = clientConfigurationProblem();
  if (clientProblem) return clientProblem;
  if (!process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim()) return "Firebase web push VAPID key is not configured";
  return null;
}

// Firestore invitation persistence and custom-token issuance do not require
// browser push. Keep the durable lifecycle available when VAPID is absent.
function configurationProblem(): string | null {
  return adminConfigurationProblem() ?? clientConfigurationProblem();
}

export function isFirebaseCallPushConfigured(): boolean {
  return configurationProblem() === null;
}

async function loadServices(): Promise<FirebaseServices> {
  const problem = configurationProblem();
  if (problem) throw new CallPushError(problem);
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const account = readServiceAccount();
      if (!account) throw new CallPushError("Firebase service account is not configured");
      console.info("[Firebase] Service account parsed successfully");
      let app: App;
      try {
        app = getApps()[0] ?? initializeApp({ credential: cert(account) });
      } catch {
        throw new CallPushError("Firebase Admin initialization failed");
      }
      return { db: getFirestore(app), auth: getAuth(app), messaging: getMessaging(app) };
    })().catch(error => {
      servicesPromise = undefined;
      if (error instanceof CallPushError) throw error;
      throw new CallPushError("Firebase Admin initialization failed");
    });
  }
  return servicesPromise;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return fallback;
}

function callRef(db: Firestore, callId: string) {
  return db.collection("callInvites").doc(callId);
}

function userRef(db: Firestore, userId: number) {
  return db.collection("users").doc(String(userId));
}

function missedRef(db: Firestore, userId: number, callId: string) {
  return userRef(db, userId).collection("missedCalls").doc(callId);
}

function invitationPayload(invitation: DeferredCallInvitation) {
  const createdAt = invitation.createdAt ?? new Date();
  const maximumExpiry = new Date(createdAt.getTime() + DEFERRED_INVITATION_TTL_MS);
  const requestedExpiry = invitation.expiresAt?.getTime();
  const expiresAt = Number.isFinite(requestedExpiry)
    ? new Date(Math.min(requestedExpiry as number, maximumExpiry.getTime()))
    : maximumExpiry;
  // Keep the Firestore contract independent from the WebSocket's caller/callee
  // vocabulary. The latter remains internal transport state.
  return {
    fromId: invitation.caller.id,
    fromName: invitation.caller.name,
    toId: invitation.calleeId,
    status: "ringing" as const,
    type: invitation.type,
    createdAt,
    expiresAt,
    fromAvatar: invitation.caller.avatar,
    deferredMedia: true,
  };
}

async function deviceTokens(
  db: Firestore,
  userId: number,
  includeFocused: boolean,
): Promise<{ token: string; ref: FirebaseFirestore.DocumentReference }[]> {
  const snapshot = await userRef(db, userId).collection("devices").limit(DEVICE_BATCH_SIZE).get();
  const cutoff = Date.now() - FOCUS_FRESH_MS;
  return snapshot.docs.flatMap(doc => {
    const value = doc.data();
    if (value.configurationId !== pushConfigurationId()) return [];
    if (typeof value.token !== "string" || value.token.length < 20 || value.token.length > 4096) return [];
    const focusAt = dateValue(value.focusUpdatedAt, new Date(0)).getTime();
    const focused = value.focused === true && focusAt >= cutoff;
    return includeFocused || !focused ? [{ token: value.token, ref: doc.ref }] : [];
  });
}

async function sendPush(
  services: FirebaseServices,
  userId: number,
  data: Record<string, string>,
  notification?: { title: string; body: string },
  includeFocused = false,
  ttlSeconds = INCOMING_PUSH_TTL_SECONDS,
): Promise<void> {
  // VAPID is a browser-push credential, not a Firestore credential. The
  // invitation must already be persisted before this best-effort path runs.
  if (pushConfigurationProblem()) return;
  try {
    const devices = await deviceTokens(services.db, userId, includeFocused);
    if (!devices.length) return;
    const response = await services.messaging.sendEachForMulticast({
      tokens: devices.map(device => device.token),
      data,
      notification,
      webpush: { headers: { Urgency: "high", TTL: String(ttlSeconds) } },
    });
    await Promise.all(response.responses.map(async (result, index) => {
      const code = result.error?.code;
      if (!result.success && (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" || code === "messaging/mismatched-credential")) {
        await devices[index].ref.delete().catch(() => {});
      }
      if (!result.success) console.warn("[Firebase] A background notification was not delivered");
    }));
  } catch {
    // Push delivery is intentionally isolated from call-state persistence. Never
    // log an FCM token or let a provider outage crash WebSocket signaling.
    console.warn("[Firebase] Background notification delivery failed");
  }
}

export async function getCallPushStatus(): Promise<CallPushStatus> {
  const problem = configurationProblem();
  if (problem) return { enabled: false, reason: problem };
  try {
    await loadServices();
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof CallPushError ? error.message : "Firebase Admin is unavailable",
    };
  }
  const readiness = firebaseReadiness(true, true, !!process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim());
  return {
    ...readiness,
    firebase: asPublicConfig() ?? undefined,
    vapidPublicKey: process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim(),
  };
}

export async function createCallPushSession(
  userId: number,
  sessionId: string,
  sessionExpiresAt?: Date,
): Promise<{ customToken: string; userId: string }> {
  const { auth, db } = await loadServices();
  try {
    const firebaseUserId = String(userId);
    const tag = sessionTag(sessionId);
    // Rules require this record for every Firestore read. It is server-owned,
    // expires with the HTTP session, and is marked revoked at logout so an
    // already-issued Firebase ID token immediately loses document access.
    await userRef(db, userId).collection("sessions").doc(tag).set({
      expiresAt: sessionExpiresAt && sessionExpiresAt.getTime() > Date.now()
        ? sessionExpiresAt
        : new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      updatedAt: new Date(),
    });
    return {
      customToken: await auth.createCustomToken(firebaseUserId, { userId, sessionTag: tag }),
      userId: firebaseUserId,
    };
  } catch {
    throw new CallPushError("Firebase custom-token issuance failed");
  }
}

function validInstallationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function pushConfigurationId(): string {
  const config = asPublicConfig();
  return createHash("sha256").update(JSON.stringify([
    config?.projectId, config?.appId, config?.messagingSenderId,
    process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim(),
  ])).digest("hex");
}

export async function registerCallPushDevice(
  userId: number,
  sessionId: string,
  input: { token: unknown; installationId: unknown; focused: unknown },
): Promise<void> {
  if (typeof input.token !== "string" || input.token.length < 20 || input.token.length > 4096 ||
    !validInstallationId(input.installationId) || typeof input.focused !== "boolean") {
    throw new CallPushError("Invalid push device registration");
  }
  const { db } = await loadServices();
  try {
    const now = new Date();
    await userRef(db, userId).collection("devices").doc(input.installationId).set({
      token: input.token,
      configurationId: pushConfigurationId(),
      focused: input.focused,
      focusUpdatedAt: now,
      sessionTag: sessionTag(sessionId),
      updatedAt: now,
    });
  } catch {
    throw new CallPushError("Firebase device registration failed");
  }
}

async function ownedDeviceRef(
  db: Firestore,
  userId: number,
  sessionId: string,
  installationId: string,
) {
  const ref = userRef(db, userId).collection("devices").doc(installationId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.sessionTag !== sessionTag(sessionId)) {
    throw new CallPushError("Push installation does not belong to this session");
  }
  return ref;
}

export async function removeCallPushDevice(userId: number, sessionId: string, installationId: unknown): Promise<void> {
  if (!validInstallationId(installationId)) throw new CallPushError("Invalid installation ID");
  const { db } = await loadServices();
  try {
    await (await ownedDeviceRef(db, userId, sessionId, installationId)).delete();
  } catch (error) {
    if (error instanceof CallPushError) throw error;
    throw new CallPushError("Firebase device removal failed");
  }
}

export async function setCallPushFocus(
  userId: number,
  sessionId: string,
  installationId: unknown,
  focused: unknown,
): Promise<void> {
  if (!validInstallationId(installationId) || typeof focused !== "boolean") {
    throw new CallPushError("Invalid focus update");
  }
  const { db } = await loadServices();
  try {
    await (await ownedDeviceRef(db, userId, sessionId, installationId)).update({
      focused,
      focusUpdatedAt: new Date(),
    });
  } catch (error) {
    if (error instanceof CallPushError) throw error;
    throw new CallPushError("Firebase focus update failed");
  }
}

export async function createDeferredCallInvitation(invitation: DeferredCallInvitation): Promise<DeferredCallInvitation> {
  if (!isValidCallId(invitation.callId)) throw new CallPushError("Invalid call ID");
  const { db, messaging, auth } = await loadServices();
  const record = invitationPayload(invitation);
  try {
    await callRef(db, invitation.callId).create(record);
  } catch {
    throw new CallPushError("Firebase invitation creation failed");
  }
  // Authentication is established above; messaging is deliberately best effort.
  void auth;
  void sendPush(
    { db, messaging, auth },
    invitation.calleeId,
    {
      type: "INCOMING_CALL",
      callId: invitation.callId,
      fromName: invitation.caller.name,
      title: `مكالمة واردة من ${invitation.caller.name}`,
      // Keep the established aliases while clients migrate to the canonical
      // callId/fromName fields.
      callerId: String(invitation.caller.id),
      callerName: invitation.caller.name,
      callerAvatar: invitation.caller.avatar ?? "",
      roomId: invitation.callId,
      expiresAt: record.expiresAt.toISOString(),
      deferredMedia: "true",
    },
  );
  return { ...invitation, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

export async function acceptDeferredCallInvitation(callId: string, calleeId: number): Promise<boolean> {
  const { db, messaging, auth } = await loadServices();
  try {
    let callerName = "";
    const accepted = await db.runTransaction(async transaction => {
      const ref = callRef(db, callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.toId !== calleeId || data.status !== "ringing" ||
        dateValue(data.expiresAt, new Date(0)).getTime() <= Date.now()) return false;
      callerName = typeof data.fromName === "string" ? data.fromName : "";
      transaction.update(ref, { status: "answered", answeredAt: new Date() });
      return true;
    });
    if (accepted) {
      await sendPush(
        { db, messaging, auth },
        calleeId,
        {
          type: "CALL_ENDED",
          callId,
          fromName: callerName,
          title: "انتهت المكالمة",
          // Retain aliases consumed by existing workers/clients.
          roomId: callId,
          callerName,
          body: "تم قبول المكالمة",
        },
        undefined,
        true,
        INCOMING_PUSH_TTL_SECONDS,
      );
    }
    return accepted;
  } catch {
    throw new CallPushError("Firebase invitation acceptance failed");
  }
}

export function evaluateDeferredCallDecline(
  input: {
    calleeId: number;
    invitationCalleeId: number;
    status: CallStatus;
    expiresAt: Date;
  },
  now = new Date(),
): Pick<DeferredCallDeclineResult, "outcome" | "changed" | "status"> {
  if (input.calleeId !== input.invitationCalleeId) {
    return { outcome: "not-callee", changed: false };
  }
  if (input.status !== "ringing") {
    return { outcome: "finished", changed: false, status: input.status };
  }
  // A stale decline is also the first opportunity to close an invitation
  // after a browser missed its 30-second timer. Mark it missed, never
  // declined, and never reopen a terminal invitation.
  if (input.expiresAt.getTime() <= now.getTime()) {
    return { outcome: "expired", changed: true, status: "missed" };
  }
  return { outcome: "declined", changed: true, status: "declined" };
}

function canonicalInvitation(
  callId: string,
  data: Record<string, unknown>,
): DeferredCallInvitation | null {
  if (typeof data.fromId !== "number" || !Number.isSafeInteger(data.fromId) ||
    typeof data.fromName !== "string" || typeof data.toId !== "number" ||
    !Number.isSafeInteger(data.toId) ||
    (data.type !== "video" && data.type !== "voice")) return null;
  return {
    callId,
    caller: {
      id: data.fromId,
      name: data.fromName,
      avatar: typeof data.fromAvatar === "string" ? data.fromAvatar : null,
    },
    calleeId: data.toId,
    type: data.type,
    createdAt: dateValue(data.createdAt),
    expiresAt: dateValue(data.expiresAt, new Date(0)),
  };
}

function canonicalStatus(value: unknown): CallStatus {
  return value === "ringing" || value === "answered" || value === "declined" || value === "missed"
    ? value
    : "answered";
}

function missedCallPayload(invitation: DeferredCallInvitation, status: "declined" | "missed") {
  return {
    fromId: invitation.caller.id,
    fromName: invitation.caller.name,
    fromAvatar: invitation.caller.avatar,
    type: invitation.type,
    time: new Date(),
    seen: false,
    // Legacy aliases are intentionally retained in inbox documents so older
    // clients can continue reading the same durable record.
    caller: invitation.caller,
    isSeen: false,
    status,
  };
}

/**
 * Atomically declines the canonical ringing invitation for its recorded
 * callee. This is shared by the HTTP action and WebSocket rejection path so a
 * stale tab cannot race a second device into reviving or duplicating a call.
 */
export async function declineDeferredCallInvitation(
  callId: string,
  calleeId: number,
): Promise<DeferredCallDeclineResult> {
  const { db, messaging, auth } = await loadServices();
  try {
    const result = await db.runTransaction<DeferredCallDeclineResult>(async transaction => {
      const ref = callRef(db, callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data) return { callId, outcome: "not-found", changed: false };
      const invitation = canonicalInvitation(callId, data);
      if (!invitation) return { callId, outcome: "not-found", changed: false };

      const decision = evaluateDeferredCallDecline({
        calleeId,
        invitationCalleeId: invitation.calleeId,
        status: canonicalStatus(data.status),
        expiresAt: invitation.expiresAt ?? new Date(0),
      });
      if (decision.outcome === "not-callee") {
        return {
          callId,
          outcome: decision.outcome,
          changed: false,
          callerId: invitation.caller.id,
          callerName: invitation.caller.name,
          callerAvatar: invitation.caller.avatar,
          calleeId: invitation.calleeId,
          type: invitation.type,
        };
      }
      if (!decision.changed || !decision.status) {
        return {
          callId,
          outcome: decision.outcome,
          changed: false,
          status: canonicalStatus(data.status),
          callerId: invitation.caller.id,
          callerName: invitation.caller.name,
          callerAvatar: invitation.caller.avatar,
          calleeId: invitation.calleeId,
          type: invitation.type,
        };
      }

      // Read the inbox item before any writes, as required by Firestore
      // transactions. A repeated/racing transition preserves an existing
      // seen=true acknowledgement and never creates a second record.
      const inboxRef = missedRef(db, invitation.calleeId, callId);
      const inboxSnapshot = await transaction.get(inboxRef);
      const endedAt = new Date();
      transaction.update(ref, {
        status: decision.status,
        endedAt,
        ...(decision.outcome === "expired" ? { expiredAt: endedAt } : {}),
      });
      const inboxStatus = decision.status === "missed" || decision.status === "declined"
        ? decision.status
        : "missed";
      const inboxPayload = missedCallPayload(invitation, inboxStatus);
      if (!inboxSnapshot.exists) {
        transaction.create(inboxRef, inboxPayload);
      } else {
        transaction.set(inboxRef, inboxPayload, { merge: true });
      }
      return {
        callId,
        outcome: decision.outcome,
        changed: true,
        status: decision.status,
        callerId: invitation.caller.id,
        callerName: invitation.caller.name,
        callerAvatar: invitation.caller.avatar,
        calleeId: invitation.calleeId,
        type: invitation.type,
      };
    });
    if (result.changed && (result.status === "declined" || result.status === "missed") &&
      result.calleeId !== undefined && result.callerName !== undefined) {
      await sendPush(
        { db, messaging, auth },
        result.calleeId,
        {
          type: "MISSED_CALL",
          callId,
          fromName: result.callerName,
          title: `مكالمة فائتة من ${result.callerName}`,
          // Retain aliases consumed by existing workers/clients.
          roomId: callId,
          callerName: result.callerName,
          body: "لديك مكالمة فائتة",
        },
        undefined,
        true,
        MISSED_PUSH_TTL_SECONDS,
      );
    }
    return result;
  } catch {
    throw new CallPushError("Firebase call status update failed");
  }
}

export async function finishDeferredCallInvitation(
  invitation: DeferredCallInvitation,
  status: DeferredTerminalStatus,
): Promise<boolean> {
  const { db, messaging, auth } = await loadServices();
  try {
    const transition = await db.runTransaction(async transaction => {
      const ref = callRef(db, invitation.callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.fromId !== invitation.caller.id || data.toId !== invitation.calleeId) {
        return { changed: false, sendMissed: false };
      }
      // A timeout/caller-close can race a callee acceptance transaction. The
      // invitation is already answered in that race: record only endedAt,
      // leave status=answered, and never create a false missed-call inbox item.
      if (data.status === "answered" && status === "missed") {
        if (data.endedAt !== undefined && data.endedAt !== null) {
          return { changed: false, sendMissed: false };
        }
        transaction.update(ref, { endedAt: new Date() });
        return { changed: true, sendMissed: false };
      }
      if (data.status === "answered" && status === "ended" &&
        data.endedAt !== undefined && data.endedAt !== null) {
        return { changed: false, sendMissed: false };
      }
      if (data.status !== "ringing" && !(data.status === "answered" && status === "ended")) {
        return { changed: false, sendMissed: false };
      }
      if (status === "declined" || status === "missed") {
        const inboxRef = missedRef(db, invitation.calleeId, invitation.callId);
        const inboxSnapshot = await transaction.get(inboxRef);
        transaction.update(ref, durableTerminalUpdate(status, new Date()));
        if (!inboxSnapshot.exists) {
          transaction.create(inboxRef, missedCallPayload(invitation, status));
        } else {
          transaction.set(inboxRef, missedCallPayload(invitation, status), { merge: true });
        }
      } else {
        transaction.update(ref, durableTerminalUpdate(status, new Date()));
      }
      return { changed: true, sendMissed: status === "declined" || status === "missed" };
    });
    if (!transition.changed) return false;
    if (transition.sendMissed) {
      await sendPush(
        { db, messaging, auth },
        invitation.calleeId,
        {
          type: "MISSED_CALL",
          callId: invitation.callId,
          fromName: invitation.caller.name,
          title: `مكالمة فائتة من ${invitation.caller.name}`,
          // Legacy aliases remain for existing workers/clients.
          roomId: invitation.callId,
          callerName: invitation.caller.name,
          body: "لديك مكالمة فائتة",
        },
        undefined,
        true,
        MISSED_PUSH_TTL_SECONDS,
      );
    } else if (status === "ended") {
      await sendPush(
        { db, messaging, auth },
        invitation.calleeId,
        {
          type: "CALL_ENDED",
          callId: invitation.callId,
          fromName: invitation.caller.name,
          title: "انتهت المكالمة",
          // Legacy aliases remain for existing workers/clients.
          roomId: invitation.callId,
          callerName: invitation.caller.name,
          body: "انتهت المكالمة",
        },
        undefined,
        true,
        INCOMING_PUSH_TTL_SECONDS,
      );
    }
    return true;
  } catch {
    throw new CallPushError("Firebase call status update failed");
  }
}

export type DeferredCallWatcherStatus = "declined" | "missed" | "ended";

/**
 * Watches one owner-instance invitation document. This is deliberately
 * per-call rather than a process-wide query: HTTP declines can be handled by
 * another API instance, while the owner still needs prompt WS cleanup.
 */
export async function watchDeferredCallInvitation(
  callId: string,
  onTerminal: (status: DeferredCallWatcherStatus) => void,
): Promise<() => void> {
  const { db } = await loadServices();
  let disposed = false;
  const unsubscribe = callRef(db, callId).onSnapshot(snapshot => {
    if (disposed || !snapshot.exists) return;
    const data = snapshot.data();
    if (!data) return;
    if (data.status === "declined" || data.status === "missed") {
      onTerminal(data.status);
      return;
    }
    // `answered` alone is still an active call. Only its explicit endedAt
    // marker is a durable terminal event.
    if (data.status === "answered" && data.endedAt !== undefined && data.endedAt !== null) {
      onTerminal("ended");
    }
  }, () => {
    // Firestore/WS remain authoritative if a transient watch stream fails.
    // The bounded per-call listener is intentionally not replaced by polling.
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
}

export async function listMissedCalls(userId: number): Promise<{
  items: { id: string; caller: CallerIdentity; type: CallType; time: string; isSeen: boolean; status: "declined" | "missed" }[];
  unseenCount: number;
}> {
  const { db } = await loadServices();
  try {
    const collection = userRef(db, userId).collection("missedCalls");
    const [itemsSnapshot, unseenSnapshot, legacyUnseenSnapshot] = await Promise.all([
      collection.orderBy("time", "desc").limit(100).get(),
      collection.where("seen", "==", false).get(),
      // This query keeps pre-contract inbox documents visible while all new
      // writes use the canonical `seen` field.
      collection.where("isSeen", "==", false).get(),
    ]);
    const items = itemsSnapshot.docs.flatMap(doc => {
      const value = doc.data();
      if ((value.type !== "video" && value.type !== "voice") ||
        (value.status !== "declined" && value.status !== "missed") ||
        (typeof value.fromId !== "number" && (!value.caller || typeof value.caller.id !== "number")) ||
        (typeof value.fromName !== "string" && (!value.caller || typeof value.caller.name !== "string"))) return [];
      const fromId = typeof value.fromId === "number" ? value.fromId : value.caller.id;
      const fromName = typeof value.fromName === "string" ? value.fromName : value.caller.name;
      const fromAvatar = typeof value.fromAvatar === "string"
        ? value.fromAvatar
        : typeof value.caller?.avatar === "string" ? value.caller.avatar : null;
      return [{
        id: doc.id,
        caller: {
          id: fromId,
          name: fromName,
          avatar: fromAvatar,
        },
        type: value.type as CallType,
        time: dateValue(value.time).toISOString(),
        isSeen: value.seen === true || value.isSeen === true,
        status: value.status as "declined" | "missed",
      }];
    });
    const unseenIds = new Set([
      ...unseenSnapshot.docs.map(doc => doc.id),
      ...legacyUnseenSnapshot.docs.map(doc => doc.id),
    ]);
    return { items, unseenCount: unseenIds.size };
  } catch {
    throw new CallPushError("Firebase missed-call retrieval failed");
  }
}

export async function markMissedCallsSeen(userId: number, ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
    !ids.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new CallPushError("Invalid missed call IDs");
  }
  const { db } = await loadServices();
  try {
    const batch = db.batch();
    for (const id of new Set(ids)) {
      batch.update(missedRef(db, userId, id), {
        seen: true,
        // Keep the old API/client alias synchronized while clients migrate.
        isSeen: true,
        seenAt: new Date(),
      });
    }
    await batch.commit();
  } catch {
    throw new CallPushError("Firebase missed-call update failed");
  }
}

async function revokeFirebaseUser(
  userId: number,
  sessionFilter?: string,
): Promise<boolean> {
  const problem = configurationProblem();
  if (problem) return true;
  try {
    const { db, auth } = await loadServices();
    const user = userRef(db, userId);
    const tag = sessionFilter ? sessionTag(sessionFilter) : undefined;
    if (tag) {
      await user.collection("sessions").doc(tag).set({
        revokedAt: new Date(),
        expiresAt: new Date(),
      }, { merge: true });
    } else {
      // Bounded batches prevent a compromised account from turning account
      // revocation into unbounded work. Repeated password/account actions can
      // continue any unusually large cleanup set.
      for (const collectionName of ["sessions", "devices"]) {
        for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
          const snapshot = collectionName === "sessions"
            ? await user.collection(collectionName).where("revokedAt", "==", null).limit(DEVICE_BATCH_SIZE).get()
            : await user.collection(collectionName).limit(DEVICE_BATCH_SIZE).get();
          if (!snapshot.size) break;
          const batch = db.batch();
          for (const doc of snapshot.docs) {
            if (collectionName === "sessions") {
              batch.set(doc.ref, { revokedAt: new Date(), expiresAt: new Date() }, { merge: true });
            } else {
              batch.delete(doc.ref);
            }
          }
          await batch.commit();
          if (snapshot.size < DEVICE_BATCH_SIZE) break;
        }
      }
    }
    if (tag) {
      const devices = await user.collection("devices")
        .where("sessionTag", "==", tag).limit(DEVICE_BATCH_SIZE).get();
      await Promise.all(devices.docs.map(doc => doc.ref.delete()));
    }
    await auth.revokeRefreshTokens(String(userId));
    return true;
  } catch {
    // Callers await this result and explicitly report pending cleanup rather
    // than claiming that an unavailable Firebase revocation was immediate.
    return false;
  }
}

export function revokeCallPushSession(userId: number, activeSessionId: string): Promise<boolean> {
  return revokeFirebaseUser(userId, activeSessionId);
}

export function revokeAllCallPushSessions(userId: number): Promise<boolean> {
  return revokeFirebaseUser(userId);
}

async function expireInvitation(db: Firestore, callId: string, data: Record<string, unknown>): Promise<void> {
  const invitation: DeferredCallInvitation = {
    callId,
      caller: {
      id: data.fromId as number,
      name: data.fromName as string,
      avatar: typeof data.fromAvatar === "string" ? data.fromAvatar : null,
    },
    calleeId: data.toId as number,
    type: data.type as CallType,
  };
  if (!Number.isInteger(invitation.caller.id) || !Number.isInteger(invitation.calleeId) ||
    (invitation.type !== "video" && invitation.type !== "voice")) return;
  await finishDeferredCallInvitation(invitation, "missed").catch(() => {});
}

export function startFirebaseCallExpirationSweep(): void {
  if (configurationProblem()) return;
  const run = async () => {
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
      try {
        const { db } = await loadServices();
        let query = db.collection("callInvites").where("status", "==", "ringing")
          .where("expiresAt", "<=", new Date()).orderBy("expiresAt").limit(SWEEP_PAGE_SIZE);
        if (last) query = query.startAfter(last);
        const snapshot = await query.get();
        if (!snapshot.size) return;
        await Promise.all(snapshot.docs.map(doc => expireInvitation(db, doc.id, doc.data())));
        if (snapshot.size < SWEEP_PAGE_SIZE) return;
        last = snapshot.docs[snapshot.docs.length - 1];
      } catch {
        return;
      }
    }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref?.();
}