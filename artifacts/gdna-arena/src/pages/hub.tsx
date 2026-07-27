import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetGsDomains, useGetGsRanking, useGetGsNews, useGetGsFigures,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Globe, Cpu, Trophy, Star, Zap, TrendingUp, Users,
  Vote, Newspaper, Gamepad2, BrainCircuit, Flame,
  ChevronRight, ArrowRight, Shield, Sparkles, Radio,
  Clock, Crown, Brain, Scale, Send, Bot, Loader2,
  Waves, Rocket, BarChart3, Coins, Play,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AI_PULSES = [
  { flag: "🇸🇦", text: "مستجد ذكي: تصويت قياسي في مجال الموسيقى خلال 24 ساعة" },
  { flag: "🇫🇷", text: "IA Prédiction: Hausse de 40% des votes dans Football" },
  { flag: "🇬🇧", text: "AI Alert: Neon Racer trending — 3x normal traffic this hour" },
  { flag: "🇲🇦", text: "تنبيه ذكي: Crypto Clash كيقلب كل التوقعات هذا الأسبوع" },
  { flag: "🌍", text: "System: AI moderation processed 12,400 votes this hour — 99.8% accuracy" },
  { flag: "🇸🇦", text: "تحديث: تم تفعيل خوارزمية التنبؤ v4.2 بنجاح" },
  { flag: "🇫🇷", text: "Mise à jour: Algorithme de classement v4.2 déployé avec succès" },
];

const GAMES = [
  { id: "neon-racer",   name: "Neon Racer",   genre: "Racing",   players: 1247, hot: true,  reward: "20-80",  color: "text-primary",    bg: "bg-primary/10",    border: "hover:border-primary/50" },
  { id: "crypto-clash", name: "Crypto Clash", genre: "Strategy", players: 893,  hot: false, reward: "30-120", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "hover:border-yellow-400/50" },
  { id: "arena-strike", name: "Arena Strike", genre: "FPS",      players: 2041, hot: true,  reward: "50-200", color: "text-orange-400", bg: "bg-orange-400/10", border: "hover:border-orange-400/50" },
  { id: "globalstar",   name: "GlobalStar",   genre: "Voting",   players: 5820, hot: true,  reward: "10-50",  color: "text-purple-400", bg: "bg-purple-400/10", border: "hover:border-purple-400/50", external: true },
];

function getRank(xp: number) {
  if (xp < 500)  return { label: "Bronze I",  color: "#cd7f32" };
  if (xp < 1000) return { label: "Bronze II", color: "#cd7f32" };
  if (xp < 2000) return { label: "Silver I",  color: "#aaa9ad" };
  if (xp < 3500) return { label: "Silver II", color: "#aaa9ad" };
  if (xp < 5000) return { label: "Gold I",    color: "#ffd700" };
  if (xp < 7500) return { label: "Gold II",   color: "#ffd700" };
  return { label: "Diamond", color: "#00d4ff" };
}

