import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain, Zap, Target, TrendingUp, Sparkles, Star,
  Eye, Heart, Shield, Flame, Clock, CheckCircle2,
  ChevronRight, Trophy, Gamepad2, Vote, RotateCcw,
  Lightbulb, Waves, Moon, Sun, ArrowRight, Crown,
  BrainCircuit, Cpu, BarChart3, Rocket
} from "lucide-react";

// ── NLP Personality dimensions derived from platform behavior ─────────────────
function getNlpProfile(xp: number, wins: number, gamesPlayed: number, balance: number) {
  const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0;
  return [
    {
      key: "nlp_dim_action",
      score: Math.min(100, Math.round((gamesPlayed / 50) * 100)),
      color: "text-primary", bar: "bg-primary",
      icon: Zap, desc: "nlp_dim_action_desc",
    },
    {
      key: "nlp_dim_resilience",
      score: Math.min(100, Math.round(winRate * 100)),
      color: "text-green-400", bar: "bg-green-400",
      icon: Shield, desc: "nlp_dim_resilience_desc",
    },
    {
      key: "nlp_dim_growth",
      score: Math.min(100, Math.round((xp / 7500) * 100)),
      color: "text-yellow-400", bar: "bg-yellow-400",
      icon: TrendingUp, desc: "nlp_dim_growth_desc",
    },
    {
      key: "nlp_dim_abundance",
      score: Math.min(100, Math.round((balance / 5000) * 100)),
      color: "text-purple-400", bar: "bg-purple-400",
      icon: Sparkles, desc: "nlp_dim_abundance_desc",
    },
    {
      key: "nlp_dim_vision",
      score: Math.min(100, Math.round(((xp + gamesPlayed * 10) / 8000) * 100)),
      color: "text-orange-400", bar: "bg-orange-400",
      icon: Eye, desc: "nlp_dim_vision_desc",
    },
  ];
}

// ── Daily NLP Programs ────────────────────────────────────────────────────────
const NLP_PROGRAMS = [
  {
    key: "nlp_prog_anchor", icon: Waves,  color: "text-primary",  bg: "bg-primary/10",
    duration: "5 min", type: "nlp_type_anchor",
    steps: ["nlp_prog_anchor_1","nlp_prog_anchor_2","nlp_prog_anchor_3"],
  },
  {
    key: "nlp_prog_vision", icon: Eye,    color: "text-purple-400", bg: "bg-purple-400/10",
    duration: "7 min", type: "nlp_type_visual",
    steps: ["nlp_prog_vision_1","nlp_prog_vision_2","nlp_prog_vision_3"],
  },
  {
    key: "nlp_prog_reframe", icon: RotateCcw, color: "text-green-400", bg: "bg-green-400/10",
    duration: "3 min", type: "nlp_type_cognitive",
    steps: ["nlp_prog_reframe_1","nlp_prog_reframe_2","nlp_prog_reframe_3"],
  },
  {
    key: "nlp_prog_peak", icon: Flame, color: "text-orange-400", bg: "bg-orange-400/10",
    duration: "10 min", type: "nlp_type_peak",
    steps: ["nlp_prog_peak_1","nlp_prog_peak_2","nlp_prog_peak_3"],
  },
];

// ── Breathing Exercise ────────────────────────────────────────────────────────
const BREATH_PHASES = ["inhale","hold","exhale","rest"] as const;
const BREATH_TIMING = { inhale: 4, hold: 4, exhale: 6, rest: 2 };

// ── AI Trajectory Predictions ─────────────────────────────────────────────────
function getTrajectory(xp: number, wins: number, gamesPlayed: number) {
  const velocity = gamesPlayed > 0 ? (xp / Math.max(gamesPlayed, 1)) * 2 : 20;
  return [
    {
      key: "nlp_traj_rank", icon: Trophy,
      current: getRank(xp).label,
      predicted: getRank(xp + Math.round(velocity * 30)).label,
      days: 30, color: "text-yellow-400",
      confidence: 88,
    },
    {
      key: "nlp_traj_xp", icon: Star,
      current: xp,
      predicted: xp + Math.round(velocity * 30),
      days: 30, color: "text-purple-400",
      confidence: 92,
    },
    {
      key: "nlp_traj_wins", icon: Gamepad2,
      current: wins,
      predicted: wins + Math.round(gamesPlayed * 0.12),
      days: 30, color: "text-primary",
      confidence: 79,
    },
  ];
}

function getRank(xp: number) {
  if (xp < 500)  return { label: "Bronze I",  color: "#cd7f32", next: 500 };
  if (xp < 1000) return { label: "Bronze II", color: "#cd7f32", next: 1000 };
  if (xp < 2000) return { label: "Silver I",  color: "#aaa9ad", next: 2000 };
  if (xp < 3500) return { label: "Silver II", color: "#aaa9ad", next: 3500 };
  if (xp < 5000) return { label: "Gold I",    color: "#ffd700", next: 5000 };
  if (xp < 7500) return { label: "Gold II",   color: "#ffd700", next: 7500 };
  return { label: "Diamond", color: "#00d4ff", next: 10000 };
}

