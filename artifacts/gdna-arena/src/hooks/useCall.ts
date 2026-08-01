// ══════════════════════════════════════════════════════════════════════════════
//  useCall — WebRTC + WebSocket hook for voice/video calls & live stories
// ══════════════════════════════════════════════════════════════════════════════

import { useRef, useState, useEffect, useCallback } from "react";

const BASE_WS = (() => {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host  = window.location.host; // includes port if any
  // /ws is proxied by Vite dev → api-server:8080/ws
  return `${proto}://${host}/ws`;
})();

export type CallStatus = "idle" | "calling" | "ringing" | "active" | "ended";
export type LiveStatus  = "idle" | "live" | "ended";

interface IncomingCall {
  from:   string;
  callId: string;
  offer:  RTCSessionDescriptionInit;
  video:  boolean;
}

interface LiveStream {
  liveId: string;
  host:   string;
  title:  string;
  domain: string;
}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export function useCall(user: { id: number; username: string } | null) {
  const wsRef   = useRef<WebSocket | null>(null);
  const pcRef   = useRef<RTCPeerConnection | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connected,    setConnected]    = useState(false);
  const [callStatus,   setCallStatus]   = useState<CallStatus>("idle");
  const [liveStatus,   setLiveStatus]   = useState<LiveStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activePeer,   setActivePeer]   = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [onlineUsers,  setOnlineUsers]  = useState<string[]>([]);
  const [activeLives,  setActiveLives]  = useState<LiveStream[]>([]);
  const [currentLiveId, setCurrentLiveId] = useState<string | null>(null);

  // Streams
  const localStreamRef  = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [localStream,  setLocalStream]  = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const sendWS = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // ── Create peer connection ─────────────────────────────────────────────────
  const createPC = useCallback((peerUsername: string, callId: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) sendWS({ type: "ice-candidate", to: peerUsername, callId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setCallStatus("active");
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setCallStatus("ended");
        setTimeout(() => { setCallStatus("idle"); setActivePeer(null); setActiveCallId(null); setRemoteStream(null); }, 2000);
      }
    };

    return pc;
  }, [sendWS]);

  // ── Connect WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const connect = () => {
      const ws = new WebSocket(BASE_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "register", userId: user.id, username: user.username }));
        pingRef.current = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
      };

      ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data as string);

        if (msg.type === "registered")    { setConnected(true); }
        if (msg.type === "online-list")   { setOnlineUsers(msg.users); }
        if (msg.type === "pong")          { /* alive */ }

        // ── Incoming call ──────────────────────────────────────────────────
        if (msg.type === "call-incoming") {
          setIncomingCall({ from: msg.from, callId: msg.callId, offer: msg.offer, video: msg.video });
          setCallStatus("ringing");
        }

        // ── Call accepted (caller side) ────────────────────────────────────
        if (msg.type === "call-accepted" && pcRef.current) {
          await pcRef.current.setRemoteDescription(msg.answer);
          setCallStatus("active");
        }

        // ── ICE candidates ─────────────────────────────────────────────────
        if (msg.type === "ice-candidate" && pcRef.current) {
          try { await pcRef.current.addIceCandidate(msg.candidate); } catch {}
        }

        // ── Call rejected / ended ──────────────────────────────────────────
        if (msg.type === "call-rejected" || msg.type === "call-ended") {
          setCallStatus("ended");
          pcRef.current?.close();
          localStreamRef.current?.getTracks().forEach(t => t.stop());
          setTimeout(() => { setCallStatus("idle"); setActivePeer(null); setActiveCallId(null); setLocalStream(null); setRemoteStream(null); }, 2000);
        }

        if (msg.type === "call-busy" || msg.type === "call-unavailable") {
          setCallStatus("ended");
          setTimeout(() => { setCallStatus("idle"); setActivePeer(null); }, 1500);
        }

        // ── Live events ────────────────────────────────────────────────────
        if (msg.type === "live-available") {
          setActiveLives(prev => [...prev.filter(l => l.liveId !== msg.liveId), { liveId: msg.liveId, host: msg.host, title: msg.title, domain: msg.domain }]);
        }
        if (msg.type === "live-ended") {
          setActiveLives(prev => prev.filter(l => l.liveId !== msg.liveId));
        }
        if (msg.type === "live-started") {
          setCurrentLiveId(msg.liveId as string);
          setLiveStatus("live");
        }

        // ── Live WebRTC viewer side ────────────────────────────────────────
        if (msg.type === "live-viewer-joined" && pcRef.current) {
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          sendWS({ type: "live-offer", to: msg.viewer, offer, liveId: msg.liveId });
        }
        if (msg.type === "live-offer") {
          const pc = createPC(msg.from, msg.liveId);
          localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
          await pc.setRemoteDescription(msg.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWS({ type: "live-answer", to: msg.from, answer, liveId: msg.liveId });
        }
        if (msg.type === "live-answer" && pcRef.current) {
          await pcRef.current.setRemoteDescription(msg.answer);
        }
        if (msg.type === "live-ice" && pcRef.current) {
          try { await pcRef.current.addIceCandidate(msg.candidate); } catch {}
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingRef.current) clearInterval(pingRef.current);
        // Reconnect after 3s
        setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [user?.id, user?.username]);

  // ── Start a call ──────────────────────────────────────────────────────────
  const startCall = useCallback(async (targetUsername: string, withVideo = true) => {
    if (callStatus !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const callId = `call_${Date.now()}`;
      const pc = createPC(targetUsername, callId);

      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setActivePeer(targetUsername);
      setActiveCallId(callId);
      setCallStatus("calling");

      sendWS({ type: "call-offer", to: targetUsername, offer, callId, from: user!.username, video: withVideo });
    } catch (err) {
      console.error("[CALL] Failed to start:", err);
      setCallStatus("idle");
    }
  }, [callStatus, createPC, sendWS, user]);

  // ── Answer an incoming call ────────────────────────────────────────────────
  const answerCall = useCallback(async (withVideo = true) => {
    if (!incomingCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPC(incomingCall.from, incomingCall.callId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      await pc.setRemoteDescription(incomingCall.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setActivePeer(incomingCall.from);
      setActiveCallId(incomingCall.callId);
      setIncomingCall(null);
      setCallStatus("active");

      sendWS({ type: "call-answer", to: incomingCall.from, answer, callId: incomingCall.callId });
    } catch (err) {
      console.error("[CALL] Failed to answer:", err);
    }
  }, [incomingCall, createPC, sendWS]);

  // ── Reject call ───────────────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    sendWS({ type: "call-reject", to: incomingCall.from, callId: incomingCall.callId });
    setIncomingCall(null);
    setCallStatus("idle");
  }, [incomingCall, sendWS]);

  // ── End active call ───────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    if (activePeer && activeCallId) sendWS({ type: "call-end", to: activePeer, callId: activeCallId });
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setCallStatus("idle");
    setActivePeer(null);
    setActiveCallId(null);
    setLocalStream(null);
    setRemoteStream(null);
  }, [activePeer, activeCallId, sendWS]);

  // ── Start live story ──────────────────────────────────────────────────────
  const startLive = useCallback(async (title: string, domain: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLiveStatus("live");
      sendWS({ type: "live-start", title, domain });
    } catch (err) {
      console.error("[LIVE] Failed:", err);
    }
  }, [sendWS]);

  const endLive = useCallback(() => {
    sendWS({ type: "live-end" });
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setLiveStatus("idle");
    setCurrentLiveId(null);
  }, [sendWS]);

  // ── Join a live ───────────────────────────────────────────────────────────
  const joinLive = useCallback(async (liveId: string) => {
    const pc = createPC("", liveId);
    pcRef.current = pc;
    sendWS({ type: "live-join", liveId });
  }, [createPC, sendWS]);

  return {
    connected, callStatus, liveStatus, incomingCall,
    activePeer, onlineUsers, activeLives, currentLiveId,
    localStream, remoteStream,
    startCall, answerCall, rejectCall, endCall,
    startLive, endLive, joinLive,
  };
}
