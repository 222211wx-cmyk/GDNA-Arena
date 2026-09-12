// ══════════════════════════════════════════════════════════════════════════════
//  GDNA REAL-TIME SIGNALING SERVER — WebRTC Call & Live Story Engine
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { performance } from "node:perf_hooks";
import { consumeRoyalCreditSeconds, hasUsableRoyalCredit } from "./royal-credit";
import { requireReadyCallMediaProvider } from "./turn-config";
import { sampleMediaContinuity } from "./call-meter";
import { reserveDeferredAnsweringSocket } from "./deferred-call-policy";
import {
  acceptDeferredCallInvitation,
  CallPushError,
  createDeferredCallInvitation,
  durableTerminalStatus,
  finishDeferredCallInvitation,
  getCallPushStatus,
  isFirebaseCallPushConfigured,
  type DeferredCallInvitation,
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
  | { type: "call-media-state"; callId: string; connected: boolean }
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
  type: "video" | "voice"; expiresAt?: Date;
}
const activeCalls = new Map<string, ActiveCall>();

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

function persistDeferredTerminal(callId: string, call: ActiveCall, status: "declined" | "missed" | "ended"): void {
  const invitation = deferredInvitation(callId, call);
  if (invitation && call.firebasePersisted) void finishDeferredCallInvitation(invitation, status).catch(() => {});
  if (invitation && !call.firebasePersisted && (status === "declined" || status === "missed")) {
    void persistLegacyDeferredMissedCall(callId, call);
  }
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

const MEDIA_HEARTBEAT_FRESH_MS = 6_500;
const MEDIA_MAX_BILLING_STEP_MS = 5_000;
interface CallBillingMeter {
  timer: NodeJS.Timeout;
  callerConnectedAt: number | null;
  calleeConnectedAt: number | null;
  lastTickAt: number | null;
  carryMs: number;
  busy: boolean;
  mediaStarted: boolean;
  startedAt: number;
  disconnectedAt: number | null;
  interruptedMs: number;
}
const callBilling = new Map<string, CallBillingMeter>();

function stopCallBilling(callId: string): void {
  const meter = callBilling.get(callId);
  if (meter) clearInterval(meter.timer);
  callBilling.delete(callId);
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

function endCallForBilling(callId: string, reason: string, code: string): void {
  const call = activeCalls.get(callId);
  stopCallBilling(callId);
  if (!call) return;
  clearTimeout(call.ringTimer);
  activeCalls.delete(callId);
  persistDeferredTerminal(callId, call, "ended");
  setUserInCall(call.caller, false);
  setUserInCall(call.callee, false);
  const event = { type: "call-ended", by: "billing", callId, reason, code };
  send(call.callerSocket, event);
  if (call.calleeSocket) send(call.calleeSocket, event);
}

function startCallBilling(callId: string): void {
  stopCallBilling(callId);
  const meter: CallBillingMeter = {
    timer: undefined as unknown as NodeJS.Timeout,
    callerConnectedAt: null,
    calleeConnectedAt: null,
    lastTickAt: null,
    carryMs: 0,
    busy: false,
    mediaStarted: false,
    startedAt: performance.now(),
    disconnectedAt: null,
    interruptedMs: 0,
  };
  meter.timer = setInterval(async () => {
    if (meter.busy) return;
    const call = activeCalls.get(callId);
    if (!call || call.callerId === null || !call.calleeSocket) {
      stopCallBilling(callId);
      return;
    }
    const now = performance.now();
    const socketsOpen = call.callerSocket.readyState === WebSocket.OPEN
      && call.calleeSocket.readyState === WebSocket.OPEN
    const continuity = sampleMediaContinuity(
      meter,
      now,
      socketsOpen ? meter.callerConnectedAt : null,
      socketsOpen ? meter.calleeConnectedAt : null,
      MEDIA_HEARTBEAT_FRESH_MS,
      12_000,
    );
    const bothFresh = socketsOpen && continuity.bothFresh;
    if (!meter.mediaStarted && bothFresh) {
      // Initial setup has its own 20-second deadline and is never billed. The
      // handover allowance begins only once both peers have established media.
      meter.interruptedMs = 0;
      meter.disconnectedAt = null;
    }
    if (!bothFresh) {
      if (!meter.mediaStarted && now - meter.startedAt > 20_000) {
        endCallForBilling(callId, "Media connection was not established", "MEDIA_START_TIMEOUT");
        return;
      }
      // Once media has started, stale reporting fails closed: allowing media to
      // continue indefinitely without two fresh, socket-bound reports would be
      // unmetered. A short, non-billed grace supports Wi-Fi/cellular handover.
      if (meter.mediaStarted && continuity.exhausted) {
        endCallForBilling(callId, "Media connectivity reporting stopped", "MEDIA_HEARTBEAT_TIMEOUT");
        return;
      }
      meter.lastTickAt = null;
      meter.carryMs = 0;
      return;
    }
    meter.mediaStarted = true;
    if (meter.lastTickAt === null) {
      meter.lastTickAt = now;
      return;
    }
    const elapsed = Math.min(now - meter.lastTickAt, MEDIA_MAX_BILLING_STEP_MS);
    meter.lastTickAt = now;
    meter.carryMs += elapsed;
    const seconds = Math.floor(meter.carryMs / 1_000);
    if (seconds <= 0) return;
    meter.carryMs -= seconds * 1_000;
    meter.busy = true;
    try {
      const result = await Promise.race([
        consumeRoyalCreditSeconds(call.callerId, seconds, callId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Royal call billing timed out")), 5_000)),
      ]);
      if (callBilling.get(callId) !== meter || activeCalls.get(callId) !== call) return;
      if (result.exhausted) {
        endCallForBilling(callId, "Royal call credit exhausted", "CREDIT_EXHAUSTED");
      }
    } catch {
      // Charging must fail closed; a DB outage cannot create an unmetered call.
      endCallForBilling(callId, "Royal call billing unavailable", "CREDIT_BILLING_UNAVAILABLE");
    } finally {
      meter.busy = false;
    }
  }, 1_000);
  meter.timer.unref?.();
  callBilling.set(callId, meter);
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
      clearTimeout(call.ringTimer);
      stopCallBilling(id);
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
            if (!await hasUsableRoyalCredit(self.userId)) {
              send(ws, {
                type: "call-unavailable", to: callee.username, callId: msg.callId,
                reason: "Royal call credit or explicit reserve consent is required", code: "CREDIT_REQUIRED",
              });
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
            // Firebase absent is an explicitly exposed UI state, not a reason
            // to regress a live web socket call. Once configured, however, any
            // Firebase failure is terminal and never silently falls back.
            const firebaseConfigured = isFirebaseCallPushConfigured();
            const firebaseStatus = await getCallPushStatus();
            if (firebaseConfigured && !firebaseStatus.enabled) {
              throw new CallPushError(firebaseStatus.reason ?? "Firebase call push is unavailable");
            }
            const firebasePersisted = firebaseStatus.enabled;
            const invitation = firebasePersisted
              ? await createDeferredCallInvitation(localInvitation)
              : localInvitation;
            const ringTimer = setTimeout(() => {
              const ringing = activeCalls.get(msg.callId);
              if (!ringing || ringing.status !== "ringing") return;
              activeCalls.delete(msg.callId);
              stopCallBilling(msg.callId);
              persistDeferredTerminal(msg.callId, ringing, "missed");
              setUserInCall(ringing.caller, false);
              setUserInCall(ringing.callee, false);
              const event = { type: "call-ended", by: "timeout", callId: msg.callId, code: "RING_TIMEOUT", reason: "Call was not answered within 30 seconds" };
              send(ringing.callerSocket, event);
              sendToUsername(ringing.callee, event);
            }, Math.max(1, invitation.expiresAt!.getTime() - Date.now()));
            ringTimer.unref?.();
            activeCalls.set(msg.callId, {
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
            });
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
        const target = findByUsername(msg.to);
        if (!target) {
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

            const callType = msg.video ? "video" : "audio";
            await pool!.query(
              `INSERT INTO call_history
                 (caller_id, caller_username, callee_id, callee_username, call_type, status, duration_sec)
               VALUES ($1, $2, $3, $4, $5, 'missed', 0)`,
              [self.userId, self.username, callee.id, callee.username, callType],
            );

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
        try {
          if (!await hasUsableRoyalCredit(self.userId)) {
            send(ws, {
              type: "call-unavailable",
              to: msg.to,
              callId: msg.callId,
              reason: "Royal call credit or explicit reserve consent is required",
              code: "CREDIT_REQUIRED",
            });
            return;
          }
        } catch {
          send(ws, {
            type: "call-unavailable",
            to: msg.to,
            callId: msg.callId,
            reason: "Royal call billing unavailable",
            code: "CREDIT_BILLING_UNAVAILABLE",
          });
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
             const ringTimer = setTimeout(() => {
               const ringing = activeCalls.get(msg.callId);
               if (!ringing || ringing.calleeSocket !== target.ws) return;
               activeCalls.delete(msg.callId);
               stopCallBilling(msg.callId);
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
        return;
      }

      // A pushed/Firestore-discovered callee binds one socket before accepting.
      // It can never replace an already selected answering device.
      if (msg.type === "call-resume") {
        const call = activeCalls.get(msg.callId);
        if (!call || !call.deferredMedia || call.status !== "ringing" || call.calleeId !== self.userId) return;
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
          expiresAt: call.expiresAt?.toISOString(),
          video: call.type === "video",
          transport: call.transport,
        });
        return;
      }

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        const call = activeCalls.get(msg.callId);
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
                clearTimeout(call.ringTimer);
                setUserInCall(call.caller, false);
                setUserInCall(call.callee, false);
                send(ws, { type: "call-ended", by: "server", callId: msg.callId, code: "INVITATION_NO_LONGER_RINGING" });
                send(call.callerSocket, { type: "call-ended", by: "server", callId: msg.callId, code: "INVITATION_NO_LONGER_RINGING" });
                return;
              }
            } catch {
              activeCalls.delete(msg.callId);
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
          startCallBilling(msg.callId);
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
           startCallBilling(msg.callId);
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

       // ── SERVER-OWNED CALL BILLING HEARTBEAT ─────────────────────────────
       if (msg.type === "call-media-state") {
         const call = activeCalls.get(msg.callId);
         const meter = callBilling.get(msg.callId);
         if (!call || !meter || typeof msg.connected !== "boolean") return;
         const now = performance.now();
         // The authenticated participant and exact socket selected for this
         // call must match; another tab/device cannot spoof media connectivity.
         if (call.callerId === self.userId && call.callerSocket === ws) {
           meter.callerConnectedAt = msg.connected ? now : null;
         } else if (call.calleeId === self.userId && call.calleeSocket === ws) {
           meter.calleeConnectedAt = msg.connected ? now : null;
         } else {
           return;
         }
         const continuity = sampleMediaContinuity(
           meter,
           now,
           meter.callerConnectedAt,
           meter.calleeConnectedAt,
           MEDIA_HEARTBEAT_FRESH_MS,
           12_000,
         );
         if (meter.mediaStarted && continuity.exhausted) {
           endCallForBilling(
             msg.callId,
             "Cumulative media interruption allowance exhausted",
             "MEDIA_HEARTBEAT_TIMEOUT",
           );
         }
         return;
       }

      // ── ICE CANDIDATE ─────────────────────────────────────────────────────
      if (msg.type === "ice-candidate") {
        const call = activeCalls.get(msg.callId);
        if (!call || call.transport.provider !== "webrtc" ||
            (call.deferredMedia && call.status !== "accepted") ||
            !msg.candidate || typeof msg.candidate.candidate !== "string" ||
            msg.candidate.candidate.length > 4_096) return;
        if (call.callerId === self.userId && call.callerSocket === ws &&
            call.callee === msg.to.toLowerCase() && call.calleeSocket) {
          send(call.calleeSocket, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
        } else if (call.calleeId === self.userId && call.calleeSocket === ws && call.caller === msg.to.toLowerCase()) {
          send(call.callerSocket, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
        }
        return;
      }

      // ── CALL REJECT ───────────────────────────────────────────────────────
      if (msg.type === "call-reject" || msg.type === "call-cancel") {
        // Recipient is DERIVED from the recorded call — client "to" is ignored,
        // so a participant can never target a third party.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        if (msg.type === "call-cancel" &&
            (call.callerId !== self.userId || (call.status !== "ringing" && call.status !== "accepting"))) return;
        activeCalls.delete(msg.callId);
        clearTimeout(call.ringTimer);
        stopCallBilling(msg.callId);
        if (call.deferredMedia) {
          persistDeferredTerminal(
            msg.callId,
            call,
            durableTerminalStatus(call.status, call.callerId === self.userId),
          );
        }
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        if (call.callerSocket === ws) {
          sendToUsername(call.callee, { type: "call-rejected", by: self.username, callId: msg.callId });
        } else {
          send(call.callerSocket, { type: "call-rejected", by: self.username, callId: msg.callId });
          sendToUsername(call.callee, { type: "call-ended", by: self.username, callId: msg.callId });
        }
        return;
      }

      // ── CALL END ──────────────────────────────────────────────────────────
      if (msg.type === "call-end") {
        // Recipient DERIVED from recorded call state — client "to" is ignored.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        activeCalls.delete(msg.callId);
        clearTimeout(call.ringTimer);
        stopCallBilling(msg.callId);
        if (call.deferredMedia) {
          persistDeferredTerminal(
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
        clearTimeout(call.ringTimer);
        stopCallBilling(callId);
        if (call.deferredMedia) {
          persistDeferredTerminal(
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
