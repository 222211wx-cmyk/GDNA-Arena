import { CallPushError, callFailureDiagnosticCode, callSessionBinding, getCallStateDb, type CallStateDb, type CallStateTransaction } from "./call-state-db";
import { sendAuthoritativeIncomingCallPush } from "./firebase-call-push";
import { sendBrowserCallTerminalPush } from "./browser-push";
export { CallPushError, callSessionBinding } from "./call-state-db";

type IncomingSink = typeof sendAuthoritativeIncomingCallPush;
type TerminalSink = typeof sendBrowserCallTerminalPush;
let incomingSink: IncomingSink = sendAuthoritativeIncomingCallPush;
let terminalSink: TerminalSink = sendBrowserCallTerminalPush;

/** Test seam for verifying that the durable call entrypoints dispatch pushes. */
export function setCallPushSinksForTest(sinks: {
  incoming: IncomingSink;
  terminal: TerminalSink;
} | null): void {
  incomingSink = sinks?.incoming ?? sendAuthoritativeIncomingCallPush;
  terminalSink = sinks?.terminal ?? sendBrowserCallTerminalPush;
}

function notifyTerminal(record: CallRecord, status: "answered" | "ended" | "declined" | "missed"): void {
  void terminalSink({ callId: record.callId, calleeId: record.callee.id, status }).catch(() => {});
}
function isValidCallId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

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
const HEARTBEAT_LEASE_MS = 120_000;

