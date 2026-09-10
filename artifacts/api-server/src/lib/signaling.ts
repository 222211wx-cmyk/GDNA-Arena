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
  | { type: "call-offer";     to: string; offer: RTCSessionDescriptionInit | null; callId: string; from: string; video: boolean; transport?: CallTransport; e2e?: E2eCallEnvelope }
  | { type: "call-answer";    to: string; answer: RTCSessionDescriptionInit | null; callId: string; transport?: CallTransport }
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
const activeCalls = new Map<string, {
  caller: string; callee: string; callerId: number | null; calleeId: number | null;
  callerSocket: WebSocket; calleeSocket: WebSocket | null; startedAt: Date;
  transport: CallTransport; ringTimer: NodeJS.Timeout;
}>();

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
          (transportMatches(msg.transport, authoritativeProvider) ||
            (authoritativeProvider === "agora" && msg.transport === undefined)) &&
          (authoritativeProvider === "agora"
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

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        // Only the recorded callee may answer, and only towards the recorded caller.
        const call = activeCalls.get(msg.callId);
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
      if (msg.type === "call-reject") {
        // Recipient is DERIVED from the recorded call — client "to" is ignored,
        // so a participant can never target a third party.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        activeCalls.delete(msg.callId);
        clearTimeout(call.ringTimer);
        stopCallBilling(msg.callId);
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        const peerSocket = call.callerSocket === ws ? call.calleeSocket : call.callerSocket;
        if (peerSocket) send(peerSocket, { type: "call-rejected", by: self.username, callId: msg.callId });
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
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        const peerSocket = call.callerSocket === ws ? call.calleeSocket : call.callerSocket;
        if (peerSocket) send(peerSocket, { type: "call-ended", by: self.username, callId: msg.callId });
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
        activeCalls.delete(callId);
        clearTimeout(call.ringTimer);
        stopCallBilling(callId);
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
