import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { pool as pgPool } from "@workspace/db";
import {
  getCallStateDb,
  type CallDatabase,
  type CallStateDocumentReference,
} from "./call-state-db";
import { DEFERRED_INVITATION_TTL_MS } from "./deferred-call-policy";
import { sendBrowserCallTerminalPush, sendBrowserIncomingCallPush } from "./browser-push";

const FOCUS_FRESH_MS = 30_000;
const DEVICE_BATCH_SIZE = 500;
const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 5;
const INCOMING_PUSH_TTL_SECONDS = 30;
const MISSED_PUSH_TTL_SECONDS = 86_400;
const MESSAGE_PUSH_TTL_SECONDS = 86_400;
const PUSH_CLAIM_STALE_MS = 60_000;
const PUSH_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * The normal browser call path carries its offer immediately.  This durable
 * variant is only used when that direct offer has no online WebSocket
 * recipient; it does not defer caller media or replace the configured media
 * provider.
 */
export interface DirectCallInvitation extends DeferredCallInvitation {
  offer: Record<string, unknown> | null;
  transport: { provider: "agora" | "webrtc"; version: 1 };
  e2e?: Record<string, unknown>;
}

export interface DirectCallResume {
  callId: string;
  caller: CallerIdentity;
  calleeId: number;
  type: CallType;
  offer: Record<string, unknown> | null;
  transport: { provider: "agora" | "webrtc"; version: 1 };
  e2e?: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export interface DirectCallAcceptance extends DirectCallResume {
  answer: Record<string, unknown> | null;
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
  /** Call lifecycle state is Postgres-backed and independent of FCM. */
  callAuthorityReady: boolean;
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
let credentialWarningLogged = false;

/**
 * FIREBASE_VAPID_PUBLIC is the current deployment name. Keep the old
 * FIREBASE_VAPID_PUBLIC_KEY name as a compatibility fallback because VAPID is
 * a public browser credential and rotating this alias must not invalidate
 * already-installed clients.
 */
export function firebaseVapidPublicKey(): string | undefined {
  const current = process.env.FIREBASE_VAPID_PUBLIC?.trim();
  if (current) return current;
  const legacy = process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim();
  return legacy || undefined;
}

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

function fcmDisabled(): boolean {
  return process.env.FCM_ENABLED?.trim().toLowerCase() === "false";
}

export function shouldRevokeFirebaseRefreshTokens(sessionFilter?: string): boolean {
  return !sessionFilter;
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

function readServiceAccount(): Record<string, unknown> | null {
  if (process.env.FCM_ENABLED?.trim().toLowerCase() === "false") return null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    // Credentials are optional. Never expose parser diagnostics or credential
    // contents in startup logs.
    if (!credentialWarningLogged) {
      credentialWarningLogged = true;
      console.warn("[FCM] disabled: no valid Firebase credential");
    }
    return null;
  }
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
  if (process.env.FCM_ENABLED?.trim().toLowerCase() === "false") return "FCM is disabled";
  if (!readServiceAccount()) return "FCM is disabled: no valid Firebase credential";
  const clientProblem = clientConfigurationProblem();
  if (clientProblem) return clientProblem;
  if (!firebaseVapidPublicKey()) return "Firebase web push VAPID key is not configured";
  return null;
}

// Firestore invitation persistence and custom-token issuance do not require
// browser push. Keep the durable lifecycle available when VAPID is absent.
function configurationProblem(): string | null {
  if (process.env.FCM_ENABLED?.trim().toLowerCase() === "false") return "FCM is disabled";
  if (!readServiceAccount()) return "FCM is disabled: no valid Firebase credential";
  return clientConfigurationProblem();
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
      if (!account) {
        console.warn("[FCM] disabled: no valid Firebase credential");
        throw new CallPushError("FCM is disabled: no valid Firebase credential");
      }
      let app: App;
      try {
        app = getApps()[0] ?? initializeApp({ credential: cert(account) });
      } catch {
        console.warn("[FCM] disabled: no valid Firebase credential");
        throw new CallPushError("FCM is disabled: no valid Firebase credential");
      }
      return { db: getFirestore(app), auth: getAuth(app), messaging: getMessaging(app) };
    })().catch(error => {
      servicesPromise = undefined;
      if (error instanceof CallPushError) throw error;
      console.warn("[FCM] disabled: no valid Firebase credential");
      throw new CallPushError("FCM is disabled: no valid Firebase credential");
    });
  }
  return servicesPromise;
}

/**
 * Legacy callers retain this getter name while call lifecycle state is backed
 * by Postgres. It must never initialize Firebase or make calls depend on FCM.
 */
export async function getAuthoritativeCallFirestore(): Promise<CallDatabase> {
  // Despite the legacy name, this is the Postgres-backed call-state facade.
  // Firebase remains an optional push/device provider only.
  return getCallStateDb();
}

/** A raw express-session id must never be put in Firestore. */
export function callSessionBinding(sessionId: string): string {
  return sessionTag(sessionId);
}

