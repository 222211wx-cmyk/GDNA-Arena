import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type { RequestHandler } from "express";
import { pool } from "./db";
import { requireReadyCallMediaProvider } from "./turn-config";
import {
  appendAuthoritativeSignal, answerAuthoritativeCall, createAuthoritativeCall,
  canControlDirectCallRecording, expireAuthoritativeCall, getAuthoritativeCall, isDurableCallParticipant, switchAuthoritativeCallProvider, terminateAuthoritativeCall,
  canonicalCallRecord, cleanupStaleAuthoritativeCalls, heartbeatAuthoritativeCall, type CallRecord, type CallTransport, type StoredDescription,
} from "./call-signal-store";
import { CallPushError, callFailureDiagnosticCode, callSessionBinding, getCallStateDb } from "./call-state-db";
import { canIssueGroupAgoraToken, getGroupCall } from "./group-call-store";
import { sendBrowserCallTerminalPush } from "./browser-push";
import { logger } from "./logger";
import { sessionIsLive } from "./session-security";
import { sessionCredentialEpoch } from "./session-policy";

interface RTCIceCandidateInit { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null; }
interface E2eCallEnvelope { devices: Record<string, { wrappedSecret: string; fingerprint: string }>; }
interface DeferredCallDeclineResult {
  callId: string;
  outcome: "declined" | "expired" | "finished" | "not-found" | "not-callee";
  changed: boolean;
  status?: CallRecord["status"];
  callerId?: number;
  callerName?: string;
  callerAvatar?: string | null;
  calleeId?: number;
  type?: "video" | "voice";
}
interface Client {
  ws: WebSocket; userId: number; sessionId: string; deviceId: string; username: string;
  liveId: string | null; stopCalls?: () => void;
  observedCalls: Set<string>;
}
type SignalMsg =
  | { type: "register"; userId: number; username: string; deviceId?: string }
  | { type: "call-offer"; to: string; offer: StoredDescription | null; callId: string; from: string; video: boolean; deferredMedia?: boolean; transport?: CallTransport; e2e?: E2eCallEnvelope }
  | { type: "call-answer"; to: string; answer: StoredDescription | null; callId: string; deferredMedia?: boolean; transport?: CallTransport }
  | { type: "call-resume"; callId: string }
  | { type: "call-cancel"; callId: string } | { type: "call-reject"; to: string; callId: string }
  | { type: "call-end"; to: string; callId: string }
  | { type: "call-heartbeat"; callId: string; background?: boolean }
  | { type: "call-media-state"; callId: string; connected: boolean }
  | { type: "call-provider-switch"; callId: string; provider: "agora" }
  | { type: "call-recording-control"; callId: string; requestId: string; action: "request" | "accept" | "reject" | "stop" | "revoke" }
  | { type: "call-webrtc-offer"; callId: string; offer: StoredDescription; transport?: CallTransport }
  | { type: "call-webrtc-answer"; callId: string; answer: StoredDescription; transport?: CallTransport }
  | { type: "call-renegotiate-offer"; callId: string; offer: StoredDescription; transport?: CallTransport }
  | { type: "call-renegotiate-answer"; callId: string; answer: StoredDescription; transport?: CallTransport }
  | { type: "ice-candidate"; to: string; candidate: RTCIceCandidateInit; callId: string }
  | { type: "live-start"; title: string; domain: string } | { type: "live-end" }
  | { type: "live-join"; liveId: string }
  | { type: "live-offer"; to: string; offer: StoredDescription; liveId: string }
  | { type: "live-answer"; to: string; answer: StoredDescription; liveId: string }
  | { type: "live-ice"; to: string; candidate: RTCIceCandidateInit; liveId: string }
  | { type: "ping" };

// Socket registries are transport bookkeeping only. No call state lives here.
const clients = new Map<string, Set<Client>>();
const byUserId = new Map<number, Set<Client>>();
const socketsBySessionId = new Map<string, Set<WebSocket>>();
const lives = new Map<string, { hostUsername: string; title: string; domain: string; startedAt: Date }>();
const socketBindings = new WeakMap<WebSocket, { sessionId: string; userId: number; credentialEpoch: number }>();
const outboundQueues = new WeakMap<WebSocket, Promise<void>>();

