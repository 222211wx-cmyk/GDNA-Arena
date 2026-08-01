// ══════════════════════════════════════════════════════════════════════════════
//  LiveStoryRecorder — بث مباشر من الكاميرا/الميكروفون
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, StopCircle, Mic, MicOff, Video, VideoOff, Users, X } from "lucide-react";

interface LiveStream { liveId: string; host: string; title: string; domain: string; }

interface Props {
  liveStatus:   "idle" | "live" | "ended";
  localStream:  MediaStream | null;
  currentLiveId: string | null;
  activeLives:  LiveStream[];
  onStartLive:  (title: string, domain: string) => void;
  onEndLive:    () => void;
  onJoinLive:   (liveId: string) => void;
  remoteStream: MediaStream | null;
}

const DOMAINS = [
  { value: "general", label: "عام",       icon: "🌍" },
  { value: "sport",   label: "رياضة",     icon: "⚽" },
  { value: "music",   label: "موسيقى",    icon: "🎵" },
  { value: "cinema",  label: "سينما",     icon: "🎬" },
  { value: "tech",    label: "تقنية",     icon: "💡" },
  { value: "art",     label: "فنون",      icon: "🎨" },
];

export default function LiveStoryRecorder({
  liveStatus, localStream, currentLiveId, activeLives, onStartLive, onEndLive, onJoinLive, remoteStream
}: Props) {
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [showCompose,  setShowCompose]  = useState(false);
  const [title,        setTitle]        = useState("");
  const [domain,       setDomain]       = useState("general");
  const [micMuted,     setMicMuted]     = useState(false);
  const [videoOff,     setVideoOff]     = useState(false);
  const [duration,     setDuration]     = useState(0);
  const [watchingId,   setWatchingId]   = useState<string | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    localStream?.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
  }, [micMuted, localStream]);

  useEffect(() => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !videoOff; });
  }, [videoOff, localStream]);

  useEffect(() => {
    if (liveStatus !== "live") { setDuration(0); return; }
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, [liveStatus]);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Active live view ───────────────────────────────────────────────────────
  if (liveStatus === "live" && localStream) return (
    <div className="relative rounded-xl overflow-hidden" style={{ height: 360, background: "#000" }}>
      <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

      {/* LIVE badge */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-black text-white"
          style={{ background: "#ef4444" }}>
          <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
          LIVE
        </div>
        <div className="px-2 py-1 rounded-full text-xs font-mono" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
          {fmt(duration)}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setMicMuted(v => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: micMuted ? "#ef4444" : "rgba(0,0,0,0.6)" }}>
            {micMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
          </button>
          <button onClick={() => setVideoOff(v => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: videoOff ? "#ef4444" : "rgba(0,0,0,0.6)" }}>
            {videoOff ? <VideoOff className="w-4 h-4 text-white" /> : <Video className="w-4 h-4 text-white" />}
          </button>
        </div>
        <button onClick={onEndLive}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black text-white"
          style={{ background: "#ef4444" }}>
          <StopCircle className="w-4 h-4" /> إنهاء البث
        </button>
      </div>
    </div>
  );

  // ── Watching a live ────────────────────────────────────────────────────────
  if (watchingId && remoteStream) {
    const liveInfo = activeLives.find(l => l.liveId === watchingId);
    return (
      <div className="relative rounded-xl overflow-hidden" style={{ height: 300, background: "#000" }}>
        <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-black text-white" style={{ background: "#ef4444" }}>
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" /> LIVE
          </div>
          <span className="text-xs text-white font-bold" style={{ background: "rgba(0,0,0,0.6)", padding: "2px 8px", borderRadius: 20 }}>
            {liveInfo?.host} — {liveInfo?.title}
          </span>
        </div>
        <button onClick={() => { setWatchingId(null); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}>
          <X className="w-4 h-4 text-white" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Start live button */}
      {liveStatus === "idle" && (
        <button onClick={() => setShowCompose(v => !v)}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase tracking-wider transition-all active:scale-95"
          style={{ background: showCompose ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)", border: "1px solid #ef444440", color: "#ef4444" }}>
          <Radio className="w-4 h-4" />
          ابدأ بثاً مباشراً
        </button>
      )}

      {/* Compose panel */}
      <AnimatePresence>
        {showCompose && liveStatus === "idle" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-3 p-4" style={{ border: "1px solid #ef444430", background: "rgba(239,68,68,0.04)" }}>

            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="عنوان البث المباشر..."
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={{ background: "#0a0a0a", border: "1px solid #ffffff15", color: "#fff" }}
              dir="rtl" />

            <div className="flex flex-wrap gap-1.5">
              {DOMAINS.map(d => (
                <button key={d.value} onClick={() => setDomain(d.value)}
                  className="px-3 py-1 text-xs font-bold transition-all"
                  style={{ border: `1px solid ${domain === d.value ? "#ef4444" : "#ffffff10"}`, background: domain === d.value ? "rgba(239,68,68,0.15)" : "transparent", color: domain === d.value ? "#ef4444" : "#ffffff40" }}>
                  {d.icon} {d.label}
                </button>
              ))}
            </div>

            <button disabled={!title.trim()}
              onClick={() => { onStartLive(title.trim(), domain); setShowCompose(false); }}
              className="w-full py-2.5 text-sm font-black text-white uppercase tracking-wider disabled:opacity-40 transition-all active:scale-95"
              style={{ background: "#ef4444" }}>
              📡 ابدأ الآن
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active lives */}
      {activeLives.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "#ef444460" }}>
            بث مباشر — {activeLives.length} حالياً
          </p>
          {activeLives.map(live => (
            <div key={live.liveId} className="flex items-center justify-between p-3"
              style={{ border: "1px solid #ef444425", background: "rgba(239,68,68,0.04)" }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
                <div>
                  <p className="text-xs font-bold text-white">{live.host}</p>
                  <p className="text-[10px]" style={{ color: "#ffffff40" }}>{live.title}</p>
                </div>
              </div>
              <button onClick={() => { onJoinLive(live.liveId); setWatchingId(live.liveId); }}
                className="px-3 py-1 text-xs font-bold text-white"
                style={{ background: "#ef4444" }}>
                <Users className="w-3 h-3 inline mr-1" />انضم
              </button>
            </div>
          ))}
        </div>
      )}

      {activeLives.length === 0 && liveStatus === "idle" && !showCompose && (
        <p className="text-center text-xs py-2" style={{ color: "#ffffff20" }}>
          لا بث مباشر الآن — كن أول من يبث
        </p>
      )}
    </div>
  );
}
