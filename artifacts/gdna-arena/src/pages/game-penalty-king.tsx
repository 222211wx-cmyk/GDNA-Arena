import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowLeft, Crown, Trophy } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Card, CardContent } from "@workspace/gdna-ds/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import GameWarning from "@/components/GameWarning";
import { useLang } from "@/contexts/LangContext";
import { gameText } from "@/i18n/game-chrome";
import { localeForLang } from "@/i18n/game-locale-copy";

type Direction = "left" | "center" | "right";
type Result = { win: boolean; xpEarned: number; message: string };

export default function PenaltyKingGame() {
  const [, navigate] = useLocation();
  const { refreshUser } = useAuth();
  const { lang } = useLang();
  const t = (key: Parameters<typeof gameText>[1]) => gameText(lang, key);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function shoot(direction: Direction) {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/games/penalty-king/play", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("roundError"));
      setResult(data);
      await refreshUser();
    } catch (error) {
      setResult({ win: false, xpEarned: 0, message: error instanceof Error ? error.message : t("roundError") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button variant="ghost" onClick={() => navigate("/games")} className="text-primary">
          <ArrowLeft className="me-2 size-4" /> {t("penaltyBack")}
        </Button>
        <GameWarning />

        <Card className="overflow-hidden border-primary/50 bg-card">
          <CardContent className="space-y-8 p-6 text-center md:p-10">
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
              <Crown className="mx-auto size-16 text-primary" />
            </motion.div>
            <div dir={lang === "ar" ? "rtl" : "ltr"}>
              <p className="text-xs font-black tracking-[0.3em] text-primary">{t("kingsLeague")}</p>
              <h1 className="mt-2 text-3xl font-black md:text-5xl">{t("penaltyTitle")}</h1>
              <p className="mt-3 text-muted-foreground">{t("penaltyIntro")}</p>
            </div>

            <div className="mx-auto grid max-w-xl grid-cols-3 gap-3 rounded-xl border border-primary/30 bg-background p-4">
              {(["left", "center", "right"] as const).map((direction, index) => (
                <Button
                  key={direction}
                  onClick={() => shoot(direction)}
                  disabled={submitting}
                  variant="outline"
                  className="h-24 border-primary/40 text-2xl hover:bg-primary hover:text-primary-foreground"
                  aria-label={[t("shootLeft"), t("shootCenter"), t("shootRight")][index]}
                >
                  {["↙", "⚽", "↘"][index]}
                </Button>
              ))}
            </div>

            {submitting && <p className="animate-pulse font-bold text-primary">{t("keeperMoving")}</p>}
            {result && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl border border-primary/30 bg-primary/5 p-5">
                <Trophy className="mx-auto mb-2 size-7 text-primary" />
                <p className="font-black">{result.win ? t("royalGoal") : t("keeperSaved")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>
                <p className="mt-2 font-black text-primary">+{result.xpEarned.toLocaleString(localeForLang[lang])} XP</p>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}