function send(ws: WebSocket, data: object) {
  const binding = socketBindings.get(ws);
  if (!binding) return;
  // Check outbound data too: an idle revoked socket on another replica must
  // not keep receiving private room/call events before its next inbound frame.
  const next = (outboundQueues.get(ws) ?? Promise.resolve()).then(async () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!await sessionIsLive(binding.sessionId, binding.userId, binding.credentialEpoch)) {
      endSessionSocket(ws); return;
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }).catch(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1013, "Session validation unavailable"); });
  outboundQueues.set(ws, next);
}
function endSessionSocket(ws: WebSocket) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "session-ended" }));
  ws.close(4001, "Session ended");
}
function clientsForUsername(name: string) { return clients.get(name.toLowerCase()) ?? new Set<Client>(); }
function findByUsername(name: string) { return [...clientsForUsername(name)].find(client => client.ws.readyState === WebSocket.OPEN); }
function broadcastToUser(userId: number, data: object) { for (const client of byUserId.get(userId) ?? []) send(client.ws, data); }
export { broadcastToUser };
function addClient(client: Client) {
  const named = clients.get(client.username) ?? new Set<Client>(); named.add(client); clients.set(client.username, named);
  const identified = byUserId.get(client.userId) ?? new Set<Client>(); identified.add(client); byUserId.set(client.userId, identified);
}
function removeClient(client: Client) {
  const named = clients.get(client.username); named?.delete(client); if (!named?.size) clients.delete(client.username);
  const identified = byUserId.get(client.userId); identified?.delete(client); if (!identified?.size) byUserId.delete(client.userId);
}
function validDescription(value: StoredDescription | null, type: "offer" | "answer"): value is StoredDescription {
  return !!value && value.type === type && typeof value.sdp === "string" && value.sdp.length > 0 && value.sdp.length <= 256_000;
}
function validIce(candidate: RTCIceCandidateInit | undefined): candidate is RTCIceCandidateInit {
  return !!candidate && typeof candidate.candidate === "string" && candidate.candidate.length <= 4096;
}
function transportMatches(value: CallTransport | undefined, provider: "agora" | "webrtc") {
  return value?.version === 1 && value.provider === provider;
}
function validDeviceId(value: unknown, sessionId: string) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value)
    ? value : `session_${callSessionBinding(sessionId).slice(0, 32)}`;
}
function validRecordingControl(msg: SignalMsg): msg is Extract<SignalMsg, { type: "call-recording-control" }> {
  return msg.type === "call-recording-control" && /^[A-Za-z0-9_-]{1,128}$/.test(msg.callId) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(msg.requestId) &&
    (msg.action === "request" || msg.action === "accept" || msg.action === "reject" || msg.action === "stop" || msg.action === "revoke");
}
async function currentCallBlocked(callerId: number, calleeId: number) {
  if (!pool) return true;
  const result = await pool.query(`SELECT 1 FROM citizen_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1`, [callerId, calleeId]);
  return result.rows.length > 0;
}
function envelopeMatches(rows: { device_id: string; fingerprint: string }[], envelope: E2eCallEnvelope | undefined) {
  if (!envelope?.devices || typeof envelope.devices !== "object" || Array.isArray(envelope.devices) ||
    JSON.stringify(envelope.devices).length > 256_000) return false;
  if (!Object.entries(envelope.devices).every(([id, key]) =>
    /^[A-Za-z0-9_-]{16,80}$/.test(id) &&
    typeof key?.fingerprint === "string" && /^[A-Za-z0-9_-]{43}$/.test(key.fingerprint) &&
    typeof key?.wrappedSecret === "string" && /^[A-Za-z0-9_+/=-]{100,1000}$/.test(key.wrappedSecret))) return false;
  const offered = Object.entries(envelope.devices).map(([id, key]) => `${id}.${key?.fingerprint}`).sort();
  const registered = rows.map(key => `${key.device_id}.${key.fingerprint}`).sort();
  return offered.length > 0 && offered.length === registered.length && offered.every((key, i) => key === registered[i]);
}
async function validateEnvelope(calleeId: number, envelope: E2eCallEnvelope | undefined) {
  if (!pool) return false;
  const rows = await pool.query<{ device_id: string; fingerprint: string }>(
    `SELECT device_id, fingerprint FROM dm_user_e2ee_keys WHERE user_id=$1`, [calleeId],
  );
  return envelopeMatches(rows.rows, envelope);
}
async function callerAvatar(userId: number): Promise<string | null> {
  if (!pool) return null;
  try {
    const result = await pool.query<{ avatar: string | null }>(
      `SELECT NULLIF(COALESCE(to_jsonb(u)->>'avatar_url', to_jsonb(u)->>'avatar'), '') AS avatar FROM users u WHERE u.id=$1`, [userId],
    );
    const avatar = result.rows[0]?.avatar?.trim(); return avatar && avatar.length <= 2048 ? avatar : null;
  } catch { return null; }
}

