import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Crown, Sword, Shield, ArrowLeft, Gamepad2, Trophy,
  MessageSquare, Eye, Coins, Zap, Star, Globe,
  Music, Cpu, Briefcase, Film, Calendar, Medal, Heart,
  AlertTriangle, CheckCircle, Phone, Video, MessageCircle,
  Lock, ExternalLink
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCallContext } from "@/contexts/CallContext";

// ── Types ─────────────────────────────────────────────────────────────────────
interface HonorInfo { title: string; color: string; badge: string }
interface Rank { label: string; tier: number; color: string; icon: string }
interface Citizen {
  id: number; username: string; xp: number; balance: number;
  gamesPlayed: number; wins: number; createdAt: string;
  honorCount: number; isMuted: boolean; isTrending: boolean;
  rank: Rank; honorInfo: HonorInfo;
  specialty: string; totalDebates: number;
  uniqueLegends: number; totalWatches: number;
  recentHonors: string[];
}
interface Post {
  id: number; content: string; domain: string; type: string;
  likes: number; createdAt: string;
}
interface Achievement { id: string; icon: string; label: string; earned: boolean }

// ── Archon types ──────────────────────────────────────────────────────────────
interface ArchonPublicProfile {
  archonCode: string;
  archetype: string;
  dimensions: {
    volontas: number; resilentia: number; intellectus: number;
    disciplina: number; societas: number; abundantia: number; auctoritas: number;
  };
  overallScore: number;
  archetypeDeclaration: string | null;
}

const ARCHETYPES: Record<string, { color: string; symbol: string; ar: string }> = {
  "THE SOVEREIGN":   { color: "#C9A84C", symbol: "♔", ar: "السيد المطلق" },
  "THE CONQUEROR":   { color: "#FF6B35", symbol: "⚔", ar: "الفاتح" },
  "THE VISIONARY":   { color: "#A8E6CF", symbol: "👁", ar: "الرائي" },
  "THE ARCHITECT":   { color: "#DDA0DD", symbol: "⚙", ar: "المعماري" },
  "THE CATALYST":    { color: "#87CEEB", symbol: "◈", ar: "المحرك" },
  "THE SENTINEL":    { color: "#98FB98", symbol: "🛡", ar: "الحارس" },
  "THE SEEKER":      { color: "#E8C97A", symbol: "◉", ar: "الباحث" },
};

function computeFourPillars(d: ArchonPublicProfile["dimensions"], overallScore: number) {
  const dimVals = Object.values(d);
  return [
    {
      id: "mens",    latin: "MENS",    ar: "العقل الإمبراطوري", sub: "Clarity · Vision · Authority",
      symbol: "🧠", color: "#A8E6CF",
      score: Math.round((d.intellectus + d.auctoritas) / 2),
    },
    {
      id: "vis",     latin: "VIS",     ar: "قوة التنفيذ",       sub: "Will · Discipline · Action",
      symbol: "⚔️", color: "#C9A84C",
      score: Math.round((d.volontas + d.disciplina) / 2),
    },
    {
      id: "anima",   latin: "ANIMA",   ar: "روح المحارب",       sub: "Resilience · Influence · Connection",
      symbol: "🔥", color: "#FF8C42",
      score: Math.round((d.resilentia + d.societas) / 2),
    },
    {
      id: "legatum", latin: "LEGATUM", ar: "الإرث الأبدي",      sub: "Abundance · Balance · Legacy",
      symbol: "👑", color: "#DDA0DD",
      score: Math.round((d.abundantia * 0.5) + (overallScore * 0.3) + (Math.min(...dimVals) * 0.2)),
    },
  ];
}

