import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { DEFERRED_INVITATION_TTL_MS } from "./deferred-call-policy";

const FOCUS_FRESH_MS = 30_000;
const DEVICE_BATCH_SIZE = 500;
const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 5;
const INCOMING_PUSH_TTL_SECONDS = 30;
const MISSED_PUSH_TTL_SECONDS = 86_400;

type CallType = "video" | "voice";
type CallStatus = "ringing" | "accepted" | "declined" | "missed" | "cancelled" | "ended";

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
  vapidPublicKey?: string;
}

export class CallPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallPushError";
  }
}

let servicesPromise: Promise<FirebaseServices> | undefined;

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

function readServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.project_id === "string" && typeof value.client_email === "string" &&
      typeof value.private_key === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function configurationProblem(): string | null {
  if (!readServiceAccount()) return "Firebase service account is not configured";
  if (!asPublicConfig()) return "Firebase web configuration is not configured";
  if (!process.env.FIREBASE_VAPID_PUBLIC_KEY?.trim()) return "Firebase web push VAPID key is not configured";
  return null;
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
  return db.collection("calls").doc(callId);
}

function userRef(db: Firestore, userId: number) {
  return db.collection("users").doc(String(userId));
}

function missedRef(db: Firestore, userId: number, callId: string) {
  return userRef(db, userId).collection("missedCalls").doc(callId);
}

function invitationPayload(invitation: DeferredCallInvitation) {
  const createdAt = invitation.createdAt ?? new Date();
  const expiresAt = invitation.expiresAt ?? new Date(createdAt.getTime() + DEFERRED_INVITATION_TTL_MS);
  return {
    callerId: invitation.caller.id,
    calleeId: invitation.calleeId,
    status: "ringing" as const,
    type: invitation.type,
    createdAt,
    expiresAt,
    callerName: invitation.caller.name,
    callerAvatar: invitation.caller.avatar,
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
        code === "messaging/invalid-registration-token")) {
        await devices[index].ref.delete().catch(() => {});
      }
    }));
  } catch {
    // Push delivery is intentionally isolated from call-state persistence. Never
    // log an FCM token or let a provider outage crash WebSocket signaling.
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
  return {
    enabled: true,
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
    const accepted = await db.runTransaction(async transaction => {
      const ref = callRef(db, callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.calleeId !== calleeId || data.status !== "ringing" ||
        dateValue(data.expiresAt, new Date(0)).getTime() <= Date.now()) return false;
      transaction.update(ref, { status: "accepted", acceptedAt: new Date() });
      return true;
    });
    if (accepted) {
      await sendPush({ db, messaging, auth }, calleeId, { type: "CALL_ENDED", roomId: callId }, undefined, true);
    }
    return accepted;
  } catch {
    throw new CallPushError("Firebase invitation acceptance failed");
  }
}

export async function finishDeferredCallInvitation(
  invitation: DeferredCallInvitation,
  status: Exclude<CallStatus, "ringing" | "accepted">,
): Promise<boolean> {
  const { db, messaging, auth } = await loadServices();
  try {
    const changed = await db.runTransaction(async transaction => {
      const ref = callRef(db, invitation.callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.callerId !== invitation.caller.id || data.calleeId !== invitation.calleeId) return false;
      if (data.status !== "ringing" &&
        !(data.status === "accepted" && (status === "ended" || status === "cancelled"))) return false;
      transaction.update(ref, { status, endedAt: new Date() });
      if (status === "declined" || status === "missed") {
        transaction.set(missedRef(db, invitation.calleeId, invitation.callId), {
          caller: invitation.caller,
          type: invitation.type,
          time: new Date(),
          isSeen: false,
          status,
        });
      }
      return true;
    });
    if (!changed) return false;
    if (status === "declined" || status === "missed") {
      await sendPush(
        { db, messaging, auth },
        invitation.calleeId,
        {
          type: "MISSED_CALL",
          roomId: invitation.callId,
          callerName: invitation.caller.name,
          title: `مكالمة فائتة من ${invitation.caller.name}`,
          body: "لديك مكالمة فائتة",
        },
        undefined,
        true,
        MISSED_PUSH_TTL_SECONDS,
      );
    } else {
      await sendPush({ db, messaging, auth }, invitation.calleeId, { type: "CALL_ENDED", roomId: invitation.callId }, undefined, true);
    }
    return true;
  } catch {
    throw new CallPushError("Firebase call status update failed");
  }
}

export async function listMissedCalls(userId: number): Promise<{
  items: { id: string; caller: CallerIdentity; type: CallType; time: string; isSeen: boolean; status: "declined" | "missed" }[];
  unseenCount: number;
}> {
  const { db } = await loadServices();
  try {
    const collection = userRef(db, userId).collection("missedCalls");
    const [itemsSnapshot, unseenSnapshot] = await Promise.all([
      collection.orderBy("time", "desc").limit(100).get(),
      collection.where("isSeen", "==", false).count().get(),
    ]);
    const items = itemsSnapshot.docs.flatMap(doc => {
      const value = doc.data();
      if ((value.type !== "video" && value.type !== "voice") ||
        (value.status !== "declined" && value.status !== "missed") ||
        !value.caller || typeof value.caller.id !== "number" || typeof value.caller.name !== "string") return [];
      return [{
        id: doc.id,
        caller: {
          id: value.caller.id,
          name: value.caller.name,
          avatar: typeof value.caller.avatar === "string" ? value.caller.avatar : null,
        },
        type: value.type as CallType,
        time: dateValue(value.time).toISOString(),
        isSeen: value.isSeen === true,
        status: value.status as "declined" | "missed",
      }];
    });
    return { items, unseenCount: unseenSnapshot.data().count };
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
    for (const id of new Set(ids)) batch.update(missedRef(db, userId, id), { isSeen: true, seenAt: new Date() });
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
      id: data.callerId as number,
      name: data.callerName as string,
      avatar: typeof data.callerAvatar === "string" ? data.callerAvatar : null,
    },
    calleeId: data.calleeId as number,
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
        let query = db.collection("calls").where("status", "==", "ringing")
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