function wirePayload(record: CallRecord, signal: { kind: string; signalId: string; fromId: number; payload: Record<string, unknown> }) {
  const from = signal.fromId === record.caller.id ? record.caller.name : record.callee.name;
  return { type: signal.kind, from, callId: record.callId, signalId: signal.signalId, ...signal.payload, transport: record.transport };
}
function deliverCallSnapshot(client: Client, record: CallRecord) {
  // History is not live presence. Do not resurrect an old answered call when
  // a freshly registered socket subscribes to historical documents.
  if (record.status === "ringing" && !record.endedAt) client.observedCalls.add(record.callId);
  if (record.status === "answered" && !client.observedCalls.has(record.callId)) return;
  const caller = client.userId === record.caller.id &&
    record.callerSessionTag === callSessionBinding(client.sessionId) && record.callerDeviceId === client.deviceId;
  const selected = !!record.answerer && record.answerer.userId === client.userId &&
    record.answerer.sessionTag === callSessionBinding(client.sessionId) && record.answerer.deviceId === client.deviceId;
  if (record.status === "ringing") {
    if (caller) {
      send(client.ws, { type: "call-ready", callId: record.callId, expiresAt: record.expiresAt.toISOString(), deferredMedia: record.deferredMedia, replay: true });
    } else if (client.userId === record.callee.id) {
      send(client.ws, { type: "call-incoming", from: record.caller.name, callerId: record.caller.id, callerName: record.caller.name,
        callerAvatar: record.caller.avatar, callId: record.callId, offer: record.initialOffer, video: record.type === "video",
        deferredMedia: record.deferredMedia, expiresAt: record.expiresAt.toISOString(), transport: record.transport, e2e: record.e2e, signalId: `${record.callId}:incoming` });
    }
    return;
  }
  if (record.status === "answered" && !record.endedAt) {
    if (caller) {
      send(client.ws, { type: "call-accepted", from: record.callee.name, callId: record.callId, answer: record.initialAnswer ?? null, deferredMedia: record.deferredMedia, transport: record.transport, signalId: `${record.callId}:accepted` });
    } else if (selected) {
      send(client.ws, { type: "call-resumed", callId: record.callId, from: record.caller.name, callerId: record.caller.id, callerName: record.caller.name,
        callerAvatar: record.caller.avatar, offer: record.initialOffer, expiresAt: record.expiresAt.toISOString(), video: record.type === "video",
        deferredMedia: record.deferredMedia, transport: record.transport, e2e: record.e2e, signalId: `${record.callId}:accepted` });
    } else if (client.userId === record.callee.id) {
      send(client.ws, { type: "call-ended", by: "answered-elsewhere", callId: record.callId, signalId: `${record.callId}:answered-elsewhere` });
    }
    return;
  }
  if ((caller || selected || client.userId === record.callee.id) && (record.status === "declined" || record.status === "missed" || record.endedAt)) {
    send(client.ws, { type: record.status === "declined" ? "call-rejected" : "call-ended", by: record.status === "missed" ? "timeout" : record.callee.name, callId: record.callId, signalId: `${record.callId}:terminal` });
    return; // A terminal record must never replay media candidates.
  }
}
async function subscribeCalls(client: Client): Promise<() => void> {
  const db = getCallStateDb();
  const delivered = new Set<string>();
  const eventStops = new Map<string, () => void>();
  const queues = new Map<string, Promise<void>>();
  let closed = false;
  const enqueue = (callId: string, work: () => Promise<void>) => {
    const next = (queues.get(callId) ?? Promise.resolve()).then(async () => {
      if (!closed) await work();
    }).catch(() => {
      if (!closed) send(client.ws, { type: "call-unavailable", callId, code: "CALL_SIGNALING_UNAVAILABLE" });
    });
    queues.set(callId, next);
  };
  // Both document and event changes drain the complete immutable transcript.
  // In particular, an Answer must re-read candidates observed while ringing:
  // those event documents do not change when the answerer is selected.
  const drain = async (callId: string) => {
    const call = await getAuthoritativeCall(callId);
    if (!call || closed || client.ws.readyState !== WebSocket.OPEN) return;
    if (call.status === "ringing" && call.expiresAt.getTime() <= Date.now()) {
      await expireAuthoritativeCall(callId);
      return;
    }
    deliverCallSnapshot(client, call);
    if (call.status !== "answered" || call.endedAt) return;
    const caller = client.userId === call.caller.id &&
      call.callerSessionTag === callSessionBinding(client.sessionId) && call.callerDeviceId === client.deviceId;
    const selected = call.answerer?.userId === client.userId &&
      call.answerer.sessionTag === callSessionBinding(client.sessionId) && call.answerer.deviceId === client.deviceId;
    if (!caller && !selected) return;
    const events = await db.collection("callInvites").doc(callId).collection("events").orderBy("seq", "asc").get();
    for (const event of events.docs) {
      if (closed || client.ws.readyState !== WebSocket.OPEN) return;
      const value = event.data();
      if (!value) continue;
      if (value.toId !== client.userId || typeof value.signalId !== "string" || delivered.has(value.signalId)) continue;
      const senderOk = value.fromId === call.caller.id
        ? value.senderSessionTag === call.callerSessionTag && value.senderDeviceId === call.callerDeviceId
        : value.fromId === call.callee.id &&
          value.senderSessionTag === call.answerer?.sessionTag && value.senderDeviceId === call.answerer?.deviceId;
      if (!senderOk) continue;
      send(client.ws, wirePayload(call, value as any));
      delivered.add(value.signalId);
    }
  };
  const unsubscribe = db.collection("callInvites").where("participantIds", "array-contains", client.userId).onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "removed") { eventStops.get(change.doc.id)?.(); eventStops.delete(change.doc.id); continue; }
      enqueue(change.doc.id, async () => {
        const current = await getAuthoritativeCall(change.doc.id);
        if (!current || client.ws.readyState !== WebSocket.OPEN) return;
        if (current.status === "ringing" && current.expiresAt.getTime() <= Date.now()) {
          await expireAuthoritativeCall(current.callId);
          return;
        }
        deliverCallSnapshot(client, current);
        if (current.endedAt || current.status === "declined" || current.status === "missed") {
          eventStops.get(change.doc.id)?.();
          eventStops.delete(change.doc.id);
          return;
        }
        // The state snapshot is the ordering barrier. Only after it has been
        // sent may the ordered stream emit SDP/ICE documents.
        if (!eventStops.has(change.doc.id)) {
          const stop = change.doc.ref.collection("events").orderBy("seq", "asc").onSnapshot(() => {
            enqueue(change.doc.id, () => drain(change.doc.id));
          }, () => {
            if (!closed) send(client.ws, { type: "call-unavailable", callId: change.doc.id, code: "CALL_SIGNALING_UNAVAILABLE" });
          });
          eventStops.set(change.doc.id, stop);
        }
        await drain(change.doc.id);
      });
    }
  }, () => {
    // Calls fail explicitly on an action when call state is unavailable. A failed
    // listener must not create a process-local signalling fallback.
  });
  return () => { closed = true; unsubscribe(); for (const stop of eventStops.values()) stop(); eventStops.clear(); };
}

