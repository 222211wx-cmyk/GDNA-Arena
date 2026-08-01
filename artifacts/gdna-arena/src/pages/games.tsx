import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Trophy, X, Coins, Zap, Loader2, Star, Crown, Shield, Medal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useLegal } from "@/contexts/LegalContext";
import { useLocation, Link } from "wouter";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// ── Game definitions ───────────────────────────────────────────────────────────
const GAMES = [
  {
    id: "neon-racer",
    title: "Neon Racer",
    description: "Race through glowing cyberpunk streets at breakneck speed",
    image: "/images/neon-racer.png",
    genre: "Racing",
    minReward: 20, maxReward: 80, winChance: "60%",
    isTournament: false, isExternal: false,
    color: "#00d4ff",
  },
  {
    id: "crypto-clash",
    title: "Crypto Clash",
    description: "Battle opponents in strategic card duels, earn coins with every win",
    image: "/images/crypto-clash.png",
    genre: "Strategy",
    minReward: 30, maxReward: 120, winChance: "50%",
    isTournament: false, isExternal: false,
    color: "#a855f7",
  },
  {
    id: "arena-strike",
    title: "Arena Strike",
    description: "First-person arena combat. Dominate and claim your crypto rewards",
    image: "/images/arena-strike.png",
    genre: "FPS",
    minReward: 50, maxReward: 200, winChance: "45%",
    isTournament: false, isExternal: false,
    color: "#f97316",
  },
  {
    id: "globalstar",
    title: "GlobalStar",
    description: "100 citizens enter. Only 10 survive the filter. Claim your tribute and your place among the immortals.",
    image: "/images/globalstar.png",
    genre: "Tournament",
    minReward: 10, maxReward: 200, winChance: "12%",
    isTournament: true, isExternal: false,
    color: "#C9A84C",
  },
];

