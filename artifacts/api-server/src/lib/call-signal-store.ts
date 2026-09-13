import type { Firestore } from "firebase-admin/firestore";
import {
  CallPushError,
  callSessionBinding,
  getAuthoritativeCallFirestore,
  isValidCallId,
  sendAuthoritativeIncomingCallPush,
} from "./firebase-call-push";

export type CallProvider = "agora" | "webrtc";
export type CallStatus = "ringing" | "answered" | "declined" | "missed";
export interface CallTransport { provider: CallProvider; version: 1; }
export interface StoredDescription { type: string; sdp?: string; }
export interface CallIdentity { id: number; name: string; avatar: string | null; }
export interface CallRecord {
  callId: string;
  caller: CallIdentity;
  callee: CallIdentity;
  status: CallStatus;
  type: "video" | "voice";
  deferredMedia: boolean;
  transport: CallTransport;
  initialOffer: StoredDescription | null;
  latestOffer: StoredDescription | null;
  initialAnswer?: StoredDescription | null;
  latestAnswer?: StoredDescription | null;
  e2e?: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  callerSessionTag: string;
  callerDeviceId: string;
  answerer?: { userId: number; sessionTag: string; deviceId: string };
  endedAt?: Date;
  /** Bounded replay snapshots; full relay payloads live in events documents. */
  replayIce: { caller: Record<string, unknown>[]; callee: Record<string, unknown>[] };
  preAnswerIce: Record<string, Record<string, unknown>[]>;
}
export interface CallSignal {
  signalId: string;
  seq: number;
  kind: "ice-candidate" | "call-webrtc-offer" | "call-webrtc-answer" |
    "call-renegotiate-offer" | "call-renegotiate-answer";
  fromId: number;
  toId: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const MAX_ICE_PER_SIDE = 32;
const MAX_PREANSWER_DEVICES = 3;
const MAX_PREANSWER_ICE = 16;
const MAX_CALL_LIFETIME_MS = 4 * 60 * 60 * 1000;

function ref(db: Firestore, callId: string) {
  return db.collection("callInvites").doc(callId);
}
function lockRef(db: Firestore, userId: number) {
  return db.collection("callLocks").doc(String(userId));
}
function asDate(value: unknown, fallback = new Date(0)): Date {
  return value instanceof Date ? value :
    value && typeof (value as { toDate?: unknown }).toDate === "function"
      ? (value as { toDate(): Date }).toDate() : fallback;
}
function description(value: unknown): StoredDescription | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as StoredDescription;
  return (candidate.type === "offer" || candidate.type === "answer") &&
    typeof candidate.sdp === "string" && candidate.sdp.length > 0 &&
    // Four SDP snapshots plus bounded ICE must fit a Firestore 1MiB document.
    candidate.sdp.length <= 96_000 ? candidate : null;
}
function canonical(callId: string, data: Record<string, unknown>): CallRecord | null {
  if (typeof data.fromId !== "number" || typeof data.toId !== "number" ||
    typeof data.fromName !== "string" || typeof data.toName !== "string" ||
    (data.status !== "ringing" && data.status !== "answered" &&
      data.status !== "declined" && data.status !== "missed") ||
    (data.type !== "video" && data.type !== "voice") ||
    !data.transport || typeof data.transport !== "object" ||
    (data.transport as CallTransport).version !== 1 ||
    ((data.transport as CallTransport).provider !== "agora" &&
      (data.transport as CallTransport).provider !== "webrtc") ||
    typeof data.callerSessionTag !== "string" || typeof data.callerDeviceId !== "string") return null;
  const ice = data.replayIce && typeof data.replayIce === "object" ? data.replayIce as Record<string, unknown> : {};
  const replayIce = {
    caller: Array.isArray(ice.caller) ? ice.caller.filter(value => value && typeof value === "object").slice(-MAX_ICE_PER_SIDE) as Record<string, unknown>[] : [],
    callee: Array.isArray(ice.callee) ? ice.callee.filter(value => value && typeof value === "object").slice(-MAX_ICE_PER_SIDE) as Record<string, unknown>[] : [],
  };
  const preAnswerIce = data.preAnswerIce && typeof data.preAnswerIce === "object" ? data.preAnswerIce as Record<string, Record<string, unknown>[]> : {};
  return {
    callId,
    caller: { id: data.fromId, name: data.fromName, avatar: typeof data.fromAvatar === "string" ? data.fromAvatar : null },
    callee: { id: data.toId, name: data.toName, avatar: typeof data.toAvatar === "string" ? data.toAvatar : null },
    status: data.status, type: data.type, deferredMedia: data.deferredMedia === true,
    transport: data.transport as CallTransport, initialOffer: description(data.initialOffer ?? data.offer),
    latestOffer: description(data.latestOffer ?? data.offer),
    initialAnswer: description(data.initialAnswer ?? data.answer),
    latestAnswer: description(data.latestAnswer ?? data.answer),
    e2e: data.e2e && typeof data.e2e === "object" ? data.e2e as Record<string, unknown> : undefined,
    expiresAt: asDate(data.expiresAt), createdAt: asDate(data.createdAt),
    callerSessionTag: data.callerSessionTag, callerDeviceId: data.callerDeviceId,
    answerer: data.answerer && typeof data.answerer === "object" ? data.answerer as CallRecord["answerer"] : undefined,
    endedAt: data.endedAt ? asDate(data.endedAt) : undefined, replayIce, preAnswerIce,
  };
}

