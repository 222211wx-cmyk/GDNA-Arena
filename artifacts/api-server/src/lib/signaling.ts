// ══════════════════════════════════════════════════════════════════════════════
//  GDNA REAL-TIME SIGNALING SERVER — WebRTC Call & Live Story Engine
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { requireReadyCallMediaProvider } from "./turn-config";
import { reserveDeferredAnsweringSocket } from "./deferred-call-policy";
import { appendBoundedIce } from "./ice-buffer";
import {
  acceptDirectCallInvitation,
  acceptDeferredCallInvitation,
  CallPushError,
  createDirectCallInvitation,
  createDeferredCallInvitation,
  declineDeferredCallInvitation,
  durableTerminalStatus,
  finishDirectCallInvitation,
  finishDeferredCallInvitation,
  getCallPushStatus,
  isFirebaseCallPushConfigured,
  resumeDirectCallInvitation,
  watchDirectCallInvitation,
  watchDeferredCallInvitation,
  type DeferredCallDeclineResult,
  type DeferredCallInvitation,
  type DeferredCallWatcherStatus,
  type DirectCallInvitation,
} from "./firebase-call-push";

// ── WebRTC type stubs (browser DOM types not present in Node tsconfig) ────────
interface RTCSessionDescriptionInit { type: string; sdp?: string; }
interface RTCIceCandidateInit      { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null; }
interface E2eCallEnvelope {
  devices: Record<string, { wrappedSecret: string; fingerprint: string }>;
}
type CallMediaProvider = "agora" | "webrtc";
interface CallTransport { provider: CallMediaProvider; version: 1; }

// ── Types ─────────────────────────────────────────────────────────────────────
interface Client {
  ws:       WebSocket;
  userId:   number | null;  // null = unauthenticated (WebRTC-only)
  sessionId: string;
  username: string;
  inCall:   boolean;
  liveId:   string | null;
}

type SignalMsg =
  | { type: "register";       userId: number; username: string }
  | { type: "call-offer";     to: string; offer: RTCSessionDescriptionInit | null; callId: string; from: string; video: boolean; deferredMedia?: boolean; transport?: CallTransport; e2e?: E2eCallEnvelope }
  | { type: "call-answer";    to: string; answer: RTCSessionDescriptionInit | null; callId: string; deferredMedia?: boolean; transport?: CallTransport }
  | { type: "call-resume";    callId: string }
  | { type: "call-cancel";    callId: string }
  | { type: "call-webrtc-offer"; callId: string; to?: string; offer: RTCSessionDescriptionInit; transport?: CallTransport }
  | { type: "call-webrtc-answer"; callId: string; to?: string; answer: RTCSessionDescriptionInit; transport?: CallTransport }
  | { type: "call-renegotiate-offer"; callId: string; offer: RTCSessionDescriptionInit; transport?: CallTransport }
  | { type: "call-renegotiate-answer"; callId: string; answer: RTCSessionDescriptionInit; transport?: CallTransport }
  | { type: "ice-candidate";  to: string; candidate: RTCIceCandidateInit; callId: string }
  | { type: "call-reject";    to: string; callId: string }
  | { type: "call-end";       to: string; callId: string }
  | { type: "live-start";     title: string; domain: string }
  | { type: "live-end" }
  | { type: "live-join";      liveId: string }
  | { type: "live-offer";     to: string; offer: RTCSessionDescriptionInit; liveId: string }
  | { type: "live-answer";    to: string; answer: RTCSessionDescriptionInit; liveId: string }
  | { type: "live-ice";       to: string; candidate: RTCIceCandidateInit; liveId: string }
  | { type: "ping" };

// ── In-memory registry ────────────────────────────────────────────────────────
const clients   = new Map<string, Set<Client>>();  // username (lower) → every active socket
const byUserId  = new Map<number, Set<Client>>();  // authenticated userId → every active socket
// Track from the moment an authenticated upgrade completes, before the client
// sends its register frame. Otherwise logout could race upgrade→register and
// miss a not-yet-registered socket carrying the former session identity.
const socketsBySessionId = new Map<string, Set<WebSocket>>();
const lives     = new Map<string, { hostUsername: string; title: string; domain: string; startedAt: Date }>();

// Active call state keyed by callId — signaling only relays answer/reject/end
// for calls it saw offered, and only between the two recorded participants.
interface ActiveCall {
  caller: string; callee: string; callerId: number | null; calleeId: number | null;
  callerSocket: WebSocket; calleeSocket: WebSocket | null; startedAt: Date;
  transport: CallTransport; ringTimer: NodeJS.Timeout;
  deferredMedia: boolean; firebasePersisted: boolean; status: "ringing" | "accepting" | "accepted"; callerAvatar: string | null;
  type: "video" | "voice"; expiresAt?: Date; firebaseWatcher?: () => void; directWatcher?: () => void; terminalEventSent?: boolean;
  directOffer?: RTCSessionDescriptionInit | null; directE2e?: E2eCallEnvelope;
  callerIceCandidates: RTCIceCandidateInit[];
  calleeIceCandidates: Array<{ socket: WebSocket; candidate: RTCIceCandidateInit }>;
}
const activeCalls = new Map<string, ActiveCall>();
// Firebase-disabled development deployments still need retry-safe HTTP
// responses after the in-memory call is removed. Keep only a bounded terminal
// cache; configured deployments use Firestore as the source of truth instead.
const localTerminalCalls = new Map<string, DeferredCallDeclineResult>();

interface PendingDirectOffer {
  callerId: number | null;
  callerSocket: WebSocket;
  callee: string;
  canceled: boolean;
  expiryTimer: NodeJS.Timeout | null;
  iceCandidates: RTCIceCandidateInit[];
}
const pendingDirectOffers = new Map<string, PendingDirectOffer>();
const MAX_PENDING_DIRECT_OFFERS = 10_000;
const PENDING_DIRECT_OFFER_TTL_MS = 30_000;

function beginPendingDirectOffer(
  callId: string,
  callerId: number | null,
  callerSocket: WebSocket,
  callee: string,
): PendingDirectOffer | null {
  if (activeCalls.has(callId) || pendingDirectOffers.has(callId) ||
      pendingDirectOffers.size >= MAX_PENDING_DIRECT_OFFERS) return null;
  const pending: PendingDirectOffer = {
    callerId,
    callerSocket,
    callee: callee.toLowerCase(),
    canceled: false,
    expiryTimer: null,
    iceCandidates: [],
  };
  pendingDirectOffers.set(callId, pending);
  pending.expiryTimer = setTimeout(() => {
    if (pendingDirectOffers.get(callId) !== pending) return;
    pending.canceled = true;
    pendingDirectOffers.delete(callId);
  }, PENDING_DIRECT_OFFER_TTL_MS);
  pending.expiryTimer.unref?.();
  return pending;
}

function pendingDirectOfferIsLive(
  callId: string,
  pending: PendingDirectOffer,
  callerSocket: WebSocket,
): boolean {
  return pendingDirectOffers.get(callId) === pending &&
    !pending.canceled &&
    pending.callerSocket === callerSocket &&
    callerSocket.readyState === WebSocket.OPEN;
}

function finishPendingDirectOffer(callId: string, pending: PendingDirectOffer): void {
  if (pending.expiryTimer) clearTimeout(pending.expiryTimer);
  if (pendingDirectOffers.get(callId) === pending) pendingDirectOffers.delete(callId);
}

function bufferIceCandidate(
  buffer: RTCIceCandidateInit[],
  candidate: RTCIceCandidateInit,
): void {
  if (buffer.some(existing =>
    existing.candidate === candidate.candidate &&
    existing.sdpMid === candidate.sdpMid &&
    existing.sdpMLineIndex === candidate.sdpMLineIndex)) return;
  appendBoundedIce(buffer, candidate);
}

function validIceCandidate(candidate: RTCIceCandidateInit | undefined): candidate is RTCIceCandidateInit {
  return !!candidate &&
    typeof candidate.candidate === "string" &&
    candidate.candidate.length <= 4_096;
}

function replayCallerIce(callId: string, call: ActiveCall, calleeSocket: WebSocket): void {
  for (const candidate of call.callerIceCandidates) {
    send(calleeSocket, {
      type: "ice-candidate",
      from: call.caller,
      callId,
      candidate,
    });
  }
}

function replayCalleeIce(callId: string, call: ActiveCall, calleeSocket: WebSocket): void {
  for (const item of call.calleeIceCandidates) {
    if (item.socket === calleeSocket) {
      send(call.callerSocket, {
        type: "ice-candidate",
        from: call.callee,
        callId,
        candidate: item.candidate,
      });
    }
  }
  // A single answer wins. Candidates from other pre-answer tabs must not leak
  // into the selected device's negotiated peer connection.
  call.calleeIceCandidates = [];
}

function cancelPendingDirectOffer(
  callId: string,
  callerId: number | null,
  callerSocket: WebSocket,
): boolean {
  const pending = pendingDirectOffers.get(callId);
  if (!pending || pending.callerId !== callerId || pending.callerSocket !== callerSocket) return false;
  pending.canceled = true;
  return true;
}

function rememberLocalTerminalCall(callId: string, result: DeferredCallDeclineResult): void {
  localTerminalCalls.set(callId, result);
  if (localTerminalCalls.size > 10_000) {
    const oldest = localTerminalCalls.keys().next().value;
    if (oldest) localTerminalCalls.delete(oldest);
  }
}

