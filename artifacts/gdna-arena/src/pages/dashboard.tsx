import { useLocation } from "wouter";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, LogOut, Swords, Trophy, Activity } from "lucide-react";

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const handleLogout = () => {
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
            Welcome, <span className="text-primary neon-text-glow">Player_77</span>
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
              <h2 className="text-5xl md:text-7xl font-black text-white neon-text-glow mb-8 tracking-tighter">
                1,250 <span className="text-2xl text-primary font-bold">COINS</span>
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
                  <p className="text-xl font-bold">Silver II</p>
                </div>
              </div>
              <div className="w-full bg-background rounded-full h-2 mt-4 border border-primary/20">
                <div className="bg-primary h-full rounded-full w-[65%] shadow-[0_0_10px_rgba(0,212,255,0.8)]" />
              </div>
              <p className="text-xs text-right mt-2 text-muted-foreground">350 XP to Gold</p>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 border-primary/20">
            <CardContent className="p-6">
              <h3 className="text-sm uppercase tracking-widest text-muted-foreground mb-4">Recent Matches</h3>
              <div className="space-y-4">
                {[
                  { game: "Neon Racer", result: "+50 Coins", win: true },
                  { game: "Arena Strike", result: "+120 Coins", win: true },
                  { game: "Crypto Clash", result: "-10 Coins", win: false },
                ].map((match, i) => (
                  <div key={i} className="flex justify-between items-center border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <span className="font-medium text-sm">{match.game}</span>
                    <span className={`text-sm font-bold ${match.win ? 'text-primary' : 'text-destructive'}`}>
                      {match.result}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
