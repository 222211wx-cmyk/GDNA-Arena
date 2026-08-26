import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Send, Heart, Clock, Mic, Video, Type, Radio, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { useConnectivity } from "@/contexts/ConnectivityContext";

interface Story {
  id: number; username: string; content: string;
  audioUrl: string | null; imageUrl: string | null;
  type: string; domain: string; likes: number;
  expiresAt: string; createdAt: string;
}

const GREEN    = "#22c55e";
const DARK_BG  = "#050a05";
const CARD_BG  = "#0a120a";
const BORDER_G = "#22c55e22";

const DOMAIN_META: Record<string, { label: string; color: string; icon: string }> = {
  sport:     { label: "Sport",     color: "#22d3ee",  icon: "⚡" },
  tech:      { label: "Tech",      color: "#a78bfa",  icon: "🔮" },
  science:   { label: "Science",   color: "#38bdf8",  icon: "🔬" },
  music:     { label: "Music",     color: "#f472b6",  icon: "🎵" },
  business:  { label: "Business",  color: "#4ade80",  icon: "💰" },
  art:       { label: "Art",       color: "#fb923c",  icon: "🎨" },
  education: { label: "Education", color: GREEN,      icon: "📚" },
  general:   { label: "General",   color: "#64748b",  icon: "🌍" },
};

const DOMAINS = ["all", "sport", "tech", "science", "music", "business", "art", "education"];

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function hoursLeft(d: string) {
  return Math.max(0, Math.floor((new Date(d).getTime() - Date.now()) / 3600000));
}

