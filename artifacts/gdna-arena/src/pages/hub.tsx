import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGetGsDomains, useGetGsRanking, useGetGsNews } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe, Cpu, Trophy, Star, Zap, TrendingUp, Users,
  Vote, Newspaper, Gamepad2, BrainCircuit, Flame,
  ChevronRight, ArrowRight, Shield, Sparkles, Radio
} from "lucide-react";

// ── AI Smart Feed (simulated live data) ──────────────────────────────────────
const AI_PULSES = [
  { id: 1, lang: "ar", flag: "🇸🇦", text: "مستجد ذكي: تصويت قياسي في مجال الموسيقى خلال 24 ساعة" },
  { id: 2, lang: "fr", flag: "🇫🇷", text: "IA Prédiction: Hausse de 40% des votes dans Football" },
  { id: 3, lang: "en", flag: "🇬🇧", text: "AI Alert: Neon Racer trending — 3x normal traffic" },
  { id: 4, lang: "dz", flag: "🇲🇦", text: "تنبيه ذكي: Crypto Clash كيقلب كل التوقعات هذا الأسبوع" },
  { id: 5, lang: "fr", flag: "🇫🇷", text: "Mise à jour: Algorithme de classement v4.2 déployé" },
  { id: 6, lang: "en", flag: "🇬🇧", text: "System: AI moderation processed 12,400 votes this hour" },
  { id: 7, lang: "ar", flag: "🌍", text: "تحديث: تم تفعيل خوارزمية التنبؤ الجديدة بنجاح" },
];

const PLATFORM_STATS = [
  { key: "hub_stat_votes", value: "2.4M+", icon: Vote, color: "text-primary" },
  { key: "hub_stat_games", value: "847K+", icon: Gamepad2, color: "text-yellow-400" },
  { key: "hub_stat_users", value: "156K+", icon: Users, color: "text-green-400" },
  { key: "hub_stat_ai", value: "99.8%", icon: BrainCircuit, color: "text-purple-400" },
];