export async function createAuthoritativeCall(input: Omit<CallRecord, "status" | "createdAt" | "expiresAt" | "replayIce" | "preAnswerIce" | "callerSessionTag"> & {
  callerSessionId: string; expiresAt?: Date;
}): Promise<CallRecord> {
  if (!isValidCallId(input.callId)) throw new CallPushError("Invalid call ID");
  const db = await getAuthoritativeCallFirestore();
  const createdAt = new Date();
  const expiresAt = input.expiresAt && input.expiresAt.getTime() > createdAt.getTime()
    ? input.expiresAt : new Date(createdAt.getTime() + 30_000);
  const callerSessionTag = callSessionBinding(input.callerSessionId);
  const record: CallRecord = {
    ...input, callerSessionTag, status: "ringing", createdAt, expiresAt, replayIce: { caller: [], callee: [] }, preAnswerIce: {},
  };
  try {
    await db.runTransaction(async transaction => {
      const call = ref(db, input.callId);
      const callerLock = lockRef(db, input.caller.id);
      const calleeLock = lockRef(db, input.callee.id);
      const [existing, callerBusy, calleeBusy] = await Promise.all([
        transaction.get(call), transaction.get(callerLock), transaction.get(calleeLock),
      ]);
      if (existing.exists) throw new CallPushError("Call ID is already in use");
      for (const lock of [callerBusy, calleeBusy]) {
        if (lock.exists && asDate(lock.data()?.expiresAt).getTime() > Date.now()) {
          throw new CallPushError("A participant is already in a call");
        }
      }
      const payload = {
        authoritative: true, participantIds: [input.caller.id, input.callee.id],
        fromId: input.caller.id, fromName: input.caller.name, fromAvatar: input.caller.avatar,
        toId: input.callee.id, toName: input.callee.name, toAvatar: input.callee.avatar,
        status: "ringing", type: input.type, deferredMedia: input.deferredMedia,
        transport: input.transport, initialOffer: input.initialOffer, latestOffer: input.latestOffer,
        e2e: input.e2e ?? null, callerSessionTag, callerDeviceId: input.callerDeviceId,
        createdAt, expiresAt, lastSignalSeq: 0, replayIce: { caller: [], callee: [] }, preAnswerIce: {},
      };
      transaction.create(call, payload);
      transaction.set(callerLock, { callId: input.callId, expiresAt, updatedAt: createdAt });
      transaction.set(calleeLock, { callId: input.callId, expiresAt, updatedAt: createdAt });
    });
  } catch (error) {
    if (error instanceof CallPushError) throw error;
    throw new CallPushError("Firebase call creation failed");
  }
  void sendAuthoritativeIncomingCallPush({
    callId: input.callId, callerId: input.caller.id, callerName: input.caller.name,
    callerAvatar: input.caller.avatar, calleeId: input.callee.id, expiresAt, video: input.type === "video",
  });
  return record;
}