export async function isCallParticipant(callId: string, userId: number): Promise<boolean> {
  try { return await isDurableCallParticipant(callId, userId); } catch { return false; }
}

export async function declineCallForUser(callId: string, userId: number): Promise<DeferredCallDeclineResult> {
  try {
    const db = getCallStateDb();
    const result = await db.runTransaction(async transaction => {
      const ref = db.collection("callInvites").doc(callId);
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!snapshot.exists || !data) return { callId, outcome: "not-found", changed: false };
      const current = canonicalCallRecord(callId, data);
      if (!current) return { callId, outcome: "not-found", changed: false };
      const details = {
        callerId: current.caller.id, callerName: current.caller.name, callerAvatar: current.caller.avatar,
        calleeId: current.callee.id, type: current.type,
      };
      if (current.callee.id !== userId) return { callId, outcome: "not-callee", changed: false, ...details };
      if (current.status !== "ringing" || current.endedAt) {
        return { callId, outcome: "finished", changed: false, status: current.status, ...details };
      }
      const now = new Date();
      const expired = current.expiresAt.getTime() <= now.getTime();
      const status = expired ? "missed" : "declined";
      transaction.update(ref, { status, endedAt: now, ...(expired ? { expiredAt: now } : {}) });
      const inbox = db.collection("users").doc(String(current.callee.id)).collection("missedCalls").doc(callId);
      const existingInbox = await transaction.get(inbox);
      transaction.set(inbox, {
        fromId: current.caller.id, fromName: current.caller.name, fromAvatar: current.caller.avatar,
        type: current.type, time: now, seen: existingInbox.data()?.seen === true, caller: current.caller,
        isSeen: existingInbox.data()?.isSeen === true, status,
      }, { merge: true });
      return { callId, outcome: expired ? "expired" : "declined", changed: true, status, ...details };
    });
    if (result.changed && result.calleeId !== undefined &&
      (result.status === "declined" || result.status === "missed")) {
      void sendBrowserCallTerminalPush({
        callId,
        calleeId: result.calleeId,
        status: result.status,
      }).catch(() => {});
    }
    return result;
  } catch (error) {
    throw error instanceof CallPushError ? error : new CallPushError("Call state status update failed");
  }
}
export function disconnectSessionSockets(sessionId: string) { for (const ws of [...(socketsBySessionId.get(sessionId) ?? [])]) endSessionSocket(ws); }
export function disconnectUserSockets(userId: number) { for (const client of [...(byUserId.get(userId) ?? [])]) endSessionSocket(client.ws); }
export async function broadcastRoomEvent(roomId: number, event: object, recipients?: number[]) {
  if (!pool) return;
  const members = await pool.query<{ user_id: number }>(`SELECT user_id FROM dm_room_members WHERE room_id=$1`, [roomId]);
  const allowed = recipients ? new Set(recipients) : null;
  for (const member of members.rows) if (!allowed || allowed.has(member.user_id)) broadcastToUser(member.user_id, { ...event, recipientUserId: member.user_id, roomId });
}
export async function broadcastMessageToRoom(roomId: number, message: object) { return broadcastRoomEvent(roomId, { type: "chat-message", message }); }

