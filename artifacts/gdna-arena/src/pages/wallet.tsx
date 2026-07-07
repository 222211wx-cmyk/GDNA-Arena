import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Coins, TrendingUp, TrendingDown, Trophy, Gift, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useLocation } from "wouter";

interface Transaction {
  id: number;
  amount: number;
  type: string;
  description: string;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Coins; color: string; label: string }> = {
  win:          { icon: Trophy, color: "text-primary",   label: "Win" },
  participation:{ icon: TrendingDown, color: "text-orange-400", label: "Match" },
  daily_reward: { icon: Gift, color: "text-green-400",   label: "Daily" },
};

function txConfig(type: string) {
  return TYPE_CONFIG[type] ?? { icon: TrendingUp, color: "text-primary", label: type };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Wallet() {
  const { user } = useAuth();
  const { t } = useLang();
  const [, setLocation] = useLocation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLocation("/login"); return; }
    fetch("/api/wallet/transactions", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setTransactions(d.transactions ?? []);
        setBalance(d.balance ?? 0);
      })
      .finally(() => setLoading(false));
  }, [user, setLocation]);

  const totalWon   = transactions.filter((t) => t.type === "win").reduce((s, t) => s + t.amount, 0);
  const totalGames = transactions.filter((t) => t.type === "win" || t.type === "participation").length;
  const dailyClaims = transactions.filter((t) => t.type === "daily_reward").length;

  if (!user) return null;

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider neon-text-glow mb-2">Wallet</h1>
        <p className="text-muted-foreground uppercase tracking-widest text-sm">Your coin history & balance</p>
      </motion.div>

      {/* Balance + Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="md:col-span-1">
          <Card className="bg-card/50 border-primary/30 h-full">
            <CardContent className="p-6 flex flex-col items-center justify-center text-center h-full">
              <Coins className="w-10 h-10 text-primary mb-3 drop-shadow-[0_0_12px_rgba(0,212,255,0.8)]" />
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Balance</p>
              <p className="text-4xl font-black text-primary neon-text-glow" data-testid="text-wallet-balance">
                {balance.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">COINS</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }} className="md:col-span-2">
          <div className="grid grid-cols-3 gap-4 h-full">
            {[
              { label: "Games Played", value: totalGames, color: "text-white" },
              { label: "Coins Won", value: totalWon.toLocaleString(), color: "text-primary" },
              { label: "Daily Claims", value: dailyClaims, color: "text-green-400" },
            ].map((stat) => (
              <Card key={stat.label} className="bg-card/50 border-primary/20">
                <CardContent className="p-4 text-center">
                  <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Transaction History */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h2 className="text-lg font-bold uppercase tracking-widest text-muted-foreground mb-4">Transaction History</h2>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <Card className="bg-card/30 border-primary/10">
            <CardContent className="p-12 text-center">
              <Coins className="w-12 h-12 text-primary/30 mx-auto mb-3" />
              <p className="text-muted-foreground uppercase tracking-widest text-sm">No transactions yet. Play a game!</p>
            </CardContent>
          </Card>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-2">
            {transactions.map((tx, i) => {
              const cfg = txConfig(tx.type);
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={tx.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  data-testid={`tx-${tx.id}`}
                >
                  <Card className="bg-card/40 border-primary/10 hover:border-primary/30 transition-colors">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full bg-background flex items-center justify-center border border-primary/20 shrink-0`}>
                        <Icon className={`w-5 h-5 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{tx.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(tx.createdAt)}</p>
                      </div>
                      <span className={`font-black text-lg shrink-0 ${tx.amount >= 0 ? "text-primary" : "text-destructive"}`}>
                        {tx.amount >= 0 ? "+" : ""}{tx.amount}
                      </span>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