function ref(db: CallStateDb, callId: string) {
  return db.collection("callInvites").doc(callId);
}
function lockRef(db: CallStateDb, userId: number) {
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
    // Four SDP snapshots plus bounded ICE must fit a single JSONB document.
    candidate.sdp.length <= 96_000 ? candidate : null;
}
export function canonicalCallRecord(callId: string, data: Record<string, unknown>): CallRecord | null {
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

/** Expired locks alone never end a legacy conversation. Re-read the call and
 * its participant locks under the existing serialized transaction, then
 * require authoritative revocation of at least one recorded session. */
async function recoverAbandonedLegacyCall(
  db: CallStateDb, transaction: CallStateTransaction, callId: string, lockedUserId: number, now: Date,
): Promise<CallRecord | null> {
  const snapshot = await transaction.get(ref(db, callId));
  const raw = snapshot.data();
  const record = raw ? canonicalCallRecord(callId, raw) : null;
  if (!record || raw?.endedAt || record.status !== "answered" || raw?.heartbeatEnabled === true ||
    !Number.isSafeInteger(record.caller.id) || record.caller.id <= 0 ||
    !Number.isSafeInteger(record.callee.id) || record.callee.id <= 0 ||
    record.caller.id === record.callee.id) return null;
  const participantIds = [record.caller.id, record.callee.id];
  if (!participantIds.includes(lockedUserId) || !Number.isFinite(now.getTime())) return null;
  const locks = [
    await transaction.get(lockRef(db, record.caller.id)),
    await transaction.get(lockRef(db, record.callee.id)),
  ];
  if (locks[participantIds.indexOf(lockedUserId)].data()?.callId !== callId) return null;
  for (const lock of locks) {
    if (lock.data()?.callId !== callId) continue;
    // Missing/malformed expiry is not evidence of an elapsed lock.
    const expiry = asDate(lock.data()?.expiresAt, new Date(NaN)).getTime();
    if (!Number.isFinite(expiry) || expiry > now.getTime()) return null;
  }
  const callerRevoked = await transaction.isRecordedSessionRevoked(record.caller.id, record.callerSessionTag);
  const answererRevoked = record.answerer?.userId === record.callee.id &&
    await transaction.isRecordedSessionRevoked(record.callee.id, record.answerer.sessionTag);
  if (!callerRevoked && !answererRevoked) return null;
  transaction.update(ref(db, callId), { endedAt: now });
  for (const [index, id] of participantIds.entries())
    if (locks[index].data()?.callId === callId) transaction.delete(lockRef(db, id));
  return { ...record, endedAt: now };
}

export async function createAuthoritativeCall(input: Omit<CallRecord, "status" | "createdAt" | "expiresAt" | "replayIce" | "preAnswerIce" | "callerSessionTag"> & {
  callerSessionId: string; expiresAt?: Date;
}): Promise<CallRecord> {
  if (!isValidCallId(input.callId)) throw new CallPushError("Invalid call ID");
  const db = getCallStateDb();
  const createdAt = new Date();
  const expiresAt = input.expiresAt && input.expiresAt.getTime() > createdAt.getTime()
    ? input.expiresAt : new Date(createdAt.getTime() + 30_000);
  const callerSessionTag = callSessionBinding(input.callerSessionId);
  const record: CallRecord = {
    ...input, callerSessionTag, status: "ringing", createdAt, expiresAt, replayIce: { caller: [], callee: [] }, preAnswerIce: {},
  };
  const recoveredLegacyCalls: CallRecord[] = [];
  try {
    await db.runTransaction(async transaction => {
      const call = ref(db, input.callId);
      const callerLock = lockRef(db, input.caller.id);
      const calleeLock = lockRef(db, input.callee.id);
      // A PostgreSQL transaction owns one client: do not queue concurrent
      // queries on it as we could with the former Firestore store.
      const existing = await transaction.get(call);
      const callerBusy = await transaction.get(callerLock);
      const calleeBusy = await transaction.get(calleeLock);
      if (existing.exists) throw new CallPushError("Call ID is already in use");
      for (const [userId, lock] of [[input.caller.id, callerBusy], [input.callee.id, calleeBusy]] as const) {
        if (!lock.exists) continue;
        // A committed terminal call is authoritative even if a leftover lock
        // still has a future expiry (for example after a failed prior cleanup).
        const oldId = lock.data()?.callId;
        if (typeof oldId === "string" && isValidCallId(oldId)) {
          if (recoveredLegacyCalls.some(previous => previous.callId === oldId)) continue;
          const oldSnapshot = await transaction.get(ref(db, oldId));
          const oldData = oldSnapshot.data();
          const old = oldData ? canonicalCallRecord(oldId, oldData) : null;
          if (old?.endedAt || old?.status === "missed" || old?.status === "declined") continue;
          if (asDate(lock.data()?.expiresAt).getTime() > Date.now())
            throw new CallPushError("A participant is already in a call");
          // An old web client has no lease protocol: an elapsed historical lock
          // alone is not proof that its answered media call has ended. A revoked
          // recorded participant session can prove abandonment.
          // Also protect malformed legacy records: a missing binding must not
          // bypass this guard just because canonicalization rejected the call.
          if (oldData?.status === "answered" && !oldData.endedAt &&
            oldData.heartbeatEnabled !== true) {
            const recovered = await recoverAbandonedLegacyCall(db, transaction, oldId, userId, new Date());
            if (!recovered) throw new CallPushError("A participant is already in a call");
            recoveredLegacyCalls.push(recovered);
          }
        } else if (asDate(lock.data()?.expiresAt).getTime() > Date.now()) {
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
    throw new CallPushError("Call state creation failed", callFailureDiagnosticCode(error));
  }
  for (const recovered of recoveredLegacyCalls) notifyTerminal(recovered, "ended");
  void incomingSink({
    callId: record.callId,
    callerId: record.caller.id,
    callerName: record.caller.name,
    callerAvatar: record.caller.avatar,
    calleeId: record.callee.id,
    expiresAt: record.expiresAt,
    video: record.type === "video",
  }).catch(() => {});
  return record;
}

export async function getAuthoritativeCall(callId: string): Promise<CallRecord | null> {
  if (!isValidCallId(callId)) return null;
  const db = getCallStateDb();
  const snapshot = await ref(db, callId).get();
  return snapshot.exists && snapshot.data() ? canonicalCallRecord(callId, snapshot.data()!) : null;
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
  const db = getCallStateDb();
  let accepted: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    accepted = null; // Reset before entering the serialized transaction.
    const snapshot = await transaction.get(ref(db, callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonicalCallRecord(callId, snapshot.data()!);
    if (!record || record.endedAt || record.callee.id !== calleeId || record.status !== "ringing" ||
      record.expiresAt.getTime() <= Date.now()) return;
    // Deferred calls use a null consent answer first, then exchange SDP through
    // durable call-webrtc-* events after the acceptance commit.
    if (record.transport.provider === "webrtc" && !record.deferredMedia && !description(answer)) return;
    if (record.transport.provider === "webrtc" && record.deferredMedia && answer !== null && !description(answer)) return;
    if (record.transport.provider === "agora" && answer !== null) return;
    const answerer = { userId: calleeId, sessionTag: callSessionBinding(sessionId), deviceId };
    const activeUntil = new Date(Date.now() + MAX_CALL_LIFETIME_MS);
    // Older web clients do not send heartbeats. Only opt-in leases may be
    // reclaimed after two minutes; answered is not itself a terminal state.
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
  if (accepted) notifyTerminal(accepted, "answered");
  return accepted;
}

/** One-way, durable direct-media failover. Authentication is evaluated inside
 * the PostgreSQL transaction so a stale socket cannot downgrade or steal it. */
export async function switchAuthoritativeCallProvider(
  callId: string, userId: number, sessionId: string, deviceId: string,
): Promise<CallRecord | null> {
  const db = getCallStateDb();
  let changed: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    changed = null;
    const snapshot = await transaction.get(ref(db, callId));
    const record = snapshot.exists && snapshot.data() ? canonicalCallRecord(callId, snapshot.data()!) : null;
    if (!record || record.endedAt || record.transport.provider !== "webrtc" ||
        (record.status !== "ringing" && record.status !== "answered")) return;
    const caller = record.caller.id === userId &&
      record.callerSessionTag === callSessionBinding(sessionId) && record.callerDeviceId === deviceId;
    const selectedCallee = record.status === "answered" && record.callee.id === userId &&
      record.answerer?.sessionTag === callSessionBinding(sessionId) && record.answerer.deviceId === deviceId;
    // A hybrid native client may not have WebRTC support. While the invitation
    // is still ringing it can request, but not join, the Agora failover only
    // from an E2EE recipient device included in the caller's durable envelope.
    // Its session remains authenticated by the WebSocket; it receives no token
    // until the normal answer transaction binds this session/device.
    const ringingEnvelopeDevice = record.status === "ringing" && record.callee.id === userId &&
      !!record.e2e?.devices && typeof record.e2e.devices === "object" &&
      Object.hasOwn(record.e2e.devices as object, deviceId);
    if (!caller && !selectedCallee && !ringingEnvelopeDevice) return;
    const transport: CallTransport = { provider: "agora", version: 1 };
    transaction.update(ref(db, callId), { transport, providerChangedAt: new Date() });
    changed = { ...record, transport };
  });
  return changed;
}

export function canControlDirectCallRecording(record: CallRecord | null, userId: number, sessionId: string, deviceId: string): boolean {
  if (!record || record.status !== "answered" || record.endedAt) return false;
  return sessionOwns(record, userId, sessionId, deviceId, true);
}

export async function appendAuthoritativeSignal(input: {
  callId: string; userId: number; sessionId: string; deviceId: string;
  kind: CallSignal["kind"]; payload: Record<string, unknown>;
}): Promise<CallSignal | null> {
  const db = getCallStateDb();
  let emitted: CallSignal | null = null;
  await db.runTransaction(async transaction => {
    emitted = null; // Never leak a result from an abandoned transaction attempt.
    const snapshot = await transaction.get(ref(db, input.callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonicalCallRecord(input.callId, snapshot.data()!);
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
     // this immutable event stream gives every replica a durable relay cursor.
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
  const db = getCallStateDb();
  let result: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    result = null;
    const snapshot = await transaction.get(ref(db, callId));
    if (!snapshot.exists || !snapshot.data()) return;
    const record = canonicalCallRecord(callId, snapshot.data()!);
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
  const completed = result as CallRecord | null;
  if (completed) {
    notifyTerminal(
      completed,
      completed.status === "declined" || completed.status === "missed"
        ? completed.status
        : "ended",
    );
  }
  return completed;
}

/** A selected participant renews an opt-in lease. Legacy calls retain their
 * original lifetime and are never assumed dead merely because of their age. */
export async function heartbeatAuthoritativeCall(
  callId: string, userId: number, sessionId: string, deviceId: string, background = false,
): Promise<boolean> {
  if (!isValidCallId(callId)) return false;
  const db = getCallStateDb();
  let renewed = false;
  await db.runTransaction(async transaction => {
    renewed = false;
    const snapshot = await transaction.get(ref(db, callId));
    const record = snapshot.data() ? canonicalCallRecord(callId, snapshot.data()!) : null;
    if (!record || record.status !== "answered" || record.endedAt ||
      !sessionOwns(record, userId, sessionId, deviceId, true)) return;
    const now = new Date();
    const lease = new Date(now.getTime() + (background ? MAX_CALL_LIFETIME_MS : HEARTBEAT_LEASE_MS));
    const locks = await Promise.all([transaction.get(lockRef(db, record.caller.id)), transaction.get(lockRef(db, record.callee.id))]);
    if (locks.some(lock => lock.data()?.callId !== callId)) return;
    transaction.update(ref(db, callId), { heartbeatEnabled: true, lastHeartbeatAt: now, leaseExpiresAt: lease });
    for (const id of [record.caller.id, record.callee.id])
      transaction.set(lockRef(db, id), { callId, expiresAt: lease, updatedAt: now });
    renewed = true;
  });
  return renewed;
}

/** Reclaim timed-out invitations, explicitly leased answered calls, and locked
 * legacy calls with expired locks AND a revoked recorded participant session.
 * Each decision is rechecked under the same PostgreSQL transaction as lock
 * deletion, so cleanup cannot delete a subsequent call's lock. */
export async function cleanupStaleAuthoritativeCalls(now = new Date()): Promise<number> {
  const db = getCallStateDb();
  let cleaned = 0;
  // A previous server version may have committed a terminal call but left
  // its lock. Reconcile it without touching a lock belonging to a new call.
  const lockSnapshots = await db.collection("callLocks").get();
  for (const lock of lockSnapshots.docs) {
    const oldId = lock.data()?.callId;
    if (typeof oldId !== "string" || !isValidCallId(oldId)) continue;
    const lockUserId = Number(lock.id);
    if (!Number.isSafeInteger(lockUserId) || lockUserId <= 0 || String(lockUserId) !== lock.id) continue;
    const recovered = await db.runTransaction(async transaction => {
      const latest = await transaction.get(lockRef(db, lockUserId));
      if (latest.data()?.callId !== oldId) return null;
      const call = await transaction.get(ref(db, oldId));
      const data = call.data();
      if ((data && (data.endedAt || data.status === "missed" || data.status === "declined")) ||
        (!data && asDate(latest.data()?.updatedAt).getTime() + HEARTBEAT_LEASE_MS <= now.getTime())) {
        transaction.delete(lockRef(db, lockUserId));
        return null;
      }
      return recoverAbandonedLegacyCall(db, transaction, oldId, lockUserId, now);
    });
    if (recovered) { cleaned++; notifyTerminal(recovered, "ended"); }
  }
  const snapshots = await db.collection("callInvites").get();
  for (const snapshot of snapshots.docs) {
    const data = snapshot.data();
    if (!data || data.endedAt || !(
      (data.status === "ringing" && asDate(data.expiresAt).getTime() <= now.getTime()) ||
      (data.status === "answered" && data.heartbeatEnabled === true &&
        asDate(data.leaseExpiresAt, new Date(asDate(data.lastHeartbeatAt).getTime() + HEARTBEAT_LEASE_MS)).getTime() <= now.getTime())
    )) continue;
    let completed: CallRecord | null = null;
    await db.runTransaction(async transaction => {
      completed = null;
      const currentSnapshot = await transaction.get(ref(db, snapshot.id));
      const raw = currentSnapshot.data();
      const current = raw ? canonicalCallRecord(snapshot.id, raw) : null;
      if (!current || current.endedAt || !(
        (current.status === "ringing" && current.expiresAt.getTime() <= now.getTime()) ||
        (current.status === "answered" && raw?.heartbeatEnabled === true &&
          asDate(raw.leaseExpiresAt, new Date(asDate(raw.lastHeartbeatAt).getTime() + HEARTBEAT_LEASE_MS)).getTime() <= now.getTime())
      )) return;
      const locks = await Promise.all([transaction.get(lockRef(db, current.caller.id)), transaction.get(lockRef(db, current.callee.id))]);
      const status = current.status === "ringing" ? "missed" : "answered";
      if (status === "missed") {
        const missed = db.collection("users").doc(String(current.callee.id)).collection("missedCalls").doc(snapshot.id);
        const previous = await transaction.get(missed);
        transaction.set(missed, {
          fromId: current.caller.id, fromName: current.caller.name, fromAvatar: current.caller.avatar,
          type: current.type, time: now, seen: previous.data()?.seen === true,
          caller: current.caller, isSeen: previous.data()?.isSeen === true, status: "missed",
        }, { merge: true });
      }
      transaction.update(ref(db, snapshot.id), { status, endedAt: now, expiredAt: now });
      for (const [index, id] of [current.caller.id, current.callee.id].entries())
        if (locks[index].data()?.callId === snapshot.id) transaction.delete(lockRef(db, id));
      completed = { ...current, status, endedAt: now };
    });
    const finalized = completed as CallRecord | null;
    if (finalized) { cleaned++; notifyTerminal(finalized, finalized.status === "missed" ? "missed" : "ended"); }
  }
  return cleaned;
}

export async function expireAuthoritativeCall(callId: string): Promise<CallRecord | null> {
  const record = await getAuthoritativeCall(callId);
  if (!record || record.status !== "ringing" || record.expiresAt.getTime() > Date.now()) return null;
  // Expiry is a durable transaction; the caller binding is supplied from the
  // canonical document and is never inferred from a disconnected socket.
  const db = getCallStateDb();
  let expired: CallRecord | null = null;
  await db.runTransaction(async transaction => {
    expired = null;
    const snapshot = await transaction.get(ref(db, callId));
    const current = snapshot.exists && snapshot.data() ? canonicalCallRecord(callId, snapshot.data()!) : null;
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
  if (expired) notifyTerminal(expired, "missed");
  return expired;
}

export async function isDurableCallParticipant(callId: string, userId: number): Promise<boolean> {
  const record = await getAuthoritativeCall(callId);
  return !!record && (record.caller.id === userId || record.callee.id === userId);
}