/** Best-effort wake-up after a call has already been committed to Postgres. */
export async function sendAuthoritativeIncomingCallPush(input: {
  callId: string;
  callerId: number;
  callerName: string;
  callerAvatar: string | null;
  calleeId: number;
  expiresAt: Date;
  video: boolean;
}): Promise<void> {
  // Standards-based Web Push is independent from Firebase and is attempted
  // first. This function is called only after the authorized invitation commit.
  try {
    await sendBrowserIncomingCallPush({
      callId: input.callId,
      callerName: input.callerName,
      calleeId: input.calleeId,
      expiresAt: input.expiresAt,
      video: input.video,
    });
  } catch {
    // Durable call state remains authoritative; push is only a wake-up.
    console.warn("[WebPush] Incoming call wake-up unavailable");
  }
  try {
    const services = await loadServices();
    await sendPush(services, input.calleeId, {
      type: "INCOMING_CALL",
      callId: input.callId,
      callerId: String(input.callerId),
      callerName: input.callerName,
      callerAvatar: input.callerAvatar ?? "",
      fromName: input.callerName,
      title: `مكالمة واردة من ${input.callerName}`,
      expiresAt: input.expiresAt.toISOString(),
      video: input.video ? "true" : "false",
      roomId: input.callId,
      url: `/messages?callId=${encodeURIComponent(input.callId)}`,
    }, undefined, true, INCOMING_PUSH_TTL_SECONDS, {
      dedupeKey: `incoming-call:${input.callId}:${input.calleeId}`,
    });
  } catch {
    // FCM is a wake-up transport only. Postgres call state is authoritative.
    console.warn("[FCM] Incoming call wake-up unavailable");
  }
}

/** Best-effort wake-up for a server-authorized group invitation. Recipient
 * selection (membership/mute/block) is deliberately done before this function;
 * this provider only delivers to the supplied durable recipient. */
export async function sendAuthoritativeGroupCallPush(input: {
  callId: string; roomId: number; callerName: string; recipientId: number; video: boolean;
}): Promise<void> {
  try {
    const services = await loadServices();
    await sendPush(services, input.recipientId, {
      type: "INCOMING_GROUP_CALL",
      callId: input.callId,
      roomId: String(input.roomId),
      fromName: input.callerName,
      title: `مكالمة جماعية واردة من ${input.callerName}`,
      video: input.video ? "true" : "false",
      url: `/messages?roomId=${input.roomId}&groupCallId=${encodeURIComponent(input.callId)}`,
    }, undefined, true, INCOMING_PUSH_TTL_SECONDS, {
      dedupeKey: `incoming-group-call:${input.callId}:${input.recipientId}`,
    });
  } catch {
    console.warn("[FCM] group invitation wake-up unavailable", { userId: input.recipientId });
  }
}

function dateValue(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return fallback;
}

function callRef(db: Firestore, callId: string): FirebaseFirestore.DocumentReference;
function callRef(db: CallDatabase, callId: string): CallStateDocumentReference;
function callRef(db: Firestore | CallDatabase, callId: string):
  FirebaseFirestore.DocumentReference | CallStateDocumentReference {
  return (db as { collection(name: string): { doc(id: string): unknown } })
    .collection("callInvites").doc(callId) as FirebaseFirestore.DocumentReference | CallStateDocumentReference;
}

