import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Trophy, Coins, Swords, Crown, Medal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLang } from "@/contexts/LangContext";

interface LeaderboardPlayer {
  id: number;
  username: string;
  balance: number;
  wins: number;
  gamesPlayed: number;
  xp: number;
}

function RankBadge({ position }: { position: number }) {
  if (position === 1) return <Crown className="w-6 h-6 text-yellow-400 drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]" />;
  if (position === 2) return <Medal className="w-6 h-6 text-slate-300 drop-shadow-[0_0_8px_rgba(170,169,173,0.8)]" />;
  if (position === 3) return <Medal className="w-6 h-6 text-orange-400 drop-shadow-[0_0_8px_rgba(205,127,50,0.8)]" />;
  return <span className="w-6 h-6 flex items-center justify-center text-muted-foreground font-bold text-sm">#{position}</span>;
}

const rowColors: Record<number, string> = {
  1: "border-yellow-400/40 bg-yellow-400/5",
  2: "border-slate-300/40 bg-slate-300/5",
  3: "border-orange-400/40 bg-orange-400/5",
};

export default function Leaderboard() {
  const { t } = useLang();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/leaderboard", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setPlayers(data.players ?? []))
      .catch(() => setError("Failed to load leaderboard"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-10"
      >
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider neon-text-glow mb-3">
          {t("lb_title")}
        </h1>
        <p className="text-muted-foreground uppercase tracking-widest text-sm">{t("lb_sub")}</p>
      </motion.div>

      {loading && (
        <div className="text-center text-primary animate-pulse text-xl uppercase tracking-widest mt-20">
          Loading...
        </div>
      )}
      {error && <div className="text-center text-destructive mt-20">{error}</div>}

      {!loading && !error && players.length === 0 && (
        <div className="text-center mt-20">
          <Trophy className="w-16 h-16 text-primary/30 mx-auto mb-4" />
          <p className="text-muted-foreground uppercase tracking-widest">No players yet. Be the first!</p>
        </div>
      )}

      {!loading && players.length > 0 && (
        <div className="space-y-3">
          {/* Header */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-2 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="col-span-1">{t("lb_rank")}</span>
            <span className="col-span-5">{t("lb_player")}</span>
            <span className="col-span-3 text-right">{t("lb_xp")}</span>
            <span className="col-span-3 text-right">{t("lb_wins")}</span>
          </div>

          {players.map((player, index) => {
            const position = index + 1;
            const winRate = player.gamesPlayed > 0
              ? Math.round((player.wins / player.gamesPlayed) * 100)
              : 0;

            return (
              <motion.div
                key={player.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                data-testid={`row-player-${player.id}`}
              >
                <Card className={`border transition-all hover:scale-[1.01] duration-200 ${
                  rowColors[position] ?? "border-primary/10 bg-card/50"
                }`}>
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 flex justify-center shrink-0">
                        <RankBadge position={position} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg uppercase tracking-wide truncate" data-testid={`text-username-${player.id}`}>
                          {player.username}
                        </p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Swords className="w-3 h-3" />
                            {player.wins}W / {player.gamesPlayed}G
                          </span>
                          <span>{winRate}% WR</span>
                          <span>{player.xp} XP</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Coins className="w-5 h-5 text-primary" />
                        <span className="text-xl font-black text-primary neon-text-glow" data-testid={`text-balance-${player.id}`}>
                          {player.balance.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
