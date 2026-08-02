import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Users, Crown, Sword, Shield, Zap, Coins,
  Trophy, Gamepad2, TrendingUp, Search, Star, Medal,
  Phone, Video, MessageSquare, UserPlus, UserCheck, Loader2
} from "lucide-react";
import { useAuth }        from "@/contexts/AuthContext";
import { useCallContext } from "@/contexts/CallContext";

interface HonorInfo { title: string; color: string; badge: string }
interface Rank { label: string; tier: number; color: string; icon: string }
interface Citizen {
  id: number; username: string; xp: number; balance: number;
  gamesPlayed: number; wins: number; createdAt: string;
  honorCount: number; isMuted: boolean;
  rank: Rank; honorInfo: HonorInfo; position: number;
}

const TIER_ICONS: Record<number, React.ReactNode> = {
  0: <Star className="w-4 h-4" />,
  1: <Sword className="w-4 h-4" />,
  2: <Shield className="w-4 h-4" />,
  3: <Crown className="w-4 h-4" />,
  4: <Crown className="w-4 h-4" />,
  5: <Trophy className="w-4 h-4" />,
  6: <Zap className="w-4 h-4" />,
};

const GREEN = "#22c55e";
const BASE  = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const bapi  = (p: string) => `${BASE()}${p}`;