// ── Quick Chat (inline mini-terminal) ─────────────────────────────────────────
function QuickChat() {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    { role: "ai", text: { en: "Ask me anything — I am GDN-AI 🔥", ar: "اسألني أي شيء — أنا GDN-AI 🔥", fr: "Demandez-moi n'importe quoi 🔥", dz: "سولني على أي حاجة 🔥" }[lang] ?? "Ask me anything — I am GDN-AI 🔥" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setMessages(m => [...m, { role: "user", text: msg }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg, history: messages.slice(-6).map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text })) }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: "ai", text: data.reply ?? "…" }]);
    } catch {
      setMessages(m => [...m, { role: "ai", text: "Neural grid disruption — try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-52 scrollbar-thin">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "ai" && <Bot className="w-4 h-4 text-primary mt-0.5 shrink-0" />}
            <div className={`text-xs rounded-xl px-3 py-2 max-w-[85%] leading-relaxed ${
              m.role === "ai" ? "bg-primary/10 text-foreground/90 border border-primary/20" : "bg-white/10 text-foreground/80"
            }`} dir="auto">{m.text}</div>
          </div>
        ))}
        {loading && <div className="flex gap-2 items-center"><Bot className="w-4 h-4 text-primary" /><Loader2 className="w-3 h-3 text-primary animate-spin" /></div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-border/30">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={t("chat_placeholder")}
          className="h-8 text-xs bg-background/50 border-primary/30"
          disabled={loading}
          dir="auto"
        />
        <Button onClick={send} disabled={!input.trim() || loading} size="sm" className="h-8 px-3 bg-primary text-black shrink-0">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function Hub() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [pulseIdx, setPulseIdx] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playResult, setPlayResult] = useState<{ win: boolean; coins: number; xpEarned: number } | null>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: domains }  = useGetGsDomains();
  const { data: ranking }  = useGetGsRanking();
  const { data: news }     = useGetGsNews();
  const { data: figures }  = useGetGsFigures({ limit: 5 });

  // Leaderboard (fetch directly)
  const [leaders, setLeaders] = useState<Array<{ id: number; username: string; xp: number; balance: number; wins: number }>>([]);
  useEffect(() => {
    fetch(`${BASE}/api/leaderboard`, { credentials: "include" })
      .then(r => r.json()).then(d => setLeaders(d.players?.slice(0, 5) ?? [])).catch(() => {});
  }, []);

  // Pulse ticker
  useEffect(() => {
    const id = setInterval(() => setPulseIdx(p => (p + 1) % AI_PULSES.length), 3500);
    return () => clearInterval(id);
  }, []);

  const topFigures = figures?.figures?.slice(0, 3) ?? [];
  const topDomains = domains?.domains?.slice(0, 4) ?? [];
  const latestNews = news?.articles?.slice(0, 3) ?? [];
  const rank = user ? getRank(user.xp) : null;

  const handlePlay = async (gameId: string, external?: boolean) => {
    if (external) { setLocation("/games/globalstar"); return; }
    if (!user) { setLocation("/login"); return; }
    setPlaying(gameId);
    setPlayResult(null);
    try {
      const res = await fetch(`${BASE}/api/games/${gameId}/play`, { method: "POST", credentials: "include" });
      const d = await res.json();
      setPlayResult({ win: d.win, coins: d.coinsEarned, xpEarned: d.xpEarned });
      setTimeout(() => setPlayResult(null), 3000);
    } catch {} finally {
      setPlaying(null);
    }
  };

  // ── Sections quick nav ────────────────────────────────────────────────────
  const SECTIONS = [
    { icon: Vote,       label: "GlobalStar", color: "text-primary",    path: "/games/globalstar" },
    { icon: Gamepad2,   label: t("games"),   color: "text-yellow-400", path: "/games" },
    { icon: Brain,      label: "NLP",        color: "text-purple-400", path: "/growth" },
    { icon: Clock,      label: t("nav_chronicle"), color: "text-orange-400", path: "/chronicle" },
    { icon: Newspaper,  label: t("news"),    color: "text-green-400",  path: "/news" },
    { icon: Crown,      label: t("empire_title"), color: "text-yellow-400", path: "/empire" },
    { icon: Scale,      label: t("legal_title"),  color: "text-blue-400",  path: "/legal" },
    { icon: Trophy,     label: t("leaderboard"),  color: "text-orange-400", path: "/leaderboard" },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-8 max-w-7xl mx-auto space-y-8">

      {/* ── AI Live Intelligence Bar ──────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3 overflow-hidden"
      >
        <div className="flex items-center gap-2 shrink-0">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-xs font-mono font-bold text-primary uppercase tracking-widest">{t("hub_ai_live")}</span>
        </div>
        <div className="h-4 w-px bg-primary/30 shrink-0" />
        <AnimatePresence mode="wait">
          <motion.div key={pulseIdx}
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.35 }}
            className="flex items-center gap-2 min-w-0"
          >
            <span className="text-base">{AI_PULSES[pulseIdx].flag}</span>
            <p className="text-sm text-foreground/80 truncate font-mono">{AI_PULSES[pulseIdx].text}</p>
          </motion.div>
        </AnimatePresence>
        <Link href="/chat" className="ml-auto shrink-0">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-primary gap-1 hover:bg-primary/10">
            GDN-AI <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </motion.div>

      {/* ── Empire Title ──────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight neon-text-glow">{t("hub_title")}</h1>
        <p className="text-muted-foreground uppercase tracking-widest text-xs">{t("hub_sub")}</p>
      </motion.div>

      {/* ── Quick Nav Bar ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="flex flex-wrap gap-2 justify-center"
      >
        {SECTIONS.map(s => (
          <Link key={s.path} href={s.path}>
            <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 bg-card/40 hover:border-current/40 hover:bg-card/70 transition-all text-xs font-bold uppercase tracking-wider ${s.color}`}>
              <s.icon className="w-3.5 h-3.5" />{s.label}
            </button>
          </Link>
        ))}
      </motion.div>

      {/* ── Stats Strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: "hub_stat_votes", val: "2.4M+", icon: Vote,         color: "text-primary" },
          { key: "hub_stat_games", val: "847K+", icon: Gamepad2,     color: "text-yellow-400" },
          { key: "hub_stat_users", val: "156K+", icon: Users,        color: "text-green-400" },
          { key: "hub_stat_ai",    val: "99.8%", icon: BrainCircuit, color: "text-purple-400" },
        ].map((s, i) => (
          <motion.div key={s.key} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
            <Card className="bg-card/40 border-primary/15 hover:border-primary/40 transition-colors">
              <CardContent className="p-4 text-center">
                <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
                <p className={`text-2xl font-black font-mono ${s.color}`}>{s.val}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{t(s.key)}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ── MAIN 3-COL GRID: GlobalStar | GDN-AI Chat | Leaderboard ──────── */}
      <div className="grid md:grid-cols-3 gap-6">

        {/* GlobalStar Live */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <Card className="bg-card/40 border-primary/20 h-full flex flex-col">
            <CardContent className="p-5 flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Vote className="w-4 h-4 text-primary" />
                  <h2 className="font-black text-sm uppercase tracking-wider">{t("hub_gs_title")}</h2>
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/30 text-xs font-mono">LIVE</Badge>
              </div>

              {topDomains.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded-lg bg-background/40 border border-border/40 hover:border-primary/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{d.icon}</span>
                    <div>
                      <p className="text-xs font-bold">{d.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{d.totalVotes?.toLocaleString()} {t("hub_votes")}</p>
                    </div>
                  </div>
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                </div>
              ))}

              {topFigures.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t("hub_top_figures")}</p>
                  {topFigures.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-2 p-1.5 rounded bg-background/30">
                      <span className={`text-xs font-black font-mono w-4 ${i === 0 ? "text-yellow-400" : "text-muted-foreground"}`}>#{i + 1}</span>
                      <p className="text-xs font-medium truncate flex-1">{f.name}</p>
                      <span className="text-xs font-mono text-primary">{f.votes?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-auto mt-auto pt-2">
                <Link href="/games/globalstar">
                  <Button variant="outline" size="sm" className="w-full border-primary/40 text-primary hover:bg-primary/10 gap-2 text-xs">
                    {t("hub_enter_gs")} <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* GDN-AI Quick Chat */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-gradient-to-b from-primary/10 to-card/40 border-primary/30 h-full flex flex-col">
            <CardContent className="p-5 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="font-black text-sm uppercase tracking-wider neon-text-glow">GDN-AI</h2>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-400 font-mono">LIVE</span>
                </div>
              </div>
              <div className="flex-1">
                <QuickChat />
              </div>
              <Link href="/chat" className="mt-3">
                <Button size="sm" variant="ghost" className="w-full text-xs text-primary hover:bg-primary/10 gap-1">
                  {t("hub_full_chat")} <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>

        {/* Leaderboard Top 5 */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <Card className="bg-card/40 border-yellow-400/20 h-full flex flex-col">
            <CardContent className="p-5 flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-400" />
                  <h2 className="font-black text-sm uppercase tracking-wider">{t("leaderboard")}</h2>
                </div>
                <Badge className="bg-yellow-400/10 text-yellow-400 border-yellow-400/30 text-xs">TOP 5</Badge>
              </div>

              {leaders.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                </div>
              )}

              {leaders.map((p, i) => {
                const r = getRank(p.xp);
                return (
                  <div key={p.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-background/40 border border-border/40">
                    <div className="w-6 text-center">
                      {i === 0 ? <Crown className="w-4 h-4 text-yellow-400 mx-auto" />
                       : i === 1 ? <span className="text-xs font-black text-slate-300">#2</span>
                       : i === 2 ? <span className="text-xs font-black text-orange-400">#3</span>
                       : <span className="text-xs font-black text-muted-foreground">#{i+1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{p.username}</p>
                      <p className="text-xs font-mono" style={{ color: r.color }}>{r.label}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black font-mono text-yellow-400">{p.balance.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground font-mono">{p.xp} XP</p>
                    </div>
                  </div>
                );
              })}

              <div className="mt-auto pt-2">
                <Link href="/leaderboard">
                  <Button variant="outline" size="sm" className="w-full border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 gap-2 text-xs">
                    {t("hub_see_all")} <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Gaming Arena — direct play ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-yellow-400" />
            <h2 className="font-black uppercase tracking-wider">{t("hub_gaming_title")}</h2>
          </div>
          <Link href="/games">
            <Button variant="ghost" size="sm" className="text-yellow-400 gap-1 text-xs hover:bg-yellow-400/10">
              {t("hub_see_all")} <ChevronRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        <AnimatePresence>
          {playResult && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`rounded-xl border px-5 py-3 text-center font-black text-sm ${
                playResult.win ? "border-green-400/40 bg-green-400/10 text-green-400" : "border-orange-400/40 bg-orange-400/10 text-orange-400"
              }`}
            >
              {playResult.win ? `🏆 ${t("hub_win_msg")} +${playResult.coins} coins · +${playResult.xpEarned} XP` : `⚔️ ${t("hub_lose_msg")} +${playResult.coins} coins`}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {GAMES.map((g, i) => (
            <motion.div key={g.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <Card className={`bg-card/40 border-border/50 transition-all duration-200 ${g.border} group`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={`w-9 h-9 rounded-xl ${g.bg} border border-current/20 flex items-center justify-center`}>
                      {g.hot ? <Flame className={`w-4 h-4 ${g.color}`} /> : <Gamepad2 className={`w-4 h-4 ${g.color}`} />}
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-black font-mono ${g.color}`}>{g.players.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{t("hub_online")}</p>
                    </div>
                  </div>
                  <div>
                    <p className={`font-black text-sm ${g.color}`}>{g.name}</p>
                    <p className="text-xs text-muted-foreground">{g.genre}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins className="w-3 h-3 text-yellow-400" />
                    <span className="text-xs font-mono text-yellow-400">{g.reward}</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handlePlay(g.id, g.external)}
                    disabled={playing === g.id}
                    className={`w-full h-7 text-xs font-bold uppercase gap-1 ${g.color} bg-current/10 border border-current/30 hover:bg-current/20 hover:text-inherit`}
                    style={{ color: "inherit" }}
                  >
                    {playing === g.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <><Play className="w-3 h-3" />{g.external ? t("hub_enter_gs") : t("hub_play_btn")}</>}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Growth NLP + Chronicle side-by-side ───────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* NLP Growth snapshot */}
        <motion.div initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
          <Card className="bg-gradient-to-br from-purple-500/10 to-card/30 border-purple-400/20 h-full">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
                  <h2 className="font-black text-sm uppercase tracking-wider text-purple-400">{t("hub_nlp_title")}</h2>
                </div>
                <Link href="/growth">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-purple-400 gap-1 hover:bg-purple-400/10">
                    {t("hub_see_all")} <ChevronRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>

              {user ? (
                <div className="space-y-3">
                  {/* Mental dimensions */}
                  {[
                    { label: t("nlp_dim_action"),     val: Math.min(100, Math.round((user.gamesPlayed / 50) * 100)),              color: "bg-primary" },
                    { label: t("nlp_dim_resilience"),  val: Math.min(100, Math.round(user.gamesPlayed > 0 ? (user.wins / user.gamesPlayed) * 100 : 0)), color: "bg-green-400" },
                    { label: t("nlp_dim_growth"),      val: Math.min(100, Math.round((user.xp / 7500) * 100)),                    color: "bg-yellow-400" },
                    { label: t("nlp_dim_abundance"),   val: Math.min(100, Math.round((user.balance / 5000) * 100)),               color: "bg-purple-400" },
                  ].map((d, i) => (
                    <div key={d.label} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{d.label}</span>
                        <span className="font-black font-mono">{d.val}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} whileInView={{ width: `${d.val}%` }}
                          viewport={{ once: true }} transition={{ duration: 1, delay: i * 0.08 }}
                          className={`h-full rounded-full ${d.color}`}
                        />
                      </div>
                    </div>
                  ))}
                  <Link href="/growth">
                    <Button size="sm" className="w-full h-7 text-xs bg-purple-400/10 text-purple-400 border border-purple-400/30 hover:bg-purple-400/20 gap-1 font-bold uppercase">
                      <Rocket className="w-3 h-3" />{t("hub_growth_cta")}
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center py-6 space-y-2">
                  <Brain className="w-10 h-10 text-purple-400/40 mx-auto" />
                  <p className="text-xs text-muted-foreground">{t("nlp_login_required")}</p>
                  <Link href="/login"><Button size="sm" className="text-xs bg-purple-400/10 text-purple-400 border border-purple-400/30">{t("login")}</Button></Link>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Chronicle snapshot */}
        <motion.div initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
          <Card className="bg-gradient-to-br from-yellow-400/8 to-card/30 border-yellow-400/20 h-full">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-yellow-400" />
                  <h2 className="font-black text-sm uppercase tracking-wider text-yellow-400">{t("nav_chronicle")}</h2>
                </div>
                <Link href="/chronicle">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-yellow-400 gap-1 hover:bg-yellow-400/10">
                    {t("hub_see_all")} <ChevronRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>

              <div className="space-y-3">
                {[
                  { era: t("chrono_past"),    icon: "🏛️", key: "chrono_past_snap",    color: "text-yellow-400",  border: "border-yellow-400/20" },
                  { era: t("chrono_present"), icon: "📡", key: "chrono_present_snap", color: "text-primary",     border: "border-primary/20" },
                  { era: t("chrono_future"),  icon: "🤖", key: "chrono_future_snap",  color: "text-purple-400",  border: "border-purple-400/20" },
                ].map((e, i) => (
                  <div key={e.era} className={`flex items-start gap-3 p-3 rounded-xl bg-background/30 border ${e.border}`}>
                    <span className="text-xl shrink-0">{e.icon}</span>
                    <div>
                      <p className={`text-xs font-black uppercase tracking-wider ${e.color}`}>{e.era}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(e.key)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Link href="/chronicle">
                <Button size="sm" className="w-full h-7 text-xs bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/20 gap-1 font-bold uppercase">
                  <Clock className="w-3 h-3" />{t("hub_chronicle_cta")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── News Feed ─────────────────────────────────────────────────────── */}
      {latestNews.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-green-400" />
              <h2 className="font-black uppercase tracking-wider">{t("hub_news_title")}</h2>
            </div>
            <Link href="/news">
              <Button variant="ghost" size="sm" className="text-green-400 gap-1 text-xs hover:bg-green-400/10">
                {t("hub_see_all")} <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {latestNews.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}>
                <Card className="bg-card/40 border-border/50 hover:border-green-400/30 transition-colors h-full">
                  <CardContent className="p-4 space-y-2">
                    {a.isBreaking && <Badge variant="destructive" className="text-xs">BREAKING</Badge>}
                    <h3 className="font-semibold text-xs line-clamp-2">{a.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{a.summary}</p>
                    <p className="text-xs text-green-400/60 font-mono">{a.source}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ── Empire + Legal Strip ──────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/empire">
          <Card className="bg-gradient-to-r from-yellow-400/10 to-card/20 border-yellow-400/20 hover:border-yellow-400/50 transition-all cursor-pointer group">
            <CardContent className="p-4 flex items-center gap-4">
              <Crown className="w-8 h-8 text-yellow-400 group-hover:scale-110 transition-transform" />
              <div>
                <p className="font-black uppercase tracking-wider text-yellow-400">{t("empire_title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("hub_empire_desc")}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-yellow-400 ml-auto" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/legal">
          <Card className="bg-gradient-to-r from-blue-400/10 to-card/20 border-blue-400/20 hover:border-blue-400/50 transition-all cursor-pointer group">
            <CardContent className="p-4 flex items-center gap-4">
              <Scale className="w-8 h-8 text-blue-400 group-hover:scale-110 transition-transform" />
              <div>
                <p className="font-black uppercase tracking-wider text-blue-400">{t("legal_title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("hub_legal_desc")}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400 ml-auto" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── User Command Card ─────────────────────────────────────────────── */}
      {user && rank && (
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <Card className="bg-gradient-to-r from-card/60 to-card/30 border-primary/30">
            <CardContent className="p-5 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full border-4 flex items-center justify-center shrink-0"
                  style={{ borderColor: rank.color, boxShadow: `0 0 20px ${rank.color}40` }}>
                  <span className="font-black text-sm" style={{ color: rank.color }}>{user.username.slice(0, 2).toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-black text-lg uppercase tracking-wider neon-text-glow">{user.username}</p>
                  <p className="text-xs font-bold" style={{ color: rank.color }}>{rank.label}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono mt-1">
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" />{user.xp} XP</span>
                    <span className="flex items-center gap-1"><Coins className="w-3 h-3 text-primary" />{user.balance.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Gamepad2 className="w-3 h-3 text-green-400" />{user.gamesPlayed} {t("games_played")}</span>
                    <span className="flex items-center gap-1"><Trophy className="w-3 h-3 text-yellow-400" />{user.wins} {t("wins")}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link href="/growth">
                  <Button size="sm" className="h-9 bg-purple-400/15 text-purple-400 border border-purple-400/40 hover:bg-purple-400/25 gap-1.5 text-xs font-bold uppercase">
                    <Brain className="w-3.5 h-3.5" />NLP
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="sm" className="h-9 bg-primary/15 text-primary border border-primary hover:bg-primary hover:text-black gap-1.5 text-xs font-bold uppercase">
                    <BarChart3 className="w-3.5 h-3.5" />{t("dashboard")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Multi-Language Sovereignty Footer ─────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
        className="rounded-xl border border-primary/20 bg-card/20 p-6 text-center space-y-3"
      >
        <div className="flex justify-center gap-3 text-2xl">🌍 🇬🇧 🇫🇷 🇸🇦 🇲🇦</div>
        <p className="text-sm font-mono text-muted-foreground">
          <span className="text-white font-bold">GDNA Arena</span> — {t("hub_footer")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {["العربية","English","Français","الدارجة","Español","中文","Русский","Português","हिंदी"].map(l => (
            <span key={l} className="text-xs px-2 py-0.5 rounded-full border border-primary/20 text-muted-foreground font-mono">{l}</span>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