// ── Empire Identity Section ────────────────────────────────────────────────────
function EmpireIdentitySection({ username }: { username: string }) {
  const [profile, setProfile] = useState<ArchonPublicProfile | "loading" | "none">("loading");

  useEffect(() => {
    fetch(`/api/archon/profile/${encodeURIComponent(username)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setProfile(d ?? "none"))
      .catch(() => setProfile("none"));
  }, [username]);

  if (profile === "loading") return (
    <div className="mt-6 p-5 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 animate-pulse">
      <div className="h-4 w-40 bg-yellow-500/20 rounded mb-3" />
      <div className="h-24 bg-yellow-500/10 rounded" />
    </div>
  );

  // ── LOCKED STATE ─────────────────────────────────────────────────────────────
  if (profile === "none") return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-2xl border border-primary/20 overflow-hidden bg-card">
      <div className="p-5 relative">
        <div className="relative flex flex-col items-center text-center gap-3 py-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-primary/5 border border-primary/20">
            <Lock className="w-6 h-6 text-primary/50" />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.4em] text-primary/60 mb-1">EMPIRE IDENTITY</div>
            <div className="text-lg font-black text-primary/40 tracking-widest">CLASSIFIED</div>
            <div className="text-xs text-muted-foreground mt-1 font-mono">INITIATION PENDING — ARCHON SYSTEM v4.2</div>
          </div>
          <div className="mt-1 px-4 py-2 rounded-xl border border-primary/20 bg-primary/5 text-xs text-primary/50 font-mono tracking-wider">
            ⚡ THIS CITIZEN HAS NOT COMPLETED ARCHON INITIATION
          </div>
        </div>
      </div>
    </motion.div>
  );

  // ── PROFILE STATE ────────────────────────────────────────────────────────────
  const archInfo = ARCHETYPES[profile.archetype] ?? ARCHETYPES["THE SEEKER"];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-2xl border overflow-hidden"
      style={{ borderColor: `${archInfo.color}40` }}>

      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ background: `linear-gradient(135deg, ${archInfo.color}15, transparent)`, borderBottom: `1px solid ${archInfo.color}20` }}>
        <div className="text-xs font-black tracking-[0.4em]" style={{ color: archInfo.color }}>⚡ EMPIRE IDENTITY</div>
        <div className="text-xs font-mono text-muted-foreground">ARCHON SYSTEM v4.2</div>
      </div>

      <div className="p-5 space-y-5 bg-card">

        {/* Archetype Hero */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0"
            style={{ background: `${archInfo.color}15`, border: `1px solid ${archInfo.color}40` }}>
            {archInfo.symbol}
          </div>
          <div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest mb-0.5">ARCHON ARCHETYPE</div>
            <div className="text-xl font-black tracking-wider" style={{ color: archInfo.color }}>
              {profile.archetype}
            </div>
            <div className="text-sm font-bold text-muted-foreground" dir="rtl">{archInfo.ar}</div>
          </div>
          <div className="ml-auto text-right shrink-0">
            <div className="text-3xl font-black" style={{ color: archInfo.color }}>{profile.overallScore}</div>
            <div className="text-xs text-muted-foreground">/ 100 SCORE</div>
          </div>
        </div>

        {/* Cipher code */}
        <div className="px-4 py-2.5 rounded-xl flex items-center justify-between"
          style={{ background: `${archInfo.color}08`, border: `1px solid ${archInfo.color}25` }}>
          <span className="text-xs font-mono text-muted-foreground tracking-widest">CIPHER CODE</span>
          <span className="font-mono font-black text-sm tracking-widest" style={{ color: archInfo.color }}>
            {profile.archonCode}
          </span>
        </div>

        {/* Four Pillars */}
        <div>
          <div className="text-xs font-black tracking-[0.35em] text-muted-foreground mb-3">FOUR PILLARS — GROWTH ENGINE</div>
          <div className="space-y-3">
            {computeFourPillars(profile.dimensions, profile.overallScore).map(p => (
              <div key={p.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{p.symbol}</span>
                    <div>
                      <span className="text-xs font-black tracking-wider" style={{ color: p.color }}>{p.latin}</span>
                      <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{p.sub}</span>
                    </div>
                  </div>
                  <span className="text-xs font-black" style={{ color: p.color }}>{p.score}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${p.score}%` }}
                    transition={{ duration: 1, ease: "easeOut", delay: 0.1 }}
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${p.color}90, ${p.color})` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Archetype declaration */}
        {profile.archetypeDeclaration && (
          <div className="px-4 py-3 rounded-xl italic text-sm text-muted-foreground leading-relaxed bg-card border-l-2"
            style={{ borderLeftColor: `${archInfo.color}60` }}>
            "{profile.archetypeDeclaration}"
          </div>
        )}
      </div>
    </motion.div>
  );
}

const DOMAIN_META: Record<string, { icon: React.ReactNode; color: string }> = {
  sport:    { icon: <Trophy className="w-4 h-4" />,    color: "#22d3ee" },
  tech:     { icon: <Cpu className="w-4 h-4" />,       color: "#a78bfa" },
  music:    { icon: <Music className="w-4 h-4" />,     color: "#f472b6" },
  business: { icon: <Briefcase className="w-4 h-4" />, color: "#4ade80" },
  cinema:   { icon: <Film className="w-4 h-4" />,      color: "#fb923c" },
  general:  { icon: <Globe className="w-4 h-4" />,     color: "#C9A84C" },
};

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en", { month: "short", year: "numeric" });
}

// ── Rank visual ───────────────────────────────────────────────────────────────
function RankBadge({ rank }: { rank: Rank }) {
  const icons = [Star, Sword, Shield, Crown, Crown, Trophy, Zap];
  const Icon = icons[rank.tier] ?? Crown;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
      style={{ color: rank.color, borderColor: `${rank.color}40`, background: `${rank.color}10` }}>
      <Icon className="w-4 h-4" />
      <span className="font-black text-sm tracking-wide">{rank.label}</span>
    </div>
  );
}

// ── XP Progress bar ───────────────────────────────────────────────────────────
function XpBar({ xp }: { xp: number }) {
  const thresholds = [0, 200, 500, 1000, 2000, 3500, 5000, 7500, 12000, 20000, 99999];
  let idx = thresholds.findIndex(t => xp < t) - 1;
  if (idx < 0) idx = thresholds.length - 2;
  const lo = thresholds[idx] ?? 0;
  const hi = thresholds[idx + 1] ?? 99999;
  const pct = hi >= 99999 ? 100 : Math.round(((xp - lo) / (hi - lo)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{xp.toLocaleString()} XP</span>
        {hi < 99999 && <span>{hi.toLocaleString()} next rank</span>}
        {hi >= 99999 && <span className="text-yellow-400 font-bold">⚡ MAX RANK — EMPEROR</span>}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: "easeOut" }}
          className="h-full rounded-full bg-gradient-to-r from-primary to-yellow-400" />
      </div>
    </div>
  );
}

// ── Honor progress bar ────────────────────────────────────────────────────────
function HonorBar({ honorCount, honorInfo }: { honorCount: number; honorInfo: HonorInfo }) {
  const thresholds = [0, 1, 5, 10, 25, 50, 999];
  let idx = thresholds.findIndex(t => honorCount < t) - 1;
  if (idx < 0) idx = thresholds.length - 2;
  const lo = thresholds[idx] ?? 0;
  const hi = thresholds[idx + 1] ?? 999;
  const pct = hi >= 999 ? 100 : Math.round(((honorCount - lo) / (hi - lo)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span style={{ color: honorInfo.color }}>{honorCount} honor points</span>
        {hi < 999 && <span className="text-muted-foreground">{hi} for next title</span>}
        {hi >= 999 && <span style={{ color: "#FFD700" }}>🏆 IMPERIAL LEGEND</span>}
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
          className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${honorInfo.color}, ${honorInfo.color}88)` }} />
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function CitizenPage() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser } = useAuth();
  const call = useCallContext();
  const [, navigate] = useLocation();
  const [data, setData] = useState<{
    citizen: Citizen; recentPosts: Post[]; achievements: Achievement[];
    violations: { reason: string; severity: string }[];
    earned: number; total: number;
  } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);
  const [honorLoading, setHonorLoading] = useState(false);
  const [honorDone, setHonorDone]   = useState(false);
  const [honorErr, setHonorErr]     = useState("");

  async function openDM(targetUsername: string) {
    try {
      await fetch("/api/messages/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetUsername, type: "direct" }),
      });
    } catch { /* ignore — room may already exist */ }
    navigate("/messages");
  }

  const fetchData = () => {
    if (!username) return;
    setLoading(true);
    fetch(`/api/citizens/${encodeURIComponent(username)}`, { credentials: "include" })
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then(d => { if (d) setData(d as typeof data); })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [username]);

  const giveHonor = async () => {
    setHonorLoading(true); setHonorErr("");
    try {
      const r = await fetch(`/api/citizens/${encodeURIComponent(username!)}/honor`, {
        method: "POST", credentials: "include",
      });
      if (r.status === 409) { setHonorErr("You have already honored this citizen."); return; }
      if (!r.ok) { const d = await r.json(); setHonorErr(d.error ?? "Error"); return; }
      setHonorDone(true);
      fetchData();
    } finally {
      setHonorLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );

  if (notFound || !data) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Crown className="w-16 h-16 text-muted-foreground/30" />
      <p className="text-xl font-bold">Citizen not found</p>
      <Link href="/citizens" className="text-primary hover:underline text-sm">← View all citizens</Link>
    </div>
  );

  const { citizen, recentPosts, achievements, violations, earned, total } = data;
  const domMeta = DOMAIN_META[citizen.specialty] ?? DOMAIN_META.general;
  const winRate = citizen.gamesPlayed > 0 ? Math.round((citizen.wins / citizen.gamesPlayed) * 100) : 0;
  const joinDate = new Date(citizen.createdAt).toLocaleDateString("en", { month: "long", year: "numeric" });
  const initials = citizen.username.slice(0, 2).toUpperCase();
  const isSelf = currentUser?.username === citizen.username;

  return (
    <div className="min-h-screen bg-background">
      {/* Back */}
      <div className="max-w-4xl mx-auto px-4 pt-6">
        <Link href="/citizens" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Citizens
        </Link>
      </div>

      {/* Hero Card */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border p-8"
          style={{ borderColor: `${citizen.rank.color}30`, background: `linear-gradient(135deg, ${citizen.rank.color}08, transparent)` }}>

          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at top right, ${citizen.rank.color}15, transparent 60%)` }} />

          <div className="relative flex flex-col md:flex-row gap-6 items-start md:items-center">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-black text-black"
                style={{ background: `linear-gradient(135deg, ${citizen.rank.color}, ${citizen.rank.color}88)` }}>
                {initials}
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 border-background bg-card">
                {citizen.rank.icon}
              </div>
              {citizen.isTrending && (
                <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-yellow-400 border-2 border-black flex items-center justify-center text-xs animate-pulse" title="Trending on GDNA">🔥</div>
              )}
              {citizen.isMuted && (
                <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-red-900 border border-red-500 flex items-center justify-center text-xs" title="Muted">🔇</div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black">{citizen.username}</h1>
                <RankBadge rank={citizen.rank} />
              </div>

              {/* Honor Title */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-black"
                style={{ color: citizen.honorInfo.color, borderColor: `${citizen.honorInfo.color}40`, background: `${citizen.honorInfo.color}10` }}>
                <Medal className="w-3.5 h-3.5" />
                {citizen.honorInfo.badge} {citizen.honorInfo.title} — {citizen.honorCount} Honor Points
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1" style={{ color: domMeta.color }}>
                  {domMeta.icon} {citizen.specialty.toUpperCase()} DOMAIN
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Joined {joinDate}
                </span>
                <span>·</span>
                <span className="flex items-center gap-1 text-yellow-400 font-bold">
                  {earned}/{total} achievements
                </span>
              </div>

              <XpBar xp={citizen.xp} />
              <HonorBar honorCount={citizen.honorCount} honorInfo={citizen.honorInfo} />
            </div>
          </div>

          {/* Action buttons */}
          {currentUser && !isSelf && (
            <div className="relative mt-5 flex flex-wrap items-center gap-3">
              {/* Call / Message */}
              <button onClick={() => openDM(citizen.username)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
                style={{ background: "#3b82f620", border: "1px solid #3b82f650", color: "#3b82f6" }}>
                <MessageCircle className="w-4 h-4" /> رسالة
              </button>
              <button onClick={() => call.startCall(citizen.username, false)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
                style={{ background: "#22c55e20", border: "1px solid #22c55e50", color: "#22c55e" }}>
                <Phone className="w-4 h-4" /> صوتي
              </button>
              <button onClick={() => call.startCall(citizen.username, true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
                style={{ background: "#a855f720", border: "1px solid #a855f750", color: "#a855f7" }}>
                <Video className="w-4 h-4" /> فيديو
              </button>

              {/* Divider */}
              <div style={{ width: 1, height: 28, background: "#ffffff15" }} />

              {/* Give Honor */}
              {honorDone ? (
                <div className="flex items-center gap-2 text-sm text-green-400 font-bold">
                  <CheckCircle className="w-4 h-4" /> تم الشرف! شكراً لك.
                </div>
              ) : (
                <button onClick={giveHonor} disabled={honorLoading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  style={{ background: `${citizen.honorInfo.color}20`, border: `1px solid ${citizen.honorInfo.color}50`, color: citizen.honorInfo.color }}>
                  <Heart className="w-4 h-4" />
                  {honorLoading ? "…" : `شرّف ${citizen.username}`}
                </button>
              )}
              {honorErr && <span className="text-xs text-red-400">{honorErr}</span>}
            </div>
          )}
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
          {[
            { icon: <Zap className="w-5 h-5" />,           label: "XP",        value: citizen.xp.toLocaleString(),         color: "text-primary" },
            { icon: <Coins className="w-5 h-5" />,          label: "Coins",     value: citizen.balance.toLocaleString(),    color: "text-yellow-400" },
            { icon: <Medal className="w-5 h-5" />,          label: "Honor",     value: citizen.honorCount.toString(),       color: "text-cyan-400" },
            { icon: <Gamepad2 className="w-5 h-5" />,       label: "Games",     value: citizen.gamesPlayed.toString(),      color: "text-cyan-400" },
            { icon: <Trophy className="w-5 h-5" />,         label: "Win Rate",  value: `${winRate}%`,                       color: "text-green-400" },
            { icon: <MessageSquare className="w-5 h-5" />,  label: "Debates",   value: citizen.totalDebates.toString(),     color: "text-purple-400" },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-2xl bg-card border border-border/50 text-center">
              <div className={`flex justify-center mb-1 ${s.color}`}>{s.icon}</div>
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Recent Honors */}
        {citizen.recentHonors.length > 0 && (
          <div className="mt-5 p-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/5">
            <div className="text-xs font-black text-yellow-400 tracking-widest mb-2">🎖️ RECENTLY HONORED BY</div>
            <div className="flex flex-wrap gap-2">
              {citizen.recentHonors.map(name => (
                <Link key={name} href={`/citizen/${name}`}>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-card border border-border/50 hover:border-primary/40 transition-colors cursor-pointer font-bold">
                    {name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Violations (if any) */}
        {violations.length > 0 && (
          <div className="mt-4 p-4 rounded-2xl border border-red-500/20 bg-red-900/10">
            <div className="flex items-center gap-2 text-xs font-black text-red-400 tracking-widest mb-2">
              <AlertTriangle className="w-3.5 h-3.5" /> PROTOCOL VIOLATIONS
            </div>
            <div className="space-y-1">
              {violations.map((v, i) => (
                <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className={`font-bold ${v.severity === 'severe' ? 'text-red-400' : 'text-orange-400'}`}>
                    {v.severity.toUpperCase()}
                  </span>
                  <span>— {v.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empire Identity */}
        <EmpireIdentitySection username={username!} />

        {/* Achievements */}
        <div className="mt-6">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400" /> Achievements
          </h2>
          <div className="grid grid-cols-5 sm:grid-cols-12 gap-2">
            {achievements.map(a => (
              <motion.div key={a.id} whileHover={{ scale: 1.1 }}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center cursor-default transition-all ${
                  a.earned ? "bg-primary/10 border-primary/30" : "bg-muted/30 border-border/30 opacity-40 grayscale"
                }`}
                title={a.label}>
                <span className="text-2xl">{a.icon}</span>
                <span className="text-[9px] font-bold text-muted-foreground leading-tight">{a.label}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        {recentPosts.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> Recent Empire Activity
            </h2>
            <div className="space-y-3">
              {recentPosts.map(p => (
                <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="p-4 rounded-2xl bg-card border border-border/50">
                  <p className="text-sm text-foreground/90 leading-relaxed mb-2">{p.content}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="uppercase font-bold" style={{ color: DOMAIN_META[p.domain]?.color ?? "#C9A84C" }}>{p.domain}</span>
                    <span>·</span>
                    <span>❤️ {p.likes}</span>
                    <span>·</span>
                    <span>{timeAgo(p.createdAt)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Honor System Explanation */}
        <div className="mt-8 p-5 rounded-2xl border border-primary/20 bg-primary/5">
          <div className="text-xs font-black text-primary tracking-widest mb-3">🏛️ CITIZEN HONOR SYSTEM — PROTOCOL</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { badge: "🌱", title: "New Citizen",     min: 0  },
              { badge: "🤝", title: "Trusted",         min: 1  },
              { badge: "✅", title: "Respected",       min: 5  },
              { badge: "🎖️", title: "Honorable",      min: 10 },
              { badge: "💎", title: "Distinguished",   min: 25 },
              { badge: "🏆", title: "Imperial Legend", min: 50 },
            ].map(t => (
              <div key={t.title} className={`flex items-center gap-2 text-xs ${citizen.honorCount >= t.min ? 'opacity-100' : 'opacity-40'}`}>
                <span className="text-lg">{t.badge}</span>
                <div>
                  <div className="font-black">{t.title}</div>
                  <div className="text-muted-foreground">{t.min}+ honor pts</div>
                </div>
                {citizen.honorCount >= t.min && <Eye className="w-3 h-3 text-primary ml-auto" />}
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground border-t border-border/30 pt-3">
            🛡️ <span className="font-bold text-foreground">Anti-Trivial Protocol:</span> Citizens who post memes, trash, or off-topic content receive violations.
            Only Education · Sport · Science · Art · Business · Debates · Achievements are honored.
          </div>
        </div>
      </div>
    </div>
  );
}