function missedRef(db: CallDatabase, userId: number, callId: string): CallStateDocumentReference {
  return db.collection("users").doc(String(userId)).collection("missedCalls").doc(callId);
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

function validStoredDescription(
  value: unknown,
  expectedType: "offer" | "answer",
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const description = value as Record<string, unknown>;
  return description.type === expectedType &&
    typeof description.sdp === "string" &&
    description.sdp.length > 0 &&
    description.sdp.length <= 256_000;
}

function directInvitationPayload(invitation: DirectCallInvitation) {
  const createdAt = invitation.createdAt ?? new Date();
  const maximumExpiry = new Date(createdAt.getTime() + DEFERRED_INVITATION_TTL_MS);
  const requestedExpiry = invitation.expiresAt?.getTime();
  const expiresAt = Number.isFinite(requestedExpiry)
    ? new Date(Math.min(requestedExpiry as number, maximumExpiry.getTime()))
    : maximumExpiry;
  return {
    fromId: invitation.caller.id,
    fromName: invitation.caller.name,
    toId: invitation.calleeId,
    status: "ringing" as const,
    type: invitation.type,
    createdAt,
    expiresAt,
    fromAvatar: invitation.caller.avatar,
    // This is a direct-SDP invitation, not the deferred-caller-media
    // protocol. Keep the marker explicit for clients migrating from the old
    // invitation shape.
    deferredMedia: false,
    offer: invitation.offer,
    transport: invitation.transport,
    e2e: invitation.e2e ?? null,
  };
}

function directResumeFromRecord(
  callId: string,
  data: Record<string, unknown>,
): DirectCallResume | null {
  if (data.deferredMedia === true ||
    typeof data.fromId !== "number" || !Number.isSafeInteger(data.fromId) ||
    typeof data.fromName !== "string" ||
    typeof data.toId !== "number" || !Number.isSafeInteger(data.toId) ||
    (data.type !== "video" && data.type !== "voice") ||
    !data.transport || typeof data.transport !== "object" ||
    (data.transport as Record<string, unknown>).version !== 1 ||
    ((data.transport as Record<string, unknown>).provider !== "webrtc" &&
      (data.transport as Record<string, unknown>).provider !== "agora")) return null;
  const transport = data.transport as { provider: "agora" | "webrtc"; version: 1 };
  if (transport.provider === "webrtc" && !validStoredDescription(data.offer, "offer")) return null;
  if (transport.provider === "agora" && data.offer !== null) return null;
  const expiresAt = dateValue(data.expiresAt, new Date(0));
  const createdAt = dateValue(data.createdAt, new Date(0));
  return {
    callId,
    caller: {
      id: data.fromId,
      name: data.fromName,
      avatar: typeof data.fromAvatar === "string" ? data.fromAvatar : null,
    },
    calleeId: data.toId,
    type: data.type,
    offer: data.offer as Record<string, unknown> | null,
    transport,
    e2e: data.e2e && typeof data.e2e === "object"
      ? data.e2e as Record<string, unknown>
      : undefined,
    createdAt,
    expiresAt,
  };
}

async function deviceTokens(
  db: Firestore,
  userId: number,
  includeFocused: boolean,
): Promise<{ token: string; ref: FirebaseFirestore.DocumentReference }[]> {
  const snapshot = await db.collection("users").doc(String(userId))
    .collection("devices").limit(DEVICE_BATCH_SIZE).get();
  const cutoff = Date.now() - FOCUS_FRESH_MS;
  const candidates: { token: string; ref: FirebaseFirestore.DocumentReference; sessionTag: string }[] =
    snapshot.docs.flatMap(doc => {
      const value = doc.data();
      if (value.configurationId !== pushConfigurationId()) return [];
      if (typeof value.token !== "string" || value.token.length < 20 || value.token.length > 4096) return [];
      const focusAt = dateValue(value.focusUpdatedAt, new Date(0)).getTime();
      const focused = value.focused === true && focusAt >= cutoff;
      if (!includeFocused && focused) return [];
      if (typeof value.sessionTag !== "string" || !/^[a-f0-9]{64}$/.test(value.sessionTag)) return [];
      return [{ token: value.token, ref: doc.ref, sessionTag: value.sessionTag }];
    });
  if (!candidates.length) return [];
  // Firestore's session mirror is required for Firebase rules, but the
  // PostgreSQL session store is canonical for HTTP authentication. Keep only
  // tokens bound to a currently-existing, unexpired PG session. The raw SID
  // never leaves this server; only its one-way sessionTag is stored in
  // Firestore and compared here.
  const canonicalSessions = await pgPool.query<{ sid: string }>(
    `SELECT sid
       FROM user_sessions
      WHERE (sess->>'userId')::int = $1
        AND expire > NOW()`,
    [userId],
  );
  const activeSessionTags = new Set(canonicalSessions.rows.map(row => sessionTag(row.sid)));
  // A device token is usable only while the exact authenticated HTTP session
  // that registered it remains active. This prevents a stale tab (including
  // one that never ran its close/unregister path) from receiving private
  // call/message pushes after expiry or logout.
  const now = Date.now();
  const validated = await Promise.all(candidates.map(async candidate => {
    const session = await db.collection("users").doc(String(userId))
      .collection("sessions").doc(candidate.sessionTag).get();
    const value = session.data();
    if (!session.exists || !isPushSessionActive(value, now) ||
        !activeSessionTags.has(candidate.sessionTag)) {
      await candidate.ref.delete().catch(() => {});
      return null;
    }
    return { token: candidate.token, ref: candidate.ref };
  }));
  return validated.flatMap(device => device ? [device] : []);
}

interface PushSendOptions {
  /**
   * A stable server-generated key shared by automatic fanout and an explicit
   * retry. It is never accepted from an HTTP client.
   */
  dedupeKey?: string;
  /** Explicit API sends report provider/device failures instead of swallowing them. */
  strict?: boolean;
}

export interface PushSendResult {
  attempted: number;
  delivered: number;
  skippedDuplicate: boolean;
}

function pushDeliveryRef(db: Firestore, key: string) {
  // A Firebase/VAPID rotation is a new delivery namespace. Without this,
  // an old project's sent marker could suppress the first notification in the
  // replacement project for an otherwise-identical message/call.
  const id = createHash("sha256").update(`${pushConfigurationId()}:${key}`).digest("hex");
  return db.collection("pushDeliveries").doc(id);
}

async function claimPushDelivery(db: Firestore, key: string, strict = false): Promise<boolean> {
  const ref = pushDeliveryRef(db, key);
  const now = new Date();
  try {
    return await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      const value = existing.data();
      if (value?.status === "sent") return false;
      const updatedAt = dateValue(value?.updatedAt, new Date(0));
      if (value?.status === "sending" &&
        now.getTime() - updatedAt.getTime() < PUSH_CLAIM_STALE_MS) return false;
      transaction.set(ref, {
        status: "sending",
        updatedAt: now,
        expiresAt: new Date(now.getTime() + PUSH_CLAIM_TTL_MS),
      });
      return true;
    });
  } catch {
    // Fail closed for a deduplicated send. A provider call without an
    // authoritative claim could turn an HTTP retry into duplicate alerts.
    if (strict) throw new CallPushError("Firebase push deduplication unavailable");
    return false;
  }
}

async function finishPushDelivery(
  db: Firestore,
  key: string,
  delivered: number,
): Promise<void> {
  const ref = pushDeliveryRef(db, key);
  if (delivered > 0) {
    await ref.set({ status: "sent", delivered, updatedAt: new Date() }, { merge: true });
  } else {
    await ref.delete().catch(() => {});
  }
}

