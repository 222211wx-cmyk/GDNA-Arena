import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import GdnAiTerminal from "@/components/GdnAiTerminal";
import { Sparkles } from "lucide-react";

export default function Home() {
  const { t } = useLang();

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[80vw] h-[60vw] max-w-[800px] max-h-[600px] bg-primary/8 rounded-full blur-[140px] pointer-events-none" />

      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center z-10 space-y-8 px-4 max-w-4xl pt-20 pb-16"
      >
        <h1 className="text-6xl md:text-8xl font-black text-white uppercase tracking-tighter neon-text-glow leading-tight">
          GDNA Arena
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground font-medium uppercase tracking-widest">
          {t("hero_sub")}
        </p>

        <div className="flex flex-wrap gap-4 justify-center pt-4">
          <Link href="/games">
            <Button
              size="lg"
              className="h-16 px-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300 hover:scale-105 active:scale-95"
            >
              {t("hero_btn")}
            </Button>
          </Link>
          <Link href="/leaderboard">
            <Button
              size="lg"
              variant="outline"
              className="h-16 px-12 text-lg font-bold uppercase tracking-wider border-primary/50 text-primary hover:bg-primary/10 transition-all duration-300"
            >
              {t("hero_btn2")}
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* ── GDN-AI Terminal Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
        className="w-full max-w-2xl px-4 pb-20 z-10"
      >
        {/* Section header */}
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

        {/* Terminal card */}
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