function disposeCallWatcher(call: ActiveCall): void {
  const watcher = call.firebaseWatcher;
  call.firebaseWatcher = undefined;
  watcher?.();
  const directWatcher = call.directWatcher;
  call.directWatcher = undefined;
  directWatcher?.();
}

function deferredInvitation(callId: string, call: ActiveCall): DeferredCallInvitation | null {
  if (!call.deferredMedia || call.callerId === null || call.calleeId === null) return null;
  return {
    callId,
    caller: { id: call.callerId, name: call.caller, avatar: call.callerAvatar },
    calleeId: call.calleeId,
    type: call.type,
    createdAt: call.startedAt,
    expiresAt: call.expiresAt,
  };
}

function directInvitation(callId: string, call: ActiveCall): DirectCallInvitation | null {
  if (call.deferredMedia || !call.firebasePersisted ||
      call.callerId === null || call.calleeId === null ||
      !call.transport || call.transport.provider !== "webrtc" ||
      !call.directOffer) return null;
  return {
    callId,
    caller: { id: call.callerId, name: call.caller, avatar: call.callerAvatar },
    calleeId: call.calleeId,
    type: call.type,
    offer: call.directOffer as unknown as Record<string, unknown>,
    transport: call.transport,
    e2e: call.directE2e as unknown as Record<string, unknown> | undefined,
    createdAt: call.startedAt,
    expiresAt: call.expiresAt,
  };
}

function persistDeferredTerminal(callId: string, call: ActiveCall, status: "declined" | "missed" | "ended"): void {
  const invitation = deferredInvitation(callId, call);
  if (invitation && call.firebasePersisted) void finishDeferredCallInvitation(invitation, status).catch(() => {});
  if (invitation && !call.firebasePersisted && (status === "declined" || status === "missed")) {
    rememberLocalTerminalCall(callId, {
      callId,
      outcome: status === "missed" ? "expired" : "declined",
      changed: true,
      status,
      callerId: call.callerId ?? undefined,
      callerName: call.caller,
      callerAvatar: call.callerAvatar,
      calleeId: call.calleeId ?? undefined,
      type: call.type,
    });
    void persistLegacyDeferredMissedCall(callId, call);
  }
}

function persistDirectTerminal(callId: string, call: ActiveCall, status: "declined" | "missed" | "ended"): void {
  const invitation = directInvitation(callId, call);
  if (invitation) void finishDirectCallInvitation(invitation, status).catch(() => {});
}

function persistLegacyDeferredMissedCall(callId: string, call: ActiveCall): Promise<void> {
  if (!pool || call.callerId === null || call.calleeId === null) return Promise.resolve();
  return pool.query(
    `INSERT INTO call_history
       (caller_id, caller_username, callee_id, callee_username, call_type, status, duration_sec)
     VALUES ($1, $2, $3, $4, $5, 'missed', 0)`,
    [call.callerId, call.caller, call.calleeId, call.callee, call.type === "video" ? "video" : "audio"],
  ).then(async () => {
    const settings = await pool.query<{ notifications: boolean }>(
      `SELECT COALESCE(notifications, true) AS notifications FROM dm_user_settings WHERE user_id = $1`,
      [call.calleeId],
    );
    if (settings.rows[0]?.notifications === false) return;
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, icon, link_path, source_ref)
       VALUES ($1, 'missed_call', $2, $3, '📞', '/messages', $4)
       ON CONFLICT (user_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
      [call.calleeId, "مكالمة فائتة · Missed call", `@${call.caller} حاول الاتصال بك`, `missed_call:${callId}`],
    );
  }).catch(() => {});
}

function validDescription(
  description: RTCSessionDescriptionInit | null,
  expectedType: "offer" | "answer",
): description is RTCSessionDescriptionInit {
  return !!description &&
    description.type === expectedType &&
    typeof description.sdp === "string" &&
    description.sdp.length > 0 &&
    description.sdp.length <= 256_000;
}

function transportMatches(
  value: CallTransport | undefined,
  provider: CallMediaProvider,
): value is CallTransport {
  return value?.version === 1 && value.provider === provider;
}

// Participant authorization for RTC token issuance: a token for channel
// `callId` is only granted to one of the two recorded call participants.
export function isCallParticipant(callId: string, userId: number): boolean {
  const call = activeCalls.get(callId);
  return !!call && (call.callerId === userId || call.calleeId === userId);
}

// Periodic sweep: drop call records older than 4h (crash/no-close leftovers)
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, call] of activeCalls) {
    if (call.startedAt.getTime() < cutoff) {
      activeCalls.delete(id);
      disposeCallWatcher(call);
      clearTimeout(call.ringTimer);
    }
  }
}, 30 * 60 * 1000).unref?.();

function send(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function findByUsername(username: string): Client | undefined {
  return Array.from(clients.get(username.toLowerCase()) ?? [])
    .find(client => client.ws.readyState === WebSocket.OPEN);
}

function clientsForUsername(username: string): Set<Client> {
  return clients.get(username.toLowerCase()) ?? new Set<Client>();
}

function addClient(client: Client) {
  const named = clients.get(client.username) ?? new Set<Client>();
  named.add(client);
  clients.set(client.username, named);
  if (client.userId !== null) {
    const identified = byUserId.get(client.userId) ?? new Set<Client>();
    identified.add(client);
    byUserId.set(client.userId, identified);
  }
}

function removeClient(client: Client) {
  const named = clients.get(client.username);
  named?.delete(client);
  if (named?.size === 0) clients.delete(client.username);
  if (client.userId !== null) {
    const identified = byUserId.get(client.userId);
    identified?.delete(client);
    if (identified?.size === 0) byUserId.delete(client.userId);
  }
}

function trackSessionSocket(sessionId: string, ws: WebSocket) {
  const sockets = socketsBySessionId.get(sessionId) ?? new Set<WebSocket>();
  sockets.add(ws);
  socketsBySessionId.set(sessionId, sockets);
}

function untrackSessionSocket(sessionId: string, ws: WebSocket) {
  const sockets = socketsBySessionId.get(sessionId);
  sockets?.delete(ws);
  if (sockets?.size === 0) socketsBySessionId.delete(sessionId);
}

function scheduleSessionExpiry(ws: WebSocket, expires: unknown): () => void {
  const expiresAt = expires instanceof Date
    ? expires.getTime()
    : typeof expires === "string" || typeof expires === "number"
      ? new Date(expires).getTime()
      : Number.NaN;
  if (!Number.isFinite(expiresAt)) return () => {};

  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      if (ws.readyState === WebSocket.OPEN) {
        send(ws, { type: "session-ended" });
        ws.close(4001, "Session expired");
      }
      return;
    }
    // Node timers are capped at a signed 32-bit millisecond delay.
    timer = setTimeout(schedule, Math.min(remaining, 2_147_000_000));
  };
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
  };
}

async function sessionIsActive(sessionId: string, userId: number): Promise<boolean> {
  const result = await pool?.query(
    `SELECT 1
     FROM user_sessions
     WHERE sid = $1
       AND (sess->>'userId')::int = $2
       AND expire > NOW()
     LIMIT 1`,
    [sessionId, userId],
  );
  return !!result?.rowCount;
}

function onlineUsernames() {
  return Array.from(clients.keys());
}

function setUserInCall(username: string, inCall: boolean) {
  for (const client of clientsForUsername(username)) client.inCall = inCall;
}

function userIsInCall(username: string): boolean {
  return Array.from(clientsForUsername(username)).some(client => client.inCall);
}

function userHasRecordedCall(userId: number): boolean {
  return Array.from(activeCalls.values()).some(call =>
    call.callerId === userId || call.calleeId === userId,
  );
}

function sendToUsername(username: string, data: object) {
  for (const client of clientsForUsername(username)) send(client.ws, data);
}

function callEnvelopeMatchesDevices(
  rows: { device_id: string; fingerprint: string }[],
  envelope: E2eCallEnvelope | undefined,
): boolean {
  if (!envelope?.devices || typeof envelope.devices !== "object" || Array.isArray(envelope.devices)) return false;
  const entries = Object.entries(envelope.devices);
  if (!entries.length || entries.length > 32) return false;
  for (const [deviceId, entry] of entries) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(deviceId) ||
        !entry || typeof entry.wrappedSecret !== "string" ||
        entry.wrappedSecret.length < 100 || entry.wrappedSecret.length > 1000 ||
        typeof entry.fingerprint !== "string" ||
        entry.fingerprint.length < 20 || entry.fingerprint.length > 100) return false;
  }
  const registered = rows.map(row => `${row.device_id}.${row.fingerprint}`).sort();
  const offered = entries.map(([deviceId, entry]) => `${deviceId}.${entry.fingerprint}`).sort();
  return registered.length === offered.length && registered.every((value, index) => value === offered[index]);
}

async function currentCallEnvelopeMatches(
  calleeId: number,
  envelope: E2eCallEnvelope | undefined,
): Promise<boolean> {
  if (!pool) return false;
  const rows = await pool.query<{ device_id: string; fingerprint: string }>(
    `SELECT device_id, fingerprint
       FROM dm_user_e2ee_keys
      WHERE user_id=$1 AND updated_at >= now() - interval '90 days'`,
    [calleeId],
  );
  return callEnvelopeMatchesDevices(rows.rows, envelope);
}

