import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import GdnAiTerminal from "@/components/GdnAiTerminal";
import { Sparkles, Globe, Cpu, ArrowRight, Vote, Gamepad2, BrainCircuit } from "lucide-react";

const PILLARS = [
  { icon: Gamepad2,    key: "home_pillar_games",  color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/30" },
  { icon: Vote,        key: "home_pillar_vote",   color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30" },
  { icon: BrainCircuit,key: "home_pillar_ai",    color: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-400/30" },
  { icon: Globe,       key: "home_pillar_lang",   color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
];

export default function Home() {
  const { t } = useLang();

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[80vw] h-[60vw] max-w-[800px] max-h-[600px] bg-primary/8 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 left-1/4 w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center z-10 space-y-6 px-4 max-w-5xl pt-16 pb-10"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-2"
        >
          <Cpu className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span className="text-xs font-mono font-bold text-primary uppercase tracking-widest">
            {t("home_badge")}
          </span>
        </motion.div>

        <h1 className="text-6xl md:text-8xl font-black text-white uppercase tracking-tighter neon-text-glow leading-tight">
          GDNA Arena
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground font-medium uppercase tracking-widest">
          {t("hero_sub")}
        </p>

        <p className="text-sm text-foreground/60 max-w-2xl mx-auto font-mono">
          {t("home_desc")}
        </p>

        <div className="flex flex-wrap gap-4 justify-center pt-2">
          <Link href="/hub">
            <Button
              size="lg"
              className="h-14 px-10 text-base font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300 hover:scale-105 active:scale-95 gap-2"
            >
              {t("home_btn_hub")} <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/games">
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-10 text-base font-bold uppercase tracking-wider border-primary/50 text-primary hover:bg-primary/10 transition-all duration-300 gap-2"
            >
              {t("hero_btn")}
            </Button>
          </Link>
          <Link href="/games/globalstar">
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-10 text-base font-bold uppercase tracking-wider border-purple-400/50 text-purple-400 hover:bg-purple-400/10 transition-all duration-300 gap-2"
            >
              GlobalStar <Vote className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* ── 4 Pillars ── */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.7 }}
        className="w-full max-w-5xl px-4 pb-10 z-10"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {PILLARS.map((pillar, i) => (
            <motion.div
              key={pillar.key}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.08 }}
              className={`rounded-xl border ${pillar.border} ${pillar.bg} p-4 text-center group hover:scale-105 transition-transform cursor-default`}
            >
              <pillar.icon className={`w-6 h-6 mx-auto mb-2 ${pillar.color}`} />
              <p className={`text-xs font-bold uppercase tracking-wider ${pillar.color}`}>{t(pillar.key)}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── GDN-AI Terminal Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.5, ease: "easeOut" }}
        className="w-full max-w-2xl px-4 pb-20 z-10"
      >
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/30" />
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5">
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span className="text-xs font-mono font-bold text-primary uppercase tracking-widest">
              GDN-AI
            </span>
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/30" />
        </div>

        <div className="rounded-xl border border-primary/25 bg-card/40 backdrop-blur-sm shadow-2xl shadow-primary/10 overflow-hidden">
          <GdnAiTerminal />
        </div>

        <p className="text-center text-xs text-muted-foreground/50 font-mono mt-3 uppercase tracking-widest">
          {t("chat_sub")}
        </p>
      </motion.div>
    </div>
  );
}
