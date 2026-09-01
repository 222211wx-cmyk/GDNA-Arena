// ══════════════════════════════════════════════════════════════════════════════
//  GDNA REAL-TIME SIGNALING SERVER — WebRTC Call & Live Story Engine
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";

// ── WebRTC type stubs (browser DOM types not present in Node tsconfig) ────────
interface RTCSessionDescriptionInit { type: string; sdp?: string; }
interface RTCIceCandidateInit      { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null; }
interface E2eCallEnvelope {
  devices: Record<string, { wrappedSecret: string; fingerprint: string }>;
}

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
  | { type: "call-offer";     to: string; offer: RTCSessionDescriptionInit | null; callId: string; from: string; video: boolean; e2e?: E2eCallEnvelope }
  | { type: "call-answer";    to: string; answer: RTCSessionDescriptionInit | null; callId: string }
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
const activeCalls = new Map<string, {
  caller: string; callee: string; callerId: number | null; calleeId: number | null;
  callerSocket: WebSocket; calleeSocket: WebSocket | null; startedAt: Date;
}>();

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
    if (call.startedAt.getTime() < cutoff) activeCalls.delete(id);
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
              send(ws, { type: "call-unavailable", to: msg.to });
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
              missedLogged: true,
            });
          } catch {
            send(ws, { type: "call-unavailable", to: msg.to });
          }
          return;
        }
        // Blocking is enforced before busy checks and, critically, before any
        // call state is created. Both directions are equivalent for contact
        // safety; identity comes exclusively from authenticated sockets.
        if (self.userId === null || target.userId === null) {
          send(ws, { type: "call-unavailable", to: msg.to }); return;
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
          send(ws, { type: "call-unavailable", to: msg.to });
          return;
        }
        if (userIsInCall(self.username) || userIsInCall(target.username)) {
          send(ws, { type: "call-busy", to: msg.to });
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
            send(ws, { type: "call-unavailable", to: msg.to, reason: "secure-device-keys-changed" });
            return;
          }
           // Recording the call while holding the same lock used by key
           // registration/revocation closes the key-check→route race.
           await lockClient.query("COMMIT");
            activeCalls.set(msg.callId, {
              caller: self.username, callee: target.username, callerId: self.userId, calleeId: target.userId,
              callerSocket: self.ws, calleeSocket: target.ws, startedAt: new Date(),
            });
            // Reserve both participants while the call is ringing. Without this,
            // either side could create a second offer before the first answer.
            setUserInCall(self.username, true);
            setUserInCall(target.username, true);
         } catch {
           await lockClient.query("ROLLBACK").catch(() => {});
          send(ws, { type: "call-unavailable", to: msg.to });
          return;
         } finally {
           lockClient.release();
        }
        sendToUsername(target.username, {
          type: "call-incoming",
          from: self.username,
          callId: msg.callId,
          offer: msg.offer,
          video: msg.video,
          e2e: msg.e2e,
        });
        console.log(`[WS] 📞 ${self.username} → ${msg.to} [${msg.video ? "video" : "audio"}]`);
        return;
      }

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        // Only the recorded callee may answer, and only towards the recorded caller.
        const call = activeCalls.get(msg.callId);
        if (!call || call.calleeId !== self.userId || call.caller !== msg.to.toLowerCase()) return;
        const caller = findByUsername(msg.to);
        if (caller) {
          call.calleeSocket = ws;
          setUserInCall(self.username, true);
          setUserInCall(caller.username, true);
          for (const device of clientsForUsername(self.username)) {
            if (device.ws !== ws) {
              send(device.ws, { type: "call-ended", by: self.username, callId: msg.callId });
            }
          }
          sendToUsername(caller.username, { type: "call-accepted", from: self.username, callId: msg.callId, answer: msg.answer });
        }
        return;
      }

      // ── ICE CANDIDATE ─────────────────────────────────────────────────────
      if (msg.type === "ice-candidate") {
        const call = activeCalls.get(msg.callId);
        if (!call) return;
        if (call.callerId === self.userId && call.callee === msg.to.toLowerCase()) {
          if (call.calleeSocket) send(call.calleeSocket, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
          else sendToUsername(call.callee, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
        } else if (call.calleeId === self.userId && call.caller === msg.to.toLowerCase()) {
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
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        sendToUsername(peerName, { type: "call-rejected", by: self.username, callId: msg.callId });
        return;
      }

      // ── CALL END ──────────────────────────────────────────────────────────
      if (msg.type === "call-end") {
        // Recipient DERIVED from recorded call state — client "to" is ignored.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.calleeId !== self.userId && call.callerId !== self.userId)) return;
        activeCalls.delete(msg.callId);
        const peerName = call.caller === self.username ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        sendToUsername(peerName, { type: "call-ended", by: self.username, callId: msg.callId });
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
        const peerName = call.callerSocket === ws ? call.callee : call.caller;
        setUserInCall(self.username, false);
        setUserInCall(peerName, false);
        sendToUsername(peerName, { type: "call-ended", by: self.username, callId });
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
