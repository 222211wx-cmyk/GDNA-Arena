// CLIPS — كليبسز: Reels-style vertical feed.
// Owner rules: min duration 2:00 (no upper limit — even 25h);
// only the owner of the work may publish (sha256 first-owner rights guard).
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clapperboard, Upload, Eye, Play, Pause, Volume2, VolumeX, ShieldCheck, X, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL;
const api = (p: string) => `${BASE}api${p}`;
const MIN_SEC = 60; // owner rule: 1 minute minimum — NO maximum (any chrono above 1 min)

interface Clip {
  id: number; user_id: number; username: string; title: string;
  content_type: string; duration_sec: number; views: number; created_at: string;
}

function fmtDur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// ── One clip card (autoplays when scrolled into view) ────────────────────────
function ClipCard({ clip }: { clip: Clip }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [views, setViews] = useState(clip.views);
  const counted = useRef(false);

  useEffect(() => {
    const el = wrapRef.current, v = videoRef.current;
    if (!el || !v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio > 0.6) {
        v.play().catch(() => {});
        if (!counted.current) {
          counted.current = true;
          fetch(api(`/clips/${clip.id}/view`), { method: "POST", credentials: "include" })
            .then(r => r.json()).then(d => typeof d.views === "number" && setViews(d.views)).catch(() => {});
        }
      } else v.pause();
    }, { threshold: [0, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, [clip.id]);

  return (
    <div ref={wrapRef} className="relative h-[80vh] snap-start rounded-2xl overflow-hidden border shrink-0"
      style={{ background: "#050505", borderColor: "#C9A84C30" }}>
      <video ref={videoRef} src={api(`/clips/stream/${clip.id}`)} playsInline loop muted={muted}
        className="w-full h-full object-contain bg-black"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }} />
      {/* Overlay info */}
      <div className="absolute bottom-0 inset-x-0 p-4 pointer-events-none"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85))" }}>
        <p className="font-black text-white text-lg leading-tight" dir="auto">{clip.title}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs font-mono" style={{ color: "#C9A84C" }}>
          <span>👑 {clip.username}</span>
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {views}</span>
          <span>⏱️ {fmtDur(clip.duration_sec)}</span>
        </div>
      </div>
      <div className="absolute top-3 right-3 flex gap-2">
        <button onClick={() => setMuted(m => !m)}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-black/60 text-white">
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-black/50 border" style={{ borderColor: "#C9A84C" }}>
            <Play className="w-7 h-7 ml-1" style={{ color: "#C9A84C" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | null) => {
    setFile(f); setDuration(null); setError(null);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      setDuration(v.duration);
      if (v.duration < MIN_SEC) setError("Durée minimale: 1 minute. Les clips de moins d'1 min sont interdits.");
    };
    v.onerror = () => { URL.revokeObjectURL(url); setError("ما قدرناش نقراو الفيديو"); };
    v.src = url;
  };

  const publish = () => {
    if (!file || !duration || duration < MIN_SEC || !title.trim() || busy) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("durationSec", String(Math.floor(duration)));
    fd.append("video", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api("/clips"));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      if (xhr.status === 200) { onDone(); onClose(); }
      else { try { setError(JSON.parse(xhr.responseText).error ?? "فشل النشر"); } catch { setError("فشل النشر"); } }
    };
    xhr.onerror = () => { setBusy(false); setError("فشل الاتصال — عاود المحاولة"); };
    xhr.send(fd);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-2xl border p-5 space-y-4"
        style={{ background: "#0a0a0a", borderColor: "#C9A84C50" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-lg" style={{ color: "#C9A84C" }}>🎬 نشر كليب</h3>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="text-[11px] leading-relaxed rounded-lg border p-3 space-y-1" style={{ borderColor: "#C9A84C30", color: "#d4c391" }}>
          <p>⏱️ Durée: <b>Minimum 1 min</b> · Pas de limite maximale.</p>
          <p className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> حقوق الملكية الفكرية محمية: التسجيلة الأصلية (الأوريجينال) لصاحبها وحدو — كل ملف كيتسجل ببصمة رقمية، والنسخة طبق الأصل كترفض.</p>
          <p>📱 التسجيل بالهاتف أو الكاميرا ديالك مسموح بالنشر — بشرط ما يكونش نفس الكرونو ديال الأصلية (ما شي نسخة مطابقة).</p>
        </div>
        <input type="file" accept="video/mp4,video/webm,video/quicktime"
          onChange={e => pick(e.target.files?.[0] ?? null)} disabled={busy}
          className="w-full text-xs text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-yellow-400/10 file:text-yellow-400" />
        <p className="text-sm text-yellow-400">⚠️ Minimum 1 minute. Pas de limite maximale.</p>
        {file && duration !== null && (
          <p className="text-xs font-mono" style={{ color: duration >= MIN_SEC ? "#22c55e" : "#ef4444" }}>
            Durée: {fmtDur(Math.floor(duration))} {duration >= MIN_SEC ? "✅" : "❌"}
          </p>
        )}
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} dir="auto" disabled={busy}
          placeholder="عنوان الكليب..." className="w-full px-3 py-2.5 rounded-lg bg-black border text-white text-sm outline-none"
          style={{ borderColor: "#C9A84C40" }} />
        {error && <p className="text-xs text-red-400" dir="auto">{error}</p>}
        {busy && (
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
            <div className="h-full transition-all" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#C9A84C,#FFD700)" }} />
          </div>
        )}
        <button onClick={publish}
          disabled={busy || !file || !title.trim() || duration === null || duration < MIN_SEC}
          className="w-full py-3 rounded-xl font-black text-black disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#C9A84C,#FFD700)" }}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> كيترفع... {progress}%</> : <><Upload className="w-4 h-4" /> نشر الكليب</>}
        </button>
      </div>
    </motion.div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ClipsPage() {
  const { user } = useAuth();
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (before?: number) => {
    try {
      const r = await fetch(api(`/clips/feed${before ? `?before=${before}` : ""}`), { credentials: "include" });
      const d = await r.json();
      const batch: Clip[] = d.clips ?? [];
      setClips(prev => before ? [...prev, ...batch] : batch);
      setHasMore(batch.length === 10);
    } catch { /* keep prior state */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen pt-20 pb-12" style={{ background: "#050505" }}>
      <div className="max-w-lg mx-auto px-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-black text-2xl flex items-center gap-2 text-white">
            <Clapperboard className="w-6 h-6" style={{ color: "#C9A84C" }} /> CLIPS <span style={{ color: "#C9A84C" }}>— كليبسز</span>
          </h1>
          {user && (
            <button onClick={() => setShowUpload(true)}
              className="px-4 py-2 rounded-xl font-bold text-sm text-black flex items-center gap-1.5"
              style={{ background: "linear-gradient(135deg,#C9A84C,#FFD700)" }}>
              <Upload className="w-4 h-4" /> نشر
            </button>
          )}
        </div>
        <p className="text-[11px] font-mono" style={{ color: "#C9A84C99" }}>
          Durée: Minimum 1 min · Pas de limite maximale · Droits d'auteur réservés à l'employeur
        </p>

        {loading ? (
          <div className="h-[60vh] rounded-2xl animate-pulse" style={{ background: "#111" }} />
        ) : clips.length === 0 ? (
          <div className="h-[50vh] rounded-2xl border flex flex-col items-center justify-center gap-3 text-center px-6"
            style={{ borderColor: "#C9A84C30" }}>
            <Clapperboard className="w-10 h-10" style={{ color: "#C9A84C" }} />
            <p className="text-white font-bold">ما كاين حتى كليب دابا</p>
            <p className="text-xs text-gray-400">كون أول واحد ينشر عملو — منتج، مغني، لاعب... كل واحد عندو شغلة ديالو</p>
          </div>
        ) : (
          <div className="space-y-6 snap-y snap-mandatory">
            {clips.map(c => <ClipCard key={c.id} clip={c} />)}
            {hasMore && (
              <button onClick={() => load(clips[clips.length - 1]?.id)}
                className="w-full py-3 rounded-xl border font-bold text-sm" style={{ borderColor: "#C9A84C40", color: "#C9A84C" }}>
                شوف المزيد
              </button>
            )}
          </div>
        )}
      </div>
      <AnimatePresence>
        {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={() => { setLoading(true); void load(); }} />}
      </AnimatePresence>
    </div>
  );
}
