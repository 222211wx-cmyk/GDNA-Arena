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

// ── Types ─────────────────────────────────────────────────────────────────────
interface Client {
  ws:       WebSocket;
  userId:   number | null;  // null = unauthenticated (WebRTC-only)
  username: string;
  inCall:   boolean;
  liveId:   string | null;
}

type SignalMsg =
  | { type: "register";       userId: number; username: string }
  | { type: "call-offer";     to: string; offer: RTCSessionDescriptionInit | null; callId: string; from: string; video: boolean }
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
const lives     = new Map<string, { hostUsername: string; title: string; domain: string; startedAt: Date }>();

// Active call state keyed by callId — signaling only relays answer/reject/end
// for calls it saw offered, and only between the two recorded participants.
const activeCalls = new Map<string, {
  caller: string; callee: string; callerId: number | null; calleeId: number | null;
  callerSocket: WebSocket; calleeSocket: WebSocket; startedAt: Date;
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

// ── Broadcast a notification payload to a specific authenticated userId ────────
export function broadcastToUser(userId: number, data: object) {
  for (const client of byUserId.get(userId) ?? []) send(client.ws, data);
}

// Chat delivery is always resolved from persisted room membership. The client
// never supplies recipients, which keeps a crafted WebSocket payload from
// leaking a private room's message to an unrelated citizen.
export async function broadcastMessageToRoom(roomId: number, message: object): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM dm_room_members WHERE room_id = $1`,
    [roomId],
  );
  for (const { user_id: userId } of rows) {
    broadcastToUser(userId, { type: "chat-message", roomId, message });
  }
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

    ws.on("message", async (raw) => {
      let msg: SignalMsg;
      try { msg = JSON.parse(raw.toString()) as SignalMsg; }
      catch { return; }

      // ── REGISTER ──────────────────────────────────────────────────────────
      if (msg.type === "register") {
        // Derive username from DB using the session-authenticated userId.
        let username: string | null = null;
        try {
          const { rows } = (await pool?.query<{ username: string }>(
            `SELECT username FROM users WHERE id = $1 LIMIT 1`, [sessionUserId],
          )) ?? { rows: [] };
          username = rows[0]?.username?.toLowerCase() ?? null;
        } catch { /* fall through */ }
        if (!username) { send(ws, { type: "error", message: "Unknown user" }); return; }
        self = { ws, userId: sessionUserId, username, inCall: false, liveId: null };
        addClient(self);
        send(ws, { type: "registered", username, onlineCount: clients.size });
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
        if (!target) { send(ws, { type: "call-unavailable", to: msg.to }); return; }
        if (userIsInCall(target.username)) { send(ws, { type: "call-busy", to: msg.to }); return; }
        activeCalls.set(msg.callId, {
          caller: self.username, callee: target.username, callerId: self.userId, calleeId: target.userId,
          callerSocket: self.ws, calleeSocket: target.ws, startedAt: new Date(),
        });
        send(target.ws, { type: "call-incoming", from: self.username, callId: msg.callId, offer: msg.offer, video: msg.video });
        console.log(`[WS] 📞 ${self.username} → ${msg.to} [${msg.video ? "video" : "audio"}]`);
        return;
      }

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        // Only the recorded callee may answer, and only towards the recorded caller.
        const call = activeCalls.get(msg.callId);
        if (!call || call.callee !== self.username || call.caller !== msg.to.toLowerCase()) return;
        const caller = findByUsername(msg.to);
        if (caller) {
          setUserInCall(self.username, true);
          setUserInCall(caller.username, true);
          sendToUsername(caller.username, { type: "call-accepted", from: self.username, callId: msg.callId, answer: msg.answer });
        }
        return;
      }

      // ── ICE CANDIDATE ─────────────────────────────────────────────────────
      if (msg.type === "ice-candidate") {
        const peer = findByUsername(msg.to);
        if (peer) send(peer.ws, { type: "ice-candidate", from: self.username, callId: msg.callId, candidate: msg.candidate });
        return;
      }

      // ── CALL REJECT ───────────────────────────────────────────────────────
      if (msg.type === "call-reject") {
        // Recipient is DERIVED from the recorded call — client "to" is ignored,
        // so a participant can never target a third party.
        const call = activeCalls.get(msg.callId);
        if (!call || (call.callee !== self.username && call.caller !== self.username)) return;
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
        if (!call || (call.callee !== self.username && call.caller !== self.username)) return;
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
