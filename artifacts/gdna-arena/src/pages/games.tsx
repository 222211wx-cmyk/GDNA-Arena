import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Trophy, X, Coins, Zap, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useLocation } from "wouter";

const GAMES = [
  {
    id: "neon-racer",
    title: "Neon Racer",
    description: "Race through glowing cyberpunk streets at breakneck speed",
    image: "/images/neon-racer.png",
    genre: "Racing",
    minReward: 20,
    maxReward: 80,
    winChance: "60%",
  },
  {
    id: "crypto-clash",
    title: "Crypto Clash",
    description: "Battle opponents in strategic card duels, earn coins with every win",
    image: "/images/crypto-clash.png",
    genre: "Strategy",
    minReward: 30,
    maxReward: 120,
    winChance: "50%",
  },
  {
    id: "arena-strike",
    title: "Arena Strike",
    description: "First-person arena combat. Dominate and claim your crypto rewards",
    image: "/images/arena-strike.png",
    genre: "FPS",
    minReward: 50,
    maxReward: 200,
    winChance: "45%",
  },
];

interface PlayResult {
  win: boolean;
  coinsEarned: number;
  xpEarned: number;
  newBalance: number;
  newXp: number;
  message: string;
}

export default function Games() {
  const { user, refreshUser } = useAuth();
  const { t } = useLang();
  const [, setLocation] = useLocation();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [result, setResult] = useState<(PlayResult & { gameTitle: string }) | null>(null);

  const handlePlay = async (gameId: string, gameTitle: string) => {
    if (!user) {
      setLocation("/login");
      return;
    }
    setPlayingId(gameId);
    try {
      const res = await fetch(`/api/games/${gameId}/play`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult({ ...data, gameTitle });
      await refreshUser();
    } catch {
      // silently fail
    } finally {
      setPlayingId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <div className="text-center space-y-4 pt-8">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-6xl font-black uppercase tracking-wider neon-text-glow"
        >
          {t("select_arena")}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-muted-foreground uppercase tracking-widest"
        >
          {t("compete")}
        </motion.p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {GAMES.map((game, index) => (
          <motion.div
            key={game.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.15 + 0.3 }}
          >
            <Card className="bg-card/40 border-primary/20 overflow-hidden group hover:border-primary/60 transition-colors duration-500 h-full flex flex-col">
              <div className="relative aspect-video overflow-hidden">
                <img
                  src={game.image}
                  alt={game.title}
                  className="object-cover w-full h-full transform group-hover:scale-110 transition-transform duration-700 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
                <div className="absolute top-4 right-4">
                  <span className="px-3 py-1 bg-background/80 backdrop-blur border border-primary/50 text-xs font-bold uppercase tracking-wider text-primary rounded-full">
                    {game.genre}
                  </span>
                </div>
              </div>

              <CardContent className="p-6 flex-1 flex flex-col justify-between relative z-10 -mt-6">
                <div>
                  <h3 className="text-2xl font-bold uppercase tracking-wider mb-2 group-hover:text-primary transition-colors">
                    {game.title}
                  </h3>
                  <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
                    {game.description}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between text-xs uppercase tracking-widest border-t border-border/50 pt-4">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Coins className="w-3 h-3" /> {t("reward")}
                    </span>
                    <span className="text-primary font-bold">{game.minReward}–{game.maxReward} {t("coins")}</span>
                  </div>
                  <div className="flex justify-between text-xs uppercase tracking-widest">
                    <span className="text-muted-foreground">{t("win_chance")}</span>
                    <span className="text-green-400 font-bold">{game.winChance}</span>
                  </div>

                  <Button
                    className="w-full h-12 font-bold uppercase tracking-wider group-hover:neon-glow bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                    onClick={() => handlePlay(game.id, game.title)}
                    disabled={playingId === game.id}
                    data-testid={`button-play-${game.id}`}
                  >
                    {playingId === game.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Playing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Play Now
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Result Modal */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setResult(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`relative w-full max-w-sm rounded-2xl border p-8 text-center bg-card ${
                result.win
                  ? "border-primary shadow-[0_0_40px_rgba(0,212,255,0.3)]"
                  : "border-destructive/50 shadow-[0_0_40px_rgba(239,68,68,0.2)]"
              }`}
            >
              <button
                onClick={() => setResult(null)}
                className="absolute top-4 right-4 text-muted-foreground hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
                result.win ? "bg-primary/20" : "bg-destructive/20"
              }`}>
                {result.win
                  ? <Trophy className="w-10 h-10 text-primary drop-shadow-[0_0_12px_rgba(0,212,255,0.9)]" />
                  : <X className="w-10 h-10 text-destructive" />
                }
              </div>

              <h2 className={`text-3xl font-black uppercase tracking-wider mb-1 ${
                result.win ? "text-primary neon-text-glow" : "text-destructive"
              }`}>
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

              <p className="text-xs text-muted-foreground mb-4">
                Balance: <span className="text-white font-bold">{result.newBalance.toLocaleString()} coins</span>
              </p>

              <Button
                onClick={() => setResult(null)}
                className="w-full bg-primary hover:bg-primary/90 text-black font-bold uppercase tracking-wider neon-glow"
              >
                Play Again
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