export default function CitizensPage() {
  const { user }     = useAuth();
  const call         = useCallContext();
  const [, navigate] = useLocation();

  const [citizens,   setCitizens]   = useState<Citizen[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [sort,       setSort]       = useState<"xp" | "coins" | "honor">("xp");
  const [query,      setQuery]      = useState("");
  const [followIds,  setFollowIds]  = useState<Set<number>>(new Set());
  const [addingId,   setAddingId]   = useState<number | null>(null);
  const [dmId,       setDmId]       = useState<number | null>(null);

  /* Load citizens */
  useEffect(() => {
    setLoading(true);
    fetch(`/api/citizens?sort=${sort}&limit=50`, { credentials: "include" })
      .then(r => r.json() as Promise<{ citizens: Citizen[] }>)
      .then(d => setCitizens(d.citizens ?? []))
      .finally(() => setLoading(false));
  }, [sort]);

  /* Load who I follow */
  const loadFollowing = useCallback(async () => {
    if (!user) return;
    const res = await fetch(bapi("/api/social/v2/following"), { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json() as { following: { id: number }[] };
    setFollowIds(new Set((d.following ?? []).map(f => f.id)));
  }, [user]);

  useEffect(() => { void loadFollowing(); }, [loadFollowing]);

  /* Follow / unfollow */
  const toggleFollow = async (username: string, id: number) => {
    if (!user) return;
    setAddingId(id);
    const method = followIds.has(id) ? "DELETE" : "POST";
    await fetch(bapi(`/api/social/v2/follow/${encodeURIComponent(username)}`), {
      method, credentials: "include",
    });
    await loadFollowing();
    setAddingId(null);
  };

  /* Open DM → navigate to /messages */
  const openDM = async (username: string, id: number) => {
    if (!user) return;
    setDmId(id);
    const res = await fetch(bapi("/api/messages/rooms"), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUsername: username, type: "direct" }),
    });
    setDmId(null);
    if (res.ok) navigate("/messages");
  };

  const filtered = citizens.filter(c =>
    !query || c.username.toLowerCase().includes(query.toLowerCase())
  );

  const topThree  = filtered.slice(0, 3);
  const theRest   = filtered.slice(3);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-primary/10 bg-gradient-to-b from-black to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(34,197,94,0.08),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-bold tracking-widest mb-5">
            <Users className="w-3.5 h-3.5" /> EMPIRE CITIZENS — HONOR BOARD
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-3">
            CITIZEN <span className="text-primary">DIRECTORY</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            The Empire's ranked citizens — every XP earned, every honor given, every battle won is recorded here.
          </p>

          {/* Honor System Banner */}
          <div className="mt-6 inline-flex items-center gap-3 px-5 py-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 text-sm">
            <span className="text-xl">🎖️</span>
            <div className="text-left">
              <div className="font-black text-yellow-400 text-xs tracking-widest">CITIZEN HONOR SYSTEM</div>
              <div className="text-muted-foreground text-xs">Honor respectful citizens · Earn titles · Build your legacy</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search citizens..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border/50 focus:border-primary/50 outline-none text-sm transition-colors"
            />
          </div>
          <div className="flex gap-2">
            {([
              { v: "xp",    label: "XP Rank",    icon: <Zap className="w-3.5 h-3.5" /> },
              { v: "honor", label: "Honor",       icon: <Medal className="w-3.5 h-3.5" /> },
              { v: "coins", label: "Coins",       icon: <Coins className="w-3.5 h-3.5" /> },
            ] as const).map(s => (
              <button key={s.v} onClick={() => setSort(s.v)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  sort === s.v
                    ? "bg-primary text-black border-primary shadow-lg shadow-primary/20"
                    : "bg-card border-border/50 text-muted-foreground hover:border-primary/30"
                }`}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Top 3 Podium */}
            {topThree.length > 0 && (
              <div className="mb-8">
                <div className="flex items-end justify-center gap-3 md:gap-6">
                  {[topThree[1], topThree[0], topThree[2]].filter(Boolean).map((c, i) => {
                    const podiumPos = i === 0 ? 2 : i === 1 ? 1 : 3;
                    const heights  = { 1: "h-44", 2: "h-36", 3: "h-28" } as Record<number, string>;
                    const sizes    = { 1: "w-20 h-20", 2: "w-16 h-16", 3: "w-14 h-14" } as Record<number, string>;
                    const medals   = { 1: "🥇", 2: "🥈", 3: "🥉" } as Record<number, string>;
                    if (!c) return null;
                    return (
                      <motion.div key={c.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="flex flex-col items-center flex-1 max-w-[180px]">
                        <div className={`${sizes[podiumPos]} rounded-2xl flex items-center justify-center text-2xl font-black text-black mb-2 ring-2 ring-offset-2 ring-offset-background`}
                          style={{ background: `linear-gradient(135deg, ${c.rank.color}, ${c.rank.color}99)`, outline: `2px solid ${c.rank.color}` }}>
                          {c.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="text-xs font-black mb-1">{medals[podiumPos]}</div>
                        <Link href={`/citizen/${c.username}`}>
                          <div className="font-black text-sm text-center hover:text-primary transition-colors truncate max-w-full cursor-pointer">
                            {c.username}
                          </div>
                        </Link>
                        <div className="text-[10px] font-bold mt-0.5" style={{ color: c.rank.color }}>
                          {c.rank.icon} {c.rank.label}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: c.honorInfo.color }}>
                          {c.honorInfo.badge} {c.honorInfo.title}
                        </div>
                        <div className={`w-full ${heights[podiumPos]} mt-3 rounded-t-xl flex flex-col items-center justify-end pb-3 border-t border-l border-r`}
                          style={{ background: `${c.rank.color}15`, borderColor: `${c.rank.color}30` }}>
                          <div className="text-xs font-black" style={{ color: c.rank.color }}>
                            {sort === "honor" ? `${c.honorCount} honors` : sort === "coins" ? `${c.balance.toLocaleString()}` : `${c.xp.toLocaleString()} XP`}
                          </div>
                          <div className="text-[10px] text-muted-foreground">#1 {sort === "honor" ? "Honor" : sort === "coins" ? "Coins" : "XP"}</div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Rest of leaderboard */}
            <div className="space-y-2">
              {theRest.map(c => (
                <motion.div key={c.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 p-3 md:p-4 rounded-2xl bg-card border border-border/30 hover:border-primary/30 transition-all group">
                  <div className="w-8 text-center text-sm font-black text-muted-foreground shrink-0">
                    #{c.position}
                  </div>
                  <Link href={`/citizen/${c.username}`}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-black shrink-0 cursor-pointer group-hover:scale-105 transition-transform"
                      style={{ background: `linear-gradient(135deg, ${c.rank.color}, ${c.rank.color}88)` }}>
                      {c.username.slice(0, 2).toUpperCase()}
                    </div>
                  </Link>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/citizen/${c.username}`}>
                        <span className="font-black text-sm hover:text-primary transition-colors cursor-pointer">
                          {c.username}
                        </span>
                      </Link>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ color: c.rank.color, borderColor: `${c.rank.color}40`, background: `${c.rank.color}10` }}>
                        {c.rank.icon} {c.rank.label}
                      </span>
                      <span className="text-[10px] font-bold"
                        style={{ color: c.honorInfo.color }}>
                        {c.honorInfo.badge} {c.honorInfo.title}
                      </span>
                      {c.isMuted && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-900/30 border border-red-500/30 text-red-400">
                          🔇 MUTED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1 text-primary">
                        <Zap className="w-3 h-3" /> {c.xp.toLocaleString()} XP
                      </span>
                      <span className="flex items-center gap-1 text-yellow-400">
                        <Coins className="w-3 h-3" /> {c.balance.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1" style={{ color: c.honorInfo.color }}>
                        🎖️ {c.honorCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Gamepad2 className="w-3 h-3" /> {c.gamesPlayed}
                      </span>
                    </div>
                  </div>

                  {/* ── Communication buttons (logged-in only, not yourself) ── */}
                  {user && c.id !== user.id && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      {/* رسالة */}
                      <button onClick={() => void openDM(c.username, c.id)}
                        disabled={dmId === c.id} title="اكتب رسالة"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
                        style={{ background: "#1a1400", border: "1px solid #FFD70030", color: "#FFD700" }}>
                        {dmId === c.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <MessageSquare className="w-3 h-3" />}
                      </button>
                      {/* صوتي */}
                      <button onClick={() => call.startCall(c.username, false)} title="مكالمة صوتية"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-80"
                        style={{ background: "#071a07", border: `1px solid ${GREEN}40`, color: GREEN }}>
                        <Phone className="w-3 h-3" />
                      </button>
                      {/* فيديو */}
                      <button onClick={() => call.startCall(c.username, true)} title="مكالمة فيديو"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-80"
                        style={{ background: "#07101a", border: "1px solid #09f4", color: "#09f" }}>
                        <Video className="w-3 h-3" />
                      </button>
                      {/* متابعة / إزالة */}
                      <button onClick={() => void toggleFollow(c.username, c.id)}
                        disabled={addingId === c.id} title={followIds.has(c.id) ? "إلغاء المتابعة" : "إضافة صديق"}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
                        style={{
                          background: followIds.has(c.id) ? "#130303" : "#0d1a0d",
                          border: followIds.has(c.id) ? "1px solid #f444" : `1px solid ${GREEN}40`,
                          color: followIds.has(c.id) ? "#f44" : GREEN,
                        }}>
                        {addingId === c.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : followIds.has(c.id) ? <UserCheck className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                  {(!user || c.id === user.id) && (
                    <div className="shrink-0 hidden md:flex items-center gap-1 text-muted-foreground/40 group-hover:text-primary/60 transition-colors">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
