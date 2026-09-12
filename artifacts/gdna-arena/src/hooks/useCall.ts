// ══════════════════════════════════════════════════════════════════════════════
//  useCall — authenticated WebSocket signaling + deferred WebRTC/TURN media.
//  Invitations never request media until the callee accepts.
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
  encryptCallSecret,
  ensureDeviceIdentity,
  type E2ERecipientKey,
} from "@/lib/amis-e2ee";
import { apiPath, websocketUrl } from "@/lib/network";
import { trackCallDeviceOutcome } from "@/lib/analytics";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import {
  readCallNetworkState,
  subscribeCallNetwork,
  type CallNetworkState,
} from "@/lib/call-network";
import {
  fetchCallRtcConfig,
  preferOpus,
  type CallMediaProvider,
  type CallRtcConfig,
} from "@/lib/call-rtc-config";
import { CallRingtone } from "@/lib/call-ringtone";
import { useCallPush } from "@/hooks/use-call-push";
import {
  DEFERRED_WEBRTC_TRANSPORT,
  isDeferredWebRtcTransport,
  loadDeferredConfig,
} from "@/lib/call-deferred";
import {
  canApplyNotificationCallAction,
  readNotificationCallAction,
  readNotificationCallResume,
  showForegroundCallNotification,
  shouldClearTerminalCall,
  type PendingNotificationCallAction,
} from "@/lib/call-notification-action";

// Kept only for an unreachable legacy SDK helper below. Call setup never
// invokes this function; authenticated calls fetch TURN through
// fetchCallRtcConfig and use deferred WebRTC.
async function fetchAgoraToken(_channel: string): Promise<{ appId: string; token: string; uid: number }> {
  throw new Error("Native call transport is unavailable; use WebRTC/TURN");
}

export type CallStatus = "idle" | "calling" | "ringing" | "active" | "ended";
export type CallPhase = "idle" | "ringing" | "accepted" | "connecting" | "connected" | "ended";
export type LiveStatus  = "idle" | "live" | "ended";
export type ConnectionTestStatus = "idle" | "testing" | "ready" | "unstable" | "failed";
export type CallNetworkQuality = "unknown" | "good" | "weak" | "poor";
export type CallDeviceKind = "audioinput" | "videoinput" | "audiooutput";

export interface CallDevice {
  deviceId: string;
  kind: CallDeviceKind;
  label: string;
}

export interface CallDeviceIssue {
  kind: CallDeviceKind;
  message: string;
  disconnected?: boolean;
}

interface IncomingCall {
  from:   string;
  callId: string;
  video:  boolean;
  offer?: RTCSessionDescriptionInit | null;
  transport?: { provider: CallMediaProvider; version: number };
  e2e?: {
    devices: Record<string, {
      wrappedSecret: string;
      fingerprint: string;
    }>;
  };
  callerId?: number;
  callerName?: string;
  callerAvatar?: string;
  expiresAt?: number;
  deferredMedia?: boolean;
}

interface LiveStream {
  liveId: string;
  host:   string;
  title:  string;
  domain: string;
}

// Live stories use the same browser WebRTC primitives, independently of calls.
const LIVE_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function mediaFailureMessage(err: unknown, device: "microphone" | "camera" = "microphone"): string {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  const icon = device === "camera" ? "📹" : "🎤";
  const label = device === "camera" ? "الكاميرا" : "الميكروفون";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || code === "PERMISSION_DENIED") {
    return `${icon} تم رفض إذن ${label} — افتح إعدادات الموقع في المتصفح، اسمح بالوصول، ثم أعد المحاولة`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || code === "DEVICE_NOT_FOUND") {
    return `${icon} لا توجد ${label} متصلة بالجهاز`;
  }
  if (name === "NotReadableError" || name === "AbortError" || code === "DEVICE_BUSY" || code === "DEVICE_IN_USE") {
    return `${icon} ${label} مستخدمة من تطبيق آخر — أغلقه ثم أعد المحاولة`;
  }
  if (name === "NotSupportedError") {
    return `${icon} هذا المتصفح لا يدعم الوصول إلى ${label}`;
  }
  return `${icon} تعذّر الوصول إلى ${label} — تأكد من الإذن والجهاز ثم أعد المحاولة`;
}

function isRecoverableMediaError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return [
    "NotAllowedError",
    "PermissionDeniedError",
    "NotFoundError",
    "DevicesNotFoundError",
    "NotReadableError",
    "AbortError",
    "NotSupportedError",
  ].includes(name) || ["PERMISSION_DENIED", "DEVICE_NOT_FOUND", "DEVICE_BUSY", "DEVICE_IN_USE"].includes(code);
}