export async function getAuthoritativeCall(callId: string): Promise<CallRecord | null> {
  if (!isValidCallId(callId)) return null;
  const db = await getAuthoritativeCallFirestore();
  const snapshot = await ref(db, callId).get();
  return snapshot.exists && snapshot.data() ? canonical(callId, snapshot.data()!) : null;
}

function sessionOwns(record: CallRecord, userId: number, sessionId: string, deviceId: string, requireSelected = false): boolean {
  const tag = callSessionBinding(sessionId);
  if (userId === record.caller.id) return record.callerSessionTag === tag && record.callerDeviceId === deviceId;
  return userId === record.callee.id && !!record.answerer &&
    record.answerer.sessionTag === tag && record.answerer.deviceId === deviceId &&
    (!requireSelected || record.status === "answered");
}

export async function answerAuthoritativeCall(
  callId: string, calleeId: number, sessionId: string, deviceId: string, answer: StoredDescription | null,
): Promise<CallRecord | null> {
  const db = await getAuthoritativeCallFirestore();
  let accepted: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    accepted = null; // Firestore may retry this callback after a conflict.
    const snapshot = await transaction.get(ref(db, callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonical(callId, snapshot.data()!);
    if (!record || record.endedAt || record.callee.id !== calleeId || record.status !== "ringing" ||
      record.expiresAt.getTime() <= Date.now()) return;
    // Deferred calls use a null consent answer first, then exchange SDP through
    // durable call-webrtc-* events after the acceptance commit.
    if (record.transport.provider === "webrtc" && !record.deferredMedia && !description(answer)) return;
    if (record.transport.provider === "webrtc" && record.deferredMedia && answer !== null && !description(answer)) return;
    if (record.transport.provider === "agora" && answer !== null) return;
    const answerer = { userId: calleeId, sessionTag: callSessionBinding(sessionId), deviceId };
    const activeUntil = new Date(Date.now() + MAX_CALL_LIFETIME_MS);
    const answererKey = `${answerer.sessionTag}:${answerer.deviceId}`;
    const winningIce = record.preAnswerIce[answererKey] ?? [];
    const callerKey = `caller:${record.callerSessionTag}:${record.callerDeviceId}`;
    const replayIce = {
      caller: (record.preAnswerIce[callerKey] ?? []).slice(-MAX_ICE_PER_SIDE),
      callee: winningIce.slice(-MAX_ICE_PER_SIDE),
    };
    transaction.update(ref(db, callId), {
      status: "answered", answeredAt: new Date(), answerer,
      initialAnswer: answer, latestAnswer: answer, activeUntil, replayIce, preAnswerIce: {},
    });
    transaction.set(lockRef(db, record.caller.id), { callId, expiresAt: activeUntil, updatedAt: new Date() });
    transaction.set(lockRef(db, record.callee.id), { callId, expiresAt: activeUntil, updatedAt: new Date() });
    accepted = { ...record, status: "answered", answerer, initialAnswer: answer, latestAnswer: answer, replayIce, preAnswerIce: {} };
  });
  return accepted;
}

