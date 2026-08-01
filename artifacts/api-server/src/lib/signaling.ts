// ══════════════════════════════════════════════════════════════════════════════
//  GDNA REAL-TIME SIGNALING SERVER — WebRTC Call & Live Story Engine
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Client {
  ws:       WebSocket;
  userId:   number;
  username: string;
  inCall:   boolean;
  liveId:   string | null;
}

type SignalMsg =
  | { type: "register";       userId: number; username: string }
  | { type: "call-offer";     to: string; offer: RTCSessionDescriptionInit; callId: string; from: string; video: boolean }
  | { type: "call-answer";    to: string; answer: RTCSessionDescriptionInit; callId: string }
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
const clients  = new Map<string, Client>();  // username → client
const lives    = new Map<string, { hostUsername: string; title: string; domain: string; startedAt: Date }>();

function send(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function findByUsername(username: string): Client | undefined {
  return clients.get(username.toLowerCase());
}

// ── Attach WebSocket server to HTTP server ────────────────────────────────────
export function attachSignalingServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let self: Client | null = null;

    ws.on("message", (raw) => {
      let msg: SignalMsg;
      try { msg = JSON.parse(raw.toString()) as SignalMsg; }
      catch { return; }

      // ── REGISTER ──────────────────────────────────────────────────────────
      if (msg.type === "register") {
        self = { ws, userId: msg.userId, username: msg.username.toLowerCase(), inCall: false, liveId: null };
        clients.set(msg.username.toLowerCase(), self);
        send(ws, { type: "registered", username: msg.username, onlineCount: clients.size });
        // Broadcast online list
        const onlineList = Array.from(clients.values()).map(c => c.username);
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "online-list", users: onlineList }); });
        console.log(`[WS] 🟢 ${msg.username} connected (total: ${clients.size})`);
        return;
      }

      if (!self) { send(ws, { type: "error", message: "Not registered" }); return; }

      // ── PING ──────────────────────────────────────────────────────────────
      if (msg.type === "ping") { send(ws, { type: "pong" }); return; }

      // ── CALL OFFER ────────────────────────────────────────────────────────
      if (msg.type === "call-offer") {
        const target = findByUsername(msg.to);
        if (!target) { send(ws, { type: "call-unavailable", to: msg.to }); return; }
        if (target.inCall) { send(ws, { type: "call-busy", to: msg.to }); return; }
        send(target.ws, { type: "call-incoming", from: self.username, callId: msg.callId, offer: msg.offer, video: msg.video });
        console.log(`[WS] 📞 ${self.username} → ${msg.to} [${msg.video ? "video" : "audio"}]`);
        return;
      }

      // ── CALL ANSWER ───────────────────────────────────────────────────────
      if (msg.type === "call-answer") {
        const caller = findByUsername(msg.to);
        if (caller) {
          self.inCall = true;
          const c = clients.get(msg.to.toLowerCase());
          if (c) c.inCall = true;
          send(caller.ws, { type: "call-accepted", from: self.username, callId: msg.callId, answer: msg.answer });
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
        const caller = findByUsername(msg.to);
        if (caller) send(caller.ws, { type: "call-rejected", by: self.username, callId: msg.callId });
        return;
      }

      // ── CALL END ──────────────────────────────────────────────────────────
      if (msg.type === "call-end") {
        self.inCall = false;
        const peer = findByUsername(msg.to);
        if (peer) { peer.inCall = false; send(peer.ws, { type: "call-ended", by: self.username, callId: msg.callId }); }
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
      if (self.liveId) {
        lives.delete(self.liveId);
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) send(c, { type: "live-ended", liveId: self!.liveId }); });
      }
      clients.delete(self.username);
      const onlineList = Array.from(clients.values()).map(c => c.username);
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
