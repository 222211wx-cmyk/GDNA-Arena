// ══════════════════════════════════════════════════════════════════════════════
//  useCall — Agora RTC calls + WebSocket signaling for GDNA Arena
//  Media rides Agora's global relay network (works on strict NATs/firewalls).
//  The WS layer keeps ring / accept / reject / end + presence + notifications.
// ══════════════════════════════════════════════════════════════════════════════

import { useRef, useState, useEffect, useCallback } from "react";
import AgoraRTC from "agora-rtc-sdk-ng";
import type {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
  ICameraVideoTrack,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import {
  decryptCallSecret,
  encryptCallSecret,
  ensureDeviceIdentity,
  type E2ERecipientKey,
} from "@/lib/amis-e2ee";

const AGORA_APP_ID = "62585b9b53c44c47baa7600ee5d74e54";

// Fetch a channel-scoped RTC token from the authenticated backend.
// Returns { appId, token, uid } — token is null while the Agora project runs
// in App-ID-only mode (no App Certificate configured server-side yet).
async function fetchAgoraToken(channel: string): Promise<{ appId: string; token: string | null; uid: number | null }> {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  // Retry briefly on 403: the caller's call-offer (which registers the call
  // server-side) races this HTTP request over a separate connection.
  let lastError = "Secure call token unavailable";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${base}/api/rtc/agora-token?channel=${encodeURIComponent(channel)}`, { credentials: "include" });
      if (r.status === 403) { await new Promise(res => setTimeout(res, 350)); continue; }
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Secure call token failed: HTTP ${r.status}`);
      }
      const data = await r.json();
      return { appId: data.appId ?? AGORA_APP_ID, token: data.token ?? null, uid: data.uid ?? null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < 3) await new Promise(res => setTimeout(res, 350));
    }
  }
  throw new Error(lastError);
}

const BASE_WS = (() => {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host  = window.location.host; // includes port if any
  // /api/ws rides the /api path so it reaches the api-server in BOTH dev and
  // production (the deployment router only forwards /api/* to the backend).
  return `${proto}://${host}/api/ws`;
})();

export type CallStatus = "idle" | "calling" | "ringing" | "active" | "ended";
export type LiveStatus  = "idle" | "live" | "ended";
export type ConnectionTestStatus = "idle" | "testing" | "ready" | "unstable" | "failed";

interface IncomingCall {
  from:   string;
  callId: string;
  video:  boolean;
  e2e?: {
    devices: Record<string, {
      wrappedSecret: string;
      fingerprint: string;
    }>;
  };
}

interface LiveStream {
  liveId: string;
  host:   string;
  title:  string;
  domain: string;
}