async function sendPush(
  services: FirebaseServices,
  userId: number,
  data: Record<string, string>,
  notification?: { title: string; body: string },
  includeFocused = false,
  ttlSeconds = INCOMING_PUSH_TTL_SECONDS,
  options: PushSendOptions = {},
): Promise<PushSendResult> {
  // VAPID is a browser-push credential, not a Firestore credential. The
  // invitation must already be persisted before this best-effort path runs.
  const configurationError = pushConfigurationProblem();
  if (configurationError) {
    if (options.strict) throw new CallPushError(configurationError);
    return { attempted: 0, delivered: 0, skippedDuplicate: false };
  }
  let claimed = false;
  if (options.dedupeKey) {
    claimed = await claimPushDelivery(services.db, options.dedupeKey, options.strict);
    if (!claimed) return { attempted: 0, delivered: 0, skippedDuplicate: true };
  }
  try {
    const devices = await deviceTokens(services.db, userId, includeFocused);
    if (!devices.length) {
      if (claimed) await finishPushDelivery(services.db, options.dedupeKey!, 0);
      return { attempted: 0, delivered: 0, skippedDuplicate: false };
    }
    const response = await services.messaging.sendEachForMulticast({
      tokens: devices.map(device => device.token),
      data: data.url ? { ...data, click_action: data.url } : data,
      notification,
      webpush: { headers: { Urgency: "high", TTL: String(ttlSeconds) } },
    });
    const delivered = response.responses.filter(result => result.success).length;
    await Promise.all(response.responses.map(async (result, index) => {
      const code = result.error?.code;
      if (!result.success && (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" || code === "messaging/mismatched-credential")) {
        await devices[index].ref.delete().catch(() => {});
      }
      if (!result.success) console.warn("[Firebase] A background notification was not delivered");
    }));
    if (claimed) await finishPushDelivery(services.db, options.dedupeKey!, delivered);
    if (options.strict && delivered === 0) {
      throw new CallPushError("Firebase push delivery failed");
    }
    return { attempted: devices.length, delivered, skippedDuplicate: false };
  } catch {
    if (claimed) await finishPushDelivery(services.db, options.dedupeKey!, 0);
    // Push delivery is intentionally isolated from call-state persistence. Never
    // log an FCM token or let a provider outage crash WebSocket signaling.
    if (options.strict) throw new CallPushError("Firebase push delivery failed");
    console.warn("[Firebase] Background notification delivery failed");
    return { attempted: 0, delivered: 0, skippedDuplicate: false };
  }
}

export async function getCallPushStatus(): Promise<CallPushStatus> {
  const problem = configurationProblem();
  if (problem) return {
    enabled: false,
    reason: problem,
    callAuthorityReady: true,
    pushEnabled: false,
    pushReason: problem,
  };
  try {
    await loadServices();
  } catch (error) {
    return {
      enabled: false,
      callAuthorityReady: true,
      reason: error instanceof CallPushError ? error.message : "Firebase Admin is unavailable",
      pushEnabled: false,
      pushReason: error instanceof CallPushError ? error.message : "Firebase Admin is unavailable",
    };
  }
  const vapidPublicKey = firebaseVapidPublicKey();
  const readiness = firebaseReadiness(true, true, !!vapidPublicKey);
  return {
    ...readiness,
    callAuthorityReady: true,
    firebase: asPublicConfig() ?? undefined,
    vapidPublicKey,
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
    await db.collection("users").doc(String(userId)).collection("sessions").doc(tag).set({
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
    firebaseVapidPublicKey(),
  ])).digest("hex");
}

export function isPushSessionActive(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.revokedAt === null &&
    dateValue(record.expiresAt, new Date(0)).getTime() > now;
}

export async function registerCallPushDevice(
  userId: number,
  sessionId: string,
  input: { token: unknown; installationId: unknown; focused: unknown },
): Promise<void> {
  if (fcmDisabled()) throw new CallPushError("FCM is disabled");
  if (typeof input.token !== "string" || input.token.length < 20 || input.token.length > 4096 ||
    !validInstallationId(input.installationId) || typeof input.focused !== "boolean") {
    throw new CallPushError("Invalid push device registration");
  }
  const { db } = await loadServices();
  try {
    const now = new Date();
    await db.collection("users").doc(String(userId)).collection("devices").doc(input.installationId).set({
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

/**
 * Build the data-only message notification contract consumed by the browser
 * service worker.  Message bodies are deliberately generic: the API never
 * decrypts E2E content and must not put plaintext message content in FCM.
 */
export function newMessagePushPayload(input: {
  roomId: number;
  messageId: number;
  fromName: string;
}): Record<string, string> {
  return {
    type: "NEW_MESSAGE",
    roomId: String(input.roomId),
    messageId: String(input.messageId),
    fromName: input.fromName,
    title: "رسالة جديدة",
    body: "لديك رسالة جديدة",
    url: `/messages?roomId=${input.roomId}`,
  };
}

/**
 * FCM is an optional background transport.  Persistence and authenticated
 * WebSocket delivery do not depend on it, so every configuration/provider
 * failure is isolated here.  Device fanout and invalid-token cleanup remain
 * on the same configuration-bound path as call notifications.
 */
export async function sendNewMessagePush(
  userId: number,
  input: { roomId: number; messageId: number; fromName: string },
): Promise<void> {
  try {
    const services = await loadServices();
    await sendPush(
      services,
      userId,
      newMessagePushPayload(input),
      undefined,
      false,
      MESSAGE_PUSH_TTL_SECONDS,
      { dedupeKey: `new-message:${input.messageId}:${userId}` },
    );
  } catch {
    // A message has already committed by the time this function is called.
    // Never turn an FCM outage into a failed message or call request.
    console.warn("[Firebase] Background message notification unavailable");
  }
}

export type FcmSendRequest =
  | { kind: "call"; callId: string }
  | { kind: "message"; roomId: number; messageId: number };

/**
 * Parse the intentionally small explicit-send contract. Tokens, recipients,
 * notification bodies, and FCM data are not part of this contract: the
 * authenticated server derives all of them from durable state.
 */
export function parseFcmSendRequest(value: unknown): FcmSendRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const kind = body.kind ?? body.type;
  const allowed = new Set(["kind", "type", "callId", "roomId", "messageId"]);
  if (Object.keys(body).some(key => !allowed.has(key))) return null;
  if (body.kind !== undefined && body.type !== undefined && body.kind !== body.type) return null;
  if (kind === "call" && isValidCallId(body.callId)) {
    return { kind: "call", callId: body.callId };
  }
  if (kind === "message" &&
    Number.isSafeInteger(body.roomId) && (body.roomId as number) > 0 &&
    Number.isSafeInteger(body.messageId) && (body.messageId as number) > 0) {
    return {
      kind: "message",
      roomId: body.roomId as number,
      messageId: body.messageId as number,
    };
  }
  return null;
}

function validStoredTransport(value: unknown): value is { provider: "agora" | "webrtc"; version: 1 } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const transport = value as Record<string, unknown>;
  return transport.version === 1 &&
    (transport.provider === "agora" || transport.provider === "webrtc");
}

async function blockedPushPair(callerId: number, calleeId: number): Promise<boolean> {
  const blocked = await pgPool.query(
    `SELECT 1
       FROM citizen_blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)
      LIMIT 1`,
    [callerId, calleeId],
  );
  return blocked.rows.length > 0;
}

export interface FcmSendOutcome {
  kind: FcmSendRequest["kind"];
  attempted: number;
  delivered: number;
  skippedDuplicates: number;
  recipientCount: number;
}

/**
 * Explicit, authenticated retry for an already-persisted invitation/message.
 * This is deliberately not a general FCM gateway. The caller may only retry
 * their own durable call invitation; a message author may only retry their own
 * persisted message in its recorded room. Recipient selection, mute/block
 * policy, payload, and device/session checks all remain server-side.
 */
export async function sendAuthenticatedFcmPush(
  senderId: number,
  request: FcmSendRequest,
): Promise<FcmSendOutcome> {
  const services = await loadServices();
  const callDb = await getAuthoritativeCallFirestore();
  if (request.kind === "call") {
    const snapshot = await callRef(callDb, request.callId).get();
    if (!snapshot.exists) throw new CallPushError("Call invitation not found");
    const data = snapshot.data();
    if (!data || data.fromId !== senderId) {
      throw new CallPushError("Only the call caller can send this push");
    }
    if (data.status !== "ringing") {
      throw new CallPushError("Call invitation is no longer ringing");
    }
    const calleeId = data.toId;
    const callerName = data.fromName;
    const callType = data.type;
    const expiresAt = dateValue(data.expiresAt, new Date(0));
    if (typeof calleeId !== "number" || !Number.isSafeInteger(calleeId) || typeof callerName !== "string" ||
      (callType !== "video" && callType !== "voice") ||
      expiresAt.getTime() <= Date.now()) {
      throw new CallPushError("Call invitation is no longer valid");
    }
    if (await blockedPushPair(senderId, calleeId)) {
      throw new CallPushError("Push is unavailable for this call");
    }
    const payload: Record<string, string> = {
      type: "INCOMING_CALL",
      callId: request.callId,
      callerId: String(senderId),
      callerName,
      callerAvatar: typeof data.fromAvatar === "string" ? data.fromAvatar : "",
      fromName: callerName,
      title: `مكالمة واردة من ${callerName}`,
      roomId: request.callId,
      expiresAt: expiresAt.toISOString(),
      video: callType === "video" ? "true" : "false",
      deferredMedia: data.deferredMedia === true ? "true" : "false",
    };
    if (validStoredTransport(data.transport)) {
      payload.transport = JSON.stringify(data.transport);
    }
    const result = await sendPush(
      services,
      calleeId,
      payload,
      undefined,
      true,
      INCOMING_PUSH_TTL_SECONDS,
      { dedupeKey: `incoming-call:${request.callId}:${calleeId}`, strict: true },
    );
    return {
      kind: request.kind,
      attempted: result.attempted,
      delivered: result.delivered,
      skippedDuplicates: result.skippedDuplicate ? 1 : 0,
      recipientCount: 1,
    };
  }

  const message = await pgPool.query<{
    id: number;
    room_id: number;
    user_id: number;
    username: string;
  }>(
    `SELECT message.id, message.room_id, message.user_id, message.username
       FROM dm_messages message
       JOIN dm_room_members author_member
         ON author_member.room_id = message.room_id
        AND author_member.user_id = message.user_id
      WHERE message.id = $1 AND message.room_id = $2 AND message.user_id = $3
      LIMIT 1`,
    [request.messageId, request.roomId, senderId],
  );
  const authoredMessage = message.rows[0];
  if (!authoredMessage) {
    throw new CallPushError("Message not found or not authorized");
  }
  const recipients = await pgPool.query<{ user_id: number }>(
    `SELECT member.user_id
       FROM dm_room_members member
       LEFT JOIN dm_user_settings settings ON settings.user_id = member.user_id
      WHERE member.room_id = $1
        AND member.user_id <> $2
        AND COALESCE(member.muted, false) = false
        AND COALESCE(settings.notifications, true) = true
        AND NOT EXISTS (
          SELECT 1
            FROM citizen_blocks blocked
           WHERE (blocked.blocker_id = $2 AND blocked.blocked_id = member.user_id)
              OR (blocked.blocker_id = member.user_id AND blocked.blocked_id = $2)
        )
      ORDER BY member.user_id`,
    [request.roomId, senderId],
  );
  const results = await Promise.allSettled(recipients.rows.map(recipient =>
    sendPush(
      services,
      recipient.user_id,
      newMessagePushPayload({
        roomId: request.roomId,
        messageId: request.messageId,
        fromName: authoredMessage.username,
      }),
      undefined,
      false,
      MESSAGE_PUSH_TTL_SECONDS,
      { dedupeKey: `new-message:${request.messageId}:${recipient.user_id}`, strict: true },
    ),
  ));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === results.length && failures.length > 0) {
    const first = failures[0].reason;
    throw first instanceof CallPushError
      ? first
      : new CallPushError("Firebase push delivery failed");
  }
  const totals = results.reduce((sum, result) => {
    if (result.status === "rejected") return sum;
    return {
      attempted: sum.attempted + result.value.attempted,
      delivered: sum.delivered + result.value.delivered,
      skippedDuplicates: sum.skippedDuplicates + (result.value.skippedDuplicate ? 1 : 0),
    };
  }, { attempted: 0, delivered: 0, skippedDuplicates: 0 });
  return { kind: request.kind, ...totals, recipientCount: recipients.rows.length };
}

async function ownedDeviceRef(
  db: Firestore,
  userId: number,
  sessionId: string,
  installationId: string,
) {
  const ref = db.collection("users").doc(String(userId)).collection("devices").doc(installationId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.sessionTag !== sessionTag(sessionId)) {
    throw new CallPushError("Push installation does not belong to this session");
  }
  return ref;
}

export async function removeCallPushDevice(userId: number, sessionId: string, installationId: unknown): Promise<void> {
  if (fcmDisabled()) throw new CallPushError("FCM is disabled");
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
  if (fcmDisabled()) throw new CallPushError("FCM is disabled");
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
  const db = await getAuthoritativeCallFirestore();
  const record = invitationPayload(invitation);
  try {
    await db.runTransaction(async transaction => {
      transaction.create(callRef(db, invitation.callId), record);
    });
  } catch {
    throw new CallPushError("Call invitation creation failed");
  }
  void sendAuthoritativeIncomingCallPush({
    callId: invitation.callId,
    callerId: invitation.caller.id,
    callerName: invitation.caller.name,
    callerAvatar: invitation.caller.avatar,
    calleeId: invitation.calleeId,
    expiresAt: record.expiresAt,
    video: invitation.type === "video",
  });
  return { ...invitation, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

/**
 * Persist the normal direct-SDP offer for a recipient that has no WebSocket.
 * The offer remains in Firestore so the resumed browser gets the exact SDP
 * that the caller already used; caller media is not delayed or regenerated.
 */
export async function createDirectCallInvitation(invitation: DirectCallInvitation): Promise<DirectCallInvitation> {
  if (!isValidCallId(invitation.callId)) throw new CallPushError("Invalid call ID");
  const record = directInvitationPayload(invitation);
  if (record.transport.provider === "webrtc" && !validStoredDescription(record.offer, "offer")) {
    throw new CallPushError("Invalid direct call offer");
  }
  if (record.transport.provider === "agora" && record.offer !== null) {
    throw new CallPushError("Invalid direct call offer");
  }
  const db = await getAuthoritativeCallFirestore();
  try {
    await db.runTransaction(async transaction => {
      transaction.create(callRef(db, invitation.callId), record);
    });
  } catch {
    throw new CallPushError("Call invitation creation failed");
  }
  // Do not put SDP in FCM; the Postgres invitation is authoritative.
  void sendAuthoritativeIncomingCallPush({
    callId: invitation.callId,
    callerId: invitation.caller.id,
    callerName: invitation.caller.name,
    callerAvatar: invitation.caller.avatar,
    calleeId: invitation.calleeId,
    expiresAt: record.expiresAt,
    video: invitation.type === "video",
  });
  return { ...invitation, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

/**
 * Read an unexpired direct invitation for the authenticated callee. A read
 * never accepts the call; the browser must send an explicit answer afterward.
 */
export async function resumeDirectCallInvitation(
  callId: string,
  calleeId: number,
): Promise<DirectCallResume | null> {
  if (!isValidCallId(callId)) throw new CallPushError("Invalid call ID");
  const db = await getAuthoritativeCallFirestore();
  try {
    const snapshot = await callRef(db, callId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (!data || data.toId !== calleeId || data.status !== "ringing") return null;
    const invitation = directResumeFromRecord(callId, data);
    if (!invitation || invitation.expiresAt.getTime() <= Date.now()) return null;
    return invitation;
  } catch {
    throw new CallPushError("Call invitation retrieval failed");
  }
}

/**
 * Atomically accepts a direct invitation and stores the exact callee answer.
 * Firestore arbitration preserves the same single-answer race guarantee as
 * the in-process WebSocket path.
 */
export async function acceptDirectCallInvitation(
  callId: string,
  calleeId: number,
  answer: Record<string, unknown> | null,
): Promise<DirectCallAcceptance | null> {
  if (!isValidCallId(callId)) throw new CallPushError("Invalid call ID");
  const db = await getAuthoritativeCallFirestore();
  try {
    let accepted: DirectCallAcceptance | null = null;
    await db.runTransaction(async transaction => {
      const ref = callRef(db, callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.toId !== calleeId || data.status !== "ringing") return;
      const invitation = directResumeFromRecord(callId, data);
      if (!invitation || invitation.expiresAt.getTime() <= Date.now()) return;
      if (invitation.transport.provider === "webrtc" && !validStoredDescription(answer, "answer")) return;
      if (invitation.transport.provider === "agora" && answer !== null) return;
      transaction.update(ref, {
        status: "answered",
        answeredAt: new Date(),
        answer,
      });
      accepted = { ...invitation, answer };
    });
    if (accepted) {
      void sendBrowserCallTerminalPush({ callId, calleeId, status: "answered" }).catch(() => {});
    }
    return accepted;
  } catch {
    throw new CallPushError("Call invitation acceptance failed");
  }
}

export type DirectCallWatcherEvent =
  | { kind: "answered"; answer: Record<string, unknown> | null }
  | { kind: "terminal"; status: "declined" | "missed" | "ended" };

/**
 * Compatibility watcher for older consumers. Authoritative WebSocket routing
 * subscribes by participant document and does not depend on an owner replica.
 */
export async function watchDirectCallInvitation(
  callId: string,
  onEvent: (event: DirectCallWatcherEvent) => void,
): Promise<() => void> {
  // WebSocket participant subscriptions are authoritative. Do not attach a
  // client-style Firebase listener (or make call availability depend on FCM).
  void callId;
  void onEvent;
  return () => {};
}

export async function finishDirectCallInvitation(
  invitation: DirectCallInvitation,
  status: DeferredTerminalStatus,
): Promise<boolean> {
  // The direct and deferred invitation records share terminal-state semantics;
  // only the pre-answer media contract differs.
  return finishDeferredCallInvitation(invitation, status);
}

export async function acceptDeferredCallInvitation(callId: string, calleeId: number): Promise<boolean> {
  const db = await getAuthoritativeCallFirestore();
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
      void sendBrowserCallTerminalPush({ callId, calleeId, status: "answered" }).catch(() => {});
      try {
        const services = await loadServices();
        await sendPush(services, calleeId, {
          type: "CALL_ENDED", callId, fromName: callerName,
          title: "انتهت المكالمة", roomId: callId, callerName,
          body: "تم قبول المكالمة",
        }, undefined, true, INCOMING_PUSH_TTL_SECONDS, {
          dedupeKey: `call-terminal:${callId}:answered`,
        });
      } catch {
        // Push is best effort; acceptance is already authoritative.
      }
    }
    return accepted;
  } catch {
    throw new CallPushError("Call invitation acceptance failed");
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
  const db = await getAuthoritativeCallFirestore();
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
      const [callerLock, calleeLock] = await Promise.all([
        transaction.get(db.collection("callLocks").doc(String(invitation.caller.id))),
        transaction.get(db.collection("callLocks").doc(String(invitation.calleeId))),
      ]);
      const endedAt = new Date();
      transaction.update(ref, {
        status: decision.status,
        endedAt,
        ...(decision.outcome === "expired" ? { expiredAt: endedAt } : {}),
      });
      if (callerLock.data()?.callId === callId) transaction.delete(db.collection("callLocks").doc(String(invitation.caller.id)));
      if (calleeLock.data()?.callId === callId) transaction.delete(db.collection("callLocks").doc(String(invitation.calleeId)));
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
      void sendBrowserCallTerminalPush({
        callId,
        calleeId: result.calleeId,
        status: result.status,
      }).catch(() => {});
      try {
        const services = await loadServices();
        await sendPush(services, result.calleeId, {
          type: "MISSED_CALL", callId, fromName: result.callerName,
          title: `مكالمة فائتة من ${result.callerName}`,
          roomId: callId, callerName: result.callerName, body: "لديك مكالمة فائتة",
        }, undefined, true, MISSED_PUSH_TTL_SECONDS, {
          dedupeKey: `call-terminal:${callId}:${result.status}`,
        });
      } catch {
        // Push is optional and must not make the authenticated decline fail.
      }
    }
    return result;
  } catch {
    throw new CallPushError("Call status update failed");
  }
}

export async function finishDeferredCallInvitation(
  invitation: DeferredCallInvitation,
  status: DeferredTerminalStatus,
): Promise<boolean> {
  const db = await getAuthoritativeCallFirestore();
  try {
    const transition = await db.runTransaction(async transaction => {
      const ref = callRef(db, invitation.callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.fromId !== invitation.caller.id || data.toId !== invitation.calleeId) {
        return { changed: false, sendMissed: false };
      }
      const [callerLock, calleeLock] = await Promise.all([
        transaction.get(db.collection("callLocks").doc(String(invitation.caller.id))),
        transaction.get(db.collection("callLocks").doc(String(invitation.calleeId))),
      ]);
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
        if (callerLock.data()?.callId === invitation.callId) transaction.delete(db.collection("callLocks").doc(String(invitation.caller.id)));
        if (calleeLock.data()?.callId === invitation.callId) transaction.delete(db.collection("callLocks").doc(String(invitation.calleeId)));
        if (!inboxSnapshot.exists) {
          transaction.create(inboxRef, missedCallPayload(invitation, status));
        } else {
          transaction.set(inboxRef, missedCallPayload(invitation, status), { merge: true });
        }
      } else {
        transaction.update(ref, durableTerminalUpdate(status, new Date()));
        if (callerLock.data()?.callId === invitation.callId) transaction.delete(db.collection("callLocks").doc(String(invitation.caller.id)));
        if (calleeLock.data()?.callId === invitation.callId) transaction.delete(db.collection("callLocks").doc(String(invitation.calleeId)));
      }
      return { changed: true, sendMissed: status === "declined" || status === "missed" };
    });
    if (!transition.changed) return false;
    void sendBrowserCallTerminalPush({
      callId: invitation.callId,
      calleeId: invitation.calleeId,
      status: status === "ended" ? "ended" : status,
    }).catch(() => {});
    if (transition.sendMissed) {
      try {
        const services = await loadServices();
        await sendPush(services, invitation.calleeId, {
          type: "MISSED_CALL", callId: invitation.callId,
          fromName: invitation.caller.name,
          title: `مكالمة فائتة من ${invitation.caller.name}`,
          roomId: invitation.callId, callerName: invitation.caller.name,
          body: "لديك مكالمة فائتة",
        }, undefined, true, MISSED_PUSH_TTL_SECONDS, {
          dedupeKey: `call-terminal:${invitation.callId}:${status}`,
        });
      } catch {
        // Optional wake-up only.
      }
    } else if (status === "ended") {
      try {
        const services = await loadServices();
        await sendPush(services, invitation.calleeId, {
          type: "CALL_ENDED", callId: invitation.callId,
          fromName: invitation.caller.name, title: "انتهت المكالمة",
          roomId: invitation.callId, callerName: invitation.caller.name,
          body: "انتهت المكالمة",
        }, undefined, true, INCOMING_PUSH_TTL_SECONDS, {
          dedupeKey: `call-terminal:${invitation.callId}:ended`,
        });
      } catch {
        // Optional wake-up only.
      }
    }
    return true;
  } catch {
    throw new CallPushError("Call status update failed");
  }
}

export type DeferredCallWatcherStatus = "declined" | "missed" | "ended";

/**
 * Compatibility watcher for older consumers. New signalling uses participant
 * subscriptions, so an HTTP decline on another replica is delivered normally.
 */
export async function watchDeferredCallInvitation(
  callId: string,
  onTerminal: (status: DeferredCallWatcherStatus) => void,
): Promise<() => void> {
  // Signalling owns lifecycle notifications through the participant channel.
  void callId;
  void onTerminal;
  return () => {};
}

export async function listMissedCalls(userId: number): Promise<{
  items: { id: string; caller: CallerIdentity; type: CallType; time: string; isSeen: boolean; status: "declined" | "missed" }[];
  unseenCount: number;
}> {
  const db = await getAuthoritativeCallFirestore();
  try {
    const collection = db.collection("users").doc(String(userId)).collection("missedCalls");
    const [itemsSnapshot, unseenSnapshot, legacyUnseenSnapshot] = await Promise.all([
      collection.orderBy("time", "desc").limit(100).get(),
      collection.where("seen", "==", false).get(),
      // This query keeps pre-contract inbox documents visible while all new
      // writes use the canonical `seen` field.
      collection.where("isSeen", "==", false).get(),
    ]);
    const items = itemsSnapshot.docs.flatMap(doc => {
      const raw = doc.data();
      if (!raw) return [];
      const value: Record<string, unknown> = raw;
      const caller = value.caller && typeof value.caller === "object" && !Array.isArray(value.caller)
        ? value.caller as Record<string, unknown>
        : null;
      if ((value.type !== "video" && value.type !== "voice") ||
        (value.status !== "declined" && value.status !== "missed") ||
        (typeof value.fromId !== "number" && (!caller || typeof caller.id !== "number")) ||
        (typeof value.fromName !== "string" && (!caller || typeof caller.name !== "string"))) return [];
      const fromId = typeof value.fromId === "number" ? value.fromId : caller!.id as number;
      const fromName = typeof value.fromName === "string" ? value.fromName : caller!.name as string;
      const fromAvatar = typeof value.fromAvatar === "string"
        ? value.fromAvatar
        : typeof caller?.avatar === "string" ? caller.avatar : null;
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
    throw new CallPushError("Missed-call retrieval failed");
  }
}

export async function markMissedCallsSeen(userId: number, ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
    !ids.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new CallPushError("Invalid missed call IDs");
  }
  const db = await getAuthoritativeCallFirestore();
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
    throw new CallPushError("Missed-call update failed");
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
    const user = db.collection("users").doc(String(userId));
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
    } else if (shouldRevokeFirebaseRefreshTokens(sessionFilter)) {
      // Refresh-token revocation is account-wide and must never be part of a
      // single-session logout. It belongs only to explicit all-session flows.
      await auth.revokeRefreshTokens(String(userId));
    }
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

async function expireInvitation(db: CallDatabase, callId: string, data: Record<string, unknown>): Promise<void> {
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
  const run = async () => {
    let last: any;
    for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
      try {
        const db = await getAuthoritativeCallFirestore();
        let query = db.collection("callInvites").where("status", "==", "ringing")
          .where("expiresAt", "<=", new Date()).orderBy("expiresAt").limit(SWEEP_PAGE_SIZE);
        if (last) query = query.startAfter(last);
        const snapshot = await query.get();
        if (!snapshot.size) return;
        await Promise.all(snapshot.docs.map(async doc => {
          const data = doc.data();
          if (data) await expireInvitation(db, doc.id, data);
        }));
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