export async function appendAuthoritativeSignal(input: {
  callId: string; userId: number; sessionId: string; deviceId: string;
  kind: CallSignal["kind"]; payload: Record<string, unknown>;
}): Promise<CallSignal | null> {
  const db = await getAuthoritativeCallFirestore();
  let emitted: CallSignal | null = null;
  await db.runTransaction(async transaction => {
    emitted = null; // Never leak a result from an abandoned transaction attempt.
    const snapshot = await transaction.get(ref(db, input.callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonical(input.callId, snapshot.data()!);
    if (!record || record.endedAt) return;
    if (record.transport.provider !== "webrtc") return;
    const callerRingingIce = record.status === "ringing" && input.kind === "ice-candidate" &&
      input.userId === record.caller.id && sessionOwns(record, input.userId, input.sessionId, input.deviceId);
    const calleeRingingIce = record.status === "ringing" && input.kind === "ice-candidate" && input.userId === record.callee.id;
    if (callerRingingIce || calleeRingingIce) {
      const key = `${callSessionBinding(input.sessionId)}:${input.deviceId}`;
      // Caller candidates use their fixed initiating key; callee candidates
      // remain isolated until answer arbitration selects a key.
      const iceKey = callerRingingIce ? `caller:${key}` : key;
      const current = record.preAnswerIce[iceKey] ?? [];
      const preAnswerIce = { ...record.preAnswerIce, [iceKey]: [...current, input.payload].slice(-MAX_PREANSWER_ICE) };
      const keys = Object.keys(preAnswerIce).filter(key => !key.startsWith("caller:"));
      for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PREANSWER_DEVICES))) delete preAnswerIce[stale];
      const seq = Number(snapshot.data()!.lastSignalSeq ?? 0) + 1;
      const signal: CallSignal = { signalId: `${input.callId}:${seq}`, seq, kind: input.kind, fromId: input.userId,
        toId: callerRingingIce ? record.callee.id : record.caller.id, payload: input.payload, createdAt: new Date() };
      transaction.update(ref(db, input.callId), { preAnswerIce, lastSignalSeq: seq });
      transaction.set(ref(db, input.callId).collection("events").doc(signal.signalId.replace(":", "_")), {
        ...signal, callId: input.callId, senderSessionTag: callSessionBinding(input.sessionId),
        senderDeviceId: input.deviceId, pendingAnswer: true, expiresAt: new Date(Date.now() + MAX_CALL_LIFETIME_MS),
      });
      return; // never deliver pre-answer ICE until answer ownership is committed.
    }
    if (!(callerRingingIce || (record.status === "answered" &&
      sessionOwns(record, input.userId, input.sessionId, input.deviceId, true)))) return;
    const toId = input.userId === record.caller.id ? record.callee.id : record.caller.id;
    const seq = Number(snapshot.data()!.lastSignalSeq ?? 0) + 1;
    const signal: CallSignal = {
      signalId: `${input.callId}:${seq}`, seq, kind: input.kind, fromId: input.userId, toId,
      payload: input.payload, createdAt: new Date(),
    };
    const side = input.userId === record.caller.id ? "caller" : "callee";
    const replayIce = input.kind === "ice-candidate"
      ? { ...record.replayIce, [side]: [...record.replayIce[side], input.payload].slice(-MAX_ICE_PER_SIDE) }
      : record.replayIce;
    const updates: Record<string, unknown> = { lastSignalSeq: seq, replayIce };
    if (input.kind.endsWith("offer")) {
      updates.latestOffer = input.payload.offer;
      if (!record.initialOffer) updates.initialOffer = input.payload.offer;
    }
    if (input.kind.endsWith("answer")) {
      updates.latestAnswer = input.payload.answer;
      if (!record.initialAnswer) updates.initialAnswer = input.payload.answer;
    }
    transaction.update(ref(db, input.callId), updates);
    // The bounded document copy makes reconnect replay a single-document read;
    // this immutable event stream gives every replica a Firestore relay cursor.
    transaction.set(ref(db, input.callId).collection("events").doc(signal.signalId.replace(":", "_")), {
      ...signal,
      callId: input.callId,
      senderSessionTag: callSessionBinding(input.sessionId),
      senderDeviceId: input.deviceId,
      expiresAt: new Date(Date.now() + MAX_CALL_LIFETIME_MS),
    });
    emitted = signal;
  });
  return emitted;
}