export default function StoriesPage() {
  const { isOnline } = useConnectivity();
  const { user } = useAuth();
  const [stories, setStories]       = useState<Story[]>([]);
  const [filter,  setFilter]        = useState("all");
  const [content, setContent]       = useState("");
  const [audioUrl, setAudioUrl]     = useState("");
  const [storyType, setStoryType]   = useState<"text" | "audio" | "video">("text");
  const [domain, setDomain]         = useState("general");
  const [posting, setPosting]       = useState(false);
  const [liked,   setLiked]         = useState<Set<number>>(new Set());
  const [toast,   setToast]         = useState<string | null>(null);
  const [error,   setError]         = useState<string | null>(null);
  const [activeStories, setActiveStories] = useState(0);

  const load = useCallback(async () => {
    const [fr, sr] = await Promise.all([
      fetch(`/api/stories/feed${filter !== "all" ? `?domain=${filter}` : ""}`, { credentials: "include" }),
      fetch("/api/stories/stats", { credentials: "include" }),
    ]);
    const fd = await fr.json() as { stories: Story[] };
    const sd = await sr.json() as { activeStories: number };
    setStories(fd.stories ?? []);
    setActiveStories(sd.activeStories ?? 0);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const post = async () => {
    if (!content.trim() || posting || !isOnline) return;
    setPosting(true); setError(null);
    const body: Record<string, string> = { content: content.trim(), type: storyType, domain };
    if (audioUrl.trim()) body.audioUrl = audioUrl.trim();

    const res = await fetch("/api/stories", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { coinsEarned?: number; error?: string };
    if (!res.ok) { setError(data.error ?? "Error posting story"); setPosting(false); return; }
    setContent(""); setAudioUrl("");
    void load();
    if (data.coinsEarned) {
      setToast(`+${data.coinsEarned} Coins earned! Story published. 📖`);
      setTimeout(() => setToast(null), 4000);
    }
    setPosting(false);
  };

  const like = async (id: number) => {
    if (liked.has(id) || !isOnline) return;
    const response = await fetch(`/api/stories/${id}/like`, { method: "POST", credentials: "include" });
    if (!response.ok) return;
    setLiked(prev => new Set([...prev, id]));
    void load();
  };

  // Extract YouTube ID from URL
  const extractYtId = (url: string) => {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/\s]{11})/);
    return m ? m[1] : null;
  };

  return (
    <div className="min-h-screen" style={{ background: DARK_BG, color: "#e5ffe5" }}>
      {/* ── Hero ── */}
      <div className="relative overflow-hidden border-b" style={{ borderColor: BORDER_G }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `linear-gradient(${GREEN}08 1px, transparent 1px), linear-gradient(90deg, ${GREEN}08 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse at 50% -30%, ${GREEN}15, transparent 60%)`,
        }} />
        <div className="relative max-w-5xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-5 text-xs font-bold tracking-widest"
            style={{ borderColor: `${GREEN}50`, background: `${GREEN}10`, color: GREEN }}>
            <BookOpen className="w-3.5 h-3.5" />
            EMPIRE STORIES — 24h CHRONICLES
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-3" style={{ color: "#fff" }}>
            STORIES &amp; <span style={{ color: GREEN }}>VOICES</span>
          </h1>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            Share moments, thoughts, and audio — every story expires in 24 hours. 
            <span className="text-yellow-400 font-bold"> +10 Coins</span> per story.
          </p>
          <div className="flex justify-center gap-8">
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: GREEN }}>{activeStories}</div>
              <div className="text-xs text-muted-foreground">Active Stories</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: GREEN }}>24h</div>
              <div className="text-xs text-muted-foreground">Story Lifespan</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-yellow-400">+10</div>
              <div className="text-xs text-muted-foreground">Coins Earned</div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full font-bold text-sm shadow-xl"
            style={{ background: GREEN, color: "#000" }}>
            📖 {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        {/* ── Compose box ── */}
        {user ? (
          <div className="rounded-2xl border p-5 space-y-4" style={{ background: CARD_BG, borderColor: `${GREEN}30` }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm text-black"
                style={{ background: GREEN }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-sm">{user.username}</div>
                <div className="text-xs text-muted-foreground">Share your story with the Empire</div>
              </div>
              <div className="ml-auto text-xs font-bold text-yellow-400">+10 Coins</div>
            </div>

            {/* Type selector */}
            <div className="flex gap-2">
              {([["text", <Type className="w-3 h-3" />, "Text"], ["audio", <Mic className="w-3 h-3" />, "Audio"], ["video", <Video className="w-3 h-3" />, "Video"]] as const).map(([t, icon, label]) => (
                <button key={t} onClick={() => setStoryType(t)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all"
                  style={{ borderColor: storyType === t ? `${GREEN}60` : BORDER_G, background: storyType === t ? `${GREEN}15` : "transparent", color: storyType === t ? GREEN : "#888" }}>
                  {icon} {label}
                </button>
              ))}
            </div>

            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Share a moment, insight, or tribute... the Empire is listening"
              maxLength={400} rows={3}
              className="w-full px-4 py-3 rounded-xl border resize-none text-sm focus:outline-none focus:border-green-500/50"
              style={{ background: "#050a05", borderColor: BORDER_G, color: "#e5ffe5" }} />

            {(storyType === "audio" || storyType === "video") && (
              <input value={audioUrl} onChange={e => setAudioUrl(e.target.value)}
                placeholder="YouTube URL (e.g. https://youtube.com/watch?v=...)"
                className="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-green-500/50"
                style={{ background: "#050a05", borderColor: BORDER_G, color: "#e5ffe5" }} />
            )}

            {/* Domain + Post row */}
            <div className="flex items-center gap-3 flex-wrap">
              <select value={domain} onChange={e => setDomain(e.target.value)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold border focus:outline-none"
                style={{ background: CARD_BG, borderColor: BORDER_G, color: "#aaa" }}>
                {Object.entries(DOMAIN_META).filter(([k]) => k !== "general").map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
                <option value="general">🌍 General</option>
              </select>
              <span className="text-xs text-muted-foreground ml-auto">{content.length}/400</span>
              <button onClick={() => void post()} disabled={!content.trim() || posting || !isOnline}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-40"
                style={{ background: GREEN, color: "#000" }}>
                <Send className="w-4 h-4" />
                {posting ? "Posting..." : "Publish Story"}
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
                <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                <span>🛡️ Content Guardian: {error}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border p-6 text-center" style={{ background: CARD_BG, borderColor: BORDER_G }}>
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: GREEN }} />
            <p className="text-muted-foreground mb-3">Login to share your story and earn +10 Coins</p>
            <Link href="/login">
              <button className="px-6 py-2 rounded-xl font-bold text-sm text-black" style={{ background: GREEN }}>
                Join the Empire
              </button>
            </Link>
          </div>
        )}

        {/* ── Domain filter ── */}
        <div className="flex gap-2 flex-wrap">
          {DOMAINS.map(d => {
            const meta = DOMAIN_META[d];
            const active = filter === d;
            return (
              <button key={d} onClick={() => setFilter(d)}
                className="px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                style={{ borderColor: active ? (meta?.color ?? GREEN) : BORDER_G, background: active ? `${meta?.color ?? GREEN}20` : "transparent", color: active ? (meta?.color ?? GREEN) : "#888" }}>
                {d === "all" ? "🌍 ALL" : `${meta?.icon} ${meta?.label}`}
              </button>
            );
          })}
        </div>

        {/* ── Stories feed ── */}
        {stories.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <BookOpen className="w-14 h-14 mx-auto mb-4 opacity-20" style={{ color: GREEN }} />
            <p className="text-lg font-bold mb-1">No stories yet</p>
            <p className="text-sm">Be the first to chronicle this moment in the Empire.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {stories.map((s, i) => {
              const dm   = DOMAIN_META[s.domain] ?? DOMAIN_META.general;
              const hl   = hoursLeft(s.expiresAt);
              const ytId = s.audioUrl ? extractYtId(s.audioUrl) : null;
              const isLiked = liked.has(s.id);

              return (
                <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="rounded-2xl border p-4 space-y-3 hover:border-green-500/20 transition-colors"
                  style={{ background: CARD_BG, borderColor: BORDER_G }}>

                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-black"
                      style={{ background: `linear-gradient(135deg, ${GREEN}, #16a34a)` }}>
                      {s.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <Link href={`/citizen/${s.username}`}>
                        <span className="text-sm font-bold hover:text-green-400 transition-colors cursor-pointer">{s.username}</span>
                      </Link>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{timeAgo(s.createdAt)}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1" style={{ color: hl < 3 ? "#f87171" : "#888" }}>
                          <Clock className="w-2.5 h-2.5" /> {hl}h left
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: `${dm.color}20`, color: dm.color }}>
                      {dm.icon} {dm.label}
                    </span>
                  </div>

                  {/* Content */}
                  <p className="text-sm leading-relaxed" style={{ color: "#d1ffd1" }}>{s.content}</p>

                  {/* Embedded YouTube for audio/video */}
                  {ytId && (
                    <div className="rounded-xl overflow-hidden border" style={{ borderColor: BORDER_G }}>
                      <div className="relative" style={{ paddingTop: "56.25%" }}>
                        <iframe src={`https://www.youtube.com/embed/${ytId}?rel=0`}
                          className="absolute inset-0 w-full h-full" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                      </div>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1 text-[10px]">
                      {s.type === "audio" && <span className="flex items-center gap-1 text-muted-foreground"><Mic className="w-3 h-3" /> Audio</span>}
                      {s.type === "video" && <span className="flex items-center gap-1 text-muted-foreground"><Video className="w-3 h-3" /> Video</span>}
                      {s.type === "text"  && <span className="flex items-center gap-1 text-muted-foreground"><Type className="w-3 h-3" /> Text</span>}
                    </div>
                    <button onClick={() => void like(s.id)} disabled={isLiked || !isOnline}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all border"
                      style={{ borderColor: isLiked ? "#f4724860" : BORDER_G, color: isLiked ? "#f47248" : "#888", background: isLiked ? "#f4724815" : "transparent" }}>
                      <Heart className={`w-3 h-3 ${isLiked ? "fill-current" : ""}`} />
                      {s.likes + (isLiked && s.likes === 0 ? 1 : 0)}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Anti-trivial badge */}
        <div className="text-center py-4">
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full border text-xs font-bold tracking-widest"
            style={{ borderColor: `${GREEN}40`, color: GREEN, background: `${GREEN}08` }}>
            🛡️ EMPIRE CONTENT GUARDIAN — No memes, no trash. Only meaningful stories.
          </div>
        </div>
      </div>
    </div>
  );
}