async function currentCallBlocked(callerId: number, calleeId: number): Promise<boolean> {
  if (!pool) return true;
  const result = await pool.query(
    `SELECT 1
       FROM citizen_blocks
      WHERE (blocker_id=$1 AND blocked_id=$2)
         OR (blocker_id=$2 AND blocked_id=$1)
      LIMIT 1`,
    [callerId, calleeId],
  );
  return result.rows.length > 0;
}

function safeCallerAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const avatar = value.trim();
  return avatar.length > 0 && avatar.length <= 2_048 ? avatar : null;
}

// Avatar fields have existed in different production user/profile shapes over
// time, while the current shared users schema intentionally has none. Converting
// the server row to JSON lets us read any persisted optional field without
// introducing a migration or trusting caller-supplied display metadata.
async function persistedCallerAvatar(userId: number): Promise<string | null> {
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ avatar: string | null }>(
      `SELECT NULLIF(COALESCE(
         to_jsonb(u)->>'avatar_url',
         to_jsonb(u)->>'avatar',
         to_jsonb(u)->'profile'->>'avatarUrl',
         to_jsonb(u)->'profile'->>'avatar_url',
         to_jsonb(u)->'profile_json'->>'avatarUrl',
         to_jsonb(u)->'profile_json'->>'avatar_url'
       ), '') AS avatar
       FROM users u WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    return safeCallerAvatar(rows[0]?.avatar);
  } catch {
    return null;
  }
}

// ── Broadcast a notification payload to a specific authenticated userId ────────
export function broadcastToUser(userId: number, data: object) {
  for (const client of byUserId.get(userId) ?? []) send(client.ws, data);
}

function clearActiveCall(callId: string, call: ActiveCall): void {
  if (activeCalls.get(callId) !== call) return;
  activeCalls.delete(callId);
  disposeCallWatcher(call);
  clearTimeout(call.ringTimer);
  setUserInCall(call.caller, false);
  setUserInCall(call.callee, false);
}

function broadcastDeclinedCall(
  callId: string,
  result: DeferredCallDeclineResult,
  call?: ActiveCall,
): void {
  const callerId = result.callerId ?? call?.callerId;
  const calleeId = result.calleeId ?? call?.calleeId;
  const callerName = result.callerName ?? call?.caller;
  const calleeName = call?.callee;
  if (result.status === "declined") {
    const callerEvent = { type: "call-rejected", by: calleeName ?? "callee", callId };
    if (callerId !== undefined && callerId !== null) broadcastToUser(callerId, callerEvent);
    const calleeEvent = { type: "call-ended", by: calleeName ?? "callee", callId };
    if (calleeId !== undefined && calleeId !== null) broadcastToUser(calleeId, calleeEvent);
    return;
  }
  if (result.status === "missed" || result.outcome === "expired") {
    const event = {
      type: "call-ended",
      by: "timeout",
      callId,
      code: "RING_TIMEOUT",
      reason: "Call was not answered within 30 seconds",
    };
    if (callerId !== undefined && callerId !== null) broadcastToUser(callerId, event);
    if (calleeId !== undefined && calleeId !== null) broadcastToUser(calleeId, event);
  }
  void callerName;
}

function handleDurableCallTerminal(callId: string, status: DeferredCallWatcherStatus): void {
  const call = activeCalls.get(callId);
  if (!call || !call.firebasePersisted) return;
  if (call.terminalEventSent) return;
  call.terminalEventSent = true;
  const result: DeferredCallDeclineResult = {
    callId,
    outcome: status === "declined" ? "declined" : status === "missed" ? "expired" : "finished",
    changed: true,
    status: status === "ended" ? "answered" : status,
    callerId: call.callerId ?? undefined,
    callerName: call.caller,
    callerAvatar: call.callerAvatar,
    calleeId: call.calleeId ?? undefined,
    type: call.type,
  };
  clearActiveCall(callId, call);
  if (status === "ended") {
    const event = { type: "call-ended", by: call.callee, callId };
    if (result.callerId !== undefined) broadcastToUser(result.callerId, event);
    if (result.calleeId !== undefined) broadcastToUser(result.calleeId, event);
  } else {
    broadcastDeclinedCall(callId, result, call);
  }
}

function watchDurableInvitation(callId: string, call: ActiveCall): void {
  if (!call.firebasePersisted) return;
  void watchDeferredCallInvitation(callId, terminal => {
    handleDurableCallTerminal(callId, terminal);
  }).then(stop => {
    if (activeCalls.get(callId) !== call || !call.firebasePersisted) {
      stop();
      return;
    }
    call.firebaseWatcher = stop;
  }).catch(() => {});
}

function watchDirectInvitation(callId: string, call: ActiveCall): void {
  if (call.deferredMedia || !call.firebasePersisted) return;
  void watchDirectCallInvitation(callId, event => {
    if (activeCalls.get(callId) !== call || call.terminalEventSent) return;
    if (event.kind === "answered") {
      if (call.status !== "ringing" && call.status !== "accepting") return;
      call.status = "accepted";
      clearTimeout(call.ringTimer);
      setUserInCall(call.callee, true);
      setUserInCall(call.caller, true);
      for (const device of clientsForUsername(call.callee)) {
        if (device.ws !== call.calleeSocket) {
          send(device.ws, { type: "call-ended", by: call.callee, callId });
        }
      }
      send(call.callerSocket, {
        type: "call-accepted",
        from: call.callee,
        callId,
        answer: event.answer,
        transport: call.transport,
      });
      if (call.calleeSocket) {
        replayCallerIce(callId, call, call.calleeSocket);
        replayCalleeIce(callId, call, call.calleeSocket);
      }
      return;
    }
    handleDurableCallTerminal(callId, event.status);
  }).then(stop => {
    if (activeCalls.get(callId) !== call || call.deferredMedia) {
      stop();
      return;
    }
    call.directWatcher = stop;
  }).catch(() => {});
}

/**
 * Authenticated HTTP and WebSocket callee rejection share this path. The
 * Firestore transaction runs before in-memory cleanup/broadcast, then every
 * active tab for both recorded participants receives the same terminal event.
 */
export async function declineCallForUser(
  callId: string,
  userId: number,
): Promise<DeferredCallDeclineResult> {
  const call = activeCalls.get(callId);
  if (call && (!(call.deferredMedia || call.firebasePersisted) || call.calleeId !== userId)) {
    return { callId, outcome: "not-callee", changed: false, calleeId: call.calleeId ?? undefined };
  }
  if (call && call.status !== "ringing") {
    return {
      callId,
      outcome: "finished",
      changed: false,
      status: "answered",
      callerId: call.callerId ?? undefined,
      callerName: call.caller,
      callerAvatar: call.callerAvatar,
      calleeId: call.calleeId ?? undefined,
      type: call.type,
    };
  }
  const localTerminal = localTerminalCalls.get(callId);
  if (!call && localTerminal) {
    if (localTerminal.calleeId !== undefined && localTerminal.calleeId !== userId) {
      return { callId, outcome: "not-callee", changed: false, calleeId: localTerminal.calleeId };
    }
    return { ...localTerminal, outcome: "finished", changed: false };
  }

  let result: DeferredCallDeclineResult;
  if (call?.firebasePersisted || isFirebaseCallPushConfigured()) {
    result = await declineDeferredCallInvitation(callId, userId);
  } else if (call) {
    // The explicit Firebase-disabled deployment keeps the established
    // in-memory/legacy missed-call path. It still enforces ownership and
    // removes the call before broadcasting, so a stale tab cannot revive it.
    const expired = call.expiresAt !== undefined && call.expiresAt.getTime() <= Date.now();
    result = {
      callId,
      outcome: expired ? "expired" : "declined",
      changed: true,
      status: expired ? "missed" : "declined",
      callerId: call.callerId ?? undefined,
      callerName: call.caller,
      callerAvatar: call.callerAvatar,
      calleeId: call.calleeId ?? undefined,
      type: call.type,
    };
    rememberLocalTerminalCall(callId, result);
  } else {
    // A process that restarted cannot authoritatively decline a call without
    // its durable Firestore record. Surface the precise readiness failure
    // rather than pretending that cloud state was updated.
    result = await declineDeferredCallInvitation(callId, userId);
  }

  // A finished answered call must remain alive; only a canonical declined or
  // expired/missed ringing record can clear the local ring state.
  const persistLegacy = call && result.changed && !call.firebasePersisted &&
    (result.status === "declined" || result.status === "missed") && call.status === "ringing";
  const terminalRing = result.status === "declined" || result.status === "missed";
  if (call && call.status === "ringing" && (result.changed || terminalRing)) {
    clearActiveCall(callId, call);
  }
  const shouldBroadcast = call ? !call.terminalEventSent : true;
  if (call) call.terminalEventSent = true;
  if (result.changed && shouldBroadcast) broadcastDeclinedCall(callId, result, call);
  // Keep the legacy no-Firebase fallback durable before the HTTP action
  // resolves, but only after in-memory cleanup and broadcasts are immediate.
  if (persistLegacy) await persistLegacyDeferredMissedCall(callId, call);
  return result;
}

// An upgraded WebSocket otherwise remains authenticated after its backing HTTP
// session is destroyed. Auth routes call these revokers on logout, session
// rotation, and password changes so a stale tab/device cannot keep receiving a
// former citizen's private AMIS events.
export function disconnectSessionSockets(sessionId: string) {
  for (const ws of Array.from(socketsBySessionId.get(sessionId) ?? [])) {
    send(ws, { type: "session-ended" });
    ws.close(4001, "Session ended");
  }
}

export function disconnectUserSockets(userId: number) {
  for (const client of Array.from(byUserId.get(userId) ?? [])) {
    send(client.ws, { type: "session-ended" });
    client.ws.close(4001, "Session revoked");
  }
}

// Chat delivery is always resolved from persisted room membership. The client
// never supplies recipients, which keeps a crafted WebSocket payload from
// leaking a private room's message to an unrelated citizen.
export async function broadcastRoomEvent(
  roomId: number,
  event: object,
  recipientUserIds?: number[],
): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM dm_room_members WHERE room_id = $1`,
    [roomId],
  );
  const allowedRecipients = recipientUserIds ? new Set(recipientUserIds) : null;
  for (const { user_id: userId } of rows) {
    if (allowedRecipients && !allowedRecipients.has(userId)) continue;
    broadcastToUser(userId, {
      ...event,
      recipientUserId: userId,
      roomId,
    });
  }
}

