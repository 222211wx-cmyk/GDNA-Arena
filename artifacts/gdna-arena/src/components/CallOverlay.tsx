// ══════════════════════════════════════════════════════════════════════════════
//  CallOverlay — Full-screen voice/video call UI
// ══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Volume2, VolumeX, Minimize2
} from "lucide-react";
import type { CallStatus } from "@/hooks/useCall";

interface Props {
  status:       CallStatus;
  peer:         string | null;
  localStream:  MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: { from: string; video: boolean } | null;
  onAnswer:     (video: boolean) => void;
  onReject:     () => void;
  onEnd:        () => void;
}

export default function CallOverlay({
  status, peer, localStream, remoteStream, incomingCall, onAnswer, onReject, onEnd
}: Props) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const [muted,       setMuted]       = useState(false);
  const [videoOff,    setVideoOff]    = useState(false);
  const [speakerOff,  setSpeakerOff]  = useState(false);
  const [minimized,   setMinimized]   = useState(false);
  const [duration,    setDuration]    = useState(0);

  // Attach streams to video elements
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Mute local audio
  useEffect(() => {
    localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }, [muted, localStream]);

  // Disable local video
  useEffect(() => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !videoOff; });
  }, [videoOff, localStream]);

  // Call timer
  useEffect(() => {
    if (status !== "active") { setDuration(0); return; }
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const formatDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const hasVideo = !!(localStream?.getVideoTracks().length);

  const visible = status !== "idle";
  if (!visible) return null;

  // ── Incoming call ring ─────────────────────────────────────────────────────
  if (status === "ringing" && incomingCall) return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 320, background: "#0a0a0a", border: "1px solid #C9A84C40" }}>

        {/* Pulse ring */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 animate-ping rounded-2xl opacity-10" style={{ background: "#22c55e" }} />
        </div>

        <div className="relative p-5 space-y-4">
          <div className="text-center space-y-1">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center font-black text-2xl text-black"
              style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
              {incomingCall.from.charAt(0).toUpperCase()}
            </div>
            <p className="font-black text-white text-lg">{incomingCall.from}</p>
            <p className="text-xs font-mono animate-pulse" style={{ color: "#22c55e" }}>
              {incomingCall.video ? "📹 Incoming video call" : "📞 Incoming voice call"}
            </p>
          </div>

          <div className="flex justify-center gap-6">
            {/* Reject */}
            <button onClick={onReject}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "#ef4444" }}>
              <PhoneOff className="w-6 h-6 text-white" />
            </button>

            {/* Answer audio */}
            {incomingCall.video && (
              <button onClick={() => onAnswer(false)}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={{ background: "#3b82f6" }}>
                <Phone className="w-6 h-6 text-white" />
              </button>
            )}

            {/* Answer video */}
            <button onClick={() => onAnswer(incomingCall.video)}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "#22c55e" }}>
              {incomingCall.video ? <Video className="w-6 h-6 text-white" /> : <Phone className="w-6 h-6 text-white" />}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  // ── Active call / calling / ended ──────────────────────────────────────────
  if (minimized) return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed bottom-6 right-6 z-[9999] rounded-2xl cursor-pointer overflow-hidden shadow-2xl"
      style={{ width: 200, height: 112, background: "#050505", border: "1px solid #C9A84C40" }}
      onClick={() => setMinimized(false)}>
      {remoteStream
        ? <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" muted={speakerOff} />
        : <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full mx-auto flex items-center justify-center font-black text-sm text-black"
                style={{ background: "#C9A84C" }}>{peer?.charAt(0).toUpperCase()}</div>
              <p className="text-[10px] font-mono" style={{ color: "#C9A84C" }}>
                {status === "calling" ? "Calling..." : status === "active" ? formatDuration(duration) : "Ended"}
              </p>
            </div>
          </div>}
      <div className="absolute top-2 right-2">
        <button onClick={(e) => { e.stopPropagation(); onEnd(); }}
          className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#ef4444" }}>
          <PhoneOff className="w-3 h-3 text-white" />
        </button>
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ background: "#050505" }}>

      {/* Remote video / avatar */}
      <div className="flex-1 relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" muted={speakerOff} />
        ) : (
          <div className="text-center space-y-4">
            <div className="w-28 h-28 rounded-full mx-auto flex items-center justify-center font-black text-5xl text-black"
              style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
              {peer?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="space-y-1">
              <p className="text-white font-black text-2xl">{peer}</p>
              <p className="text-sm font-mono animate-pulse" style={{ color: status === "active" ? "#22c55e" : "#C9A84C" }}>
                {status === "calling"  ? "⏳ Calling..."
                : status === "active"  ? `✅ Connected — ${formatDuration(duration)}`
                : status === "ended"   ? "📵 Call ended"
                : ""}
              </p>
            </div>
          </div>
        )}

        {/* Timer overlay when video active */}
        {remoteStream && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono"
            style={{ background: "rgba(0,0,0,0.6)", color: "#22c55e" }}>
            {peer} · {formatDuration(duration)}
          </div>
        )}

        {/* Local video (PiP) */}
        {localStream && hasVideo && !videoOff && (
          <div className="absolute bottom-4 right-4 w-28 h-20 rounded-xl overflow-hidden border-2"
            style={{ borderColor: "#C9A84C50" }}>
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-center gap-4 py-8"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}>

        <button onClick={() => setMuted(v => !v)}
          className="w-13 h-13 w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: muted ? "#ef4444" : "#1a1a1a", border: "1px solid #ffffff20" }}>
          {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>

        {hasVideo && (
          <button onClick={() => setVideoOff(v => !v)}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: videoOff ? "#ef4444" : "#1a1a1a", border: "1px solid #ffffff20" }}>
            {videoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>
        )}

        {/* End call — center large */}
        <button onClick={onEnd}
          className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg"
          style={{ background: "#ef4444" }}>
          <PhoneOff className="w-7 h-7 text-white" />
        </button>

        <button onClick={() => setSpeakerOff(v => !v)}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: speakerOff ? "#ef4444" : "#1a1a1a", border: "1px solid #ffffff20" }}>
          {speakerOff ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
        </button>

        <button onClick={() => setMinimized(true)}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: "#1a1a1a", border: "1px solid #ffffff20" }}>
          <Minimize2 className="w-5 h-5 text-white" />
        </button>
      </div>
    </motion.div>
  );
}