// STUN-only config for the live-story WebRTC path (calls now use Agora).
const LIVE_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function mediaFailureMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || code === "PERMISSION_DENIED") {
    return "🎤 تم رفض إذن الميكروفون — افتح إعدادات المتصفح وأعطِ الإذن للموقع";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || code === "DEVICE_NOT_FOUND") {
    return "🎤 لا يوجد ميكروفون متصل بالجهاز";
  }
  if (name === "NotReadableError" || name === "AbortError" || code === "DEVICE_BUSY" || code === "DEVICE_IN_USE") {
    return "🎤 الميكروفون مستخدم من تطبيق أو تسجيل آخر — أغلقه وأعد المحاولة";
  }
  if (name === "NotSupportedError") {
    return "🎤 هذا المتصفح لا يدعم الوصول إلى الميكروفون";
  }
  return "🎤 تعذّر الوصول إلى الميكروفون — تأكد من الإذن والجهاز ثم أعد المحاولة";
}
export function useCall(user: { id: number; username: string } | null) {
  const wsRef   = useRef<WebSocket | null>(null);
  const pcRef   = useRef<RTCPeerConnection | null>(null); // live stories only
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityGenerationRef = useRef(0);
  const preflightClientRef = useRef<IAgoraRTCClient | null>(null);

  // ── Agora call engine ──────────────────────────────────────────────────────
  const agoraRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioRef  = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoRef  = useRef<ICameraVideoTrack | null>(null);
  const screenTrackRef = useRef<ILocalVideoTrack | null>(null);
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const remoteVideoRef = useRef<IRemoteVideoTrack | null>(null);

  const [connected,    setConnected]    = useState(false);
  const [callStatus,   setCallStatus]   = useState<CallStatus>("idle");
  const [liveStatus,   setLiveStatus]   = useState<LiveStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activePeer,   setActivePeer]   = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  // Mirror of the call the user is currently in or being offered — WS handlers
  // use this ref to IGNORE call events whose callId does not belong to us.
  const currentCallIdRef = useRef<string | null>(null);
  const [activeVideo,  setActiveVideo]  = useState(false);
  // Call-history tracking — lives here (single instance) so it logs exactly once
  const historyRef = useRef<{ peer: string; video: boolean; start: number; outgoing: boolean; answered: boolean } | null>(null);
  const [onlineUsers,  setOnlineUsers]  = useState<string[]>([]);
  const [activeLives,  setActiveLives]  = useState<LiveStream[]>([]);
  const [currentLiveId, setCurrentLiveId] = useState<string | null>(null);

  // Streams (MediaStream API kept so CallOverlay & live components stay unchanged)
  const localStreamRef  = useRef<MediaStream | null>(null);
  const [localStream,   setLocalStream]   = useState<MediaStream | null>(null);
  const [remoteStream,  setRemoteStream]  = useState<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);

  // ── Error feedback ─────────────────────────────────────────────────────────
  const [callError,    setCallError]    = useState<string | null>(null);
  const [connectionTest, setConnectionTest] = useState<ConnectionTestStatus>("idle");
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCallError = (msg: string) => {
    setCallError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setCallError(null), 5000);
  };

  // ── Ring timeout: give up on unanswered outgoing calls after ~45s ─────────
  const RING_TIMEOUT_MS = 45_000;
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRingTimer = () => {
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
  };

  const sendWS = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Publish only the current browser's public key. The private RSA key remains
  // non-extractable in IndexedDB and is never included in an HTTP/WS payload.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const identity = await ensureDeviceIdentity(user.id);
        if (cancelled) return;
        const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
        await fetch(`${base}/api/messages/e2e/key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: identity.deviceId, publicKey: identity.publicKey }),
          credentials: "include",
        });
      } catch (error) {
        console.warn("[E2E] Device key registration failed:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ── Pre-call Agora quality test ───────────────────────────────────────────
  // Agora computes this last-mile metric from bitrate, packet loss, RTT, and
  // jitter. It measures the same network path calls use without opening a real
  // call or requesting microphone/camera permission.
  const testConnection = useCallback(async () => {
    if (connectionTest === "testing") return;
    if (!user) {
      setConnectionTest("failed");
      return;
    }

    if (preflightClientRef.current) {
      try { await preflightClientRef.current.leave(); } catch { /* already disconnected */ }
      preflightClientRef.current = null;
    }
    setConnectionTest("testing");
    let client: IAgoraRTCClient | null = null;
    let silentTrack: ILocalAudioTrack | null = null;
    let audioContext: AudioContext | null = null;
    let oscillator: OscillatorNode | null = null;

    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      const response = await fetch(`${base}/api/rtc/preflight-token`, { credentials: "include" });
      if (!response.ok) throw new Error(`Agora preflight unavailable: HTTP ${response.status}`);

      const data = await response.json() as { appId?: string; token?: string | null; uid?: number | null; channel?: string };
      if (!data.channel) {
        throw new Error("Agora preflight channel is unavailable");
      }

      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      const activeClient = client;
      preflightClientRef.current = activeClient;
      await activeClient.join(data.appId ?? AGORA_APP_ID, data.channel, data.token ?? null, data.uid ?? null);

      // Publish a silent track so Agora can calculate meaningful uplink quality
      // without prompting for the citizen's microphone.
      audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();
      oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      const sourceTrack = destination.stream.getAudioTracks()[0];
      if (!sourceTrack) throw new Error("Unable to create preflight audio track");
      silentTrack = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: sourceTrack, encoderConfig: "speech_low_quality" });
      await activeClient.publish(silentTrack);

      const result = await new Promise<ConnectionTestStatus>((resolve) => {
        let complete = false;
        const finish = (status: ConnectionTestStatus) => {
          if (complete) return;
          complete = true;
          window.clearTimeout(timeout);
          resolve(status);
        };

        const timeout = window.setTimeout(() => finish("failed"), 8_000);
        activeClient.on("connection-state-change", state => {
          if (state === "DISCONNECTED" || state === "DISCONNECTING") finish("failed");
        });
        activeClient.on("network-quality", quality => {
          const uplink = quality.uplinkNetworkQuality;
          if (uplink === 1 || uplink === 2) finish("ready");
          if (uplink === 3 || uplink === 4) finish("unstable");
          if (uplink === 5 || uplink === 6) finish("failed");
        });
      });
      setConnectionTest(result);
    } catch (error) {
      console.warn("[CALL] Agora preflight failed:", error);
      setConnectionTest("failed");
    } finally {
      try { oscillator?.stop(); } catch { /* already stopped */ }
      try { silentTrack?.close(); } catch { /* already closed */ }
      try { await client?.leave(); } catch { /* already left */ }
      if (audioContext) void audioContext.close();
      if (preflightClientRef.current === client) preflightClientRef.current = null;
    }
  }, [connectionTest, user]);

  // ── Rebuild the remote MediaStream from current Agora remote tracks ───────
  const rebuildRemoteStream = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (remoteAudioRef.current) tracks.push(remoteAudioRef.current.getMediaStreamTrack());
    if (remoteVideoRef.current) tracks.push(remoteVideoRef.current.getMediaStreamTrack());
    setRemoteStream(tracks.length > 0 ? new MediaStream(tracks) : null);
  }, []);

  // ── Join an Agora channel & publish local media ────────────────────────────
  const joinAgora = useCallback(async (channel: string, withVideo: boolean, encryptionSecret: string) => {
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    agoraRef.current = client;
    // Agora encrypts media frames before they leave this browser. The secret is
    // generated by the caller and RSA-wrapped for the callee, so the signaling
    // server and Agora never receive the clear session secret.
    // Agora's GCM2 modes require the same exact 32-byte salt on every client.
    // The channel-derived salt is public; secrecy remains entirely in the
    // browser-generated RSA-wrapped encryptionSecret.
    const salt = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`gdna-agora:${channel}`),
    ));
    client.setEncryptionConfig("aes-256-gcm2", encryptionSecret, salt);

    client.on("user-published", async (remoteUser, mediaType) => {
      if (agoraRef.current !== client) return; // stale client
      await client.subscribe(remoteUser, mediaType);
      if (mediaType === "audio") remoteAudioRef.current = remoteUser.audioTrack ?? null;
      if (mediaType === "video") remoteVideoRef.current = remoteUser.videoTrack ?? null;
      rebuildRemoteStream();
      setCallStatus("active");
    });

    client.on("user-unpublished", (_remoteUser, mediaType) => {
      if (agoraRef.current !== client) return;
      if (mediaType === "audio") remoteAudioRef.current = null;
      if (mediaType === "video") remoteVideoRef.current = null;
      rebuildRemoteStream();
    });

    const { appId, token, uid } = await fetchAgoraToken(channel);
    await client.join(appId, channel, token, uid);

    const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    localAudioRef.current = audioTrack;
    let videoTrack: ICameraVideoTrack | null = null;
    if (withVideo) {
      try {
        videoTrack = await AgoraRTC.createCameraVideoTrack();
        localVideoRef.current = videoTrack;
      } catch { /* no camera — degrade to audio-only */ }
    }

    await client.publish(videoTrack ? [audioTrack, videoTrack] : [audioTrack]);

    const ms = new MediaStream([
      audioTrack.getMediaStreamTrack(),
      ...(videoTrack ? [videoTrack.getMediaStreamTrack()] : []),
    ]);
    localStreamRef.current = ms;
    setLocalStream(ms);
  }, [rebuildRemoteStream]);

  // ── Leave Agora & release all media ────────────────────────────────────────
  const leaveAgora = useCallback(async () => {
    const client = agoraRef.current;
    agoraRef.current = null;
    try { screenTrackRef.current?.close(); } catch { /* already closed */ }
    try { localAudioRef.current?.close(); } catch { /* already closed */ }
    try { localVideoRef.current?.close(); } catch { /* already closed */ }
    screenTrackRef.current = null;
    localAudioRef.current  = null;
    localVideoRef.current  = null;
    remoteAudioRef.current = null;
    remoteVideoRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setScreenSharing(false);
    if (client) { try { await client.leave(); } catch { /* already left */ } }
  }, []);

  // ── Connect WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    const generation = ++identityGenerationRef.current;
    let disposed = false;
    const isCurrent = (ws?: WebSocket) =>
      !disposed &&
      generation === identityGenerationRef.current &&
      (!ws || wsRef.current === ws);

    if (!user) {
      setConnected(false);
      setOnlineUsers([]);
      setActiveLives([]);
      setIncomingCall(null);
      setActivePeer(null);
      setActiveCallId(null);
      setCallStatus("idle");
      setLiveStatus("idle");
      setCurrentLiveId(null);
      setConnectionTest("idle");
      currentCallIdRef.current = null;
      historyRef.current = null;
      return () => { disposed = true; };
    }

    const expectedUserId = user.id;

    const connect = () => {
      if (!isCurrent()) return;
      const ws = new WebSocket(BASE_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isCurrent(ws)) { ws.close(); return; }
        ws.send(JSON.stringify({ type: "register", userId: user.id, username: user.username }));
        pingRef.current = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
      };

      ws.onmessage = async (e) => {
        if (!isCurrent(ws)) return;
        let msg: any;
        try { msg = JSON.parse(e.data as string); } catch { return; }

        if (msg.type === "registered") {
          // The server derives this value from the session. A mismatch means
          // this socket was opened during an account transition; never relay
          // any of its private events into the current React identity.
          if (msg.userId !== expectedUserId) {
            ws.close(4002, "Identity changed");
            return;
          }
          setConnected(true);
          window.dispatchEvent(new Event("gdna:realtime-connected"));
        }
        if (msg.type === "session-ended") {
          ws.close(4001, "Session ended");
          return;
        }
        if (msg.type === "online-list")   { setOnlineUsers(msg.users); }
        if (msg.type === "pong")          { /* alive */ }
        // Forward notification events to any listeners via CustomEvent so
        // NotificationBell can react without opening a second WS connection.
        if (msg.type === "notification")  {
          window.dispatchEvent(new CustomEvent("gdna:notification", { detail: msg.notification }));
        }
        // Messenger instances consume this event rather than opening a second
        // WebSocket. The message was already filtered to room members by the API.
        if (msg.type === "chat-message") {
          window.dispatchEvent(new CustomEvent("gdna:chat-message", { detail: msg }));
        }

        // ── Incoming call ──────────────────────────────────────────────────
        if (msg.type === "call-incoming") {
          // Ignore if already in / being offered another call
          if (!currentCallIdRef.current) {
            currentCallIdRef.current = msg.callId;
            setIncomingCall({ from: msg.from, callId: msg.callId, video: msg.video, e2e: msg.e2e });
            setCallStatus("ringing");
          }
        }

        // ── Call accepted (caller side) — callee joined the Agora channel ──
        if (msg.type === "call-accepted" && msg.callId === currentCallIdRef.current) {
          clearRingTimer();
          setCallStatus("active");
        }

        // ── Call rejected / ended — only for OUR current call ──────────────
        if ((msg.type === "call-rejected" || msg.type === "call-ended")
            && msg.callId === currentCallIdRef.current) {
          clearRingTimer();
          currentCallIdRef.current = null;
          // Callee side: caller gave up while we were ringing — hide the banner.
          setIncomingCall(null);
          setCallStatus("ended");
          void leaveAgora();
          setTimeout(() => {
            if (!isCurrent(ws)) return;
            setCallStatus("idle"); setActivePeer(null); setActiveCallId(null);
          }, 2000);
        }

        if (msg.type === "call-busy" || msg.type === "call-unavailable" || msg.type === "call-blocked") {
          clearRingTimer();
          currentCallIdRef.current = null;
          // Callee side safety: if a block denial races an incoming banner, clear it.
          setIncomingCall(null);
          showCallError(
            msg.type === "call-busy"
              ? "📞 المواطن في مكالمة أخرى حالياً — حاول لاحقاً"
              : msg.type === "call-blocked"
                ? "🚫 لا يمكن إجراء هذه المكالمة — التواصل بينكما محجوب"
                : "📴 المواطن غير متصل بالإمبراطورية حالياً — راسله وسيصله إشعار");
          void leaveAgora();
          setCallStatus("ended");
          setTimeout(() => {
            if (!isCurrent(ws)) return;
            setCallStatus("idle"); setActivePeer(null); setActiveCallId(null);
          }, 1500);
        }

        // ── Live events (live stories keep the WebRTC path) ────────────────
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
          if (!isCurrent(ws) || !pcRef.current) return;
          await pcRef.current.setLocalDescription(offer);
          if (!isCurrent(ws)) return;
          sendWS({ type: "live-offer", to: msg.viewer, offer, liveId: msg.liveId });
        }
        if (msg.type === "live-offer") {
          const pc = createLivePC(msg.from, msg.liveId);
          localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
          await pc.setRemoteDescription(msg.offer);
          if (!isCurrent(ws) || pcRef.current !== pc) { pc.close(); return; }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (!isCurrent(ws) || pcRef.current !== pc) { pc.close(); return; }
          sendWS({ type: "live-answer", to: msg.from, answer, liveId: msg.liveId });
        }
        if (msg.type === "live-answer" && pcRef.current) {
          const pc = pcRef.current;
          await pc.setRemoteDescription(msg.answer);
          if (!isCurrent(ws) && pcRef.current === pc) pc.close();
        }
        if (msg.type === "live-ice" && pcRef.current) {
          try { await pcRef.current.addIceCandidate(msg.candidate); } catch { /* stale */ }
        }
      };

      ws.onclose = () => {
        if (!isCurrent(ws)) return;
        wsRef.current = null;
        setConnected(false);
        window.dispatchEvent(new Event("gdna:realtime-disconnected"));
        if (pingRef.current) clearInterval(pingRef.current);
        // Reconnect after 3s
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      if (pingRef.current) clearInterval(pingRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      pingRef.current = null;
      reconnectRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      clearRingTimer();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      try { pcRef.current?.close(); } catch { /* already closed */ }
      pcRef.current = null;
      if (preflightClientRef.current) {
        void preflightClientRef.current.leave().catch(() => {});
        preflightClientRef.current = null;
      }
      void leaveAgora();
      currentCallIdRef.current = null;
      historyRef.current = null;
      setConnected(false);
      setOnlineUsers([]);
      setActiveLives([]);
      setIncomingCall(null);
      setActivePeer(null);
      setActiveCallId(null);
      setCallStatus("idle");
      setLiveStatus("idle");
      setCurrentLiveId(null);
      setConnectionTest("idle");
      setCallError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.username, leaveAgora]);

  // A route change or logout must not leave a microphone/camera LED on.
  useEffect(() => () => {
    clearRingTimer();
    void leaveAgora();
  }, [leaveAgora]);

  // ── Live-story peer connection (WebRTC, unchanged path) ───────────────────
  const createLivePC = (peerUsername: string, liveId: string) => {
    const pc = new RTCPeerConnection({ iceServers: LIVE_ICE_SERVERS });
    pcRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) sendWS({ type: "live-ice", to: peerUsername, candidate: e.candidate, liveId });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    return pc;
  };

  // ── Start a call ──────────────────────────────────────────────────────────
  const startCall = useCallback(async (targetUsername: string, withVideo = true) => {
    if (callStatus !== "idle") {
      showCallError("مكالمة أخرى جارية بالفعل — أنهِها أولاً");
      return;
    }
    if (!user) {
      showCallError("يجب تسجيل الدخول أولاً");
      return;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      showCallError("الاتصال بالشبكة منقطع — انتظر ثوانٍ وأعد المحاولة");
      return;
    }
    const callId = `call_${crypto.randomUUID().replace(/-/g, "")}`;
    let offered = false;
    try {
      // Stop a voice-note capture in any mounted Messenger before preflighting
      // the microphone. This event keeps the shared call engine independent
      // from individual Messenger variants.
      window.dispatchEvent(new Event("gdna:voice-note-stop"));
      await validateMicrophone();

      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
       let recipients: E2ERecipientKey[] | null = null;
       for (let attempt = 0; attempt < 3 && !recipients; attempt++) {
        const keyResponse = await fetch(
          `${base}/api/messages/e2e/users/${encodeURIComponent(targetUsername)}/key`,
          { credentials: "include" },
        );
        if (keyResponse.ok) {
           const keyData = await keyResponse.json() as { keys?: E2ERecipientKey[] };
           recipients = keyData.keys?.length ? keyData.keys : null;
          break;
        }
        if (keyResponse.status !== 409 || attempt === 2) {
          const body = await keyResponse.json().catch(() => ({} as { error?: string }));
          throw new Error(body.error ?? "Secure call key unavailable");
        }
        await new Promise(resolve => setTimeout(resolve, 350));
      }
       if (!recipients) throw new Error("Secure call key unavailable");
      const callSecret = randomSecret();
       const wrappedDevices = await Promise.all(recipients.map(async recipient => [
         recipient.deviceId,
         await encryptCallSecret(callSecret, recipient),
       ] as const));
       const e2e = { devices: Object.fromEntries(wrappedDevices) };

      // The device is usable. Register the server-side call before requesting
      // its channel-scoped Agora token.
      sendWS({
        type: "call-offer",
        to: targetUsername,
        offer: null,
        callId,
        from: user.username,
        video: withVideo,
        e2e,
      });
      offered = true;

      currentCallIdRef.current = callId;
      setActivePeer(targetUsername);
      setActiveCallId(callId);
      setActiveVideo(withVideo);
      historyRef.current = { peer: targetUsername, video: withVideo, start: Date.now(), outgoing: true, answered: false };
      setCallStatus("calling");

      await joinAgora(callId, withVideo, callSecret);

      // Give up automatically if the callee never answers.
      clearRingTimer();
      ringTimerRef.current = setTimeout(() => {
        ringTimerRef.current = null;
        sendWS({ type: "call-end", to: targetUsername, callId });
        currentCallIdRef.current = null;
        void leaveAgora();
        showCallError("📵 لم يتم الرد — حاول مرة أخرى لاحقاً");
        setCallStatus("ended");
        setTimeout(() => { setCallStatus("idle"); setActivePeer(null); setActiveCallId(null); }, 1500);
      }, RING_TIMEOUT_MS);
    } catch (err: unknown) {
      console.error("[CALL] Failed to start:", err);
      clearRingTimer();
      // Only a callee who actually received an offer needs an end signal.
      if (offered) sendWS({ type: "call-end", to: targetUsername, callId });
      currentCallIdRef.current = null;
      setActivePeer(null);
      setActiveCallId(null);
      void leaveAgora();
      const message = err instanceof Error ? err.message : "";
      showCallError(message.includes("secure") || message.includes("Secure") || message.includes("E2E")
        ? `🔐 ${message}`
        : mediaFailureMessage(err));
      setCallStatus("idle");
    }
  }, [callStatus, joinAgora, leaveAgora, sendWS, user]);

  // ── Answer an incoming call ────────────────────────────────────────────────
  const answerCall = useCallback(async (withVideo = true) => {
    if (!incomingCall) return;
    try {
      // A failed local microphone check is rejected immediately so the caller
      // is never left ringing while we attempt to join Agora.
      window.dispatchEvent(new Event("gdna:voice-note-stop"));
      await validateMicrophone();
      if (!user || !incomingCall.e2e) {
        throw new Error("Secure call handshake is unavailable");
      }
      const identity = await ensureDeviceIdentity(user.id);
      const envelope = incomingCall.e2e.devices?.[identity.deviceId];
      if (!envelope) throw new Error("Secure call was not addressed to this device");
      const callSecret = await decryptCallSecret(user.id, envelope);
      await joinAgora(incomingCall.callId, withVideo && incomingCall.video, callSecret);

      setActivePeer(incomingCall.from);
      setActiveCallId(incomingCall.callId);
      setActiveVideo(withVideo && incomingCall.video);
      setIncomingCall(null);
      setCallStatus("active");

      sendWS({ type: "call-answer", to: incomingCall.from, answer: null, callId: incomingCall.callId });
    } catch (err: unknown) {
      console.error("[CALL] Failed to answer:", err);
      // Tell the caller the answer failed so they don't ring forever.
      sendWS({ type: "call-reject", to: incomingCall.from, callId: incomingCall.callId });
      currentCallIdRef.current = null;
      void leaveAgora();
      setIncomingCall(null);
      setCallStatus("idle");
      const message = err instanceof Error ? err.message : "";
      showCallError(message.includes("secure") || message.includes("Secure") || message.includes("E2E")
        ? `🔐 ${message}`
        : mediaFailureMessage(err));
    }
  }, [incomingCall, joinAgora, leaveAgora, sendWS, user]);

  // ── Reject call ───────────────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    sendWS({ type: "call-reject", to: incomingCall.from, callId: incomingCall.callId });
    currentCallIdRef.current = null;
    setIncomingCall(null);
    setCallStatus("idle");
  }, [incomingCall, sendWS]);

  // ── End active call ───────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    clearRingTimer();
    if (activePeer && activeCallId) sendWS({ type: "call-end", to: activePeer, callId: activeCallId });
    currentCallIdRef.current = null;
    void leaveAgora();
    pcRef.current?.close();
    setCallStatus("idle");
    setActivePeer(null);
    setActiveCallId(null);
  }, [activePeer, activeCallId, leaveAgora, sendWS]);

  // ── Screen share (Agora) ──────────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    const client = agoraRef.current;
    if (!client) return;
    try {
      const screen = await AgoraRTC.createScreenVideoTrack({}, "disable");
      screenTrackRef.current = screen;
      if (localVideoRef.current) await client.unpublish(localVideoRef.current);
      await client.publish(screen);
      setScreenSharing(true);
      screen.on("track-ended", () => { void stopScreenShare(); });
    } catch { /* user cancelled */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScreenShare = useCallback(async () => {
    const client = agoraRef.current;
    const screen = screenTrackRef.current;
    screenTrackRef.current = null;
    if (client && screen) {
      try { await client.unpublish(screen); } catch { /* already gone */ }
    }
    screen?.close();
    if (client && localVideoRef.current) {
      try { await client.publish(localVideoRef.current); } catch { /* channel closed */ }
    }
    setScreenSharing(false);
  }, []);

  // ── Start live story (WebRTC path, unchanged) ─────────────────────────────
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
    localStreamRef.current = null;
    setLocalStream(null);
    setLiveStatus("idle");
    setCurrentLiveId(null);
  }, [sendWS]);

  // ── Join a live ───────────────────────────────────────────────────────────
  const joinLive = useCallback(async (liveId: string) => {
    const pc = createLivePC("", liveId);
    pcRef.current = pc;
    sendWS({ type: "live-join", liveId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendWS]);

  // ── Log outgoing calls to history exactly once, with the real call type ────
  useEffect(() => {
    if (!user) return;
    // A call only counts as answered if it actually transitioned to "active" —
    // ring time is NOT evidence of an answer (rejected/unavailable calls ring too).
    if (callStatus === "active" && historyRef.current) {
      historyRef.current.answered = true;
      historyRef.current.start = Date.now(); // duration = talk time, not ring time
    }
    if ((callStatus === "idle" || callStatus === "ended") && historyRef.current) {
      const { peer, video, start, outgoing, answered } = historyRef.current;
      historyRef.current = null;
      if (!outgoing || !peer) return; // only the caller logs, avoids duplicates
      const durationSec = answered ? Math.floor((Date.now() - start) / 1000) : 0;
      const status = answered ? "answered" : "missed";
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      fetch(`${base}/api/social/v2/call-history`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calleeUsername: peer, callType: video ? "video" : "audio", status, durationSec }),
        credentials: "include",
      }).catch(() => {});
    }
  }, [callStatus, user]);

  return {
    connected, callStatus, liveStatus, incomingCall,
    activePeer, activeVideo, onlineUsers, activeLives, currentLiveId,
    localStream, remoteStream, screenSharing,
    callError,
    connectionTest,
    startCall, answerCall, rejectCall, endCall,
    testConnection,
    startLive, endLive, joinLive,
    startScreenShare, stopScreenShare,
  };
}

async function validateMicrophone(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("Microphone capture is unavailable");
    error.name = "NotSupportedError";
    throw error;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach(track => track.stop());
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
