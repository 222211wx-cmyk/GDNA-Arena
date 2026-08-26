import { useState, useEffect, useCallback, useRef } from "react";
import SmartDomainWidget from "@/components/SmartDomainWidget";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  Zap, Send, Heart, Globe, Trophy, Cpu, Music, Film,
  Briefcase, TrendingUp, Users, Coins, Star, Crown,
  Radio, Calendar, Flame, MessageSquare, Eye
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConnectivity } from "@/contexts/ConnectivityContext";

// ── Types ────────────────────────────────────────────────────────────────────
interface Post {
  id: number; username: string; content: string; domain: string;
  type: string; likes: number; createdAt: string;
}
interface Event {
  id: number; title: string; titleAr: string | null; domain: string;
  location: string; country: string; eventDate: string; isLive: boolean;
  icon: string; color: string; impactScore: number;
}
interface Stats {
  users: number; posts: number; coinsCirculating: number; totalXp: number;
  liveEvents: Event[];
}

// ── Constants ────────────────────────────────────────────────────────────────
const DOMAIN_TABS = [
  { id: "all",      label: "ALL",      icon: <Globe className="w-3.5 h-3.5" />,   color: "text-white" },
  { id: "sport",    label: "SPORT",    icon: <Trophy className="w-3.5 h-3.5" />,  color: "text-cyan-400" },
  { id: "tech",     label: "TECH",     icon: <Cpu className="w-3.5 h-3.5" />,     color: "text-purple-400" },
  { id: "music",    label: "MUSIC",    icon: <Music className="w-3.5 h-3.5" />,   color: "text-pink-400" },
  { id: "business", label: "BUSINESS", icon: <Briefcase className="w-3.5 h-3.5" />, color: "text-green-400" },
  { id: "cinema",   label: "CINEMA",   icon: <Film className="w-3.5 h-3.5" />,    color: "text-orange-400" },
];

const POST_TYPES = [
  { id: "post",    label: "📢 Update" },
  { id: "victory", label: "🏆 Victory" },
  { id: "tribute", label: "👑 Tribute" },
  { id: "vision",  label: "🔮 Vision" },
];

const TYPE_COLORS: Record<string, string> = {
  post:    "text-primary border-primary/30 bg-primary/10",
  victory: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  tribute: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  vision:  "text-purple-400 border-purple-400/30 bg-purple-400/10",
};

