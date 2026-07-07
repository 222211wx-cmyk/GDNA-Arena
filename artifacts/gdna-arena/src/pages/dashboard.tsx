import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, LogOut, Swords, Trophy, Activity, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

function getRank(xp: number): { label: string; next: number; color: string } {
  if (xp < 500) return { label: "Bronze I", next: 500, color: "#cd7f32" };
  if (xp < 1000) return { label: "Bronze II", next: 1000, color: "#cd7f32" };
  if (xp < 2000) return { label: "Silver I", next: 2000, color: "#aaa9ad" };
  if (xp < 3500) return { label: "Silver II", next: 3500, color: "#aaa9ad" };
  if (xp < 5000) return { label: "Gold I", next: 5000, color: "#ffd700" };
  if (xp < 7500) return { label: "Gold II", next: 7500, color: "#ffd700" };
  return { label: "Diamond", next: 10000, color: "#00d4ff" };
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, logout, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      setLocation("/login");
    }
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

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-6xl mx-auto space-y-8">
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
        <Button
          variant="outline"
          onClick={handleLogout}
          className="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary transition-colors"
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="md:col-span-2"
        >
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

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
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
                  className="h-full rounded-full shadow-[0_0_10px_rgba(0,212,255,0.8)] transition-all duration-1000"
                  style={{ width: `${xpProgress}%`, backgroundColor: rank.color }}
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
    </div>
  );
}