export default function Hub() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [pulseIdx, setPulseIdx] = useState(0);
  const [tick, setTick] = useState(0);

  const { data: domains } = useGetGsDomains();
  const { data: ranking } = useGetGsRanking();
  const { data: news } = useGetGsNews();

  // Rotate AI pulse messages
  useEffect(() => {
    const id = setInterval(() => {
      setPulseIdx(p => (p + 1) % AI_PULSES.length);
      setTick(t => t + 1);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const topDomain = ranking?.ranking?.[0];
  const topFigures = topDomain?.figures?.slice(0, 3) ?? [];
  const latestNews = news?.articles?.slice(0, 3) ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-8 max-w-7xl mx-auto space-y-12">

      {/* ── AI Live Intelligence Bar ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-sm px-4 py-3 flex items-center gap-3 overflow-hidden"
      >
        <div className="flex items-center gap-2 shrink-0">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-xs font-mono font-bold text-primary uppercase tracking-widest">
            {t("hub_ai_live")}
          </span>
        </div>
        <div className="h-4 w-px bg-primary/30 shrink-0" />
        <AnimatePresence mode="wait">
          <motion.div
            key={pulseIdx}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 min-w-0"
          >
            <span className="text-base">{AI_PULSES[pulseIdx].flag}</span>
            <p className="text-sm text-foreground/80 truncate font-mono">
              {AI_PULSES[pulseIdx].text}
            </p>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* ── Page Header ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-wider neon-text-glow">
          {t("hub_title")}
        </h1>
        <p className="text-muted-foreground uppercase tracking-widest text-sm">
          {t("hub_sub")}
        </p>
      </motion.div>

      {/* ── Platform Stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {PLATFORM_STATS.map((stat, i) => (
          <motion.div
            key={stat.key}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="bg-card/40 border-primary/20 hover:border-primary/50 transition-colors group">
              <CardContent className="p-5 text-center">
                <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color} group-hover:scale-110 transition-transform`} />
                <p className={`text-3xl font-black font-mono ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{t(stat.key)}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ── Main Grid: GlobalStar + Gaming ──────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-8">

        {/* GlobalStar Live Rankings */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="bg-card/40 border-primary/20 h-full">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Vote className="w-5 h-5 text-primary" />
                  <h2 className="font-bold uppercase tracking-wider text-lg">{t("hub_gs_title")}</h2>
                </div>
                <Badge variant="outline" className="border-primary/50 text-primary text-xs font-mono">
                  LIVE
                </Badge>
              </div>

              {/* Domain tabs */}
              {domains?.domains?.slice(0, 4).map((domain, i) => (
                <motion.div
                  key={domain.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/40 border border-border/50 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{domain.icon}</span>
                    <div>
                      <p className="font-medium text-sm">{domain.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {domain.totalVotes?.toLocaleString()} {t("hub_votes")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-green-400">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="text-xs font-mono font-bold">+{Math.floor(Math.random() * 12 + 3)}%</span>
                  </div>
                </motion.div>
              ))}

              <Link href="/games/globalstar">
                <Button variant="outline" className="w-full border-primary/40 text-primary hover:bg-primary/10 gap-2">
                  {t("hub_enter_gs")} <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>

        {/* Gaming Hub */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Card className="bg-card/40 border-primary/20 h-full">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="w-5 h-5 text-yellow-400" />
                  <h2 className="font-bold uppercase tracking-wider text-lg">{t("hub_gaming_title")}</h2>
                </div>
                <Badge variant="outline" className="border-yellow-400/50 text-yellow-400 text-xs font-mono">
                  {t("hub_active")}
                </Badge>
              </div>

              {[
                { name: "Neon Racer", genre: "Racing", players: 1247, hot: true },
                { name: "Crypto Clash", genre: "Strategy", players: 893, hot: false },
                { name: "Arena Strike", genre: "FPS", players: 2041, hot: true },
                { name: "GlobalStar", genre: "Voting", players: 5820, hot: true },
              ].map((game, i) => (
                <motion.div
                  key={game.name}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/40 border border-border/50 hover:border-yellow-400/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {game.hot && <Flame className="w-4 h-4 text-orange-400 shrink-0" />}
                    {!game.hot && <Gamepad2 className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div>
                      <p className="font-medium text-sm">{game.name}</p>
                      <p className="text-xs text-muted-foreground">{game.genre}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono text-yellow-400 font-bold">{game.players.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t("hub_online")}</p>
                  </div>
                </motion.div>
              ))}

              <Link href="/games">
                <Button variant="outline" className="w-full border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 gap-2">
                  {t("hub_enter_games")} <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── AI Intelligence Panel ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="bg-gradient-to-r from-primary/10 via-purple-500/5 to-primary/10 border-primary/30">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="w-14 h-14 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                <BrainCircuit className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-xl font-black uppercase tracking-wider">{t("hub_ai_title")}</h2>
                  <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                </div>
                <p className="text-muted-foreground text-sm mb-4">{t("hub_ai_desc")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: Shield, label: t("hub_ai_mod"), desc: t("hub_ai_mod_desc") },
                    { icon: TrendingUp, label: t("hub_ai_pred"), desc: t("hub_ai_pred_desc") },
                    { icon: Globe, label: t("hub_ai_lang"), desc: t("hub_ai_lang_desc") },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background/40 border border-primary/20">
                      <item.icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider">{item.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Live News Feed ────────────────────────────────────────── */}
      {latestNews.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <h2 className="font-bold uppercase tracking-wider">{t("hub_news_title")}</h2>
            </div>
            <Link href="/news">
              <Button variant="ghost" size="sm" className="text-primary gap-1 text-xs">
                {t("hub_see_all")} <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {latestNews.map((article, i) => (
              <motion.div
                key={article.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 + i * 0.08 }}
              >
                <Card className="bg-card/40 border-primary/20 hover:border-primary/40 transition-colors h-full">
                  <CardContent className="p-4 space-y-2">
                    {article.isBreaking && (
                      <Badge variant="destructive" className="text-xs mb-1">BREAKING</Badge>
                    )}
                    <h3 className="font-semibold text-sm line-clamp-2">{article.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{article.summary}</p>
                    <p className="text-xs text-primary/60 font-mono">{article.source}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── User Zone (if logged in) ───────────────────────────────── */}
      {user && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card className="bg-gradient-to-r from-card/60 to-card/30 border-primary/30">
            <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 border-2 border-primary/50 flex items-center justify-center">
                  <Trophy className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-black text-lg uppercase tracking-wider neon-text-glow">{user.username}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" />{user.xp} XP</span>
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" />{user.balance.toLocaleString()} {t("coins")}</span>
                    <span className="flex items-center gap-1"><Gamepad2 className="w-3 h-3 text-green-400" />{user.gamesPlayed} {t("games_played")}</span>
                  </div>
                </div>
              </div>
              <Link href="/dashboard">
                <Button className="bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-black gap-2 uppercase tracking-wider font-bold">
                  {t("dashboard")} <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Multi-Language Footer Banner ───────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="rounded-xl border border-primary/20 bg-card/20 p-6 text-center space-y-2"
      >
        <div className="flex justify-center gap-3 text-2xl mb-3">
          🌍 🇬🇧 🇫🇷 🇸🇦 🇲🇦
        </div>
        <p className="text-sm font-mono text-muted-foreground">
          <span className="text-white font-bold">GDNA Arena</span> — {t("hub_footer")}
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          {["العربية", "English", "Français", "الدارجة", "Español", "中文", "Русский", "Português"].map(l => (
            <span key={l} className="text-xs px-2 py-0.5 rounded-full border border-primary/20 text-muted-foreground font-mono">
              {l}
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