export async function terminateAuthoritativeCall(
  callId: string, userId: number, sessionId: string, deviceId: string, requested: "declined" | "missed" | "ended",
): Promise<CallRecord | null> {
  const db = await getAuthoritativeCallFirestore();
  let result: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    result = null;
    const snapshot = await transaction.get(ref(db, callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonical(callId, snapshot.data()!);
    if (!record || record.endedAt) return;
    const caller = userId === record.caller.id;
    const callee = userId === record.callee.id;
    if (!caller && !callee) return;
    if (caller && !sessionOwns(record, userId, sessionId, deviceId)) return;
    if (callee && record.status === "answered" && !sessionOwns(record, userId, sessionId, deviceId, true)) return;
    if (record.status !== "ringing" && record.status !== "answered") return;
    const expired = record.status === "ringing" && record.expiresAt.getTime() <= Date.now();
    const status: CallStatus = record.status === "answered" ? "answered" :
      expired || requested === "missed" || caller ? "missed" : "declined";
    const endedAt = new Date();
    const [callerLock, calleeLock] = await Promise.all([
      transaction.get(lockRef(db, record.caller.id)), transaction.get(lockRef(db, record.callee.id)),
    ]);
    transaction.update(ref(db, callId), { status, endedAt, ...(expired ? { expiredAt: endedAt } : {}) });
    // A newer call may already own an expired predecessor's lock. Never clear
    // it unless this transaction read the lock as belonging to this call.
    if (callerLock.data()?.callId === callId) transaction.delete(lockRef(db, record.caller.id));
    if (calleeLock.data()?.callId === callId) transaction.delete(lockRef(db, record.callee.id));
    result = { ...record, status, endedAt };
  });
  return result;
}

export async function expireAuthoritativeCall(callId: string): Promise<CallRecord | null> {
  const record = await getAuthoritativeCall(callId);
  if (!record || record.status !== "ringing" || record.expiresAt.getTime() > Date.now()) return null;
  // Expiry is a durable transaction; the caller binding is supplied from the
  // canonical document and is never inferred from a disconnected socket.
  const db = await getAuthoritativeCallFirestore();
  let expired: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    expired = null;
    const snapshot = await transaction.get(ref(db, callId));
    const current = snapshot.exists && snapshot.data() ? canonical(callId, snapshot.data()!) : null;
    if (!current || current.status !== "ringing" || current.expiresAt.getTime() > Date.now()) return;
    const missed = db.collection("users").doc(String(current.callee.id)).collection("missedCalls").doc(callId);
    const missedSnapshot = await transaction.get(missed);
    const endedAt = new Date();
    const [callerLock, calleeLock] = await Promise.all([
      transaction.get(lockRef(db, current.caller.id)), transaction.get(lockRef(db, current.callee.id)),
    ]);
    transaction.update(ref(db, callId), { status: "missed", endedAt, expiredAt: endedAt });
    if (callerLock.data()?.callId === callId) transaction.delete(lockRef(db, current.caller.id));
    if (calleeLock.data()?.callId === callId) transaction.delete(lockRef(db, current.callee.id));
    transaction.set(missed, {
      fromId: current.caller.id, fromName: current.caller.name, fromAvatar: current.caller.avatar,
      type: current.type, time: endedAt, seen: missedSnapshot.data()?.seen === true,
      caller: current.caller, isSeen: missedSnapshot.data()?.isSeen === true, status: "missed",
    }, { merge: true });
    expired = { ...current, status: "missed", endedAt };
  });
  return expired;
}

export async function isDurableCallParticipant(callId: string, userId: number): Promise<boolean> {
  const record = await getAuthoritativeCall(callId);
  return !!record && (record.caller.id === userId || record.callee.id === userId);
}