export function attachSignalingServer(httpServer: Server, sessionMiddleware: RequestHandler) {
  // Expire unanswered invitations only; never derive busy state from history.
  let cleanupRunning = false;
  const cleanup = () => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupStaleAuthoritativeCalls().catch(error => {
      logger.warn({ event: "call_cleanup_failed", diagnosticCode: callFailureDiagnosticCode(error) }, "Call cleanup failed");
    }).finally(() => { cleanupRunning = false; });
  };
  cleanup();
  const cleanupInterval = setInterval(cleanup, 30_000);
  cleanupInterval.unref();
  httpServer.once("close", () => clearInterval(cleanupInterval));
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] !== "/api/ws") return;
    sessionMiddleware(req as any, {} as any, error => {
      if (error) { socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"); socket.destroy(); return; }
      if (!(req as any).session?.userId) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
    });
  });
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let self: Client | null = null;
    const sessionUserId = (req as any).session.userId as number;
    const sessionId = (req as any).sessionID as string;
    const credentialEpoch = sessionCredentialEpoch((req as any).session);
    socketBindings.set(ws, { sessionId, userId: sessionUserId, credentialEpoch });
    const sockets = socketsBySessionId.get(sessionId) ?? new Set<WebSocket>(); sockets.add(ws); socketsBySessionId.set(sessionId, sockets);
    ws.on("message", async raw => {
      let msg: SignalMsg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      // No process-local revocation cache: every frame uses canonical PG state.
      try {
        if (!await sessionIsLive(sessionId, sessionUserId, credentialEpoch)) { endSessionSocket(ws); return; }
      } catch { ws.close(1013, "Session validation unavailable"); return; }
      if (msg.type === "register") {
        if (self) return;
        try {
          const user = await pool?.query<{ username: string }>(`SELECT username FROM users WHERE id=$1 LIMIT 1`, [sessionUserId]);
          const username = user?.rows[0]?.username?.toLowerCase(); if (!username) { send(ws, { type: "error", message: "Unknown user" }); return; }
          self = { ws, userId: sessionUserId, sessionId, deviceId: validDeviceId(msg.deviceId, sessionId), username, liveId: null, observedCalls: new Set() };
          addClient(self); send(ws, { type: "registered", userId: sessionUserId, username, onlineCount: clients.size });
          self.stopCalls = await subscribeCalls(self).catch(() => undefined);
          const online = [...clients.keys()]; wss.clients.forEach(client => send(client, { type: "online-list", users: online }));
        } catch { send(ws, { type: "error", message: "Session validation failed" }); }
        return;
      }
      if (!self) { send(ws, { type: "error", message: "Not registered" }); return; }
      if (msg.type === "ping") { send(ws, { type: "pong" }); return; }
      if (msg.type === "call-media-state") {
        // Old web clients already emit this every five seconds, but a generic
        // connected socket (or login session) must never renew a ghost call.
        if (msg.connected === true) {
          try {
            await heartbeatAuthoritativeCall(msg.callId, self.userId, self.sessionId, self.deviceId);
          } catch {
            send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" });
          }
        }
        return;
      }
      if (msg.type === "call-heartbeat") {
        try { if (!await heartbeatAuthoritativeCall(msg.callId, self.userId, self.sessionId, self.deviceId, msg.background === true))
          send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SESSION_DENIED" });
        } catch { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" }); }
        return;
      }
      if (msg.type === "call-offer") {
        let stage = "media-protocol";
        try {
          const provider = requireReadyCallMediaProvider();
          const offeredProvider = msg.transport?.provider ?? (provider === "hybrid" ? "webrtc" : provider);
          const permitted = provider === "hybrid"
            ? offeredProvider === "webrtc" || offeredProvider === "agora"
            : offeredProvider === provider;
          const valid = (msg.deferredMedia === true ? transportMatches(msg.transport, "webrtc") && msg.offer === null :
            permitted && (offeredProvider === "agora" ? msg.offer === null : validDescription(msg.offer, "offer")));
          if (!valid || (msg.deferredMedia === true && provider !== "webrtc" && provider !== "hybrid")) throw new Error("MEDIA_PROTOCOL_MISMATCH");
          stage = "recipient-lookup";
          const target = await pool?.query<{ id: number; username: string }>(`SELECT id, username FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`, [msg.to]);
          const callee = target?.rows[0];
          if (!callee || callee.id === self.userId) { send(ws, { type: "call-unavailable", callId: msg.callId, to: msg.to }); return; }
          stage = "block-policy";
          if (await currentCallBlocked(self.userId, callee.id)) { send(ws, { type: "call-blocked", callId: msg.callId }); return; }
          stage = "secure-envelope";
          if (!await validateEnvelope(callee.id, msg.e2e)) { send(ws, { type: "call-unavailable", callId: msg.callId, code: "SECURE_DEVICE_KEYS_CHANGED", reason: "secure-device-keys-changed" }); return; }
          stage = "durable-create";
          const record = await createAuthoritativeCall({
            callId: msg.callId, caller: { id: self.userId, name: self.username, avatar: await callerAvatar(self.userId) },
            callee: { id: callee.id, name: callee.username.toLowerCase(), avatar: null }, type: msg.video ? "video" : "voice",
            deferredMedia: msg.deferredMedia === true, transport: msg.deferredMedia ? { provider: "webrtc", version: 1 } : (msg.transport ?? { provider: offeredProvider, version: 1 }),
            initialOffer: msg.offer, latestOffer: msg.offer, e2e: msg.e2e as Record<string, unknown> | undefined, callerDeviceId: self.deviceId, callerSessionId: self.sessionId,
            notifyOffline: ![...(byUserId.get(callee.id) ?? [])].some(client => client.ws.readyState === WebSocket.OPEN),
          });
          self.observedCalls.add(record.callId);
          // Persistence is complete before call-ready. Remote replicas receive
          // the same ringing document through their participant subscription.
          stage = "call-ready";
          send(ws, { type: "call-ready", callId: record.callId, expiresAt: record.expiresAt.toISOString(), deferredMedia: record.deferredMedia });
        } catch (error) {
          const code = error instanceof Error && error.message === "MEDIA_PROTOCOL_MISMATCH" ? "MEDIA_PROTOCOL_MISMATCH" : "CALL_SIGNALING_UNAVAILABLE";
          logger.warn({ event: "call_offer_failed", stage, code, diagnosticCode: callFailureDiagnosticCode(error) }, "Call offer failed");
          send(ws, { type: "call-unavailable", callId: msg.callId, to: msg.to, code, reason: code === "CALL_SIGNALING_UNAVAILABLE" ? "Authoritative call state is unavailable" : undefined });
        }
        return;
      }
      if (msg.type === "call-resume") {
        try {
          const record = await getAuthoritativeCall(msg.callId);
          if (!record) { send(ws, { type: "call-ended", callId: msg.callId, by: "server", code: "INVITATION_NO_LONGER_RINGING" }); return; }
          if (record.status === "ringing" && record.expiresAt.getTime() <= Date.now()) {
            await expireAuthoritativeCall(msg.callId);
            send(ws, { type: "call-ended", callId: msg.callId, by: "timeout", code: "RING_TIMEOUT" });
            return;
          }
          const caller = record.caller.id === self.userId && record.callerSessionTag === callSessionBinding(self.sessionId) && record.callerDeviceId === self.deviceId;
          const calleeRinging = record.callee.id === self.userId && record.status === "ringing";
          const selected = record.answerer?.userId === self.userId && record.answerer.sessionTag === callSessionBinding(self.sessionId) && record.answerer.deviceId === self.deviceId;
          if (!caller && !calleeRinging && !selected) { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SESSION_DENIED" }); return; }
          self.observedCalls.add(record.callId);
          deliverCallSnapshot(self, record);
        } catch { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" }); }
        return;
      }
      if (msg.type === "call-provider-switch") {
        try {
          // Failover is offered only by an explicitly hybrid deployment and is
          // one-way; an Agora call can never be downgraded by a client.
          if (requireReadyCallMediaProvider() !== "hybrid" || msg.provider !== "agora") return;
          const changed = await switchAuthoritativeCallProvider(msg.callId, self.userId, self.sessionId, self.deviceId);
          if (!changed) return;
          const event = { type: "call-provider-changed", callId: changed.callId, transport: changed.transport };
          broadcastToUser(changed.caller.id, event);
          broadcastToUser(changed.callee.id, event);
        } catch {
          send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" });
        }
        return;
      }
      if (msg.type === "call-recording-control") {
        if (!validRecordingControl(msg)) return;
        try {
          const direct = await getAuthoritativeCall(msg.callId);
          const group = direct ? null : await getGroupCall(msg.callId);
          let recipientIds: number[] | null = null;
          if (direct && canControlDirectCallRecording(direct, self.userId, self.sessionId, self.deviceId)) {
            recipientIds = [direct.caller.id, direct.callee.id];
          } else if (group && canIssueGroupAgoraToken(group, self.userId, self.sessionId, self.deviceId)) {
            recipientIds = group.participants.filter(participant => participant.status === "accepted").map(participant => participant.userId);
          }
          if (!recipientIds) return;
          // Controls are a consent transcript, never media. Persist before relay
          // so reconnecting clients can retrieve the authoritative call record.
          const db = getCallStateDb();
          const collection = direct ? db.collection("callInvites").doc(msg.callId) : db.collection("groupCallInvites").doc(msg.callId);
          await collection.collection("recordingControls").doc(msg.requestId).set({
            type: "call-recording-control", callId: msg.callId, requestId: msg.requestId,
            action: msg.action, fromUserId: self.userId, createdAt: new Date(),
          }, { merge: false });
          const event = { type: "call-recording-control", callId: msg.callId, requestId: msg.requestId, action: msg.action, serverFromUserId: self.userId };
          for (const recipientId of new Set(recipientIds)) if (recipientId !== self.userId) broadcastToUser(recipientId, event);
        } catch {
          send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" });
        }
        return;
      }
      if (msg.type === "call-answer") {
        try {
          const current = await getAuthoritativeCall(msg.callId);
          if (!current || current.callee.id !== self.userId || msg.to.toLowerCase() !== current.caller.name.toLowerCase() ||
            !(transportMatches(msg.transport, current.transport.provider) || (current.transport.provider === "agora" && msg.transport === undefined)) ||
            (current.transport.provider === "webrtc" && !current.deferredMedia && !validDescription(msg.answer, "answer")) ||
            (current.transport.provider === "webrtc" && current.deferredMedia && msg.answer !== null && !validDescription(msg.answer, "answer")) ||
            (current.transport.provider === "agora" && msg.answer !== null) ||
            await currentCallBlocked(current.caller.id, self.userId)) { return; }
          if (!await validateEnvelope(self.userId, current.e2e as E2eCallEnvelope | undefined)) {
            send(ws, { type: "call-unavailable", callId: msg.callId, code: "SECURE_DEVICE_KEYS_CHANGED" });
            return;
          }
          const accepted = await answerAuthoritativeCall(msg.callId, self.userId, self.sessionId, self.deviceId, msg.answer);
          if (!accepted) { send(ws, { type: "call-ended", callId: msg.callId, by: "server", code: "INVITATION_NO_LONGER_RINGING" }); return; }
          broadcastToUser(accepted.caller.id, { type: "call-accepted", from: accepted.callee.name, callId: accepted.callId, answer: msg.answer, deferredMedia: accepted.deferredMedia, transport: accepted.transport, signalId: `${accepted.callId}:accepted` });
        } catch { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" }); }
        return;
      }
      if (msg.type === "call-webrtc-offer" || msg.type === "call-renegotiate-offer" ||
          msg.type === "call-webrtc-answer" || msg.type === "call-renegotiate-answer" ||
          msg.type === "ice-candidate") {
        let payload: Record<string, unknown> | null = null;
        if (msg.type === "ice-candidate") payload = validIce(msg.candidate) ? { candidate: msg.candidate } : null;
        else if (msg.type === "call-webrtc-offer" || msg.type === "call-renegotiate-offer") {
          payload = validDescription(msg.offer, "offer") && transportMatches(msg.transport, "webrtc") ? { offer: msg.offer } : null;
        } else {
          payload = validDescription(msg.answer, "answer") && transportMatches(msg.transport, "webrtc") ? { answer: msg.answer } : null;
        }
        if (!payload) return;
        try {
          const signal = await appendAuthoritativeSignal({ callId: msg.callId, userId: self.userId, sessionId: self.sessionId, deviceId: self.deviceId, kind: msg.type as any, payload });
          if (signal) {
            const call = await getAuthoritativeCall(msg.callId);
            if (call) broadcastToUser(signal.toId, wirePayload(call, signal));
          }
        } catch { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" }); }
        return;
      }
      if (msg.type === "call-cancel" || msg.type === "call-reject" || msg.type === "call-end") {
        try {
          if (msg.type === "call-reject") {
            const result = await declineCallForUser(msg.callId, self.userId);
            if (result.outcome === "not-callee") return;
          }
          const terminal = msg.type === "call-reject"
            ? await getAuthoritativeCall(msg.callId)
            : await terminateAuthoritativeCall(msg.callId, self.userId, self.sessionId, self.deviceId, "ended");
          if (terminal) {
            const event = { type: terminal.status === "declined" ? "call-rejected" : "call-ended", by: self.username, callId: msg.callId, signalId: `${msg.callId}:terminal` };
            broadcastToUser(terminal.caller.id, event); broadcastToUser(terminal.callee.id, event);
          }
        } catch { send(ws, { type: "call-unavailable", callId: msg.callId, code: "CALL_SIGNALING_UNAVAILABLE" }); }
        return;
      }
      if (msg.type === "live-start") {
        const liveId = `live_${self.username}_${Date.now()}`; self.liveId = liveId;
        lives.set(liveId, { hostUsername: self.username, title: msg.title, domain: msg.domain, startedAt: new Date() }); send(ws, { type: "live-started", liveId });
        wss.clients.forEach(client => { if (client !== ws) send(client, { type: "live-available", liveId, host: self!.username, title: msg.title, domain: msg.domain }); }); return;
      }
      if (msg.type === "live-end") { if (self.liveId) { lives.delete(self.liveId); wss.clients.forEach(client => send(client, { type: "live-ended", liveId: self!.liveId })); self.liveId = null; } return; }
      if (msg.type === "live-join") { const live = lives.get(msg.liveId); const host = live && findByUsername(live.hostUsername); if (!host) send(ws, { type: "live-not-found" }); else send(host.ws, { type: "live-viewer-joined", viewer: self.username, liveId: msg.liveId }); return; }
      if (msg.type === "live-offer" || msg.type === "live-answer" || msg.type === "live-ice") { const peer = findByUsername(msg.to); if (peer) send(peer.ws, { ...msg, from: self.username }); }
    });
    ws.on("close", () => {
      const tracked = socketsBySessionId.get(sessionId); tracked?.delete(ws); if (!tracked?.size) socketsBySessionId.delete(sessionId);
      if (!self) return;
      // Socket presence ends immediately. Historical call records cannot
      // prevent this user from receiving a new invitation.
      self.stopCalls?.();
      if (self.liveId) { lives.delete(self.liveId); wss.clients.forEach(client => send(client, { type: "live-ended", liveId: self!.liveId })); }
      removeClient(self); wss.clients.forEach(client => send(client, { type: "online-list", users: [...clients.keys()] }));
    });
  });
  return { getLives: () => [...lives.entries()].map(([liveId, info]) => ({ liveId, ...info })), getOnline: () => [...clients.keys()] };
}
