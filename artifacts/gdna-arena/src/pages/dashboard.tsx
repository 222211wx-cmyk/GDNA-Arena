import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, LogOut, Swords, Trophy, Activity, Target, Gift, Wallet, CheckCircle, Clock, BrainCircuit, ArrowRight, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useEffect, useState } from "react";

// ── GDN-SMART Widget ───────────────────────────────────────────────────────────
function SmartWidget() {
  const [, nav] = useLocation();
  const [smartData, setSmartData] = useState<{
    overallScore: number;
    activeModules: number;
    totalModules: number;
    systemStatus: string;
    modules: { id: string; name: string; status: string; score: number }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/smart/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSmartData(d))
      .catch(() => {});
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      onClick={() => nav("/smart")}
      style={{ cursor: "pointer" }}
    >
      <Card style={{
        background: "linear-gradient(135deg, #0d1117 0%, #0a0f00 50%, #0d1117 100%)",
        border: "1px solid #eab30840",
        borderRadius: 16,
        overflow: "hidden",
        position: "relative",
      }}>
        {/* Animated glow background */}
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "radial-gradient(ellipse at 20% 50%, #eab30815 0%, transparent 60%)",
          }}
        />

        <CardContent style={{ padding: "22px 24px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>

            {/* Brain icon with pulse */}
            <motion.div
              animate={{ boxShadow: ["0 0 8px #eab30840", "0 0 24px #eab30880", "0 0 8px #eab30840"] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "linear-gradient(135deg, #eab308, #f59e0b)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <BrainCircuit size={26} color="#000" />
            </motion.div>

            {/* Text block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: 15 }}>
                  Votre Compagnon Smart est
                </span>
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  style={{
                    background: "#22c55e20", border: "1px solid #22c55e60",
                    color: "#22c55e", borderRadius: 6, padding: "2px 9px",
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  <Zap size={10} /> ACTIF ⚡
                </motion.span>
              </div>
              {/* Arabic subtitle */}
              <p style={{ margin: "0 0 2px", color: "#eab308", fontSize: 12, fontWeight: 700, direction: "rtl", textAlign: "right" }}>
                رفيقك الذكي نشط ⚡ — يراقب إمبراطوريتك
              </p>
              {/* Description */}
              <p style={{ margin: 0, color: "#888", fontSize: 12, lineHeight: 1.5 }}>
                Analyse de vos performances en cours dans tous les domaines · تحليل أداءك جارٍ في جميع المجالات
              </p>
            </div>

            {/* Score + status (desktop) */}
            {smartData && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#eab308", lineHeight: 1 }}>
                  {smartData.overallScore}
                  <span style={{ fontSize: 12, color: "#888", fontWeight: 400 }}>/100</span>
                </div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase" }}>SCORE</div>
              </div>
            )}
          </div>

          {/* Module dots row */}
          {smartData?.modules && (
            <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "#555", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 4 }}>
                {smartData.activeModules}/{smartData.totalModules} modules
              </span>
              {smartData.modules.map(m => (
                <motion.div
                  key={m.id}
                  title={m.name}
                  whileHover={{ scale: 1.2 }}
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: m.status === "ACTIF" ? "#22c55e20" : "#ffffff08",
                    border: `1px solid ${m.status === "ACTIF" ? "#22c55e60" : "#ffffff15"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13,
                  }}
                >
                  {m.name.split(" ")[0]}
                </motion.div>
              ))}
            </div>
          )}

          {/* CTA button */}
          <div style={{ marginTop: 16 }}>
            <motion.button
              whileHover={{ scale: 1.02, boxShadow: "0 0 20px #eab30840" }}
              whileTap={{ scale: 0.98 }}
              style={{
                background: "linear-gradient(135deg, #eab308, #f59e0b)",
                color: "#000", border: "none", borderRadius: 10,
                padding: "10px 24px", fontWeight: 800, fontSize: 13,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
              }}
            >
              <BrainCircuit size={15} />
              Voir mes recommandations
              <ArrowRight size={14} />
            </motion.button>
            <span style={{ marginRight: 10, color: "#555", fontSize: 11, marginLeft: 12 }}>
              · عرض التوصيات الذكية
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function getRank(xp: number): { label: string; next: number; color: string } {
  if (xp < 500)  return { label: "Bronze I",  next: 500,   color: "#cd7f32" };
  if (xp < 1000) return { label: "Bronze II", next: 1000,  color: "#cd7f32" };
  if (xp < 2000) return { label: "Silver I",  next: 2000,  color: "#aaa9ad" };
  if (xp < 3500) return { label: "Silver II", next: 3500,  color: "#aaa9ad" };
  if (xp < 5000) return { label: "Gold I",    next: 5000,  color: "#ffd700" };
  if (xp < 7500) return { label: "Gold II",   next: 7500,  color: "#ffd700" };
  return { label: "Diamond", next: 10000, color: "#00d4ff" };
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, logout, loading, refreshUser } = useAuth();
  const { t } = useLang();
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [dailyMsg, setDailyMsg] = useState("");
  const [recentMatches, setRecentMatches] = useState<
    { game: string; win: boolean; coins: number; xp: number; time: string }[]
  >([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("gdna_recent_matches") ?? "[]");
      setRecentMatches(stored.slice(0, 8));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-primary animate-pulse text-xl uppercase tracking-widest">Loading...</div>
      </div>
    );
  }
  if (!user) return null;

  const rank = getRank(user.xp);
  const xpProgress = Math.min((user.xp / rank.next) * 100, 100);
  const winRate = user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const handleDailyReward = async () => {
    setClaimingDaily(true);
    setDailyMsg("");
    try {
      const res = await fetch("/api/rewards/daily", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setDailyMsg(data.error ?? "Already claimed today!");
      } else {
        setDailyMsg(`+${data.coinsEarned} coins claimed!`);
        await refreshUser();
      }
    } catch {
      setDailyMsg("Failed to claim reward");
    } finally {
      setClaimingDaily(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
      >
        <div>
          <h1 className="text-3xl md:text-4xl font-bold uppercase tracking-wider">
            Welcome, <span className="text-primary neon-text-glow" data-testid="text-username">{user.username}</span>
          </h1>
          <p className="text-muted-foreground mt-1 uppercase tracking-widest text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-500" />
            Status: Online
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/wallet">
            <Button variant="outline" className="border-primary/50 text-primary hover:bg-primary/10">
              <Wallet className="w-4 h-4 mr-2" />
              Wallet
            </Button>
          </Link>
          <Button variant="outline" onClick={handleLogout} className="border-red-500/50 text-red-400 hover:bg-red-500/10" data-testid="button-logout">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </motion.div>

      {/* Daily Reward Banner */}
      {user.canClaimDaily && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <Gift className="w-8 h-8 text-green-400 shrink-0" />
            <div>
              <p className="font-bold text-green-400 uppercase tracking-wider">Daily Reward Available!</p>
              <p className="text-sm text-muted-foreground">Claim your 100 free coins for today</p>
            </div>
          </div>
          <Button
            onClick={handleDailyReward}
            disabled={claimingDaily}
            className="bg-green-500 hover:bg-green-400 text-black font-bold uppercase tracking-wider shrink-0"
            data-testid="button-daily-reward"
          >
            <Gift className="w-4 h-4 mr-2" />
            {claimingDaily ? "Claiming..." : "Claim +100 Coins"}
          </Button>
        </motion.div>
      )}

      {!user.canClaimDaily && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-card/30 border border-primary/10 rounded-xl p-3 flex items-center gap-3 text-sm text-muted-foreground"
        >
          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
          Daily reward claimed — come back tomorrow for more coins!
        </motion.div>
      )}

      {dailyMsg && (
        <p className={`text-center font-bold text-sm ${dailyMsg.includes("+") ? "text-green-400" : "text-orange-400"}`}>
          {dailyMsg}
        </p>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Balance */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="md:col-span-2">
          <Card className="bg-card/50 border-primary/30 h-full relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardContent className="p-8 flex flex-col justify-center items-center text-center h-full relative z-10">
              <Coins className="w-16 h-16 text-primary mb-6 drop-shadow-[0_0_15px_rgba(0,212,255,0.8)]" />
              <p className="text-sm uppercase tracking-widest text-muted-foreground mb-2">Available Balance</p>
              <h2 className="text-5xl md:text-7xl font-black text-white neon-text-glow mb-8 tracking-tighter" data-testid="text-balance">
                {user.balance.toLocaleString()} <span className="text-2xl text-primary font-bold">COINS</span>
              </h2>
              <Link href="/games">
                <Button size="lg" className="h-14 px-8 text-md font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300">
                  <Swords className="w-5 h-5 mr-2" />
                  Play to Earn More
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>

        {/* Side cards */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="space-y-6">
          <Card className="bg-card/50 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 rounded-full bg-primary/20 text-primary">
                  <Trophy className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Rank</p>
                  <p className="text-xl font-bold" style={{ color: rank.color }} data-testid="text-rank">{rank.label}</p>
                </div>
              </div>
              <div className="w-full bg-background rounded-full h-2 mt-4 border border-primary/20">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${xpProgress}%`, backgroundColor: rank.color, boxShadow: `0 0 10px ${rank.color}` }}
                />
              </div>
              <p className="text-xs text-right mt-2 text-muted-foreground">{user.xp} / {rank.next} XP</p>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Target className="w-5 h-5 text-primary" />
                <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Games Played</span>
                  <span className="font-bold" data-testid="text-games-played">{user.gamesPlayed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Wins</span>
                  <span className="font-bold text-primary" data-testid="text-wins">{user.wins}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Win Rate</span>
                  <span className="font-bold text-green-400">{winRate}%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── GDN-SMART Widget ─────────────────────────────────────────── */}
      <SmartWidget />

      {/* ── Recent Matches ──────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <Clock className="w-5 h-5 text-primary" />
              <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Recent Matches</h3>
            </div>
            {recentMatches.length === 0 ? (
              <div className="text-center py-8">
                <Swords className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No matches yet — <Link href="/games" className="text-primary hover:underline">play your first game!</Link></p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentMatches.map((m, i) => {
                  const ago = (() => {
                    const diff = Date.now() - new Date(m.time).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.floor(hrs / 24)}d ago`;
                  })();
                  return (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${
                      m.win ? "border-primary/20 bg-primary/5" : "border-white/5 bg-white/2"
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${m.win ? "bg-primary" : "bg-red-500/60"}`} />
                        <div>
                          <p className="text-sm font-semibold">{m.game}</p>
                          <p className="text-xs text-muted-foreground">{ago}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <p className="text-xs text-primary font-bold">+{m.coins} <span className="text-muted-foreground font-normal">coins</span></p>
                          <p className="text-xs text-purple-400">+{m.xp} XP</p>
                        </div>
                        <span className={`text-xs font-bold uppercase tracking-wider ${m.win ? "text-primary" : "text-red-400/70"}`}>
                          {m.win ? "WIN" : "LOSS"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