// ── Affirmation rotator ───────────────────────────────────────────────────────
const AFF_KEYS = ["nlp_aff_1","nlp_aff_2","nlp_aff_3","nlp_aff_4","nlp_aff_5"];

export default function Growth() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [activeProgram, setActiveProgram] = useState<number | null>(null);
  const [breathPhase, setBreathPhase] = useState<typeof BREATH_PHASES[number]>("inhale");
  const [breathing, setBrething] = useState(false);
  const [breathCount, setBreathCount] = useState(0);
  const [affIdx, setAffIdx] = useState(0);
  const breathTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate affirmations
  useEffect(() => {
    const id = setInterval(() => setAffIdx(i => (i + 1) % AFF_KEYS.length), 5000);
    return () => clearInterval(id);
  }, []);

  // Breathing engine
  useEffect(() => {
    if (!breathing) { if (breathTimer.current) clearInterval(breathTimer.current); return; }
    let phase = 0;
    const cycle = () => {
      const current = BREATH_PHASES[phase % 4];
      setBreathPhase(current);
      if (current === "inhale") setBreathCount(c => c + 1);
      const dur = BREATH_TIMING[current];
      setTimeout(() => { phase++; if (breathTimer.current) {} }, dur * 1000);
    };
    cycle();
    breathTimer.current = setInterval(cycle, 16000); // full cycle ~16s
    return () => { if (breathTimer.current) clearInterval(breathTimer.current); };
  }, [breathing]);

  if (!user) return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div className="text-center space-y-4">
        <Brain className="w-16 h-16 text-primary mx-auto animate-pulse" />
        <p className="text-muted-foreground uppercase tracking-widest text-sm">{t("nlp_login_required")}</p>
        <Link href="/login"><Button className="bg-primary/20 text-primary border border-primary">{t("login")}</Button></Link>
      </div>
    </div>
  );

  const profile = getNlpProfile(user.xp, user.wins, user.gamesPlayed, user.balance);
  const trajectory = getTrajectory(user.xp, user.wins, user.gamesPlayed);
  const rank = getRank(user.xp);
  const overallScore = Math.round(profile.reduce((s, d) => s + d.score, 0) / profile.length);

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-6xl mx-auto px-4 py-10 space-y-12">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4 relative">
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/3 w-80 h-60 bg-purple-500/8 rounded-full blur-[100px]" />
          <div className="absolute top-0 right-1/3 w-80 h-60 bg-primary/6 rounded-full blur-[100px]" />
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-400/30 bg-purple-400/5">
          <Brain className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
          <span className="text-xs font-mono font-bold text-purple-400 uppercase tracking-widest">{t("nlp_badge")}</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">
          <span className="text-purple-400" style={{ textShadow: "0 0 40px rgba(168,85,247,0.4)" }}>{t("nlp_title_1")}</span>
          <br />
          <span className="neon-text-glow">{t("nlp_title_2")}</span>
        </h1>
        <p className="text-muted-foreground text-sm uppercase tracking-widest max-w-xl mx-auto">{t("nlp_sub")}</p>
      </motion.div>

      {/* ── NLP Mental Profile ────────────────────────────────────── */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("nlp_profile_title")}</h2>
          <Badge className="ml-auto bg-purple-400/10 text-purple-400 border border-purple-400/30 font-mono">
            {t("nlp_score")}: {overallScore}%
          </Badge>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Radar-style score card */}
          <Card className="bg-gradient-to-br from-purple-500/10 to-primary/5 border-purple-400/20">
            <CardContent className="p-6 space-y-4">
              <div className="text-center space-y-2 pb-3 border-b border-purple-400/10">
                <div className="w-20 h-20 mx-auto rounded-full border-4 flex items-center justify-center relative"
                  style={{ borderColor: rank.color, boxShadow: `0 0 30px ${rank.color}40` }}>
                  <span className="text-2xl font-black" style={{ color: rank.color }}>{overallScore}</span>
                  <span className="absolute -bottom-1 text-xs font-bold text-muted-foreground">%</span>
                </div>
                <p className="font-black text-sm uppercase tracking-wider" style={{ color: rank.color }}>
                  {user.username} · {rank.label}
                </p>
                <p className="text-xs text-muted-foreground">{t("nlp_profile_sub")}</p>
              </div>
              {profile.map((dim, i) => (
                <motion.div key={dim.key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <dim.icon className={`w-3.5 h-3.5 ${dim.color}`} />
                      <span className={`font-bold ${dim.color}`}>{t(dim.key)}</span>
                    </div>
                    <span className={`font-black font-mono ${dim.color}`}>{dim.score}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${dim.score}%` }}
                      transition={{ duration: 1.2, delay: 0.3 + i * 0.1, ease: "easeOut" }}
                      className={`h-full rounded-full ${dim.bar}`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t(dim.desc)}</p>
                </motion.div>
              ))}
            </CardContent>
          </Card>

          {/* Affirmation feed */}
          <div className="space-y-4">
            <Card className="bg-card/30 border-primary/20 h-40 flex items-center justify-center overflow-hidden">
              <CardContent className="p-6 text-center">
                <Lightbulb className="w-6 h-6 text-yellow-400 mx-auto mb-3" />
                <AnimatePresence mode="wait">
                  <motion.p
                    key={affIdx}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.4 }}
                    className="text-base font-bold text-foreground/90 leading-relaxed"
                    dir={["ar","dz"].includes(lang) ? "rtl" : "ltr"}
                  >
                    "{t(AFF_KEYS[affIdx])}"
                  </motion.p>
                </AnimatePresence>
                <div className="flex justify-center gap-1 mt-3">
                  {AFF_KEYS.map((_, i) => (
                    <button key={i} onClick={() => setAffIdx(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === affIdx ? "bg-primary" : "bg-border"}`} />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick stats mapped to growth */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Gamepad2, val: user.gamesPlayed, label: t("nlp_stat_action"), color: "text-primary" },
                { icon: Trophy,   val: user.wins,         label: t("nlp_stat_wins"),   color: "text-yellow-400" },
                { icon: Star,     val: user.xp,           label: "XP",                 color: "text-purple-400" },
              ].map((s, i) => (
                <Card key={i} className="bg-card/30 border-border/50 text-center">
                  <CardContent className="p-3">
                    <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
                    <p className={`text-lg font-black font-mono ${s.color}`}>{s.val}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* NLP tip of the day */}
            <Card className="bg-yellow-400/5 border-yellow-400/20">
              <CardContent className="p-4 flex items-start gap-3">
                <Sun className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-yellow-400">{t("nlp_tip_title")}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("nlp_tip_body")}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Breathing Engine ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Waves className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("nlp_breath_title")}</h2>
        </div>
        <Card className="bg-card/30 border-primary/20 overflow-hidden">
          <CardContent className="p-8 flex flex-col md:flex-row items-center gap-8">
            {/* Breathing orb */}
            <div className="relative flex items-center justify-center shrink-0">
              <motion.div
                animate={breathPhase === "inhale" ? { scale: 1.5, opacity: 0.9 }
                  : breathPhase === "hold"   ? { scale: 1.5, opacity: 0.7 }
                  : breathPhase === "exhale" ? { scale: 1.0, opacity: 0.5 }
                  : { scale: 1.0, opacity: 0.4 }}
                transition={{ duration: breathPhase === "inhale" ? 4 : breathPhase === "exhale" ? 6 : 0.3, ease: "easeInOut" }}
                className="w-28 h-28 rounded-full bg-gradient-to-br from-primary/40 to-purple-500/30 border border-primary/40"
                style={{ boxShadow: breathing ? "0 0 40px rgba(0,212,255,0.3)" : "none" }}
              />
              <div className="absolute text-center">
                <p className={`text-xs font-black uppercase tracking-widest ${breathing ? "text-primary" : "text-muted-foreground"}`}>
                  {breathing ? t(`nlp_breath_${breathPhase}`) : t("nlp_breath_ready")}
                </p>
                {breathing && breathCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{breathCount} {t("nlp_breath_cycles")}</p>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <p className="font-bold text-sm uppercase tracking-wider mb-1">{t("nlp_breath_sub")}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{t("nlp_breath_desc")}</p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {(["inhale","hold","exhale","rest"] as const).map(p => (
                  <div key={p} className={`px-2 py-1.5 rounded-lg border transition-colors ${
                    breathPhase === p && breathing ? "border-primary bg-primary/15 text-primary font-black" : "border-border/40 text-muted-foreground"
                  }`}>
                    <p className="font-bold capitalize">{t(`nlp_breath_${p}`)}</p>
                    <p className="font-mono text-xs">{BREATH_TIMING[p]}s</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => { setBrething(!breathing); if (breathing) { setBreathCount(0); setBreathPhase("inhale"); } }}
                  className={`gap-2 font-bold uppercase tracking-wider ${breathing ? "bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30" : "bg-primary/20 text-primary border border-primary/40 hover:bg-primary hover:text-black"}`}
                >
                  {breathing ? <><Clock className="w-4 h-4" />{t("nlp_breath_stop")}</> : <><Waves className="w-4 h-4" />{t("nlp_breath_start")}</>}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── NLP Programs ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("nlp_programs_title")}</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {NLP_PROGRAMS.map((prog, i) => (
            <motion.div key={prog.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.09 }}>
              <Card
                className={`border cursor-pointer transition-all duration-200 ${
                  activeProgram === i ? "border-primary/60 bg-primary/5" : "border-border/50 bg-card/30 hover:border-primary/30"
                }`}
                onClick={() => setActiveProgram(activeProgram === i ? null : i)}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${prog.bg} border border-current/20 flex items-center justify-center`}>
                        <prog.icon className={`w-5 h-5 ${prog.color}`} />
                      </div>
                      <div>
                        <p className={`font-black text-sm uppercase tracking-wider ${prog.color}`}>{t(prog.key)}</p>
                        <p className="text-xs text-muted-foreground">{t(prog.type)} · {prog.duration}</p>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${activeProgram === i ? "rotate-90" : ""}`} />
                  </div>
                  <AnimatePresence>
                    {activeProgram === i && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3 border-t border-border/40 space-y-2">
                          {prog.steps.map((step, j) => (
                            <div key={step} className="flex items-start gap-2">
                              <div className={`w-5 h-5 rounded-full ${prog.bg} border border-current/30 flex items-center justify-center shrink-0 mt-0.5`}>
                                <span className={`text-xs font-black ${prog.color}`}>{j + 1}</span>
                              </div>
                              <p className="text-xs text-foreground/80 leading-relaxed">{t(step)}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── AI Future Trajectory ─────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Cpu className="w-6 h-6 text-primary animate-pulse" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("nlp_traj_title")}</h2>
          <Badge className="ml-auto bg-primary/10 text-primary border border-primary/30 font-mono text-xs">AI · 30 {t("nlp_days")}</Badge>
        </div>
        <Card className="bg-gradient-to-br from-primary/8 to-purple-500/5 border-primary/20">
          <CardContent className="p-6 md:p-8 space-y-6">
            <p className="text-sm text-muted-foreground">{t("nlp_traj_sub")}</p>
            <div className="grid md:grid-cols-3 gap-4">
              {trajectory.map((t2, i) => (
                <motion.div key={t2.key}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.1 }}
                >
                  <Card className="bg-card/30 border-border/50 text-center">
                    <CardContent className="p-5 space-y-3">
                      <t2.icon className={`w-6 h-6 mx-auto ${t2.color}`} />
                      <p className={`text-xs font-black uppercase tracking-wider ${t2.color}`}>{t(t2.key)}</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-sm text-muted-foreground font-mono">{t2.current}</span>
                        <ArrowRight className={`w-3.5 h-3.5 ${t2.color}`} />
                        <span className={`text-lg font-black font-mono ${t2.color}`}>{t2.predicted}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{t("nlp_confidence")}</span>
                          <span className={`font-black font-mono ${t2.color}`}>{t2.confidence}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${t2.confidence}%` }}
                            transition={{ duration: 1.2, delay: 0.4 + i * 0.12 }}
                            className={`h-full rounded-full bg-current`}
                            style={{ color: t2.color.replace("text-","") === "primary" ? "hsl(var(--primary))" : undefined }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Growth roadmap */}
            <div className="pt-4 border-t border-border/30 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t("nlp_roadmap_title")}</p>
              <div className="grid md:grid-cols-3 gap-3">
                {[
                  { phase: "30 " + t("nlp_days"), key: "nlp_road_30", icon: Rocket, color: "text-primary" },
                  { phase: "90 " + t("nlp_days"), key: "nlp_road_90", icon: Star,   color: "text-yellow-400" },
                  { phase: "1 " + t("nlp_year"),  key: "nlp_road_1y", icon: Crown,  color: "text-purple-400" },
                ].map((r, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-background/40 border border-border/30">
                    <r.icon className={`w-4 h-4 ${r.color} mt-0.5 shrink-0`} />
                    <div>
                      <p className={`text-xs font-black ${r.color}`}>{r.phase}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t(r.key)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="flex flex-wrap gap-3 justify-center pb-4">
        <Link href="/games">
          <Button className="bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-black gap-2 font-bold uppercase tracking-wider">
            <Gamepad2 className="w-4 h-4" />{t("nlp_cta_games")}
          </Button>
        </Link>
        <Link href="/chat">
          <Button variant="outline" className="border-purple-400/40 text-purple-400 hover:bg-purple-400/10 gap-2">
            <BrainCircuit className="w-4 h-4" />{t("nlp_cta_ai")}
          </Button>
        </Link>
        <Link href="/chronicle">
          <Button variant="outline" className="border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 gap-2">
            <Clock className="w-4 h-4" />{t("nlp_cta_chronicle")}
          </Button>
        </Link>
      </motion.div>

    </div>
  );
}