// ── 99 fake tournament players ─────────────────────────────────────────────────
const CITIZEN_POOL = [
  "Ahmed_Mansour","Zhang_Wei","Carlos_Rivera","Aisha_Diallo","Ivan_Petrov",
  "Yuki_Tanaka","Omar_Hassan","Marie_Dubois","Raj_Patel","Sofia_Rossi",
  "Kwame_Asante","Lena_Müller","Tariq_Al_Farsi","Mei_Lin","Dmitri_Volkov",
  "Amara_Ndiaye","Felipe_Gomes","Nadia_Khalil","Kenji_Yamamoto","Ingrid_Berg",
  "Hassan_Sultani","Priya_Sharma","Marcus_Johnson","Fatou_Sow","Alexei_Sokolov",
  "Lucia_Fernandez","Yousef_Ibrahim","Anna_Kowalski","Reza_Tehrani","Grace_Okonkwo",
  "Hamid_Moradi","Elena_Popescu","Javier_Torres","Sana_Malik","Viktor_Bauer",
  "Adaeze_Okafor","Li_Wei","Camille_Laurent","Mustafa_Erdogan","Leila_Nazari",
  "Kofi_Mensah","Valentina_Cruz","Said_Benali","Hana_Kim","Nikolai_Ivanov",
  "Blessing_Adeyemi","Marco_Conti","Zara_Ahmed","Pavel_Novak","Catalina_Reyes",
  "Idris_Elba_Jr","Sakura_Watanabe","Amin_Rachidi","Vera_Sidorova","Emmanuel_Nwachukwu",
  "Isabella_Martini","Khalid_Hamdan","Nora_Jensen","Chidi_Obi","Parisa_Ahmadi",
  "Santiago_Vega","Miriam_Cohen","Babatunde_Adisa","Yulia_Fedorova","Andrés_Moreno",
  "Kemi_Adeyinka","Sven_Eriksson","Layla_Mansouri","Tunde_Fashola","Nataliya_Koval",
  "Ricardo_Alves","Hiba_Chaoui","Maxim_Kuzmin","Serena_Oduya","Diego_Alvarez",
  "Fatima_Zahra","Jan_Kovar","Chioma_Eze","Rustam_Nazarov","Adriana_Lima_II",
  "Yusuf_Ali","Bianca_Ferreira","Rashid_Mokhtar","Ekaterina_Volkov","Pablo_Herrera",
  "Ngozi_Adeyemi","Arjun_Singh","Vanessa_Morin","Tareke_Berhane","Irina_Smirnova",
  "Juan_Guzman","Rokia_Traore","Andrei_Popov","Selma_Halilovic","Olusegun_Bello",
  "Miyuki_Ito","Bassam_Haddad","Monika_Nowak","Cristiano_Gomes","Zeinab_Farouk",
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface PlayResult { win: boolean; coinsEarned: number; xpEarned: number; newBalance: number; newXp: number; message: string; gameTitle: string; }
interface TournamentResult { placement: number; coinsEarned: number; xpEarned: number; tier: string; isWin: boolean; newBalance: number; newXp: number; username: string; message: string; top10: { username: string; xp: number }[]; }
type TournamentPhase = "idle" | "entering" | "simulating" | "filtering" | "revealing" | "done";

// ── Tournament Modal ───────────────────────────────────────────────────────────
function TournamentModal({
  user, onClose, onComplete,
}: { user: { username: string; balance: number; xp: number } | null; onClose: () => void; onComplete: (coins?: number, xp?: number, placement?: number, game?: string) => void; }) {
  const [phase, setPhase] = useState<TournamentPhase>("entering");
  const [enterCount, setEnterCount] = useState(0);
  const [players, setPlayers] = useState<string[]>([]);
  const [surviving, setSurviving] = useState<string[]>([]);
  const [result, setResult] = useState<TournamentResult | null>(null);
  const [error, setError] = useState("");
  const [simulLines, setSimulLines] = useState<{ name: string; score: number }[]>([]);
  const resultRef = useRef<TournamentResult | null>(null);

  // Generate player list with user inserted
  useEffect(() => {
    const pool = [...CITIZEN_POOL].sort(() => Math.random() - 0.5).slice(0, 99);
    const userHandle = user?.username ?? "YOU";
    const pos = Math.floor(Math.random() * 100);
    pool.splice(pos, 0, `★${userHandle}`);
    setPlayers(pool.slice(0, 100));
  }, [user]);

  // Phase machine
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (phase === "entering") {
      let c = 0;
      const id = setInterval(() => {
        c += Math.floor(Math.random() * 5) + 3;
        if (c >= 100) { c = 100; clearInterval(id); }
        setEnterCount(c);
        if (c >= 100) setTimeout(() => setPhase("simulating"), 400);
      }, 60);
      cleanup = () => clearInterval(id);

    } else if (phase === "simulating") {
      fetch(`${BASE}/api/games/globalstar/tournament`, { method: "POST", credentials: "include" })
        .then(r => r.json())
        .then(d => { resultRef.current = d; })
        .catch(() => { setError("TOURNAMENT GRID DISRUPTED — TRY AGAIN"); setPhase("idle"); });

      const names = [...players];
      const scores = names.map(() => Math.floor(Math.random() * 9000) + 1000);
      setSimulLines(names.map((n, i) => ({ name: n, score: scores[i] })).sort(() => Math.random() - 0.5).slice(0, 12));

      const id = setInterval(() => {
        setSimulLines(prev => prev.map(r => ({
          ...r, score: r.score + Math.floor(Math.random() * 300),
        })).sort((a, b) => b.score - a.score));
      }, 180);
      setTimeout(() => { clearInterval(id); setPhase("filtering"); }, 3000);
      cleanup = () => clearInterval(id);

    } else if (phase === "filtering") {
      const top = [...players].sort(() => Math.random() - 0.5).slice(0, 10);
      setSurviving(top);
      setTimeout(() => setPhase("revealing"), 2200);

    } else if (phase === "revealing") {
      setTimeout(() => {
        if (resultRef.current) { setResult(resultRef.current); setPhase("done"); }
        else setTimeout(() => {
          if (resultRef.current) { setResult(resultRef.current); setPhase("done"); }
          else { setError("TOURNAMENT GRID DISRUPTED — TRY AGAIN"); }
        }, 2000);
      }, 800);
    }

    return cleanup;
  }, [phase, players]);

  const tierConfig: Record<string, { color: string; icon: typeof Crown; label: string; label_ar: string }> = {
    champion: { color: "#C9A84C", icon: Crown,  label: "CHAMPION",  label_ar: "Champion" },
    elite:    { color: "#E8C97A", icon: Trophy, label: "ELITE",     label_ar: "Elite"    },
    legend:   { color: "#A8D8EA", icon: Medal,  label: "LEGEND",    label_ar: "Legend"   },
    citizen:  { color: "#6b7280", icon: Shield, label: "CITIZEN",   label_ar: "Citizen"  },
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm"
      onClick={phase === "done" ? onClose : undefined}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-lg border border-yellow-400/40 bg-black overflow-hidden"
        style={{ boxShadow: "0 0 60px #C9A84C20" }}>

        {/* Header bar */}
        <div className="border-b border-yellow-400/20 px-6 py-3 flex items-center justify-between">
          <div className="font-mono text-yellow-400/60 text-xs tracking-[0.4em]">
            ♔ GLOBALSTAR TOURNAMENT
          </div>
          {phase === "done" && (
            <button onClick={onClose} className="text-yellow-400/40 hover:text-yellow-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5 min-h-64">

          {/* ── ENTERING ───────────────────────────────────────────────── */}
          {phase === "entering" && (
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <div className="font-mono text-yellow-400 text-xs tracking-[0.4em]">INITIATING GLOBAL TOURNAMENT</div>
                <div className="font-mono font-black text-3xl text-white tracking-widest">
                  {enterCount} <span className="text-yellow-400/40 text-lg">/ 100</span>
                </div>
                <div className="font-mono text-yellow-400/40 text-xs">CITIZENS ENTERING THE ARENA</div>
              </div>
              <div className="h-1.5 bg-white/5 overflow-hidden">
                <motion.div className="h-full bg-yellow-400"
                  animate={{ width: `${enterCount}%` }} transition={{ duration: 0.1 }} />
              </div>
              <div className="grid grid-cols-5 gap-1 max-h-40 overflow-hidden">
                {players.slice(0, enterCount).map((p, i) => (
                  <motion.div key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                    className={`text-xs font-mono px-1 py-0.5 truncate text-center border ${
                      p.startsWith("★") ? "border-yellow-400/60 text-yellow-400 bg-yellow-400/10" : "border-white/5 text-white/30"
                    }`}>
                    {p.replace("★", "")}
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ── SIMULATING ─────────────────────────────────────────────── */}
          {phase === "simulating" && (
            <div className="space-y-4">
              <div className="font-mono text-yellow-400/60 text-xs tracking-[0.4em] text-center">
                ⚡ TRIBUTE SCORES COMPUTING — LIVE RANKINGS
              </div>
              <div className="space-y-1.5 font-mono text-xs">
                {simulLines.slice(0, 10).map((row, i) => (
                  <motion.div key={row.name}
                    layout
                    className={`flex items-center gap-3 px-3 py-1.5 border ${
                      row.name.startsWith("★")
                        ? "border-yellow-400/50 bg-yellow-400/8 text-yellow-400"
                        : "border-white/5 text-white/50"
                    }`}
                  >
                    <span className="w-5 text-white/20 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 truncate">{row.name.replace("★", "★ ")}</span>
                    <motion.span
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.05 }}
                      className="font-black tracking-wider"
                      style={{ color: row.name.startsWith("★") ? "#C9A84C" : "#6b7280" }}
                    >
                      {row.score.toLocaleString()}
                    </motion.span>
                  </motion.div>
                ))}
              </div>
              <div className="flex justify-center gap-1.5">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-yellow-400"
                    animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.3 }} />
                ))}
              </div>
            </div>
          )}

          {/* ── FILTERING ──────────────────────────────────────────────── */}
          {phase === "filtering" && (
            <div className="space-y-5 text-center">
              <div className="space-y-2">
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.8 }}
                  className="font-mono text-red-400 text-xs tracking-[0.5em]">
                  ◉ ELIMINATING 90 CITIZENS
                </motion.div>
                <div className="font-mono font-black text-4xl text-white tracking-widest">GDNA ARENA</div>
                <div className="font-mono text-yellow-400/40 text-xs tracking-widest">SEPARATING THE GREAT FROM THE REST</div>
              </div>
              <div className="relative h-24 overflow-hidden border border-yellow-400/10">
                <motion.div
                  initial={{ y: 0 }}
                  animate={{ y: "-60%" }}
                  transition={{ duration: 1.8, ease: "easeIn" }}
                  className="space-y-1 p-2">
                  {players.map((p, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 1 }}
                      animate={{ opacity: surviving.includes(p) ? 1 : 0 }}
                      transition={{ delay: Math.random() * 1.5, duration: 0.3 }}
                      className={`text-xs font-mono px-2 py-0.5 ${
                        p.startsWith("★") ? "text-yellow-400 font-black" : "text-white/30"
                      }`}>
                      {p.replace("★", "★ ")}
                    </motion.div>
                  ))}
                </motion.div>
              </div>
              <div className="font-mono text-yellow-400 text-sm tracking-wider">
                TOP 10 SURVIVORS EMERGING...
              </div>
            </div>
          )}

          {/* ── REVEALING ──────────────────────────────────────────────── */}
          {phase === "revealing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <motion.div animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="text-5xl">♔</motion.div>
              <div className="font-mono text-yellow-400 text-xs tracking-[0.5em] animate-pulse">
                CALCULATING YOUR DESTINY...
              </div>
            </div>
          )}

          {/* ── DONE ────────────────────────────────────────────────────── */}
          {phase === "done" && result && (() => {
            const tc = tierConfig[result.tier] ?? tierConfig.citizen;
            const TIcon = tc.icon;
            return (
              <div className="space-y-5">
                {/* Placement hero */}
                <div className="text-center space-y-2 py-2">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}>
                    <TIcon className="w-14 h-14 mx-auto" style={{ color: tc.color, filter: `drop-shadow(0 0 20px ${tc.color}80)` }} />
                  </motion.div>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <div className="font-mono font-black text-5xl tracking-widest" style={{ color: tc.color,
                      textShadow: `0 0 30px ${tc.color}60` }}>
                      #{result.placement}
                    </div>
                    <div className="font-mono text-xs tracking-[0.5em] mt-1" style={{ color: tc.color }}>
                      {tc.label} · {tc.label_ar}
                    </div>
                    <div className="font-mono text-white/40 text-xs mt-1">OUT OF 100 CITIZENS</div>
                  </motion.div>
                </div>

                {/* Rewards */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="grid grid-cols-2 gap-3">
                  <div className="border border-yellow-400/30 p-4 text-center bg-yellow-400/5">
                    <Coins className="w-5 h-5 mx-auto mb-1" style={{ color: "#C9A84C" }} />
                    <div className="font-mono font-black text-2xl" style={{ color: "#C9A84C" }}>+{result.coinsEarned}</div>
                    <div className="font-mono text-xs text-white/30 uppercase tracking-widest">GDNA Coins</div>
                  </div>
                  <div className="border border-purple-400/30 p-4 text-center bg-purple-400/5">
                    <Zap className="w-5 h-5 mx-auto mb-1 text-purple-400" />
                    <div className="font-mono font-black text-2xl text-purple-400">+{result.xpEarned}</div>
                    <div className="font-mono text-xs text-white/30 uppercase tracking-widest">XP</div>
                  </div>
                </motion.div>

                {/* Reward tier legend */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
                  className="border border-white/5 p-3 space-y-1.5">
                  <div className="font-mono text-white/30 text-xs tracking-widest mb-2">TRIBUTE SCALE</div>
                  {[
                    { rank: "1st",   coins: 200, color: "#C9A84C" },
                    { rank: "2–3",   coins: 100, color: "#E8C97A" },
                    { rank: "4–10",  coins: 50,  color: "#A8D8EA" },
                    { rank: "11–100",coins: 10,  color: "#4b5563" },
                  ].map(r => (
                    <div key={r.rank} className="flex justify-between font-mono text-xs">
                      <span style={{ color: r.color }}>{r.rank}</span>
                      <span style={{ color: r.color }}>{r.coins} coins</span>
                    </div>
                  ))}
                </motion.div>

                {/* Message */}
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
                  className="font-mono text-center text-xs text-white/50 italic">
                  "{result.message}"
                </motion.p>

                {/* Actions */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}
                  className="flex gap-3">
                  <Button onClick={() => { onComplete(result.coinsEarned, result.xpEarned, result.placement, "GlobalStar"); onClose(); }}
                    className="flex-1 font-mono font-black text-xs tracking-[0.3em] uppercase border border-yellow-400 text-yellow-400 bg-transparent hover:bg-yellow-400 hover:text-black h-10">
                    ↺ ENTER AGAIN
                  </Button>
                  <Link href="/games/globalstar/ranking">
                    <Button onClick={onClose} variant="outline"
                      className="flex-1 font-mono text-xs tracking-wider border-white/20 text-white/50 hover:border-white/40 h-10">
                      VIEW RANKINGS →
                    </Button>
                  </Link>
                </motion.div>
              </div>
            );
          })()}

          {/* Error state */}
          {error && (
            <div className="text-center space-y-3 py-8">
              <div className="font-mono text-red-400 text-sm">{error}</div>
              <Button onClick={onClose} variant="outline" className="border-red-400/40 text-red-400">CLOSE</Button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function Games() {
  const { user, refreshUser } = useAuth();
  const { t, lang } = useLang();
  const { country } = useLegal();
  const [, setLocation] = useLocation();
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [result, setResult]         = useState<(PlayResult) | null>(null);
  const [showTournament, setShowTournament] = useState(false);

  // Save a match to localStorage for Recent Matches on Dashboard
  const saveRecentMatch = (entry: {
    game: string; win: boolean; coins: number; xp: number; time: string;
  }) => {
    try {
      const stored = JSON.parse(localStorage.getItem("gdna_recent_matches") ?? "[]");
      const updated = [entry, ...stored].slice(0, 20);
      localStorage.setItem("gdna_recent_matches", JSON.stringify(updated));
    } catch { /* ignore */ }
  };

  const handlePlay = async (gameId: string, gameTitle: string, isTournament: boolean) => {
    if (isTournament) { setShowTournament(true); return; }

    setPlayingId(gameId);
    try {
      const res = await fetch(`${BASE}/api/games/${gameId}/play`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult({ ...data, gameTitle });
      saveRecentMatch({
        game: gameTitle,
        win: data.win,
        coins: data.coinsEarned,
        xp: data.xpEarned,
        time: new Date().toISOString(),
      });
      if (user) await refreshUser();
    } catch {
      // silently fail
    } finally {
      setPlayingId(null);
    }
  };

  const handleTournamentComplete = async (tournamentCoins?: number, tournamentXp?: number, placement?: number, gameTitle?: string) => {
    if (tournamentCoins !== undefined) {
      saveRecentMatch({
        game: gameTitle ?? "GlobalStar",
        win: (placement ?? 999) <= 10,
        coins: tournamentCoins,
        xp: tournamentXp ?? 0,
        time: new Date().toISOString(),
      });
    }
    if (user) await refreshUser();
    setShowTournament(false);
  };

  const GAMING_WARN: Record<string, string> = {
    en: "⚠️ Gaming regulations apply in your country. GDNA Arena coins are virtual only — no real monetary value. Play responsibly.",
    ar: "⚠️ Gaming regulations of your country apply. GDNA Arena coins are virtual only — no real monetary value. Play responsibly.",
    fr: "⚠️ Les réglementations sur les jeux s'appliquent dans votre pays. Les coins GDNA Arena sont virtuels uniquement — aucune valeur monétaire réelle.",
    es: "⚠️ Las regulaciones de juegos aplican en tu país. Las monedas GDNA Arena son solo virtuales — sin valor monetario real.",
    de: "⚠️ In Ihrem Land gelten Spielvorschriften. GDNA Arena Coins sind rein virtuell — kein realer Geldwert.",
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-7xl mx-auto space-y-12">

      {/* Gaming warning — restricted countries only */}
      {country.gamingWarning && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="mt-4 border border-orange-500/30 bg-orange-950/30 rounded-xl px-5 py-3 flex items-start gap-3">
          <span className="text-orange-400 text-lg shrink-0">⚠️</span>
          <div>
            <p className="text-orange-300 text-sm leading-relaxed">
              {GAMING_WARN[lang] ?? GAMING_WARN.en}
            </p>
            <Link href="/legal" className="text-orange-400/70 hover:text-orange-300 text-xs underline mt-1 inline-block transition-colors">
              View your legal rights →
            </Link>
          </div>
        </motion.div>
      )}

      {/* Header */}
      <div className="text-center space-y-4 pt-8">
        <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-6xl font-black uppercase tracking-wider neon-text-glow">
          {t("select_arena")}
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="text-muted-foreground uppercase tracking-widest">
          {t("compete")}
        </motion.p>
      </div>

      {/* 4-game grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {GAMES.map((game, index) => (
          <motion.div key={game.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.12 + 0.2 }}>
            <Card className={`overflow-hidden group hover:border-opacity-80 transition-all duration-500 h-full flex flex-col relative ${
              game.isTournament ? "border-yellow-400/40 bg-black" : "bg-card/40 border-primary/20"
            }`}
              style={game.isTournament ? { boxShadow: "0 0 30px #C9A84C10" } : {}}>

              {/* Tournament crown badge */}
              {game.isTournament && (
                <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2 py-1 border border-yellow-400/50 bg-black/80 font-mono text-xs text-yellow-400 tracking-widest">
                  ♔ TOURNAMENT
                </div>
              )}

              <div className="relative aspect-video overflow-hidden">
                <img src={game.image} alt={game.title}
                  className="object-cover w-full h-full transform group-hover:scale-110 transition-transform duration-700 ease-out" />
                <div className={`absolute inset-0 bg-gradient-to-t ${game.isTournament ? "from-black via-black/30 to-transparent" : "from-background via-background/20 to-transparent"}`} />
                {!game.isTournament && (
                  <div className="absolute top-4 right-4">
                    <span className="px-3 py-1 bg-background/80 backdrop-blur border border-primary/50 text-xs font-bold uppercase tracking-wider text-primary rounded-full">
                      {game.genre}
                    </span>
                  </div>
                )}
              </div>

              <CardContent className={`p-5 flex-1 flex flex-col justify-between relative z-10 -mt-4 ${game.isTournament ? "bg-black border-t border-yellow-400/20" : ""}`}>
                <div>
                  <h3 className={`text-xl font-bold uppercase tracking-wider mb-2 transition-colors ${
                    game.isTournament ? "text-yellow-400 font-mono" : "group-hover:text-primary"
                  }`}>
                    {game.title}
                  </h3>
                  <p className="text-muted-foreground text-xs line-clamp-3 mb-3 leading-relaxed">
                    {game.description}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="border-t border-border/30 pt-3 space-y-1.5">
                    <div className="flex justify-between text-xs uppercase tracking-wider">
                      <span className="text-muted-foreground flex items-center gap-1"><Coins className="w-3 h-3" /> Reward</span>
                      <span className="font-bold" style={{ color: game.color }}>{game.minReward}–{game.maxReward} coins</span>
                    </div>
                    {game.isTournament ? (
                      <div className="flex justify-between text-xs uppercase tracking-wider">
                        <span className="text-muted-foreground">Top 10</span>
                        <span className="font-bold text-yellow-400/80">50–200 coins</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-xs uppercase tracking-wider">
                        <span className="text-muted-foreground">Win Chance</span>
                        <span className="font-bold text-green-400">{game.winChance}</span>
                      </div>
                    )}
                  </div>

                  <Button
                    className={`w-full h-11 font-bold uppercase tracking-wider transition-all duration-300 ${
                      game.isTournament
                        ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400 hover:bg-yellow-400 hover:text-black font-mono"
                        : "bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-primary-foreground"
                    }`}
                    onClick={() => handlePlay(game.id, game.title, game.isTournament)}
                    disabled={playingId === game.id}
                  >
                    {playingId === game.id ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</>
                    ) : game.isTournament ? (
                      <><Crown className="w-4 h-4 mr-2" />ENTER TOURNAMENT</>
                    ) : (
                      <><Play className="w-4 h-4 mr-2" />Play Now</>
                    )}
                  </Button>

                  {/* GlobalStar: link to voting hall */}
                  {game.isTournament && (
                    <Link href="/games/globalstar/ranking">
                      <button className="w-full text-center font-mono text-xs text-yellow-400/30 hover:text-yellow-400/60 transition-colors tracking-widest py-1">
                        VIEW HALL OF LEGENDS →
                      </button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Standard game result modal */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setResult(null)}>
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className={`relative w-full max-w-sm rounded-2xl border p-8 text-center bg-card ${
                result.win ? "border-primary shadow-[0_0_40px_rgba(0,212,255,0.3)]" : "border-destructive/50"
              }`}>
              <button onClick={() => setResult(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-white">
                <X className="w-5 h-5" />
              </button>
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${result.win ? "bg-primary/20" : "bg-destructive/20"}`}>
                {result.win ? <Trophy className="w-10 h-10 text-primary drop-shadow-[0_0_12px_rgba(0,212,255,0.9)]" /> : <X className="w-10 h-10 text-destructive" />}
              </div>
              <h2 className={`text-3xl font-black uppercase tracking-wider mb-1 ${result.win ? "text-primary neon-text-glow" : "text-destructive"}`}>
                {result.win ? "Victory!" : "Defeat"}
              </h2>
              <p className="text-muted-foreground text-sm mb-6">{result.gameTitle}</p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-background/50 rounded-xl p-4 border border-primary/20">
                  <Coins className="w-5 h-5 text-primary mx-auto mb-1" />
                  <p className="text-2xl font-black text-primary">+{result.coinsEarned}</p>
                  <p className="text-xs text-muted-foreground uppercase">Coins</p>
                </div>
                <div className="bg-background/50 rounded-xl p-4 border border-primary/20">
                  <Zap className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
                  <p className="text-2xl font-black text-yellow-400">+{result.xpEarned}</p>
                  <p className="text-xs text-muted-foreground uppercase">XP</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Balance: <span className="text-white font-bold">{result.newBalance.toLocaleString()} coins</span></p>
              <Button onClick={() => setResult(null)} className="w-full bg-primary hover:bg-primary/90 text-black font-bold uppercase tracking-wider neon-glow">
                Play Again
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tournament Modal */}
      <AnimatePresence>
        {showTournament && (
          <TournamentModal
            user={user}
            onClose={() => setShowTournament(false)}
            onComplete={handleTournamentComplete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