export function useCall(user: { id: number; username: string } | null) {
  const { isOnline, setRealtimeConnecting, setRealtimeConnected } = useConnectivity();
  const screenShareSupported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const wsRef   = useRef<WebSocket | null>(null);
  const pcRef   = useRef<RTCPeerConnection | null>(null); // live stories only
  const callPcRef = useRef<RTCPeerConnection | null>(null);
  const callProviderRef = useRef<CallMediaProvider>("webrtc");
  const callRtcConfigRef = useRef<CallRtcConfig | null>(null);
  const remoteCallStreamRef = useRef<MediaStream | null>(null);
  const webRtcScreenTrackRef = useRef<MediaStreamTrack | null>(null);
  const webRtcCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const iceRestartAttemptedRef = useRef(false);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webRtcStatsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousPacketStatsRef = useRef(new Map<number, { received: number; lost: number }>());
  const pendingCallIceRef = useRef<RTCIceCandidate[]>([]);
  const callSignalingReadyRef = useRef(new Set<string>());
  const pendingRemoteIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const wasConnectedRef = useRef(false);
  const identityGenerationRef = useRef(0);
  const preflightClientRef = useRef<IAgoraRTCClient | null>(null);
  const mediaConnectedRef = useRef(false);
  const mediaHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedVideoRef = useRef(false);
  const callDirectionRef = useRef<"outgoing" | "incoming" | null>(null);
  const ringtoneRef = useRef<CallRingtone | null>(null);
  const callVideoRef = useRef(true);
  const mediaSetupCallRef = useRef<string | null>(null);
  // Invalidates every in-flight async media setup on cancel/end/account switch.
  const callGenerationRef = useRef(0);
  const terminalCallRef = useRef<(callId: string, status: string) => void>(() => {});
  const pendingNotificationActionRef = useRef<PendingNotificationCallAction | null>(null);
  const seenNotificationActionRef = useRef<string | null>(null);
  const seenNotificationResumeRef = useRef<string | null>(null);
  const registeredSocketRef = useRef(false);
  const pendingCallResumesRef = useRef(new Map<string, { userId: number; until: number }>());

  // Legacy SDK refs are kept isolated from the call state machine. Calls
  // themselves always select the WebRTC/TURN provider below.
  const agoraRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoRef = useRef<ICameraVideoTrack | null>(null);
  const screenTrackRef = useRef<ILocalVideoTrack | null>(null);
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const remoteVideoRef = useRef<IRemoteVideoTrack | null>(null);

  const [connected,    setConnected]    = useState(false);
  const [callStatus,   setCallStatus]   = useState<CallStatus>("idle");
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [liveStatus,   setLiveStatus]   = useState<LiveStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activePeer,   setActivePeer]   = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  // Mirror of the call the user is currently in or being offered — WS handlers
  // use this ref to IGNORE call events whose callId does not belong to us.
  const currentCallIdRef = useRef<string | null>(null);
  const callSetupWaitersRef = useRef(new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>());
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
  const [callDevices, setCallDevices] = useState<CallDevice[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("");
  const [cameraZoom, setCameraZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  const [deviceIssue, setDeviceIssue] = useState<CallDeviceIssue | null>(null);
  const [switchingDevice, setSwitchingDevice] = useState<CallDeviceKind | null>(null);
  const disconnectedDeviceKindRef = useRef<CallDeviceKind | null>(null);
  const speakerSelectionSupported =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  // ── Error feedback ─────────────────────────────────────────────────────────
  const [callError,    setCallError]    = useState<string | null>(null);
  const [connectionTest, setConnectionTest] = useState<ConnectionTestStatus>("idle");
  const [networkQuality, setNetworkQuality] = useState<CallNetworkQuality>("unknown");
  const [networkState, setNetworkState] = useState<CallNetworkState>(() =>
    readCallNetworkState(navigator));
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCallError = (msg: string, durationMs = 5_000) => {
    setCallError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setCallError(null), durationMs);
  };

  const refreshCallDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device): device is MediaDeviceInfo & { kind: CallDeviceKind } =>
          device.kind === "audioinput" || device.kind === "videoinput" || device.kind === "audiooutput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          kind: device.kind,
          label: device.label || `${device.kind === "audioinput" ? "Microphone" : device.kind === "videoinput" ? "Camera" : "Speaker"} ${index + 1}`,
        }));
      setCallDevices(devices);
      return devices;
    } catch {
      setDeviceIssue({
        kind: "audioinput",
        message: "تعذّر قراءة أجهزة المكالمة. تحقق من أذونات المتصفح ثم حاول التحديث.",
      });
      return [];
    }
  }, []);

  const refreshCameraZoom = useCallback((track?: MediaStreamTrack | null) => {
    if (!track || typeof track.getCapabilities !== "function") {
      setCameraZoom(null);
      return;
    }
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number; step?: number };
    };
    const zoom = capabilities.zoom;
    if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number" || zoom.max <= zoom.min) {
      setCameraZoom(null);
      return;
    }
    const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
    setCameraZoom({
      min: zoom.min,
      max: zoom.max,
      step: zoom.step && zoom.step > 0 ? zoom.step : 0.1,
      value: typeof settings.zoom === "number" ? settings.zoom : zoom.min,
    });
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      void refreshCallDevices().then((devices) => {
        if (!devices || callStatus === "idle") return;
        const selected = [
          { kind: "audioinput" as const, id: selectedMicrophoneId, label: "الميكروفون" },
          { kind: "videoinput" as const, id: selectedCameraId, label: "الكاميرا" },
          { kind: "audiooutput" as const, id: selectedSpeakerId, label: "مكبر الصوت" },
        ].find((item) => item.id && !devices.some((device) => device.kind === item.kind && device.deviceId === item.id));
        if (selected) {
          disconnectedDeviceKindRef.current = selected.kind;
          setDeviceIssue({
            kind: selected.kind,
            message: `تم فصل ${selected.label}. اختر جهازاً متاحاً للمتابعة دون إنهاء المكالمة.`,
            disconnected: true,
          });
        }
      }).catch(() => {});
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [callStatus, refreshCallDevices, selectedCameraId, selectedMicrophoneId, selectedSpeakerId]);

  // ── Ring timeout: client safety net (the server owns authoritative state) ──
  const RING_TIMEOUT_MS = 30_000;
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRingTimer = () => {
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
  };

  const sendWS = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const flushCallResumes = useCallback(() => {
    const now = Date.now();
    for (const [callId, pending] of pendingCallResumesRef.current) {
      if (pending.userId !== user?.id || pending.until <= now) {
        pendingCallResumesRef.current.delete(callId);
      } else if (registeredSocketRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        sendWS({ type: "call-resume", callId });
      }
    }
  }, [sendWS, user?.id]);

  // Firestore can deliver before the authenticated socket finishes registering,
  // or just before the server finishes inserting its live call record. Retry
  // briefly rather than dropping the only snapshot that announces a call.
  useEffect(() => {
    const timer = setInterval(flushCallResumes, 2_000);
    return () => {
      clearInterval(timer);
      pendingCallResumesRef.current.clear();
      registeredSocketRef.current = false;
    };
  }, [flushCallResumes]);

  // Firestore is a wake-up mechanism only. The websocket asks the API for the
  // authenticated envelope before rendering or answering an invitation.
  const callPush = useCallPush(
    user,
    callId => {
      if (!user || pendingCallResumesRef.current.size >= 100) return;
      if (!pendingCallResumesRef.current.has(callId)) {
        pendingCallResumesRef.current.set(callId, { userId: user.id, until: Date.now() + 30_000 });
      }
      flushCallResumes();
    },
    (callId, status) => terminalCallRef.current(callId, status),
  );

  const enableCallSound = useCallback(async () => {
    ringtoneRef.current ??= new CallRingtone();
    const enabled = await ringtoneRef.current.enable();
    setSoundBlocked(!enabled);
    if (enabled) {
      const kind = callStatus === "ringing"
        ? "incoming"
        : callStatus === "calling" && callDirectionRef.current === "outgoing" && callPhase === "ringing"
          ? "ringback"
          : null;
      if (kind) ringtoneRef.current.start(kind);
    }
    return enabled;
  }, [callPhase, callStatus]);

  useEffect(() => {
    const ringing = callStatus === "ringing"
      ? "incoming"
      : callStatus === "calling" && callDirectionRef.current === "outgoing" && callPhase === "ringing"
        ? "ringback"
        : null;
    if (!ringing) {
      ringtoneRef.current?.stop();
      return;
    }
    const started = ringtoneRef.current?.start(ringing) ?? false;
    if (!started) setSoundBlocked(true);
    if (ringing === "incoming" && typeof navigator.vibrate === "function") navigator.vibrate([100, 60, 100]);
    return () => ringtoneRef.current?.stop();
  }, [callPhase, callStatus]);

  useEffect(() => {
    if (!user) {
      void ringtoneRef.current?.close();
      return;
    }
    return () => { void ringtoneRef.current?.close(); };
  }, [user?.id]);

  const setActualMediaConnected = useCallback((next: boolean) => {
    mediaConnectedRef.current = next;
    if (mediaHeartbeatRef.current) {
      clearInterval(mediaHeartbeatRef.current);
      mediaHeartbeatRef.current = null;
    }
    const sendState = () => {
      const callId = currentCallIdRef.current;
      if (callId) sendWS({ type: "call-media-state", callId, connected: mediaConnectedRef.current });
    };
    // A false transition must be observable before call state is cleared.
    if (!next) {
      sendState();
      return;
    }
    setCallPhase("connected");
    // Billing and the active UI state begin only after a peer connection has
    // both connected and delivered remote media, never on "Answer".
    setCallStatus("active");
    sendState();
    mediaHeartbeatRef.current = setInterval(sendState, 5_000);
  }, [sendWS]);

  useEffect(() => subscribeCallNetwork(navigator, window, setNetworkState), []);

  const waitForCallReady = useCallback((callId: string) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      callSetupWaitersRef.current.delete(callId);
      reject(new Error("تعذّر تأكيد المكالمة الآمنة من الخادم"));
    }, 10_000);
    callSetupWaitersRef.current.set(callId, { resolve, reject, timeout });
  }), []);

  const settleCallReady = useCallback((callId: string, error?: Error) => {
    const waiter = callSetupWaitersRef.current.get(callId);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    callSetupWaitersRef.current.delete(callId);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }, []);

  const rejectPendingCallSetups = useCallback((message: string) => {
    for (const [callId, waiter] of callSetupWaitersRef.current) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(message));
      callSetupWaitersRef.current.delete(callId);
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
        await fetch(apiPath("/api/messages/e2e/key"), {
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

  // ── Pre-call TURN configuration test ─────────────────────────────────────
  // Fetch and validate the authenticated relay configuration without opening
  // a media client or requesting microphone/camera permission.
  const testConnection = useCallback(async () => {
    if (connectionTest === "testing") return;
    if (!isOnline) {
      setConnectionTest("failed");
      return;
    }
    if (!user) {
      setConnectionTest("failed");
      return;
    }

    setConnectionTest("testing");
    try {
      const config = await fetchCallRtcConfig();
      setConnectionTest(config.turnConfigured ? "ready" : "failed");
    } catch (error) {
      console.warn("[CALL] TURN preflight failed:", error);
      setConnectionTest("failed");
    }
  }, [connectionTest, isOnline, user]);

  // Legacy SDK helpers below are unreachable; calls use createWebRtcCall.
  const rebuildRemoteStream = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (remoteAudioRef.current) tracks.push(remoteAudioRef.current.getMediaStreamTrack());
    if (remoteVideoRef.current) tracks.push(remoteVideoRef.current.getMediaStreamTrack());
    setRemoteStream(tracks.length > 0 ? new MediaStream(tracks) : null);
  }, []);

  // Legacy provider helper retained only for source compatibility. It is not
  // referenced by any call path; all invitations use deferred WebRTC/TURN.
  const joinAgora = useCallback(async (
    channel: string,
    withVideo: boolean,
    encryptionSecret: string,
    preparedAudioTrack?: IMicrophoneAudioTrack,
  ) => {
    // Resolve and validate runtime server configuration before any legacy
    // provider could create or join a channel.
    const { appId, token, uid } = await fetchAgoraToken(channel);
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

    const subscribedPeers = new Set<string>();
    const refreshAgoraConnectivity = () => {
      if (agoraRef.current !== client) return;
      // Muting or switching off a camera is not a network disconnect. Require
      // an established subscription and the peer still present on the transport.
      setActualMediaConnected(
        client.connectionState === "CONNECTED" &&
        client.remoteUsers.some(peer => subscribedPeers.has(String(peer.uid))),
      );
    };
    client.on("user-published", async (remoteUser, mediaType) => {
      if (agoraRef.current !== client) return; // stale client
      await client.subscribe(remoteUser, mediaType);
      if (agoraRef.current !== client) return;
      subscribedPeers.add(String(remoteUser.uid));
      if (mediaType === "audio") remoteAudioRef.current = remoteUser.audioTrack ?? null;
      if (mediaType === "video") remoteVideoRef.current = remoteUser.videoTrack ?? null;
      rebuildRemoteStream();
      setCallStatus("active");
      refreshAgoraConnectivity();
    });

    client.on("user-unpublished", (_remoteUser, mediaType) => {
      if (agoraRef.current !== client) return;
      if (mediaType === "audio") remoteAudioRef.current = null;
      if (mediaType === "video") remoteVideoRef.current = null;
      rebuildRemoteStream();
      refreshAgoraConnectivity();
    });

    client.on("user-left", remoteUser => {
      subscribedPeers.delete(String(remoteUser.uid));
      refreshAgoraConnectivity();
    });

    client.on("connection-state-change", state => {
      if (agoraRef.current !== client) return;
      if (state === "DISCONNECTED" || state === "DISCONNECTING" || state === "RECONNECTING") {
        setActualMediaConnected(false);
      } else if (state === "CONNECTED") {
        refreshAgoraConnectivity();
      }
    });

    client.on("network-quality", quality => {
      if (agoraRef.current !== client) return;
      const worst = Math.max(quality.uplinkNetworkQuality, quality.downlinkNetworkQuality);
      setNetworkQuality(worst >= 5 ? "poor" : worst >= 3 ? "weak" : worst > 0 ? "good" : "unknown");
      const video = localVideoRef.current;
      if (video && worst >= 4 && !reducedVideoRef.current) {
        reducedVideoRef.current = true;
        void video.setEncoderConfiguration("360p_1").catch(() => {});
      } else if (video && worst > 0 && worst <= 2 && reducedVideoRef.current) {
        reducedVideoRef.current = false;
        void video.setEncoderConfiguration("720p_1").catch(() => {});
      }
    });

    await client.join(appId, channel, token, uid);

    // Reuse the track that triggered the citizen's single permission prompt.
    // Opening, closing, then reopening the microphone is unreliable on mobile.
    const audioTrack = preparedAudioTrack ?? await AgoraRTC.createMicrophoneAudioTrack();
    localAudioRef.current = audioTrack;
    let videoTrack: ICameraVideoTrack | null = null;
    let cameraWarning: string | null = null;
    if (withVideo) {
      try {
        videoTrack = await AgoraRTC.createCameraVideoTrack();
        localVideoRef.current = videoTrack;
      } catch (error) {
        // Keep the call usable as audio-only, but never hide a denied, missing,
        // or busy camera from the citizen.
        cameraWarning = `${mediaFailureMessage(error, "camera")} — ستستمر المكالمة صوتياً`;
      }
    }

    await client.publish(videoTrack ? [audioTrack, videoTrack] : [audioTrack]);

    const ms = new MediaStream([
      audioTrack.getMediaStreamTrack(),
      ...(videoTrack ? [videoTrack.getMediaStreamTrack()] : []),
    ]);
    localStreamRef.current = ms;
    setLocalStream(ms);
    setSelectedMicrophoneId(audioTrack.getMediaStreamTrack().getSettings().deviceId ?? "");
    setSelectedCameraId(videoTrack?.getMediaStreamTrack().getSettings().deviceId ?? "");
    refreshCameraZoom(videoTrack?.getMediaStreamTrack());
    setDeviceIssue(null);
    disconnectedDeviceKindRef.current = null;
    void refreshCallDevices();
    // Slow device setup must not consume the warning before the overlay renders.
    if (cameraWarning) showCallError(cameraWarning, 15_000);
  }, [rebuildRemoteStream, refreshCallDevices, refreshCameraZoom, setActualMediaConnected]);

  const createWebRtcCall = useCallback(async (
    config: CallRtcConfig,
    peer: string,
    callId: string,
    withVideo: boolean,
    canInitiateRestart: boolean,
    isCurrentCall: () => boolean = () => true,
  ): Promise<{ pc: RTCPeerConnection; stream: MediaStream }> => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Secure browser media is unavailable");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
        : false,
    });
    if (!isCurrentCall()) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error("CALL_SETUP_CANCELLED");
    }
    if (config.provider !== "webrtc") throw new Error("WebRTC TURN calling is unavailable");
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: "relay" });
    if (!isCurrentCall()) {
      pc.close();
      stream.getTracks().forEach(track => track.stop());
      throw new Error("CALL_SETUP_CANCELLED");
    }
    callPcRef.current = pc;
    callProviderRef.current = "webrtc";
    callRtcConfigRef.current = config;
    iceRestartAttemptedRef.current = false;
    previousPacketStatsRef.current.clear();
    pendingCallIceRef.current = [];

    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    if (!stream.getVideoTracks().length) {
      pc.addTransceiver("video", { direction: "sendrecv" });
    }
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.receiver.track.kind === "audio") preferOpus(transceiver);
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setSelectedMicrophoneId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? "");
    setSelectedCameraId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
    refreshCameraZoom(stream.getVideoTracks()[0]);
    void refreshCallDevices();

    pc.ontrack = event => {
      const next = event.streams[0] ?? new MediaStream([event.track]);
      remoteCallStreamRef.current = next;
      setRemoteStream(next);
      event.track.addEventListener("ended", () => setActualMediaConnected(false), { once: true });
      queueMicrotask(() => {
        const hasRemoteMedia = next.getTracks().some(track => track.readyState === "live");
        setActualMediaConnected(pc.connectionState === "connected" && hasRemoteMedia);
      });
    };
    pc.onicecandidate = event => {
      if (event.candidate) {
        if (callSignalingReadyRef.current.has(callId)) {
          sendWS({ type: "ice-candidate", to: peer, callId, candidate: event.candidate });
        } else {
          pendingCallIceRef.current.push(event.candidate);
        }
      }
    };
    pc.onconnectionstatechange = () => {
      const hasRemoteMedia = !!remoteCallStreamRef.current?.getTracks()
        .some(track => track.readyState === "live");
      if (pc.connectionState === "connected") {
        if (hasRemoteMedia) setActualMediaConnected(true);
        if (iceRestartTimerRef.current) clearTimeout(iceRestartTimerRef.current);
        return;
      }
      setActualMediaConnected(false);
      if (pc.connectionState !== "failed" && pc.connectionState !== "disconnected") return;
      // Only the original caller creates a restart offer, avoiding glare when
      // both peers observe the same network transition simultaneously.
      if (!canInitiateRestart) return;
      if (iceRestartAttemptedRef.current) {
        showCallError("فشل اتصال TURN المرحّل — أنهِ المكالمة وتحقق من الشبكة أو خادم TURN", 15_000);
        return;
      }
      iceRestartAttemptedRef.current = true;
      try {
        pc.setConfiguration({ iceServers: config.iceServers, iceTransportPolicy: "relay" });
        pc.restartIce();
        void pc.createOffer({ iceRestart: true }).then(async offer => {
          if (callPcRef.current !== pc) return;
          await pc.setLocalDescription(offer);
          sendWS({
            type: "call-renegotiate-offer",
            callId,
            offer: pc.localDescription,
            transport: { provider: "webrtc", version: 1 },
          });
          iceRestartTimerRef.current = setTimeout(() => {
            if (callPcRef.current === pc && pc.connectionState !== "connected") {
              setActualMediaConnected(false);
              showCallError("تعذّر إنشاء مسار TURN مرحّل للمكالمة", 15_000);
            }
          }, 8_000);
        }).catch(() => showCallError("تعذّرت إعادة تفاوض اتصال TURN", 15_000));
      } catch {
        showCallError("هذا المتصفح لا يدعم استعادة اتصال TURN", 15_000);
      }
    };

    webRtcStatsTimerRef.current = setInterval(() => {
      void pc.getStats().then(stats => {
        let weak = false;
        stats.forEach(report => {
          if (report.type !== "inbound-rtp" || report.kind !== "video") return;
          const received = Number(report.packetsReceived ?? 0);
          const lost = Number(report.packetsLost ?? 0);
          const previous = previousPacketStatsRef.current.get(report.ssrc);
          previousPacketStatsRef.current.set(report.ssrc, { received, lost });
          if (!previous) return;
          const receivedDelta = received - previous.received;
          const lostDelta = lost - previous.lost;
          weak ||= lostDelta > 0 && lostDelta / Math.max(1, receivedDelta + lostDelta) >= 0.05;
        });
        setNetworkQuality(weak ? "weak" : pc.connectionState === "connected" ? "good" : "poor");
        if (weak) {
          const video = localStreamRef.current?.getVideoTracks()[0];
          void video?.applyConstraints({
            width: { max: 640 },
            height: { max: 360 },
            frameRate: { max: 20 },
          }).catch(() => {});
        }
      }).catch(() => {});
    }, 5_000);

    return { pc, stream };
  }, [refreshCallDevices, refreshCameraZoom, sendWS, setActualMediaConnected]);

  // ── Leave Agora & release all media ────────────────────────────────────────
  const leaveAgora = useCallback(async () => {
    setActualMediaConnected(false);
    if (iceRestartTimerRef.current) clearTimeout(iceRestartTimerRef.current);
    if (webRtcStatsTimerRef.current) clearInterval(webRtcStatsTimerRef.current);
    iceRestartTimerRef.current = null;
    webRtcStatsTimerRef.current = null;
    try { callPcRef.current?.close(); } catch { /* already closed */ }
    callPcRef.current = null;
    webRtcScreenTrackRef.current?.stop();
    webRtcScreenTrackRef.current = null;
    webRtcCameraTrackRef.current?.stop();
    webRtcCameraTrackRef.current = null;
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
    if (callProviderRef.current === "webrtc") {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
    }
    localStreamRef.current = null;
    remoteCallStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setScreenSharing(false);
    setCallDevices([]);
    setSelectedMicrophoneId("");
    setSelectedCameraId("");
    setSelectedSpeakerId("");
    setCameraZoom(null);
    setDeviceIssue(null);
    setSwitchingDevice(null);
    setNetworkQuality("unknown");
    reducedVideoRef.current = false;
    callProviderRef.current = "webrtc";
    callRtcConfigRef.current = null;
    pendingCallIceRef.current = [];
    pendingRemoteIceRef.current = [];
    callSignalingReadyRef.current.clear();
    mediaSetupCallRef.current = null;
    if (client) { try { await client.leave(); } catch { /* already left */ } }
  }, [setActualMediaConnected]);

  // Firebase terminal snapshots are authoritative wake-up/termination signals,
  // but must only clear the exact call they describe. A delayed snapshot for a
  // former invitation may never tear down a newly accepted call on this device.
  terminalCallRef.current = (callId) => {
    pendingCallResumesRef.current.delete(callId);
    if (!shouldClearTerminalCall(currentCallIdRef.current, callId)) return;
    clearRingTimer();
    callGenerationRef.current += 1;
    currentCallIdRef.current = null;
    callDirectionRef.current = null;
    ringtoneRef.current?.stop();
    setActualMediaConnected(false);
    setIncomingCall(null);
    setActivePeer(null);
    setActiveCallId(null);
    setCallPhase("ended");
    setCallStatus("idle");
    void leaveAgora();
  };

  const rebuildLocalCallStream = useCallback(() => {
    const audioTrack = localAudioRef.current?.getMediaStreamTrack();
    const videoTrack = screenTrackRef.current?.getMediaStreamTrack() ?? localVideoRef.current?.getMediaStreamTrack();
    const tracks = [audioTrack, videoTrack].filter((track): track is MediaStreamTrack => Boolean(track));
    const stream = tracks.length ? new MediaStream(tracks) : null;
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    if (callProviderRef.current === "webrtc" && callPcRef.current && callStatus === "active") {
      setSwitchingDevice("audioinput");
      try {
        const replacement = (await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } },
          video: false,
        })).getAudioTracks()[0];
        if (!replacement) throw new Error("Microphone unavailable");
        const sender = callPcRef.current.getSenders().find(item => item.track?.kind === "audio");
        await sender?.replaceTrack(replacement);
        const stream = localStreamRef.current;
        stream?.getAudioTracks().forEach(old => { stream.removeTrack(old); old.stop(); });
        stream?.addTrack(replacement);
        if (stream) setLocalStream(new MediaStream(stream.getTracks()));
        setSelectedMicrophoneId(deviceId);
        setDeviceIssue(null);
        trackCallDeviceOutcome("audioinput", "switch_succeeded");
      } catch (error) {
        setDeviceIssue({ kind: "audioinput", message: `${mediaFailureMessage(error, "microphone")} — اختر ميكروفوناً آخر` });
      } finally {
        setSwitchingDevice(null);
      }
      return;
    }
    const track = localAudioRef.current;
    if (!track || callStatus !== "active") return;
    setSwitchingDevice("audioinput");
    try {
      await track.setDevice(deviceId);
      setSelectedMicrophoneId(deviceId);
      setDeviceIssue(null);
      rebuildLocalCallStream();
      trackCallDeviceOutcome("audioinput", "switch_succeeded");
      if (disconnectedDeviceKindRef.current === "audioinput") {
        trackCallDeviceOutcome("audioinput", "recovery_succeeded");
        disconnectedDeviceKindRef.current = null;
      }
    } catch (error) {
      setDeviceIssue({ kind: "audioinput", message: `${mediaFailureMessage(error, "microphone")} — اختر ميكروفوناً آخر` });
    } finally {
      setSwitchingDevice(null);
    }
  }, [callStatus, rebuildLocalCallStream]);

  const switchCamera = useCallback(async (deviceId: string) => {
    if (callProviderRef.current === "webrtc" && callPcRef.current && callStatus === "active") {
      setSwitchingDevice("videoinput");
      try {
        const replacement = (await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })).getVideoTracks()[0];
        if (!replacement) throw new Error("Camera unavailable");
        const sender = callPcRef.current.getTransceivers()
          .find(item => item.receiver.track.kind === "video")?.sender;
        await sender?.replaceTrack(replacement);
        const stream = localStreamRef.current;
        stream?.getVideoTracks().forEach(old => { stream.removeTrack(old); old.stop(); });
        stream?.addTrack(replacement);
        if (stream) setLocalStream(new MediaStream(stream.getTracks()));
        setSelectedCameraId(deviceId);
        refreshCameraZoom(replacement);
        setDeviceIssue(null);
        trackCallDeviceOutcome("videoinput", "switch_succeeded");
      } catch (error) {
        setDeviceIssue({ kind: "videoinput", message: `${mediaFailureMessage(error, "camera")} — اختر كاميرا أخرى` });
      } finally {
        setSwitchingDevice(null);
      }
      return;
    }
    const track = localVideoRef.current;
    if (!track || callStatus !== "active") return;
    setSwitchingDevice("videoinput");
    try {
      await track.setDevice(deviceId);
      setSelectedCameraId(deviceId);
      setDeviceIssue(null);
      rebuildLocalCallStream();
      refreshCameraZoom(track.getMediaStreamTrack());
      trackCallDeviceOutcome("videoinput", "switch_succeeded");
      if (disconnectedDeviceKindRef.current === "videoinput") {
        trackCallDeviceOutcome("videoinput", "recovery_succeeded");
        disconnectedDeviceKindRef.current = null;
      }
    } catch (error) {
      setDeviceIssue({ kind: "videoinput", message: `${mediaFailureMessage(error, "camera")} — اختر كاميرا أخرى` });
    } finally {
      setSwitchingDevice(null);
    }
  }, [callStatus, rebuildLocalCallStream, refreshCameraZoom]);

  const flipCamera = useCallback(async () => {
    const availableDevices = callDevices.length ? callDevices : await refreshCallDevices() ?? [];
    const cameras = availableDevices.filter(device => device.kind === "videoinput" && device.deviceId);
    if (cameras.length < 2) return;

    const activeTrack = localVideoRef.current?.getMediaStreamTrack()
      ?? localStreamRef.current?.getVideoTracks()[0];
    const currentId = activeTrack?.getSettings().deviceId ?? selectedCameraId;
    const currentIndex = cameras.findIndex(device => device.deviceId === currentId);
    const next = cameras[(currentIndex + 1 + cameras.length) % cameras.length];

    if (callStatus === "active" && (localVideoRef.current || callProviderRef.current === "webrtc")) {
      await switchCamera(next.deviceId);
      return;
    }
    if (liveStatus !== "live") return;

    try {
      const replacementStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: next.deviceId } },
        audio: false,
      });
      const replacement = replacementStream.getVideoTracks()[0];
      if (!replacement) return;
      const sender = pcRef.current?.getSenders().find(item => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(replacement);
      const stream = localStreamRef.current;
      stream?.getVideoTracks().forEach(track => {
        stream.removeTrack(track);
        track.stop();
      });
      stream?.addTrack(replacement);
      if (stream) setLocalStream(new MediaStream(stream.getTracks()));
      setSelectedCameraId(next.deviceId);
      refreshCameraZoom(replacement);
    } catch (error) {
      showCallError(mediaFailureMessage(error, "camera"));
    }
  }, [callDevices, callStatus, liveStatus, refreshCallDevices, refreshCameraZoom, selectedCameraId, switchCamera]);

  const adjustCameraZoom = useCallback(async (direction: "in" | "out") => {
    const track = localVideoRef.current?.getMediaStreamTrack()
      ?? localStreamRef.current?.getVideoTracks()[0];
    if (!track || !cameraZoom) return;
    const next = Math.min(
      cameraZoom.max,
      Math.max(cameraZoom.min, cameraZoom.value + (direction === "in" ? cameraZoom.step : -cameraZoom.step)),
    );
    try {
      await track.applyConstraints({
        advanced: [{ zoom: next } as MediaTrackConstraintSet],
      });
      setCameraZoom(current => current ? { ...current, value: next } : null);
    } catch {
      setCameraZoom(null);
    }
  }, [cameraZoom]);

  const selectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    setDeviceIssue(null);
  }, []);

  const reportSpeakerFailure = useCallback(() => {
    setDeviceIssue({
      kind: "audiooutput",
      message: "تعذّر استخدام مكبر الصوت المحدد. اختر مخرجاً آخر أو غيّره من إعدادات الجهاز.",
    });
  }, []);

  const reportSpeakerSuccess = useCallback(() => {
    setDeviceIssue(null);
    trackCallDeviceOutcome("audiooutput", "switch_succeeded");
    if (disconnectedDeviceKindRef.current === "audiooutput") {
      trackCallDeviceOutcome("audiooutput", "recovery_succeeded");
      disconnectedDeviceKindRef.current = null;
    }
  }, []);

  const reportDeviceRecoveryAttempt = useCallback((kind: CallDeviceKind) => {
    if (disconnectedDeviceKindRef.current !== kind) return;
    trackCallDeviceOutcome(kind, "recovery_attempted");
  }, []);

  const beginCallerWebRtc = useCallback(async (callId: string, peer: string, withVideo: boolean) => {
    if (mediaSetupCallRef.current === callId) return;
    mediaSetupCallRef.current = callId;
    const generation = callGenerationRef.current;
    const isCurrentCall = () => currentCallIdRef.current === callId && callGenerationRef.current === generation;
    try {
      setCallPhase("connecting");
      const config = await loadDeferredConfig(isCurrentCall, fetchCallRtcConfig);
      if (!config) return;
      // Calls deliberately have no Agora fallback. A deployment without TURN is
      // not permitted to silently create a less reliable call path.
      if (config.provider !== "webrtc") throw new Error("WebRTC TURN calling is unavailable");
      const { pc } = await createWebRtcCall(config, peer, callId, withVideo, true, isCurrentCall);
      if (!isCurrentCall()) return;
      const offer = await pc.createOffer();
      if (!isCurrentCall()) return;
      await pc.setLocalDescription(offer);
      if (!isCurrentCall()) return;
      callSignalingReadyRef.current.add(callId);
      sendWS({
        type: "call-webrtc-offer", callId, to: peer, offer: pc.localDescription,
        transport: DEFERRED_WEBRTC_TRANSPORT,
      });
      for (const candidate of pendingCallIceRef.current.splice(0)) {
        sendWS({ type: "ice-candidate", to: peer, callId, candidate });
      }
    } catch (error) {
      if (!isCurrentCall()) return;
      showCallError(mediaFailureMessage(error), 12_000);
      sendWS({ type: "call-end", to: peer, callId });
      currentCallIdRef.current = null;
      setCallPhase("ended");
      setCallStatus("ended");
      void leaveAgora();
    }
  }, [createWebRtcCall, leaveAgora, sendWS]);

  const answerWebRtcOffer = useCallback(async (msg: {
    callId: string; from: string; offer: RTCSessionDescriptionInit;
  }, withVideo: boolean) => {
    if (mediaSetupCallRef.current === msg.callId) return;
    mediaSetupCallRef.current = msg.callId;
    const generation = callGenerationRef.current;
    const isCurrentCall = () => currentCallIdRef.current === msg.callId && callGenerationRef.current === generation;
    try {
      setCallPhase("connecting");
      const config = await loadDeferredConfig(isCurrentCall, fetchCallRtcConfig);
      if (!config) return;
      if (config.provider !== "webrtc") throw new Error("WebRTC TURN calling is unavailable");
      callSignalingReadyRef.current.add(msg.callId);
      const { pc } = await createWebRtcCall(config, msg.from, msg.callId, withVideo, false, isCurrentCall);
      if (!isCurrentCall()) return;
      await pc.setRemoteDescription(msg.offer);
      if (!isCurrentCall()) return;
      for (const candidate of pendingRemoteIceRef.current.splice(0)) {
        try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
      }
      const answer = await pc.createAnswer();
      if (!isCurrentCall()) return;
      await pc.setLocalDescription(answer);
      if (!isCurrentCall()) return;
      sendWS({
        type: "call-webrtc-answer", callId: msg.callId, to: msg.from, answer: pc.localDescription,
        transport: DEFERRED_WEBRTC_TRANSPORT,
      });
    } catch (error) {
      if (!isCurrentCall()) return;
      showCallError(mediaFailureMessage(error), 12_000);
      sendWS({ type: "call-reject", to: msg.from, callId: msg.callId });
      currentCallIdRef.current = null;
      setCallPhase("ended");
      setCallStatus("ended");
      void leaveAgora();
    }
  }, [createWebRtcCall, leaveAgora, sendWS]);

  // ── Connect WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    const generation = ++identityGenerationRef.current;
    let disposed = false;
    const isCurrent = (ws?: WebSocket) =>
      !disposed &&
      generation === identityGenerationRef.current &&
      (!ws || wsRef.current === ws);

    if (!user) {
      setRealtimeConnected();
      wasConnectedRef.current = false;
      reconnectAttemptRef.current = 0;
      setConnected(false);
      setOnlineUsers([]);
      setActiveLives([]);
      setIncomingCall(null);
      setActivePeer(null);
      setActiveCallId(null);
      setCallStatus("idle");
      setCallPhase("idle");
      setLiveStatus("idle");
      setCurrentLiveId(null);
      setConnectionTest("idle");
      currentCallIdRef.current = null;
      historyRef.current = null;
      return () => { disposed = true; };
    }

    const expectedUserId = user.id;

    const clearReconnect = () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    };

    const scheduleReconnect = () => {
      if (!isCurrent() || !navigator.onLine) return;
      clearReconnect();
      const attempt = reconnectAttemptRef.current++;
      const backoff = Math.min(30_000, 1_000 * 2 ** attempt);
      const jitter = Math.floor(Math.random() * Math.min(1_000, backoff * 0.25));
      reconnectRef.current = setTimeout(connect, backoff + jitter);
    };

    const connect = () => {
      if (!isCurrent()) return;
      if (!navigator.onLine) {
        setRealtimeConnecting();
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
      setRealtimeConnecting();
      const ws = new WebSocket(websocketUrl());
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
          registeredSocketRef.current = true;
          flushCallResumes();
          reconnectAttemptRef.current = 0;
          setRealtimeConnected();
          window.dispatchEvent(new Event("gdna:realtime-connected"));
          if (wasConnectedRef.current) {
            window.dispatchEvent(new Event("gdna:realtime-reconnected"));
            window.dispatchEvent(new Event("gdna:realtime-refetch"));
          }
          wasConnectedRef.current = true;
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
        if (msg.type === "chat-read") {
          window.dispatchEvent(new CustomEvent("gdna:chat-read", { detail: msg }));
        }
        if (msg.type === "chat-message-deleted") {
          window.dispatchEvent(new CustomEvent("gdna:chat-message-deleted", { detail: msg }));
        }

        // ── Incoming call ──────────────────────────────────────────────────
        if (msg.type === "call-incoming" || msg.type === "call-resumed") {
          pendingCallResumesRef.current.delete(msg.callId);
          // Ignore if already in / being offered another call
          if (!currentCallIdRef.current) {
            // This runtime intentionally does not downgrade a deferred call to
            // the legacy Agora/SDP-on-ring protocol.
            if (!isDeferredWebRtcTransport(msg.transport, msg.deferredMedia)) {
              sendWS({ type: "call-reject", to: msg.from, callId: msg.callId, code: "MEDIA_PROTOCOL_MISMATCH" });
              return;
            }
            currentCallIdRef.current = msg.callId;
            callGenerationRef.current += 1;
            callDirectionRef.current = "incoming";
            callVideoRef.current = Boolean(msg.video);
            setIncomingCall({
              from: msg.from,
              callId: msg.callId,
              video: msg.video,
              offer: null,
              transport: DEFERRED_WEBRTC_TRANSPORT,
              e2e: msg.e2e,
              callerId: msg.callerId,
              callerName: msg.callerName,
              callerAvatar: msg.callerAvatar,
              expiresAt: typeof msg.expiresAt === "number"
                ? msg.expiresAt
                : typeof msg.expiresAt === "string" && Number.isFinite(Date.parse(msg.expiresAt))
                  ? Date.parse(msg.expiresAt)
                  : undefined,
              deferredMedia: true,
            });
            setCallPhase("ringing");
            setCallStatus("ringing");
            clearRingTimer();
          }
        }

        if (msg.type === "call-ready" && typeof msg.callId === "string") {
          settleCallReady(msg.callId);
        }

        // ── Accepted means permission to begin WebRTC, not "active" ─────────
        if (msg.type === "call-accepted" && msg.callId === currentCallIdRef.current) {
          if (!isDeferredWebRtcTransport(msg.transport, msg.deferredMedia)) {
            showCallError("تعذّر التحقق من بروتوكول وسائط المكالمة");
            sendWS({ type: "call-end", to: msg.from, callId: msg.callId });
            void leaveAgora();
            return;
          }
          clearRingTimer();
          setCallPhase("accepted");
          if (callDirectionRef.current === "outgoing") {
            void beginCallerWebRtc(msg.callId, msg.from, callVideoRef.current);
          }
        }

        if (msg.type === "call-webrtc-offer" && msg.callId === currentCallIdRef.current && msg.offer) {
          if (callDirectionRef.current === "incoming") {
            void answerWebRtcOffer(msg, callVideoRef.current);
          }
        }

        if (msg.type === "call-webrtc-answer" && msg.callId === currentCallIdRef.current && msg.answer && callPcRef.current) {
          await callPcRef.current.setRemoteDescription(msg.answer);
          for (const candidate of pendingRemoteIceRef.current.splice(0)) {
            try { await callPcRef.current.addIceCandidate(candidate); } catch { /* stale candidate */ }
          }
        }

        if (msg.type === "ice-candidate" && msg.callId === currentCallIdRef.current) {
          if (callPcRef.current?.remoteDescription) {
            try { await callPcRef.current.addIceCandidate(msg.candidate); } catch { /* stale candidate */ }
          } else {
            pendingRemoteIceRef.current.push(msg.candidate);
          }
        }

        if (
          msg.type === "call-renegotiate-offer" &&
          msg.callId === currentCallIdRef.current &&
          msg.transport?.provider === "webrtc" &&
          msg.transport.version === 1 &&
          callProviderRef.current === "webrtc" &&
          callPcRef.current
        ) {
          const pc = callPcRef.current;
          const config = callRtcConfigRef.current;
          if (!config) return;
          pc.setConfiguration({ iceServers: config.iceServers, iceTransportPolicy: "relay" });
          await pc.setRemoteDescription(msg.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWS({
            type: "call-renegotiate-answer",
            callId: msg.callId,
            answer: pc.localDescription,
            transport: { provider: "webrtc", version: 1 },
          });
        }

        if (
          msg.type === "call-renegotiate-answer" &&
          msg.callId === currentCallIdRef.current &&
          msg.transport?.provider === "webrtc" &&
          msg.transport.version === 1 &&
          callProviderRef.current === "webrtc" &&
          callPcRef.current
        ) {
          await callPcRef.current.setRemoteDescription(msg.answer);
        }

        // ── Call rejected / ended — only for OUR current call ──────────────
        if ((msg.type === "call-rejected" || msg.type === "call-ended")
            && msg.callId === currentCallIdRef.current) {
          clearRingTimer();
          if (callDirectionRef.current === "outgoing") {
            showForegroundCallNotification(
              "GDNA Arena",
              msg.type === "call-rejected"
                ? "The call was declined."
                : msg.code === "RING_TIMEOUT" ? "The call was not answered." : "The call has ended.",
            );
          }
          if (msg.code === "CREDIT_EXHAUSTED") {
            showCallError("انتهى رصيد المكالمات الملكي وتم إنهاء المكالمة دون احتساب وقت إضافي", 15_000);
          } else if (msg.code === "CREDIT_BILLING_UNAVAILABLE") {
            showCallError("توقفت خدمة احتساب الرصيد، لذلك أُنهيت المكالمة بأمان", 15_000);
          } else if (msg.code === "MEDIA_HEARTBEAT_TIMEOUT" || msg.code === "MEDIA_START_TIMEOUT") {
            showCallError("أُنهيت المكالمة لأن اتصال الوسائط الفعلي لم يعد قابلاً للتحقق", 15_000);
          }
          setActualMediaConnected(false);
          callGenerationRef.current += 1;
          currentCallIdRef.current = null;
          callDirectionRef.current = null;
          setCallPhase("ended");
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
          if (typeof msg.callId === "string") {
            settleCallReady(msg.callId, new Error("CALL_SETUP_REJECTED"));
          }
          if (typeof msg.callId === "string" && msg.callId !== currentCallIdRef.current) return;
          clearRingTimer();
          callGenerationRef.current += 1;
          currentCallIdRef.current = null;
          callDirectionRef.current = null;
          setCallPhase("ended");
          // The server persists offline missed calls so the callee receives them
          // after reconnecting. Do not create a second client-side history row.
          if (msg.type === "call-unavailable" && msg.missedLogged === true) {
            historyRef.current = null;
          }
          // Callee side safety: if a block denial races an incoming banner, clear it.
          setIncomingCall(null);
          showCallError(
            msg.code === "CREDIT_REQUIRED"
              ? "يلزم رصيد مكالمات ملكي أو موافقة صريحة على الاحتياطي قبل بدء المكالمة"
              : msg.code === "CREDIT_BILLING_UNAVAILABLE"
                ? "خدمة رصيد المكالمات غير متاحة حالياً — لم تبدأ المكالمة ولن يتم احتسابها"
                : msg.code === "MEDIA_PROTOCOL_MISMATCH"
                  ? "إصدار وسائط المكالمة غير متوافق — حدّث الصفحة وحاول مجدداً"
            : msg.type === "call-busy"
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
        registeredSocketRef.current = false;
        if (!isCurrent(ws)) return;
        wsRef.current = null;
        setConnected(false);
        setRealtimeConnecting();
        window.dispatchEvent(new Event("gdna:realtime-disconnected"));
        if (pingRef.current) clearInterval(pingRef.current);
        rejectPendingCallSetups("انقطع اتصال المكالمة بالخادم");
        if (currentCallIdRef.current) {
          clearRingTimer();
          setActualMediaConnected(false);
          currentCallIdRef.current = null;
          setIncomingCall(null);
          setCallStatus("ended");
          setActivePeer(null);
          setActiveCallId(null);
          void leaveAgora();
        }
        scheduleReconnect();
      };

      ws.onerror = () => ws.close();
    };

    const reconnectImmediately = () => {
      if (!isCurrent() || !navigator.onLine) return;
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
      clearReconnect();
      connect();
    };
    const onOnline = () => {
      window.dispatchEvent(new Event("gdna:realtime-refetch"));
      reconnectImmediately();
    };
    const onOffline = () => {
      clearReconnect();
      setRealtimeConnecting();
      setActualMediaConnected(false);
      wsRef.current?.close();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconnectImmediately();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (isOnline) connect();
    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pingRef.current) clearInterval(pingRef.current);
      if (mediaHeartbeatRef.current) clearInterval(mediaHeartbeatRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      pingRef.current = null;
      reconnectRef.current = null;
      const ws = wsRef.current;
      setActualMediaConnected(false);
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      clearRingTimer();
      rejectPendingCallSetups("تم إغلاق اتصال المكالمة");
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
      setCallPhase("idle");
      setLiveStatus("idle");
      setCurrentLiveId(null);
      setConnectionTest("idle");
      setCallError(null);
    };
  }, [user?.id, user?.username, isOnline, answerWebRtcOffer, beginCallerWebRtc, leaveAgora, rejectPendingCallSetups, settleCallReady, setActualMediaConnected, setRealtimeConnected, setRealtimeConnecting]);

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
    if (!isOnline) {
      showCallError("أنت غير متصل بالشبكة — لا يمكن بدء مكالمة الآن");
      return;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      showCallError("الاتصال بالشبكة منقطع — انتظر ثوانٍ وأعد المحاولة");
      return;
    }
    const callId = `call_${crypto.randomUUID().replace(/-/g, "")}`;
    let offered = false;
    try {
      // Starting a call is a signaling-only operation. In particular, do not
      // create RTCPeerConnection, SDP, or request microphone/camera until the
      // recipient accepts the canonical invitation.
       let recipients: E2ERecipientKey[] | null = null;
       for (let attempt = 0; attempt < 3 && !recipients; attempt++) {
        const keyResponse = await fetch(
          apiPath(`/api/messages/e2e/users/${encodeURIComponent(targetUsername)}/key`),
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
      currentCallIdRef.current = callId;
      callGenerationRef.current += 1;
      callDirectionRef.current = "outgoing";
      callVideoRef.current = withVideo;
      setActivePeer(targetUsername);
      setActiveCallId(callId);
      setActiveVideo(withVideo);
      setCallPhase("ringing");
      setCallStatus("calling");
      historyRef.current = { peer: targetUsername, video: withVideo, start: Date.now(), outgoing: true, answered: false };
      const callReady = waitForCallReady(callId);
      sendWS({
        type: "call-offer",
        to: targetUsername,
        offer: null,
        callId,
        from: user.username,
        video: withVideo,
        deferredMedia: true,
        transport: DEFERRED_WEBRTC_TRANSPORT,
        e2e,
      });
      offered = true;

      // The signaling server owns the 30-second ring timeout and durable
      // missed-call write. Do not race it with a browser call-end message.
      await callReady;
    } catch (err: unknown) {
      console.error("[CALL] Failed to start:", err);
      clearRingTimer();
      // Only a callee who actually received an offer needs an end signal.
      if (offered) sendWS({ type: "call-end", to: targetUsername, callId });
      currentCallIdRef.current = null;
      callGenerationRef.current += 1;
      callDirectionRef.current = null;
      setCallPhase("idle");
      setActivePeer(null);
      setActiveCallId(null);
      void leaveAgora();
      const message = err instanceof Error ? err.message : "";
      if (message !== "CALL_SETUP_REJECTED") {
        showCallError(message.includes("secure") || message.includes("Secure") || message.includes("E2E")
          ? `🔐 ${message}`
          : mediaFailureMessage(err));
      }
      setCallStatus("idle");
    }
  }, [callStatus, isOnline, leaveAgora, sendWS, setActualMediaConnected, user, waitForCallReady]);

  // ── Answer an incoming call ────────────────────────────────────────────────
  const answerCall = useCallback(async (withVideo = true) => {
    if (!incomingCall) return;
    try {
      if (!isDeferredWebRtcTransport(incomingCall.transport, incomingCall.deferredMedia)) {
        throw new Error("Secure call media protocol is unavailable");
      }
      // Answer only accepts the invitation. The caller creates the initial
      // offer afterwards, so this button never causes a media permission
      // request or RTCPeerConnection before acceptance has been acknowledged.
      clearRingTimer();
      setActivePeer(incomingCall.from);
      setActiveCallId(incomingCall.callId);
      setActiveVideo(withVideo && incomingCall.video);
      callVideoRef.current = withVideo && incomingCall.video;
      setIncomingCall(null);
      setCallPhase("accepted");
      setCallStatus("calling");
      sendWS({
        type: "call-answer",
        to: incomingCall.from,
        answer: null,
        callId: incomingCall.callId,
        deferredMedia: true,
        transport: DEFERRED_WEBRTC_TRANSPORT,
      });
    } catch (err: unknown) {
      console.error("[CALL] Failed to answer:", err);
      void leaveAgora();
      // Tell the caller the answer failed so they don't ring forever.
      sendWS({ type: "call-reject", to: incomingCall.from, callId: incomingCall.callId });
      currentCallIdRef.current = null;
      callGenerationRef.current += 1;
      callDirectionRef.current = null;
      setIncomingCall(null);
      setCallPhase("idle");
      setCallStatus("idle");
      const message = err instanceof Error ? err.message : "";
      showCallError(message.includes("secure") || message.includes("Secure") || message.includes("E2E")
        ? `🔐 ${message}`
        : mediaFailureMessage(err));
    }
  }, [incomingCall, leaveAgora, sendWS]);

  // ── Reject call ───────────────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    sendWS({ type: "call-reject", to: incomingCall.from, callId: incomingCall.callId });
    currentCallIdRef.current = null;
    callGenerationRef.current += 1;
    callDirectionRef.current = null;
    setIncomingCall(null);
    setCallPhase("idle");
    setCallStatus("idle");
  }, [incomingCall, sendWS]);

  const clearNotificationCallActionUrl = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("callId");
    url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // A notification action is inert until this account has a registered socket
  // and the server has resumed the canonical invitation. In particular, a
  // passive missed-call click has no action parameter and is intentionally
  // ignored here.
  useEffect(() => {
    if (!user) return;
    const parsed = readNotificationCallAction(window.location.search);
    if (!parsed) return;
    const key = `${user.id}:${parsed.callId}:${parsed.action}`;
    const current = pendingNotificationActionRef.current;
    if (current && current.accountId !== user.id) {
      pendingNotificationActionRef.current = null;
      clearNotificationCallActionUrl();
      return;
    }
    if (seenNotificationActionRef.current === key) return;
    seenNotificationActionRef.current = key;
    const pending: PendingNotificationCallAction = {
      ...parsed,
      accountId: user.id,
      expiresAt: Date.now() + RING_TIMEOUT_MS,
      resumeSent: false,
    };
    pendingNotificationActionRef.current = pending;
    const timeout = window.setTimeout(() => {
      if (pendingNotificationActionRef.current !== pending) return;
      pendingNotificationActionRef.current = null;
      clearNotificationCallActionUrl();
      showCallError("انتهت صلاحية دعوة المكالمة");
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [clearNotificationCallActionUrl, user?.id]);

  useEffect(() => {
    const pending = pendingNotificationActionRef.current;
    if (!pending || !user || pending.accountId !== user.id || pending.resumeSent || !connected) return;
    pending.resumeSent = true;
    sendWS({ type: "call-resume", callId: pending.callId });
  }, [connected, sendWS, user?.id]);

  // A notification body click carries only callId. Resume the authenticated
  // invitation so the normal incoming banner appears, but never auto-answer.
  useEffect(() => {
    if (!connected || !user) return;
    if (readNotificationCallAction(window.location.search)) return;
    const parsed = readNotificationCallResume(window.location.search);
    if (!parsed || seenNotificationResumeRef.current === `${user.id}:${parsed.callId}`) return;
    seenNotificationResumeRef.current = `${user.id}:${parsed.callId}`;
    sendWS({ type: "call-resume", callId: parsed.callId });
    clearNotificationCallActionUrl();
  }, [clearNotificationCallActionUrl, connected, sendWS, user?.id]);

  useEffect(() => {
    const pending = pendingNotificationActionRef.current;
    if (!pending || !incomingCall || !user || !canApplyNotificationCallAction(pending, user.id, incomingCall.callId)) return;
    // Clear before invoking either action. React state updates and duplicate
    // Firestore/FCM/WS signals therefore cannot apply it a second time.
    pendingNotificationActionRef.current = null;
    clearNotificationCallActionUrl();
    if (pending.action === "decline") {
      rejectCall();
    } else {
      void answerCall(incomingCall.video);
    }
  }, [answerCall, clearNotificationCallActionUrl, incomingCall, rejectCall, user?.id]);

  // ── End active call ───────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    clearRingTimer();
    if (activePeer && activeCallId) {
      sendWS(callStatus === "calling" && callDirectionRef.current === "outgoing"
        ? { type: "call-cancel", callId: activeCallId, status: "missed" }
        : { type: "call-end", to: activePeer, callId: activeCallId });
    }
    setActualMediaConnected(false);
    callGenerationRef.current += 1;
    currentCallIdRef.current = null;
    callDirectionRef.current = null;
    void leaveAgora();
    pcRef.current?.close();
    setCallStatus("idle");
    setCallPhase("idle");
    setActivePeer(null);
    setActiveCallId(null);
  }, [activePeer, activeCallId, callStatus, leaveAgora, sendWS, setActualMediaConnected]);

  // ── Screen share (Agora) ──────────────────────────────────────────────────
  const stopScreenShare = useCallback(async () => {
    if (callProviderRef.current === "webrtc") {
      const pc = callPcRef.current;
      const screen = webRtcScreenTrackRef.current;
      const camera = webRtcCameraTrackRef.current;
      webRtcScreenTrackRef.current = null;
      webRtcCameraTrackRef.current = null;
      const sender = pc?.getTransceivers().find(item => item.receiver.track.kind === "video")?.sender;
      try { await sender?.replaceTrack(camera); } catch { /* surfaced by current call state */ }
      screen?.stop();
      const audio = localStreamRef.current?.getAudioTracks()[0];
      const restored = new MediaStream([audio, camera].filter((track): track is MediaStreamTrack => Boolean(track)));
      localStreamRef.current = restored;
      setLocalStream(restored);
      setScreenSharing(false);
      return;
    }
    const client = agoraRef.current;
    const screen = screenTrackRef.current;
    // close() can emit track-ended synchronously; make manual and browser-driven
    // stops converge without publishing the camera twice.
    if (!screen) {
      setScreenSharing(false);
      return;
    }
    screenTrackRef.current = null;
    if (client && screen) {
      try { await client.unpublish(screen); } catch { /* already gone */ }
    }
    screen?.close();
    if (client && localVideoRef.current) {
      try {
        await client.publish(localVideoRef.current);
      } catch (error) {
        console.error("[CALL] Failed to restore camera after screen sharing:", error);
        showCallError("تعذّرت استعادة الكاميرا — أنهِ المكالمة ثم أعد الاتصال لاستعادة الفيديو", 15_000);
      }
    }
    const audioTrack = localAudioRef.current?.getMediaStreamTrack();
    const videoTrack = localVideoRef.current?.getMediaStreamTrack();
    const restoredTracks = [audioTrack, videoTrack].filter((track): track is MediaStreamTrack => Boolean(track));
    const restored = restoredTracks.length ? new MediaStream(restoredTracks) : null;
    localStreamRef.current = restored;
    setLocalStream(restored);
    setScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    if (callProviderRef.current === "webrtc" && callPcRef.current && callStatus === "active") {
      if (!screenShareSupported) {
        showCallError("مشاركة الشاشة غير مدعومة على هذا الجهاز — المكالمة ستستمر بشكل طبيعي");
        return;
      }
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screen = display.getVideoTracks()[0];
        if (!screen) throw new Error("Screen track unavailable");
        const sender = callPcRef.current.getTransceivers()
          .find(item => item.receiver.track.kind === "video")?.sender;
        if (!sender) throw new Error("Video sender unavailable");
        const camera = localStreamRef.current?.getVideoTracks()[0] ?? null;
        webRtcCameraTrackRef.current = camera;
        webRtcScreenTrackRef.current = screen;
        await sender.replaceTrack(screen);
        const audio = localStreamRef.current?.getAudioTracks()[0];
        const shared = new MediaStream([audio, screen].filter((track): track is MediaStreamTrack => Boolean(track)));
        localStreamRef.current = shared;
        setLocalStream(shared);
        setScreenSharing(true);
        screen.addEventListener("ended", () => { void stopScreenShare(); }, { once: true });
      } catch (error) {
        showCallError(mediaFailureMessage(error, "camera"), 15_000);
      }
      return;
    }
    const client = agoraRef.current;
    if (!client || callStatus !== "active") {
      showCallError("مشاركة الشاشة متاحة أثناء المكالمة النشطة فقط");
      return;
    }
    if (!screenShareSupported) {
      showCallError("مشاركة الشاشة غير مدعومة على هذا الجهاز — المكالمة ستستمر بشكل طبيعي");
      return;
    }
    let cameraUnpublished = false;
    let screen: ILocalVideoTrack | null = null;
    try {
      screen = await AgoraRTC.createScreenVideoTrack({}, "disable");
      screenTrackRef.current = screen;
      if (localVideoRef.current) {
        await client.unpublish(localVideoRef.current);
        cameraUnpublished = true;
      }
      await client.publish(screen);
      const audioTrack = localAudioRef.current?.getMediaStreamTrack();
      const screenMediaTrack = screen.getMediaStreamTrack();
      const sharedStream = new MediaStream([
        ...(audioTrack ? [audioTrack] : []),
        screenMediaTrack,
      ]);
      localStreamRef.current = sharedStream;
      setLocalStream(sharedStream);
      setScreenSharing(true);
      screen.on("track-ended", () => { void stopScreenShare(); });
    } catch (error) {
      screenTrackRef.current = null;
      try { screen?.close(); } catch { /* creation/publish did not complete */ }
      if (cameraUnpublished && localVideoRef.current) {
        try { await client.publish(localVideoRef.current); } catch { /* surfaced below */ }
      }
      const name = (error as { name?: string })?.name;
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const permissionDenied =
        name === "NotAllowedError" ||
        name === "PermissionDeniedError" ||
        code === "PERMISSION_DENIED" ||
        message.includes("permission") ||
        message.includes("denied") ||
        message.includes("cancel");
      showCallError(
        permissionDenied
          ? "تم رفض مشاركة الشاشة — اضغط مشاركة الشاشة مجدداً، اختر نافذة أو شاشة، ثم اسمح بالمشاركة"
          : "تعذرت مشاركة الشاشة على هذا الجهاز أو المتصفح — جرّب متصفحاً حديثاً أو أعد المحاولة",
        15_000,
      );
    }
  }, [callStatus, screenShareSupported, stopScreenShare]);

  // ── Start live story (WebRTC path, unchanged) ─────────────────────────────
  const startLive = useCallback(async (title: string, domain: string) => {
    if (!isOnline) {
      showCallError("أنت غير متصل بالشبكة — لا يمكن بدء بث مباشر الآن");
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showCallError("الكاميرا والميكروفون غير متاحين في هذا المتصفح — افتح الموقع عبر اتصال آمن");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setSelectedCameraId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      refreshCameraZoom(stream.getVideoTracks()[0]);
      void refreshCallDevices();
      setLiveStatus("live");
      sendWS({ type: "live-start", title, domain });
    } catch (err) {
      console.error("[LIVE] Failed:", err);
      showCallError(mediaFailureMessage(err, "camera"), 12_000);
    }
  }, [isOnline, refreshCallDevices, refreshCameraZoom, sendWS]);

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
    if (!isOnline) {
      showCallError("أنت غير متصل بالشبكة — لا يمكن الانضمام إلى البث الآن");
      return;
    }
    const live = activeLives.find((item) => item.liveId === liveId);
    if (!live) {
      showCallError("انتهى هذا البث أو لم يعد متاحاً");
      return;
    }
    const pc = createLivePC(live.host, liveId);
    pcRef.current = pc;
    sendWS({ type: "live-join", liveId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLives, isOnline, sendWS]);

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
      fetch(apiPath("/api/social/v2/call-history"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calleeUsername: peer, callType: video ? "video" : "audio", status, durationSec }),
        credentials: "include",
      }).catch(() => {});
    }
  }, [callStatus, user]);

  return {
    connected, callStatus, callPhase, liveStatus, incomingCall,
    activePeer, activeVideo, onlineUsers, activeLives, currentLiveId,
    localStream, remoteStream, screenSharing,
    callError,
    connectionTest,
    networkState, networkQuality,
    callDevices, selectedMicrophoneId, selectedCameraId, selectedSpeakerId,
    cameraZoom, canFlipCamera: callDevices.filter(device => device.kind === "videoinput").length > 1,
    speakerSelectionSupported, screenShareSupported, deviceIssue, switchingDevice,
    startCall, answerCall, rejectCall, endCall,
    testConnection,
    startLive, endLive, joinLive,
    startScreenShare, stopScreenShare,
    refreshCallDevices, switchMicrophone, switchCamera, selectSpeaker,
    flipCamera, adjustCameraZoom,
    reportSpeakerFailure, reportSpeakerSuccess, reportDeviceRecoveryAttempt,
    ...callPush,
    soundBlocked, enableCallSound,
  };
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