export async function broadcastMessageToRoom(roomId: number, message: object): Promise<void> {
  return broadcastRoomEvent(roomId, {
    type: "chat-message",
    message,
  });
}

export function attachSignalingServer(httpServer: Server, sessionMiddleware: RequestHandler) {
  const wss = new WebSocketServer({ noServer: true });

  // Authenticate the WebSocket upgrade against the same session store as HTTP.
  // Identity is always derived server-side — the client's register payload is ignored for auth.
  httpServer.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/api/ws") return; // not ours
    sessionMiddleware(req as any, {} as any, () => {
      const userId = (req as any).session?.userId;
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let self: Client | null = null;
    const sessionUserId: number = (req as any).session.userId;
    const sessionId: string = (req as any).sessionID;
    trackSessionSocket(sessionId, ws);
    const cancelSessionExpiry = scheduleSessionExpiry(
      ws,
      (req as any).session.cookie?.expires,
    );

    ws.on("message", async (raw) => {
      let msg: SignalMsg;
      try { msg = JSON.parse(raw.toString()) as SignalMsg; }
      catch { return; }

      // ── REGISTER ──────────────────────────────────────────────────────────
      if (msg.type === "register") {
        if (self) return; // one immutable identity registration per socket
        // Revalidate the backing session at registration time. This closes the
        // upgrade→logout→register race even if revocation and registration land
        // in adjacent event-loop turns.
        try {
          if (!await sessionIsActive(sessionId, sessionUserId)) {
            send(ws, { type: "session-ended" });
            ws.close(4001, "Session ended");
            return;
          }
        } catch {
          send(ws, { type: "error", message: "Session validation failed" });
          ws.close(1011, "Session validation failed");
          return;
        }
        // Derive username from DB using the session-authenticated userId.
        let username: string | null = null;
        try {
          const { rows } = (await pool?.query<{ username: string }>(
            `SELECT username FROM users WHERE id = $1 LIMIT 1`, [sessionUserId],
          )) ?? { rows: [] };
          username = rows[0]?.username?.toLowerCase() ?? null;
        } catch { /* fall through */ }
        if (!username) { send(ws, { type: "error", message: "Unknown user" }); return; }

        // The username lookup above yielded to the event loop. Revalidate at
        // the last async boundary before routing-map insertion, and reject a
        // socket that session revocation has already begun closing.
        try {
          if (
            ws.readyState !== WebSocket.OPEN ||
            !socketsBySessionId.get(sessionId)?.has(ws) ||
            !await sessionIsActive(sessionId, sessionUserId)
          ) {
            if (ws.readyState === WebSocket.OPEN) {
              send(ws, { type: "session-ended" });
              ws.close(4001, "Session ended");
            }
            return;
          }
        } catch {
          send(ws, { type: "error", message: "Session validation failed" });
          ws.close(1011, "Session validation failed");
          return;
        }
        self = { ws, userId: sessionUserId, sessionId, username, inCall: false, liveId: null };
        addClient(self);
        send(ws, { type: "registered", userId: sessionUserId, username, onlineCount: clients.size });
        // Broadcast online list
        const onlineList = onlineUsernames();
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "online-list", users: onlineList }); });
        console.log(`[WS] 🟢 ${username} connected (total: ${clients.size})`);
        return;
      }

      if (!self) { send(ws, { type: "error", message: "Not registered" }); return; }

      // ── PING ──────────────────────────────────────────────────────────────
      if (msg.type === "ping") { send(ws, { type: "pong" }); return; }

      // ── CALL OFFER ────────────────────────────────────────────────────────
      if (msg.type === "call-offer") {
        let authoritativeProvider: CallMediaProvider;
        try {
          authoritativeProvider = requireReadyCallMediaProvider();
        } catch {
          send(ws, {
            type: "call-unavailable",
            callId: msg.callId,
            code: "MEDIA_PROVIDER_UNAVAILABLE",
            reason: "Configured call media provider is unavailable",
          });
          return;
        }
        const validMediaEnvelope =
          (msg.deferredMedia === true
            ? transportMatches(msg.transport, "webrtc")
            : transportMatches(msg.transport, authoritativeProvider) ||
              (authoritativeProvider === "agora" && msg.transport === undefined)) &&
          (authoritativeProvider === "agora"
            ? msg.offer === null
            : msg.deferredMedia === true
              ? msg.offer === null
              : validDescription(msg.offer, "offer"));
        if (!validMediaEnvelope) {
          send(ws, {
            type: "call-unavailable",
            callId: msg.callId,
            code: "MEDIA_PROTOCOL_MISMATCH",
            reason: "Call media protocol does not match the server",
          });
          return;
        }
        // Deferred media is the web-only invitation protocol. It deliberately
        // carries no SDP until a callee has accepted, and is never substituted
        // onto Agora or an unconfigured TURN path.
        if (msg.deferredMedia === true && authoritativeProvider !== "webrtc") {
          send(ws, {
            type: "call-unavailable",
            callId: msg.callId,
            code: "MEDIA_PROTOCOL_MISMATCH",
            reason: "Deferred web calls require the configured WebRTC provider",
          });
          return;
        }
        if (msg.deferredMedia === true && !transportMatches(msg.transport, "webrtc")) {
          send(ws, {
            type: "call-unavailable",
            callId: msg.callId,
            code: "MEDIA_PROTOCOL_MISMATCH",
            reason: "Deferred web call transport is unsupported",
          });
          return;
        }
        if (msg.deferredMedia === true) {
          if (self.userId === null) {
            send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
            return;
          }
          try {
            // Resolve against persisted users even when the recipient has no
            // socket. This keeps block checks and call reservation identical
            // for online and offline invitees.
            const result = await pool!.query<{ id: number; username: string }>(
              `SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
              [msg.to],
            );
            const callee = result.rows[0];
            if (!callee || callee.id === self.userId) {
              send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
              return;
            }
            const block = await pool!.query(
              `SELECT 1 FROM citizen_blocks
               WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)
               LIMIT 1`,
              [self.userId, callee.id],
            );
            if (block.rows.length) {
              send(ws, { type: "call-blocked", callId: msg.callId });
              return;
            }
            if (userIsInCall(self.username) || userIsInCall(callee.username) ||
                userHasRecordedCall(self.userId) || userHasRecordedCall(callee.id)) {
              send(ws, { type: "call-busy", to: callee.username, callId: msg.callId });
              return;
            }
            const lockClient = await pool!.connect();
            try {
              await lockClient.query("BEGIN");
              await lockClient.query("SELECT pg_advisory_xact_lock(47201, 1)");
              const keyRows = await lockClient.query<{ device_id: string; fingerprint: string }>(
                `SELECT device_id, fingerprint FROM dm_user_e2ee_keys
                 WHERE user_id=$1 AND updated_at >= now() - interval '90 days'`,
                [callee.id],
              );
              if (!callEnvelopeMatchesDevices(keyRows.rows, msg.e2e)) {
                await lockClient.query("ROLLBACK");
                send(ws, { type: "call-unavailable", to: callee.username, callId: msg.callId, reason: "secure-device-keys-changed" });
                return;
              }
              await lockClient.query("COMMIT");
            } catch {
              await lockClient.query("ROLLBACK").catch(() => {});
              send(ws, { type: "call-unavailable", to: callee.username, callId: msg.callId });
              return;
            } finally {
              lockClient.release();
            }
            const createdAt = new Date();
            const callerAvatar = await persistedCallerAvatar(self.userId);
            const localInvitation: DeferredCallInvitation = {
              callId: msg.callId,
              caller: { id: self.userId, name: self.username, avatar: callerAvatar },
              calleeId: callee.id,
              type: msg.video ? "video" : "voice",
              createdAt,
              expiresAt: new Date(createdAt.getTime() + 30_000),
            };
            // Configuration/parsing/Admin initialization failures are exposed
            // by the readiness UI but must not disable in-app ringing.
            // A write failure after Firebase is ready still fails explicitly.
            const firebaseStatus = await getCallPushStatus();
            if (!firebaseStatus.enabled) {
              console.warn("[CALL] Firebase unavailable; using in-app ringing:", firebaseStatus.reason);
            }
            const firebasePersisted = firebaseStatus.enabled;
            const invitation = firebasePersisted
              ? await createDeferredCallInvitation(localInvitation)
              : localInvitation;
            const ringTimer = setTimeout(() => {
              const ringing = activeCalls.get(msg.callId);
              if (!ringing || ringing.status !== "ringing") return;
              activeCalls.delete(msg.callId);
              disposeCallWatcher(ringing);
              persistDeferredTerminal(msg.callId, ringing, "missed");
              setUserInCall(ringing.caller, false);
              setUserInCall(ringing.callee, false);
              const event = { type: "call-ended", by: "timeout", callId: msg.callId, code: "RING_TIMEOUT", reason: "Call was not answered within 30 seconds" };
              send(ringing.callerSocket, event);
              sendToUsername(ringing.callee, event);
            }, Math.max(1, invitation.expiresAt!.getTime() - Date.now()));
            ringTimer.unref?.();
            localTerminalCalls.delete(msg.callId);
            const activeCall: ActiveCall = {
              caller: self.username,
              callee: callee.username.toLowerCase(),
              callerId: self.userId,
              calleeId: callee.id,
              callerSocket: self.ws,
              calleeSocket: null,
              startedAt: invitation.createdAt!,
              transport: { provider: "webrtc", version: 1 },
              ringTimer,
              deferredMedia: true,
              firebasePersisted,
              status: "ringing",
              callerAvatar,
              type: invitation.type,
              expiresAt: invitation.expiresAt,
              callerIceCandidates: [],
              calleeIceCandidates: [],
            };
            activeCalls.set(msg.callId, activeCall);
            watchDurableInvitation(msg.callId, activeCall);
            setUserInCall(self.username, true);
            setUserInCall(callee.username, true);
            send(ws, { type: "call-ready", callId: msg.callId, deferredMedia: true, expiresAt: invitation.expiresAt!.toISOString() });
            sendToUsername(callee.username, {
              type: "call-incoming",
              from: self.username,
              callerId: self.userId,
              callerName: self.username,
              callerAvatar,
              callId: msg.callId,
              offer: null,
              video: msg.video,
              deferredMedia: true,
              expiresAt: invitation.expiresAt!.toISOString(),
              transport: { provider: "webrtc", version: 1 },
              e2e: msg.e2e,
            });
          } catch (error) {
            const firebaseFailure = error instanceof CallPushError;
            send(ws, {
              type: "call-unavailable",
              to: msg.to,
              callId: msg.callId,
              code: firebaseFailure ? "FIREBASE_OPERATION_FAILED" : "CALL_RESERVATION_UNAVAILABLE",
              reason: firebaseFailure ? error.message : "Call reservation unavailable",
            });
          }
          return;
        }
        const pending = beginPendingDirectOffer(msg.callId, self.userId, ws, msg.to);
        if (!pending) {
          send(ws, {
            type: "call-unavailable",
            callId: msg.callId,
            code: "CALL_RESERVATION_UNAVAILABLE",
            reason: "Call setup is already in progress",
          });
          return;
        }
        try {
        const target = findByUsername(msg.to);
        if (!target) {
          if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) return;
          try {
            const offlineTarget = await pool!.query<{
              id: number;
              username: string;
              notifications: boolean;
            }>(
              `SELECT u.id, u.username, COALESCE(s.notifications, true) AS notifications
               FROM users u
               LEFT JOIN dm_user_settings s ON s.user_id = u.id
               WHERE LOWER(u.username) = LOWER($1)
               LIMIT 1`,
              [msg.to],
            );
            const callee = offlineTarget.rows[0];
             if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) return;
            if (!callee) {
              send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
              return;
            }

            const blocked = await pool!.query(
              `SELECT 1 FROM citizen_blocks
               WHERE (blocker_id=$1 AND blocked_id=$2)
                  OR (blocker_id=$2 AND blocked_id=$1)
               LIMIT 1`,
              [self.userId, callee.id],
            );
            if (blocked.rows.length > 0) {
              send(ws, { type: "call-blocked", callId: msg.callId });
              return;
            }

             if (self.userId === null) {
               send(ws, { type: "call-unavailable", to: callee.username, callId: msg.callId });
               return;
             }

             const firebaseStatus = await getCallPushStatus();
             const directProvider = authoritativeProvider === "webrtc" &&
               validDescription(msg.offer, "offer");
             if (firebaseStatus.enabled && directProvider) {
               // Device fingerprints are checked for durable offline calls
               // exactly as they are for an online direct offer. A resumed
               // browser may not answer with a stale E2E device set.
               const keyClient = await pool!.connect();
               try {
                 await keyClient.query("BEGIN");
                 await keyClient.query("SELECT pg_advisory_xact_lock(47201, 1)");
                 const keyRows = await keyClient.query<{ device_id: string; fingerprint: string }>(
                   `SELECT device_id, fingerprint
                      FROM dm_user_e2ee_keys
                     WHERE user_id=$1 AND updated_at >= now() - interval '90 days'`,
                   [callee.id],
                 );
                 if (!callEnvelopeMatchesDevices(keyRows.rows, msg.e2e)) {
                   await keyClient.query("ROLLBACK");
                   send(ws, {
                     type: "call-unavailable",
                     to: callee.username,
                     callId: msg.callId,
                     reason: "secure-device-keys-changed",
                   });
                   return;
                 }
                 await keyClient.query("COMMIT");
               } catch {
                 await keyClient.query("ROLLBACK").catch(() => {});
                 send(ws, { type: "call-unavailable", to: callee.username, callId: msg.callId });
                 return;
               } finally {
                 keyClient.release();
               }
               const createdAt = new Date();
               const callerAvatar = await persistedCallerAvatar(self.userId);
               const localInvitation: DirectCallInvitation = {
                 callId: msg.callId,
                 caller: { id: self.userId, name: self.username, avatar: callerAvatar },
                 calleeId: callee.id,
                 type: msg.video ? "video" : "voice",
                 offer: msg.offer as unknown as Record<string, unknown>,
                 transport: { provider: "webrtc", version: 1 },
                 e2e: msg.e2e as unknown as Record<string, unknown> | undefined,
                 createdAt,
                 expiresAt: new Date(createdAt.getTime() + 30_000),
               };
               if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) return;
               const invitation = await createDirectCallInvitation(localInvitation);
               if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) {
                 await finishDirectCallInvitation(localInvitation, "missed").catch(() => {});
                 return;
               }
               const ringTimer = setTimeout(() => {
                 const ringing = activeCalls.get(msg.callId);
                 if (!ringing || ringing.status !== "ringing") return;
                 activeCalls.delete(msg.callId);
                 disposeCallWatcher(ringing);
                 persistDirectTerminal(msg.callId, ringing, "missed");
                 setUserInCall(ringing.caller, false);
                 setUserInCall(ringing.callee, false);
                 const event = {
                   type: "call-ended",
                   by: "timeout",
                   callId: msg.callId,
                   code: "RING_TIMEOUT",
                   reason: "Call was not answered within 30 seconds",
                 };
                 send(ringing.callerSocket, event);
               }, Math.max(1, invitation.expiresAt!.getTime() - Date.now()));
               ringTimer.unref?.();
               localTerminalCalls.delete(msg.callId);
               const activeCall: ActiveCall = {
                 caller: self.username,
                 callee: callee.username.toLowerCase(),
                 callerId: self.userId,
                 calleeId: callee.id,
                 callerSocket: self.ws,
                 calleeSocket: null,
                 startedAt: invitation.createdAt!,
                 transport: { provider: "webrtc", version: 1 },
                 ringTimer,
                 deferredMedia: false,
                 firebasePersisted: true,
                 status: "ringing",
                 callerAvatar,
                 type: invitation.type,
                 expiresAt: invitation.expiresAt,
                 directOffer: msg.offer,
                 directE2e: msg.e2e,
                  callerIceCandidates: pending.iceCandidates,
                  calleeIceCandidates: [],
               };
               activeCalls.set(msg.callId, activeCall);
               watchDirectInvitation(msg.callId, activeCall);
               setUserInCall(self.username, true);
               // The callee is offline; only the FCM wake-up is sent. This
               // avoids claiming an in-app delivery that never happened.
               send(ws, {
                 type: "call-ready",
                 callId: msg.callId,
                 expiresAt: invitation.expiresAt!.toISOString(),
               });
               return;
             }

             // Firebase or direct WebRTC readiness is absent: retain the
             // established missed-call path rather than claiming durable
             // resume. The caller's media path is otherwise untouched.
             const callType = msg.video ? "video" : "audio";
             if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) return;
             await pool!.query(
               `INSERT INTO call_history
                  (caller_id, caller_username, callee_id, callee_username, call_type, status, duration_sec)
                VALUES ($1, $2, $3, $4, $5, 'missed', 0)`,
               [self.userId, self.username, callee.id, callee.username, callType],
             );
             if (!pendingDirectOfferIsLive(msg.callId, pending, ws)) return;
             if (callee.notifications) {
               await pool!.query(
                 `INSERT INTO notifications
                    (user_id, type, title, body, icon, link_path, source_ref)
                  VALUES ($1, 'missed_call', $2, $3, '📞', '/messages', $4)
                  ON CONFLICT (user_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
                 [
                   callee.id,
                   "مكالمة فائتة · Missed call",
                   `@${self.username} حاول الاتصال بك عبر ${msg.video ? "الفيديو" : "الصوت"}`,
                   `missed_call:${msg.callId}`,
                 ],
               );
             }
             send(ws, {
               type: "call-unavailable",
               to: callee.username,
               callId: msg.callId,
               missedLogged: true,
             });
          } catch {
            send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
          }
          return;
        }
        // Blocking is enforced before busy checks and, critically, before any
        // call state is created. Both directions are equivalent for contact
        // safety; identity comes exclusively from authenticated sockets.
        if (self.userId === null || target.userId === null) {
          send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId }); return;
        }
        try {
          const block = await pool!.query(
            `SELECT 1 FROM citizen_blocks
             WHERE (blocker_id=$1 AND blocked_id=$2)
                OR (blocker_id=$2 AND blocked_id=$1)
             LIMIT 1`,
            [self.userId, target.userId],
          );
          if (block.rows.length) {
            send(ws, { type: "call-blocked", callId: msg.callId });
            return;
          }
        } catch {
          // Fail closed: a database outage must not bypass a persisted block.
          send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
          return;
        }
        if (userIsInCall(self.username) || userIsInCall(target.username)) {
          send(ws, { type: "call-busy", to: msg.to, callId: msg.callId });
          return;
        }
         const lockClient = await pool!.connect();
         try {
           await lockClient.query("BEGIN");
           await lockClient.query("SELECT pg_advisory_xact_lock(47201, 1)");
           const keyRows = await lockClient.query<{ device_id: string; fingerprint: string }>(
             `SELECT device_id, fingerprint
              FROM dm_user_e2ee_keys
              WHERE user_id=$1 AND updated_at >= now() - interval '90 days'`,
             [target.userId],
           );
           if (!callEnvelopeMatchesDevices(keyRows.rows, msg.e2e)) {
             await lockClient.query("ROLLBACK");
             send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId, reason: "secure-device-keys-changed" });
            return;
          }
           // Recording the call while holding the same lock used by key
           // registration/revocation closes the key-check→route race.
           await lockClient.query("COMMIT");
            if (!pendingDirectOfferIsLive(msg.callId, pending, ws) ||
                target.ws.readyState !== WebSocket.OPEN) return;
             const ringTimer = setTimeout(() => {
               const ringing = activeCalls.get(msg.callId);
               if (!ringing || ringing.calleeSocket !== target.ws) return;
               activeCalls.delete(msg.callId);
              disposeCallWatcher(ringing);
               setUserInCall(ringing.caller, false);
               setUserInCall(ringing.callee, false);
               const event = {
                 type: "call-ended",
                 by: "timeout",
                 callId: msg.callId,
                 code: "RING_TIMEOUT",
                 reason: "Call was not answered within 30 seconds",
               };
               send(ringing.callerSocket, event);
               send(ringing.calleeSocket, event);
             }, 30_000);
             ringTimer.unref?.();
             activeCalls.set(msg.callId, {
              caller: self.username, callee: target.username, callerId: self.userId, calleeId: target.userId,
               callerSocket: self.ws, calleeSocket: target.ws, startedAt: new Date(),
               transport: { provider: authoritativeProvider, version: 1 }, ringTimer,
                deferredMedia: false, firebasePersisted: false, status: "ringing", callerAvatar: null,
                type: msg.video ? "video" : "voice",
                callerIceCandidates: pending.iceCandidates,
                calleeIceCandidates: [],
            });
            // Reserve both participants while the call is ringing. Without this,
            // either side could create a second offer before the first answer.
            setUserInCall(self.username, true);
            setUserInCall(target.username, true);
         } catch {
           await lockClient.query("ROLLBACK").catch(() => {});
           send(ws, { type: "call-unavailable", to: msg.to, callId: msg.callId });
          return;
         } finally {
           lockClient.release();
        }
        if (!pendingDirectOfferIsLive(msg.callId, pending, ws) ||
            target.ws.readyState !== WebSocket.OPEN) {
          const inserted = activeCalls.get(msg.callId);
          if (inserted) {
            activeCalls.delete(msg.callId);
            clearTimeout(inserted.ringTimer);
            setUserInCall(inserted.caller, false);
            setUserInCall(inserted.callee, false);
          }
          return;
        }
        // The caller must wait for this acknowledgement before requesting its
        // channel token. It proves activeCalls already contains both authorized
        // participants and removes the HTTP-vs-WebSocket registration race.
        send(ws, { type: "call-ready", callId: msg.callId });
         send(target.ws, {
          type: "call-incoming",
          from: self.username,
          callId: msg.callId,
          offer: msg.offer,
          video: msg.video,
           transport: { provider: authoritativeProvider, version: 1 },
          e2e: msg.e2e,
        });
        console.log(`[WS] 📞 ${self.username} → ${msg.to} [${msg.video ? "video" : "audio"}]`);
        } finally {
          finishPendingDirectOffer(msg.callId, pending);
        }
        return;
      }

      // A pushed/Firestore-discovered callee binds one socket before accepting.
      // It can never replace an already selected answering device.
      if (msg.type === "call-resume") {
        const call = activeCalls.get(msg.callId);
        if (!call || call.status !== "ringing" || call.calleeId !== self.userId) {
          // A durable record alone cannot route post-answer signaling to a
          // caller socket owned by another replica. Fail explicitly rather
          // than showing an invitation that can never complete.
          if (!call && isFirebaseCallPushConfigured()) {
            send(ws, {
              type: "call-unavailable",
              callId: msg.callId,
              code: "CALL_RESUME_OWNER_UNAVAILABLE",
              reason: "Call resume is unavailable on this server instance",
            });
          }
          return;
        }
        try {
          if (!await sessionIsActive(sessionId, sessionUserId)) {
            send(ws, { type: "session-ended" });
            ws.close(4001, "Session ended");
            return;
          }
        } catch {
          send(ws, { type: "error", message: "Session validation failed" });
          return;
        }
        if (!call.deferredMedia) {
          if (userIsInCall(self.username)) {
            send(ws, { type: "call-busy", callId: msg.callId });
            return;
          }
          let durableOffer: Awaited<ReturnType<typeof resumeDirectCallInvitation>>;
          try {
            durableOffer = await resumeDirectCallInvitation(msg.callId, self.userId!);
            if (!durableOffer) {
              send(ws, {
                type: "call-ended",
                by: "server",
                callId: msg.callId,
                code: "INVITATION_NO_LONGER_RINGING",
              });
              return;
            }
            call.directOffer = durableOffer.offer as unknown as RTCSessionDescriptionInit | null;
            call.directE2e = durableOffer.e2e as unknown as E2eCallEnvelope | undefined;
            if (await currentCallBlocked(call.callerId!, self.userId!)) {
              send(ws, {
                type: "call-blocked",
                callId: msg.callId,
              });
              return;
            }
            if (!await currentCallEnvelopeMatches(self.userId!, call.directE2e)) {
              send(ws, {
                type: "call-unavailable",
                callId: msg.callId,
                code: "SECURE_DEVICE_KEYS_CHANGED",
                reason: "Secure device keys changed; call cannot resume",
              });
              return;
            }
          } catch {
            send(ws, { type: "call-unavailable", callId: msg.callId });
            return;
          }
          const resumedOffer = call.directOffer;
          const resumedE2e = call.directE2e;
          send(ws, {
            type: "call-resumed",
            callId: msg.callId,
            from: call.caller,
            callerId: call.callerId,
            callerName: call.caller,
            callerAvatar: call.callerAvatar,
            deferredMedia: false,
            offer: resumedOffer,
            expiresAt: call.expiresAt?.toISOString(),
            video: call.type === "video",
            transport: call.transport,
            e2e: resumedE2e,
          });
          replayCallerIce(msg.callId, call, ws);
          return;
        }
        // Resume authorizes delivery of a durable invitation after a push or
        // Firestore listener woke this tab. It must not reserve the answering
        // socket: multiple tabs may resume, and only an actual answer wins.
        send(ws, {
          type: "call-resumed",
          callId: msg.callId,
          from: call.caller,
          callerId: call.callerId,
          callerName: call.caller,
          callerAvatar: call.callerAvatar,
          deferredMedia: true,
          offer: null,
          expiresAt: call.expiresAt?.toISOString(),
          video: call.type === "video",
          transport: call.transport,
          e2e: call.directE2e,
        });
        return;
      }

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        const call = activeCalls.get(msg.callId);
        if (call && !call.deferredMedia) {
          if (call.status !== "ringing" || call.calleeId !== self.userId ||
              call.caller !== msg.to.toLowerCase() ||
              call.calleeSocket !== null ||
              !transportMatches(msg.transport, call.transport.provider) ||
              !validDescription(msg.answer, "answer")) return;
          if (userIsInCall(self.username)) {
            send(ws, { type: "call-busy", callId: msg.callId });
            return;
          }
          // Reserve the answering socket before any await. A second tab can
          // resume the invitation, but only the first explicit answer may
          // contend for the Firestore transition.
          call.calleeSocket = ws;
          call.status = "accepting";
          try {
            if (await currentCallBlocked(call.callerId!, self.userId!)) {
              call.calleeSocket = null;
              call.status = "ringing";
              send(ws, { type: "call-blocked", callId: msg.callId });
              return;
            }
            if (!await currentCallEnvelopeMatches(self.userId!, call.directE2e)) {
              call.calleeSocket = null;
              call.status = "ringing";
              send(ws, {
                type: "call-unavailable",
                callId: msg.callId,
                code: "SECURE_DEVICE_KEYS_CHANGED",
                reason: "Secure device keys changed; call cannot resume",
              });
              return;
            }
          } catch {
            call.calleeSocket = null;
            call.status = "ringing";
            send(ws, { type: "call-unavailable", callId: msg.callId });
            return;
          }
          let accepted: Awaited<ReturnType<typeof acceptDirectCallInvitation>>;
          try {
            accepted = await acceptDirectCallInvitation(
              msg.callId,
              self.userId!,
              msg.answer as unknown as Record<string, unknown>,
            );
          } catch {
            if (activeCalls.get(msg.callId) !== call) return;
            call.calleeSocket = null;
            call.status = "ringing";
            send(ws, {
              type: "call-unavailable",
              callId: msg.callId,
              code: "FIREBASE_OPERATION_FAILED",
              reason: "Firebase invitation acceptance failed",
            });
            return;
          }
          // Caller cancellation/expiry can win while the Firestore
          // transaction is in flight. Never emit a late acceptance.
          if (activeCalls.get(msg.callId) !== call || call.status !== "accepting") return;
          if (!accepted) {
            activeCalls.delete(msg.callId);
            disposeCallWatcher(call);
            clearTimeout(call.ringTimer);
            setUserInCall(call.caller, false);
            setUserInCall(call.callee, false);
            send(ws, {
              type: "call-ended",
              by: "server",
              callId: msg.callId,
              code: "INVITATION_NO_LONGER_RINGING",
            });
            send(call.callerSocket, {
              type: "call-ended",
              by: "server",
              callId: msg.callId,
              code: "INVITATION_NO_LONGER_RINGING",
            });
            return;
          }
          clearTimeout(call.ringTimer);
          call.calleeSocket = ws;
          call.status = "accepted";
          setUserInCall(self.username, true);
          setUserInCall(call.caller, true);
          for (const device of clientsForUsername(self.username)) {
            if (device.ws !== ws) {
              send(device.ws, { type: "call-ended", by: self.username, callId: msg.callId });
            }
          }
          send(call.callerSocket, {
            type: "call-accepted",
            from: self.username,
            callId: msg.callId,
            answer: msg.answer,
            transport: call.transport,
          });
          replayCallerIce(msg.callId, call, ws);
          replayCalleeIce(msg.callId, call, ws);
          return;
        }
        if (call?.deferredMedia) {
          if (call.status !== "ringing" || call.calleeId !== self.userId ||
              call.caller !== msg.to.toLowerCase() ||
              !transportMatches(msg.transport, "webrtc") || msg.answer !== null ||
              !reserveDeferredAnsweringSocket(call, self.userId, ws)) return;
          // This synchronous binding makes one socket the only contender while
          // Firestore's transaction arbitrates the same race across processes.
          // Marking it accepting also prevents the ring timer from tearing down
          // a transaction that started before its final tick.
          call.status = "accepting";
          if (call.firebasePersisted) {
            try {
              if (!await acceptDeferredCallInvitation(msg.callId, self.userId!)) {
                activeCalls.delete(msg.callId);
                disposeCallWatcher(call);
                clearTimeout(call.ringTimer);
                setUserInCall(call.caller, false);
                setUserInCall(call.callee, false);
                send(ws, { type: "call-ended", by: "server", callId: msg.callId, code: "INVITATION_NO_LONGER_RINGING" });
                send(call.callerSocket, { type: "call-ended", by: "server", callId: msg.callId, code: "INVITATION_NO_LONGER_RINGING" });
                return;
              }
            } catch {
              activeCalls.delete(msg.callId);
              disposeCallWatcher(call);
              clearTimeout(call.ringTimer);
              setUserInCall(call.caller, false);
              setUserInCall(call.callee, false);
              send(ws, {
                type: "call-unavailable", callId: msg.callId,
                code: "FIREBASE_OPERATION_FAILED", reason: "Firebase invitation acceptance failed",
              });
              send(call.callerSocket, {
                type: "call-ended", by: "server", callId: msg.callId,
                code: "FIREBASE_OPERATION_FAILED", reason: "Firebase invitation acceptance failed",
              });
              return;
            }
          }
          // The caller may cancel while Firestore arbitrates the answer. Never
          // revive a deleted/replaced call or emit a late acceptance/offer.
          if (activeCalls.get(msg.callId) !== call || call.status !== "accepting") return;
          if (ws.readyState !== WebSocket.OPEN || call.callerSocket.readyState !== WebSocket.OPEN) {
            persistDeferredTerminal(msg.callId, call, "ended");
            activeCalls.delete(msg.callId);
            disposeCallWatcher(call);
            return;
          }
          clearTimeout(call.ringTimer);
          call.status = "accepted";
          setUserInCall(self.username, true);
          setUserInCall(call.caller, true);
          for (const device of clientsForUsername(self.username)) {
            if (device.ws !== ws) send(device.ws, { type: "call-ended", by: self.username, callId: msg.callId });
          }
          send(call.callerSocket, {
            type: "call-accepted",
            from: self.username,
            callId: msg.callId,
            answer: null,
            deferredMedia: true,
            transport: call.transport,
          });
          return;
        }
        // Only the recorded callee may answer, and only towards the recorded caller.
        if (!call || call.calleeId !== self.userId || call.calleeSocket !== ws ||
            call.caller !== msg.to.toLowerCase() ||
            !(transportMatches(msg.transport, call.transport.provider) ||
              (call.transport.provider === "agora" && msg.transport === undefined)) ||
            (call.transport.provider === "agora"
              ? msg.answer !== null
              : !validDescription(msg.answer, "answer"))) return;
        const caller = Array.from(clientsForUsername(msg.to))
          .find(candidate => candidate.ws === call.callerSocket);
        if (caller) {
          clearTimeout(call.ringTimer);
          call.calleeSocket = ws;
          call.status = "accepted";
          setUserInCall(self.username, true);
          setUserInCall(caller.username, true);
          for (const device of clientsForUsername(self.username)) {
            if (device.ws !== ws) {
              send(device.ws, { type: "call-ended", by: self.username, callId: msg.callId });
            }
          }
          send(call.callerSocket, {
            type: "call-accepted",
            from: self.username,
            callId: msg.callId,
            answer: msg.answer,
            transport: call.transport,
          });
        }
        return;
      }

      // Deferred invitations exchange SDP only after the accepted state is
      // committed. Unlike legacy renegotiation, these frames are directional:
      // caller creates the first offer and the exact bound callee answers it.
      if (msg.type === "call-webrtc-offer") {
        const call = activeCalls.get(msg.callId);
        if (!call || !call.deferredMedia || call.status !== "accepted" ||
            call.transport.provider !== "webrtc" || (msg.transport !== undefined && !transportMatches(msg.transport, "webrtc")) ||
            !validDescription(msg.offer, "offer") || call.callerId !== self.userId ||
            call.callerSocket !== ws || !call.calleeSocket) return;
        send(call.calleeSocket, {
          type: "call-webrtc-offer",
          from: self.username,
          callId: msg.callId,
          offer: msg.offer,
          transport: call.transport,
        });
        return;
      }

      if (msg.type === "call-webrtc-answer") {
        const call = activeCalls.get(msg.callId);
        if (!call || !call.deferredMedia || call.status !== "accepted" ||
            call.transport.provider !== "webrtc" || (msg.transport !== undefined && !transportMatches(msg.transport, "webrtc")) ||
            !validDescription(msg.answer, "answer") || call.calleeId !== self.userId ||
            call.calleeSocket !== ws) return;
        send(call.callerSocket, {
          type: "call-webrtc-answer",
          from: self.username,
          callId: msg.callId,
          answer: msg.answer,
          transport: call.transport,
        });
        return;
      }

      if (msg.type === "call-renegotiate-offer") {
        const call = activeCalls.get(msg.callId);
        if (!call || call.transport.provider !== "webrtc" ||
            !transportMatches(msg.transport, "webrtc") ||
            !validDescription(msg.offer, "offer")) return;
        if (call.callerSocket === ws && call.calleeSocket) {
          send(call.calleeSocket, { ...msg, from: self.username, transport: call.transport });
        } else if (call.calleeSocket === ws) {
          send(call.callerSocket, { ...msg, from: self.username, transport: call.transport });
        }
        return;
      }

      if (msg.type === "call-renegotiate-answer") {
        const call = activeCalls.get(msg.callId);
        if (!call || call.transport.provider !== "webrtc" ||
            !transportMatches(msg.transport, "webrtc") ||
            !validDescription(msg.answer, "answer")) return;
        if (call.callerSocket === ws && call.calleeSocket) {
          send(call.calleeSocket, { ...msg, from: self.username, transport: call.transport });
        } else if (call.calleeSocket === ws) {
          send(call.callerSocket, { ...msg, from: self.username, transport: call.transport });
        }
        return;
      }

      // ── ICE CANDIDATE ─────────────────────────────────────────────────────
      if (msg.type === "ice-candidate") {
        const call = activeCalls.get(msg.callId);
        if (!validIceCandidate(msg.candidate)) return;
        if (!call) {
          // ICE can arrive while the initial direct offer is still being
          // persisted/authorized. Keep it with the authenticated caller
          // instead of dropping it before activeCalls is installed.
          const pending = pendingDirectOffers.get(msg.callId);
          if (pending && pending.callerId === self.userId &&
              pending.callerSocket === ws &&
              pending.callee === msg.to.toLowerCase()) {
            bufferIceCandidate(pending.iceCandidates, msg.candidate);
          }
          return;
        }
        if (call.transport.provider !== "webrtc" ||
            (call.deferredMedia && call.status !== "accepted")) return;
        if (call.callerId === self.userId && call.callerSocket === ws &&
            call.callee === msg.to.toLowerCase()) {
          if (call.calleeSocket) {
            send(call.calleeSocket, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
          } else if (!call.deferredMedia) {
            bufferIceCandidate(call.callerIceCandidates, msg.candidate);
          }
        } else if (call.calleeId === self.userId && call.caller === msg.to.toLowerCase()) {
          if (call.calleeSocket === ws) {
            send(call.callerSocket, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
          } else if (!call.deferredMedia && call.status === "ringing" && !call.calleeSocket) {
            // A resumed tab may gather ICE before its explicit answer binds
            // the socket. Keep only candidates from that authenticated tab;
            // another tab cannot win by sending ICE first.
            if (call.calleeIceCandidates.every(item => item.socket === ws)) {
              const duplicate = call.calleeIceCandidates.some(item =>
                item.candidate.candidate === msg.candidate.candidate &&
                item.candidate.sdpMid === msg.candidate.sdpMid &&
                item.candidate.sdpMLineIndex === msg.candidate.sdpMLineIndex);
              if (!duplicate) {
                appendBoundedIce(call.calleeIceCandidates, { socket: ws, candidate: msg.candidate });
              }
            }
          }
        }
        return;
      }

      // ── CALL REJECT ───────────────────────────────────────────────────────
      if (msg.type === "call-reject" || msg.type === "call-cancel") {
        if (msg.type === "call-cancel" &&
            cancelPendingDirectOffer(msg.callId, self.userId, ws)) return;
        // Recipient is DERIVED from the recorded call — client "to" is ignored,
        // so a participant can never target a third party.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        // Callee rejection is also available to a background/push-discovered
        // tab through HTTP. Use the same Firestore-first helper for both paths
        // so the first rejection wins and all tabs receive the terminal event.
        if (msg.type === "call-reject" && call.deferredMedia &&
            call.calleeId === self.userId && call.status === "ringing") {
          if (self.userId === null) return;
          try {
            await declineCallForUser(msg.callId, self.userId);
          } catch {
            send(ws, {
              type: "call-unavailable",
              callId: msg.callId,
              code: "FIREBASE_OPERATION_FAILED",
              reason: "Firebase call status update failed",
            });
          }
          return;
        }
        if (msg.type === "call-cancel" &&
            (call.callerId !== self.userId ||
              (call.status !== "ringing" && call.status !== "accepting" && call.status !== "accepted"))) return;
        activeCalls.delete(msg.callId);
        disposeCallWatcher(call);
        clearTimeout(call.ringTimer);
        if (call.deferredMedia) {
          persistDeferredTerminal(
            msg.callId,
            call,
            durableTerminalStatus(call.status, call.callerId === self.userId),
          );
        } else if (call.firebasePersisted) {
          persistDirectTerminal(
            msg.callId,
            call,
            durableTerminalStatus(call.status, call.callerId === self.userId),
          );
        }
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        const callerEndedAccepted = msg.type === "call-cancel" &&
          call.callerId === self.userId &&
          call.status === "accepted";
        if (callerEndedAccepted) {
          if (call.callerSocket !== ws) {
            send(call.callerSocket, { type: "call-ended", by: self.username, callId: msg.callId });
          }
          sendToUsername(call.callee, { type: "call-ended", by: self.username, callId: msg.callId });
        } else if (call.callerSocket === ws) {
          sendToUsername(call.callee, {
            type: msg.type === "call-cancel" && call.status === "accepted"
              ? "call-ended"
              : "call-rejected",
            by: self.username,
            callId: msg.callId,
          });
        } else {
          send(call.callerSocket, { type: "call-rejected", by: self.username, callId: msg.callId });
          sendToUsername(call.callee, { type: "call-ended", by: self.username, callId: msg.callId });
        }
        return;
      }

      // ── CALL END ──────────────────────────────────────────────────────────
      if (msg.type === "call-end") {
        if (cancelPendingDirectOffer(msg.callId, self.userId, ws)) return;
        // Recipient DERIVED from recorded call state — client "to" is ignored.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        activeCalls.delete(msg.callId);
        disposeCallWatcher(call);
        clearTimeout(call.ringTimer);
        if (call.deferredMedia) {
          persistDeferredTerminal(
            msg.callId,
            call,
            durableTerminalStatus(call.status, call.callerId === self.userId),
          );
        } else if (call.firebasePersisted) {
          persistDirectTerminal(
            msg.callId,
            call,
            durableTerminalStatus(call.status, call.callerId === self.userId),
          );
        }
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        if (call.callerSocket === ws) {
          sendToUsername(call.callee, { type: "call-ended", by: self.username, callId: msg.callId });
        } else {
          send(call.callerSocket, { type: "call-ended", by: self.username, callId: msg.callId });
          sendToUsername(call.callee, { type: "call-ended", by: self.username, callId: msg.callId });
        }
        return;
      }

      // ── LIVE START ────────────────────────────────────────────────────────
      if (msg.type === "live-start") {
        const liveId = `live_${self.username}_${Date.now()}`;
        self.liveId = liveId;
        lives.set(liveId, { hostUsername: self.username, title: msg.title, domain: msg.domain, startedAt: new Date() });
        send(ws, { type: "live-started", liveId });
        // Notify all online users
        wss.clients.forEach(c => { if (c !== ws && c.readyState === WebSocket.OPEN) {
          send(c, { type: "live-available", liveId, host: self!.username, title: msg.title, domain: msg.domain });
        }});
        console.log(`[WS] 📡 LIVE started: ${self.username} — "${msg.title}"`);
        return;
      }

      // ── LIVE END ──────────────────────────────────────────────────────────
      if (msg.type === "live-end") {
        if (self.liveId) {
          lives.delete(self.liveId);
          wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "live-ended", liveId: self!.liveId }); });
          self.liveId = null;
        }
        return;
      }

      // ── LIVE JOIN (viewer) ────────────────────────────────────────────────
      if (msg.type === "live-join") {
        const liveInfo = lives.get(msg.liveId);
        if (!liveInfo) { send(ws, { type: "live-not-found" }); return; }
        const host = findByUsername(liveInfo.hostUsername);
        if (!host) { send(ws, { type: "live-not-found" }); return; }
        send(host.ws, { type: "live-viewer-joined", viewer: self.username, liveId: msg.liveId });
        return;
      }

      // ── LIVE WebRTC SIGNALING ─────────────────────────────────────────────
      if (msg.type === "live-offer" || msg.type === "live-answer" || msg.type === "live-ice") {
        const peer = findByUsername(msg.to);
        if (peer) send(peer.ws, { ...msg, from: self.username });
        return;
      }
    });

    ws.on("close", () => {
      cancelSessionExpiry();
      untrackSessionSocket(sessionId, ws);
      if (!self) return;
      for (const pending of pendingDirectOffers.values()) {
        if (pending.callerSocket === ws) pending.canceled = true;
      }
      // Only calls owned by this exact socket end. Closing an older duplicate
      // tab cannot tear down a call occurring in a newer one.
      for (const [callId, call] of activeCalls) {
        if (call.callerSocket !== ws && call.calleeSocket !== ws) continue;
        // A ringing deferred invitation may be resumed on another callee
        // socket. Only a caller disconnect (or an accepted call) ends it.
        if (call.deferredMedia && call.status === "ringing" && call.calleeSocket === ws && call.callerSocket !== ws) {
          call.calleeSocket = null;
          continue;
        }
        activeCalls.delete(callId);
        disposeCallWatcher(call);
        clearTimeout(call.ringTimer);
        if (call.deferredMedia) {
          persistDeferredTerminal(
            callId,
            call,
            durableTerminalStatus(call.status, call.callerSocket === ws),
          );
        } else if (call.firebasePersisted) {
          persistDirectTerminal(
            callId,
            call,
            durableTerminalStatus(call.status, call.callerSocket === ws),
          );
        }
        const peerName = call.callerSocket === ws ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        const peerSocket = call.callerSocket === ws ? call.calleeSocket : call.callerSocket;
        if (peerSocket) send(peerSocket, { type: "call-ended", by: self.username, callId });
      }
      if (self.liveId) {
        lives.delete(self.liveId);
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "live-ended", liveId: self!.liveId }); });
      }
      removeClient(self);
      const onlineList = onlineUsernames();
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "online-list", users: onlineList }); });
      console.log(`[WS] 🔴 ${self.username} disconnected (total: ${clients.size})`);
    });

    ws.on("error", (err) => console.warn("[WS] error:", err.message));
  });

  // ── GET /api/live/active — list active live streams ────────────────────────
  return {
    getLives: () => Array.from(lives.entries()).map(([liveId, info]) => ({ liveId, ...info })),
    getOnline: () => Array.from(clients.keys()),
  };
}