const DOMAIN_COLORS: Record<string, string> = {
  sport: "#22d3ee", tech: "#a78bfa", music: "#f472b6",
  business: "#4ade80", cinema: "#fb923c", general: "#C9A84C",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Empire Stats Bar ──────────────────────────────────────────────────────────
function StatsBar({ stats }: { stats: Stats | null }) {
  const items = [
    { icon: <Users className="w-4 h-4" />, label: "Citizens", value: stats?.users.toLocaleString() ?? "—", color: "text-primary" },
    { icon: <MessageSquare className="w-4 h-4" />, label: "Voices", value: stats?.posts.toLocaleString() ?? "—", color: "text-cyan-400" },
    { icon: <Coins className="w-4 h-4" />, label: "Coins Circulating", value: stats?.coinsCirculating.toLocaleString() ?? "—", color: "text-yellow-400" },
    { icon: <Star className="w-4 h-4" />, label: "Total XP", value: stats?.totalXp.toLocaleString() ?? "—", color: "text-purple-400" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-card/60 border border-border/50">
          <div className={`${item.color}`}>{item.icon}</div>
          <div>
            <div className={`font-black text-lg ${item.color}`}>{item.value}</div>
            <div className="text-xs text-muted-foreground">{item.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live Events Ticker ────────────────────────────────────────────────────────
function EventsPanel({ events }: { events: Event[] }) {
  const live = events.filter(e => e.isLive);
  const upcoming = events.filter(e => !e.isLive).slice(0, 8);

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm">INTERNATIONAL EVENTS</span>
        </div>
        {live.length > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-400">{live.length} LIVE</span>
          </div>
        )}
      </div>

      {live.length > 0 && (
        <div className="p-3 space-y-2 border-b border-border/50">
          {live.map(ev => (
            <div key={ev.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: `${ev.color}15`, border: `1px solid ${ev.color}30` }}>
              <span className="text-xl">{ev.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate" style={{ color: ev.color }}>{ev.title}</div>
                <div className="text-xs text-muted-foreground">{ev.country} {ev.location}</div>
              </div>
              <div className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-black">LIVE</div>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
        {upcoming.map((ev, i) => (
          <motion.div key={ev.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <span className="text-lg shrink-0">{ev.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{ev.title}</div>
              <div className="text-xs text-muted-foreground">{ev.country} · {new Date(ev.eventDate).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</div>
            </div>
            <div className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded" style={{ color: ev.color, background: `${ev.color}15` }}>
              {ev.impactScore}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────────────────────
function PostCard({ post, onLike }: { post: Post; onLike: (id: number) => Promise<boolean> }) {
  const { isOnline } = useConnectivity();
  const [liked, setLiked] = useState(false);
  const [reported, setReported] = useState(false);
  const domColor = DOMAIN_COLORS[post.domain] ?? "#C9A84C";

  const handleLike = async () => {
    if (liked || !isOnline) return;
    if (await onLike(post.id)) setLiked(true);
  };

  const handleReport = async () => {
    if (reported || !isOnline) return;
    const reason = window.prompt("⚖️ بلّغ عن سرقة محتوى — علاش هاد المنشور مسروق؟");
    if (!reason?.trim()) return;
    const r = await fetch("/api/rights/report", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "pulse_post", contentId: post.id, reason: reason.trim() }),
    });
    if (r.ok) setReported(true);
    else {
      const j = await r.json().catch(() => ({} as { error?: string }));
      window.alert((j as { error?: string }).error ?? "فشل التبليغ");
    }
  };

  const earnings = parseFloat((post as unknown as { earnings?: string }).earnings ?? "0") || 0;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-2xl bg-card border border-border/50 hover:border-primary/20 transition-all">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 text-black"
          style={{ background: `linear-gradient(135deg, ${domColor}, ${domColor}99)` }}>
          {post.username.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Link href={`/citizen/${post.username}`} className="font-bold text-sm hover:text-primary transition-colors">{post.username}</Link>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${TYPE_COLORS[post.type] ?? TYPE_COLORS.post}`}>
              {POST_TYPES.find(t => t.id === post.type)?.label ?? post.type}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: domColor, background: `${domColor}15`, border: `1px solid ${domColor}30` }}>
              {post.domain.toUpperCase()}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">{timeAgo(post.createdAt)}</span>
          </div>
          {/* Content */}
          <p className="text-sm text-foreground/90 leading-relaxed mb-3">{post.content}</p>
          {/* Actions */}
          <div className="flex items-center gap-4">
            <button onClick={() => void handleLike()} disabled={!isOnline || liked}
              className={`flex items-center gap-1.5 text-xs transition-all active:scale-95 ${liked ? "text-red-400" : "text-muted-foreground hover:text-red-400"}`}>
              <Heart className={`w-4 h-4 ${liked ? "fill-red-400" : ""}`} />
              {post.likes + (liked ? 1 : 0)}
            </button>
            {earnings > 0 && (
              <span className="text-xs font-bold" style={{ color: "#C9A84C" }} title="أرباح صاحب المحتوى">
                💰 {earnings.toFixed(2)}
              </span>
            )}
            <button onClick={() => void handleReport()} disabled={!isOnline || reported}
              className={`text-xs ml-auto transition-all ${reported ? "text-green-400" : "text-muted-foreground/60 hover:text-red-400"}`}
              title="بلّغ عن سرقة محتوى">
              {reported ? "✅ تم التبليغ" : "🚨"}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Compose Box ────────────────────────────────────────────────────────────────
function ComposeBox({ onPosted }: { onPosted: () => void }) {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const [content, setContent] = useState("");
  const [domain, setDomain] = useState("general");
  const [type, setType] = useState("post");
  const [sending, setSending] = useState(false);
  const [xpToast, setXpToast] = useState(false);

  const submit = async () => {
    if (!content.trim() || sending || !isOnline) return;
    setSending(true);
    try {
      const res = await fetch("/api/pulse/post", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), domain, type }),
      });
      const data = await res.json() as { xpEarned?: number; error?: string };
      if (res.ok) {
        setContent("");
        if (data.xpEarned) { setXpToast(true); setTimeout(() => setXpToast(false), 3000); }
        onPosted();
      }
    } finally { setSending(false); }
  };

  return (
    <div className="rounded-2xl bg-card border border-primary/20 p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/60 to-yellow-500/60 flex items-center justify-center text-xs font-black text-black">
          {user?.username?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <span className="text-sm font-bold text-foreground">{user ? user.username : "Guest"}</span>
        {user && <span className="text-xs text-green-400 ml-auto">+20 XP per post</span>}
      </div>
      <textarea
        value={content} onChange={e => setContent(e.target.value)}
        placeholder={user ? "What moves the empire today?..." : "Login to post to the empire feed..."}
        disabled={!user}
        maxLength={280} rows={3}
        className="w-full px-3 py-2 rounded-xl bg-background border border-border focus:border-primary focus:outline-none text-sm placeholder-muted-foreground resize-none disabled:opacity-50"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <select value={domain} onChange={e => setDomain(e.target.value)} disabled={!user}
          className="text-xs px-2 py-1.5 rounded-lg bg-muted border border-border focus:outline-none disabled:opacity-50">
          {DOMAIN_TABS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} disabled={!user}
          className="text-xs px-2 py-1.5 rounded-lg bg-muted border border-border focus:outline-none disabled:opacity-50">
          {POST_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{content.length}/280</span>
        <button onClick={() => void submit()} disabled={!content.trim() || sending || !user || !isOnline}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-40 active:scale-95 transition-all">
          <Send className="w-3.5 h-3.5" /> {sending ? "Sending..." : "Post"}
        </button>
      </div>
      <AnimatePresence>
        {xpToast && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-center text-green-400 text-xs font-bold">⚡ +20 XP earned!</motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function PulsePage() {
  const [posts, setPosts]     = useState<Post[]>([]);
  const [events, setEvents]   = useState<Event[]>([]);
  const [stats, setStats]     = useState<Stats | null>(null);
  const [domain, setDomain]   = useState("all");
  const [loading, setLoading] = useState(true);

  const loadPosts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const url = `/api/pulse/feed${domain !== "all" ? `?domain=${domain}` : ""}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json() as { posts: Post[] };
      setPosts(data.posts ?? []);
    } finally { if (!silent) setLoading(false); }
  }, [domain]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadPosts(),
      fetch("/api/pulse/events", { credentials: "include" })
        .then(r => r.json() as Promise<{ events: Event[] }>)
        .then(d => setEvents(d.events ?? [])),
      fetch("/api/pulse/stats", { credentials: "include" })
        .then(r => r.json() as Promise<Stats>)
        .then(d => setStats(d)),
    ]);
  }, [loadPosts]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const t = setInterval(() => void loadPosts(true), 10_000);
    return () => clearInterval(t);
  }, [loadPosts]);

  const handleLike = async (postId: number) => {
    const response = await fetch(`/api/pulse/post/${postId}/like`, { method: "POST", credentials: "include" });
    return response.ok;
  };

  const liveCount = events.filter(e => e.isLive).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-primary/10 bg-gradient-to-b from-black via-background to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(201,168,76,0.12),transparent_70%)]" />
        <div className="relative max-w-6xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-bold tracking-widest mb-5">
            <Radio className="w-3.5 h-3.5 animate-pulse" /> EMPIRE PULSE — LIVE FEED
            {liveCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black">{liveCount} LIVE</span>}
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-3">
            <span className="text-foreground">EMPIRE </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-600">PULSE</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-base">
            Connect · Events · Vision · Progress · Growth · Prosperity · Occasions
          </p>
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="mb-8">
          <StatsBar stats={stats} />
        </div>

        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Feed (main) */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Smart Domain Widget */}
            <SmartDomainWidget domainId="social" label="Module Social & Stream" />

            {/* Compose */}
            <ComposeBox onPosted={() => void loadPosts(true)} />

            {/* Domain filter */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DOMAIN_TABS.map(d => (
                <button key={d.id} onClick={() => setDomain(d.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
                    domain === d.id ? "bg-primary/20 border-primary/50 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
                  }`}>
                  {d.icon} {d.label}
                </button>
              ))}
            </div>

            {/* Posts */}
            {loading ? (
              <div className="space-y-3">
                {Array.from({length: 4}).map((_,i) => <div key={i} className="h-28 bg-card/40 rounded-2xl animate-pulse" />)}
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Flame className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No posts yet — be the first voice in this domain.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map(p => <PostCard key={p.id} post={p} onLike={handleLike} />)}
              </div>
            )}
          </div>

          {/* Sidebar — Events */}
          <div className="w-full lg:w-80 shrink-0">
            <div className="sticky top-20 space-y-4">
              <EventsPanel events={events} />

              {/* Empire Vision */}
              <div className="rounded-2xl bg-card border border-yellow-400/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-400" />
                  <span className="font-bold text-sm text-yellow-400">EMPIRE VISION</span>
                </div>
                {[
                  { icon:"🌍", label:"Global Citizens",   value:"195 Countries" },
                  { icon:"⚡", label:"Neural Engine",      value:"v1.0 Active" },
                  { icon:"🏆", label:"Legends Tracked",    value:"10 / ∞" },
                  { icon:"🎓", label:"Education Hub",      value:"Coming Soon" },
                  { icon:"🔗", label:"Blockchain Layer",   value:"Roadmap Q3" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.icon} {item.label}</span>
                    <span className="text-foreground font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
