import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  Crown, Dna, MessageSquare, Globe2, Trophy, Users,
  BookOpen, ArrowRight, Radio, GraduationCap,
  Zap, Coins, Medal, Star, Flame, PartyPopper,
  Sword, Shield, ChevronRight
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ── GOLD / BLACK palette ──────────────────────────────────────────────────────
const GOLD    = "#FFD700";
const GOLD2   = "#B8860B";
const GOLD_LT = "#FFF176";
const BG      = "#060400";
const CARD    = "#0e0a00";
const BORDER  = "#FFD70028";
const BORDER2 = "#FFD70055";

// ── Deterministic stars ───────────────────────────────────────────────────────
function s(n: number) { const x = Math.sin(n + 1) * 43758.5453; return x - Math.floor(x); }
const STARS = Array.from({ length: 140 }, (_, i) => ({
  left: s(i * 3) * 100, top: s(i * 3 + 1) * 100,
  r: s(i * 3 + 2) * 1.8 + 0.3, dur: s(i) * 4 + 2, del: s(i * 7) * 5,
}));

const TAGLINES = [
  "The Sovereign Digital Empire of Human Legacy",
  "الإمبراطورية الرقمية السيادية — حضارة بلا حدود",
  "L'Empire Numérique Souverain du Patrimoine Humain",
  "الإمبراطورية الرقمية ديال التراث البشري",
];

interface Citizen {
  id: number; username: string; xp: number; balance: number;
  honorCount: number; rank: { label: string; tier: number; color: string; icon: string };
  honorInfo: { title: string; color: string; badge: string }; position: number;
}
interface Legend { id: number; name: string; domain: string; score: number; imageUrl: string | null }
interface LiveEvent { id: number; title: string; icon: string; isLive: boolean }
interface Celebration { id: number; title: string; icon: string; coinsReward: number; topContributorCoins: number; isLive: boolean }

const DOMAIN_COLOR: Record<string, string> = {
  sport: "#22d3ee", tech: "#a78bfa", music: "#f472b6",
  business: "#4ade80", science: "#38bdf8", cinema: "#fb923c",
};

function RankIcon({ tier }: { tier: number }) {
  const Icons = [Star, Sword, Shield, Crown, Crown, Trophy, Zap];
  const I = Icons[Math.min(tier, Icons.length - 1)] ?? Crown;
  return <I className="w-3.5 h-3.5" />;
}

export default function Home() {
  const { user } = useAuth();
  const [tagIdx, setTagIdx]           = useState(0);
  const [honorBoard, setHonorBoard]   = useState<Citizen[]>([]);
  const [legends, setLegends]         = useState<Legend[]>([]);
  const [liveEvents, setLiveEvents]   = useState<LiveEvent[]>([]);
  const [liveCels, setLiveCels]       = useState<Celebration[]>([]);
  const [stats, setStats]             = useState({ totalCitizens: 0, voices: 0 });

  useEffect(() => {
    const t = setInterval(() => setTagIdx(i => (i + 1) % TAGLINES.length), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/citizens?sort=honor&limit=10", { credentials: "include" }).then(r => r.json()),
      fetch("/api/legends",                       { credentials: "include" }).then(r => r.json()),
      fetch("/api/pulse/events",                  { credentials: "include" }).then(r => r.json()),
      fetch("/api/celebrations",                  { credentials: "include" }).then(r => r.json()),
      fetch("/api/pulse/stats",                   { credentials: "include" }).then(r => r.json()),
    ]).then(([cit, leg, ev, cel, ps]) => {
      setHonorBoard(cit.citizens ?? []);
      setLegends((leg.legends ?? []).slice(0, 3));
      setLiveEvents((ev.events ?? []).filter((e: LiveEvent) => e.isLive).slice(0, 3));
      setLiveCels((cel.celebrations ?? []).filter((c: Celebration) => c.isLive).slice(0, 2));
      setStats({ totalCitizens: ps.totalCitizens ?? 0, voices: ps.totalPosts ?? 0 });
    }).catch(() => {});
  }, []);

  return (
    <div style={{ background: BG, minHeight: "100vh", color: "#fff", fontFamily: "inherit" }}>

      {/* ══════════════════════════════════════ STAR FIELD */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {STARS.map((st, i) => (
          <div key={i} className="absolute rounded-full"
            style={{
              left: `${st.left}%`, top: `${st.top}%`,
              width: st.r * 2, height: st.r * 2,
              background: i % 7 === 0 ? GOLD : "#ffffff",
              opacity: i % 7 === 0 ? 0.6 : 0.25,
              animation: `pulse ${st.dur}s ${st.del}s ease-in-out infinite alternate`,
            }} />
        ))}
      </div>

      {/* ══════════════════════════════════════ HERO */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-4" style={{ zIndex: 1 }}>
        {/* Radial gold glow behind text */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 70% 50% at 50% 50%, ${GOLD}18, transparent 70%)` }} />

        {/* Badge */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full border mb-8 text-xs font-black tracking-widest"
          style={{ borderColor: BORDER2, background: `${GOLD}10`, color: GOLD }}>
          <Crown className="w-3.5 h-3.5" />
          EMPIRE ETERNAL v2.2 — THE FINAL PROTOCOL — AWAKENED
        </motion.div>

        {/* EMPIRE ETERNAL title */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}>
          <h1 className="font-black tracking-tighter leading-none select-none"
            style={{ fontSize: "clamp(5rem,16vw,14rem)", lineHeight: 0.85 }}>
            <span style={{ color: "#ffffff", display: "block", textShadow: "0 0 80px rgba(255,215,0,0.15)" }}>EMPIRE</span>
            <span style={{ color: GOLD, display: "block",
              textShadow: `0 0 40px ${GOLD}60, 0 0 120px ${GOLD}30`,
              WebkitTextStroke: `2px ${GOLD2}` }}>
              ETERNAL
            </span>
          </h1>
        </motion.div>

        {/* Tagline cycle */}
        <div className="mt-6 h-8 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p key={tagIdx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }}
              className="text-base md:text-lg font-medium"
              style={{ color: `${GOLD}bb` }}>
              "{TAGLINES[tagIdx]}"
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Live event pill */}
        {liveEvents[0] && (
          <Link href="/events">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full border cursor-pointer hover:scale-105 transition-transform"
              style={{ borderColor: "#ef444440", background: "#ef444412", color: "#fca5a5" }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-sm font-bold">{liveEvents[0].icon} {liveEvents[0].title} — LIVE NOW</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </motion.div>
          </Link>
        )}

        {/* CTAs */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="flex flex-wrap gap-4 justify-center mt-8">
          <Link href="/register">
            <button className="flex items-center gap-2 px-8 py-4 rounded-xl font-black text-base transition-all hover:scale-105 active:scale-95 text-black shadow-2xl"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD2})`,
                boxShadow: `0 0 40px ${GOLD}40` }}>
              <Crown className="w-5 h-5" /> JOIN THE EMPIRE
            </button>
          </Link>
          <Link href="/login">
            <button className="flex items-center gap-2 px-8 py-4 rounded-xl font-black text-base border transition-all hover:scale-105 active:scale-95"
              style={{ borderColor: BORDER2, color: GOLD, background: `${GOLD}08` }}>
              CITIZEN LOGIN <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
        </motion.div>

        {/* Empire live stats */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
          className="flex gap-8 mt-10 text-center">
          {[
            { label: "Citizens",    val: stats.totalCitizens || "—" },
            { label: "Voices",      val: stats.voices        || "—" },
            { label: "Stories",     val: 5 },
            { label: "Live Events", val: liveEvents.length || 2 },
          ].map(s => (
            <div key={s.label}>
              <div className="text-2xl font-black" style={{ color: GOLD }}>{s.val}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Scroll hint */}
        <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-xs tracking-widest"
          style={{ color: `${GOLD}60` }}>
          SCROLL DOWN
          <div className="w-px h-8" style={{ background: `linear-gradient(to bottom, ${GOLD}60, transparent)` }} />
        </motion.div>
      </section>

      {/* ══════════════════════════════════════ 3 PILLARS */}
      <section className="relative max-w-7xl mx-auto px-4 py-20" style={{ zIndex: 1 }}>
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full border mb-4 text-xs font-black tracking-widest"
            style={{ borderColor: BORDER2, color: GOLD, background: `${GOLD}0a` }}>
            <Crown className="w-3.5 h-3.5" /> THREE PILLARS OF EMPIRE ETERNAL
          </div>
          <h2 className="text-4xl md:text-6xl font-black tracking-tight">
            THE ARCHITECTURE OF{" "}
            <span style={{ color: GOLD, textShadow: `0 0 30px ${GOLD}50` }}>ETERNITY</span>
          </h2>
        </div>

        {/* 3 Columns */}
        <div className="grid md:grid-cols-3 gap-5">

          {/* ── PILLAR 1: PAST ── */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-3xl border p-6 space-y-5 relative overflow-hidden group"
            style={{ background: CARD, borderColor: `${GOLD}30` }}>
            <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: `radial-gradient(ellipse at 50% 0%, ${GOLD}10, transparent 60%)` }} />
            <div className="relative">
              {/* Icon */}
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}40` }}>
                <Dna className="w-8 h-8" style={{ color: GOLD }} />
              </div>
              <div className="text-xs font-black tracking-widest mb-1" style={{ color: GOLD }}>PILLAR I — PAST</div>
              <h3 className="text-3xl font-black mb-2 text-white">NOSTALGIA<br />DNA</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The legends of all time — preserved in a neural archive. Every story, peak moment,
                and milestone that built civilization. Eternal. Unalterable.
              </p>
            </div>

            {/* Legends preview */}
            <div className="space-y-2">
              {legends.length === 0
                ? [1,2,3].map(i => <div key={i} className="h-10 rounded-xl bg-white/5 animate-pulse" />)
                : legends.map((l, i) => (
                  <Link key={l.id} href={`/legends/${l.id}`}>
                    <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                      <span className="text-xs font-black w-5 text-center" style={{ color: GOLD }}>#{i+1}</span>
                      <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 shrink-0">
                        {l.imageUrl && <img src={l.imageUrl} alt={l.name} className="w-full h-full object-cover object-top" />}
                      </div>
                      <span className="text-sm font-bold flex-1 truncate text-white">{l.name}</span>
                      <span className="text-[10px] font-bold" style={{ color: DOMAIN_COLOR[l.domain] ?? GOLD }}>
                        {l.domain.toUpperCase()}
                      </span>
                    </div>
                  </Link>
                ))
              }
            </div>

            <Link href="/legends">
              <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-black transition-all hover:opacity-90"
                style={{ borderColor: `${GOLD}40`, color: GOLD, background: `${GOLD}0a` }}>
                VIEW TOP 10 LEGENDS <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </motion.div>

          {/* ── PILLAR 2: PRESENT ── */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
            className="rounded-3xl border p-6 space-y-5 relative overflow-hidden group"
            style={{ background: CARD, borderColor: "#22d3ee30" }}>
            <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(34,211,238,0.08), transparent 60%)" }} />
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.4)" }}>
                <MessageSquare className="w-8 h-8 text-cyan-400" />
              </div>
              <div className="text-xs font-black tracking-widest text-cyan-400 mb-1">PILLAR II — PRESENT</div>
              <h3 className="text-3xl font-black mb-2 text-white">EMPIRE<br />COMMUNICATION</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Chat, stories, debates, and the Royal Messenger. Citizens connect, speak, and build
                ideas in real-time. The empire's living pulse.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/pulse",    icon: <Radio className="w-4 h-4" />,         label: "Empire Pulse",    color: "#f472b6" },
                { href: "/stories",  icon: <BookOpen className="w-4 h-4" />,       label: "Stories 24h",     color: "#c084fc" },
                { href: "/messages", icon: <MessageSquare className="w-4 h-4" />,  label: "Royal Messenger", color: "#22d3ee" },
                { href: "/citizens", icon: <Users className="w-4 h-4" />,          label: "Citizens",        color: "#4ade80" },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center gap-2 p-3 rounded-xl border cursor-pointer hover:scale-105 transition-transform"
                    style={{ borderColor: `${item.color}25`, background: `${item.color}0a`, color: item.color }}>
                    {item.icon}
                    <span className="text-xs font-bold">{item.label}</span>
                  </div>
                </Link>
              ))}
            </div>

            <Link href="/messages">
              <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-black transition-all hover:opacity-90"
                style={{ borderColor: "rgba(34,211,238,0.4)", color: "#22d3ee", background: "rgba(34,211,238,0.08)" }}>
                OPEN ROYAL MESSENGER <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </motion.div>

          {/* ── PILLAR 3: FUTURE ── */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
            className="rounded-3xl border p-6 space-y-5 relative overflow-hidden group"
            style={{ background: CARD, borderColor: "#a78bfa30" }}>
            <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(167,139,250,0.08), transparent 60%)" }} />
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.4)" }}>
                <Globe2 className="w-8 h-8 text-purple-400" />
              </div>
              <div className="text-xs font-black tracking-widest text-purple-400 mb-1">PILLAR III — FUTURE</div>
              <h3 className="text-3xl font-black mb-2 text-white">GLOBAL<br />EVENTS</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Live lectures, international summits, global celebrations, educational hub.
                The empire grows through knowledge and shared experience.
              </p>
            </div>

            <div className="space-y-2">
              {liveEvents.map(ev => (
                <Link key={ev.id} href="/events">
                  <div className="flex items-center gap-2 p-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                    <span className="text-base">{ev.icon}</span>
                    <span className="text-xs font-bold flex-1 truncate text-white">{ev.title}</span>
                    <span className="text-[10px] text-red-400 font-black">LIVE</span>
                  </div>
                </Link>
              ))}
              {[
                { href: "/learn",        icon: <GraduationCap className="w-4 h-4" />, label: "Educational Hub",  color: GOLD },
                { href: "/celebrations", icon: <PartyPopper className="w-4 h-4" />,   label: "Celebrations Hub", color: "#FFD700" },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center gap-2 p-3 rounded-xl border cursor-pointer hover:scale-105 transition-transform"
                    style={{ borderColor: `${item.color}25`, background: `${item.color}0a`, color: item.color }}>
                    {item.icon}
                    <span className="text-xs font-bold">{item.label}</span>
                  </div>
                </Link>
              ))}
            </div>

            <Link href="/events">
              <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-black transition-all hover:opacity-90"
                style={{ borderColor: "rgba(167,139,250,0.4)", color: "#a78bfa", background: "rgba(167,139,250,0.08)" }}>
                VIEW ALL GLOBAL EVENTS <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════ HONOR LEADERBOARD */}
      <section className="relative max-w-7xl mx-auto px-4 pb-20" style={{ zIndex: 1 }}>
        <div className="rounded-3xl border overflow-hidden" style={{ background: CARD, borderColor: BORDER2 }}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 md:px-8 py-6 border-b" style={{ borderColor: BORDER }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${GOLD}20`, border: `1px solid ${GOLD}50` }}>
                <Medal className="w-5 h-5" style={{ color: GOLD }} />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest mb-0.5" style={{ color: GOLD }}>
                  🏛️ CITIZEN HONOR BOARD
                </div>
                <div className="font-black text-xl text-white">TOP HONORED CITIZENS</div>
              </div>
            </div>
            <Link href="/citizens?sort=honor">
              <button className="flex items-center gap-1.5 text-xs font-black px-4 py-2 rounded-xl border transition-all hover:opacity-80"
                style={{ borderColor: BORDER2, color: GOLD, background: `${GOLD}08` }}>
                FULL BOARD <ArrowRight className="w-3 h-3" />
              </button>
            </Link>
          </div>

          {/* Podium — top 3 */}
          {honorBoard.length > 0 && (
            <div className="px-6 md:px-8 pt-8 pb-4">
              <div className="flex items-end justify-center gap-4 md:gap-8 mb-8">
                {[honorBoard[1], honorBoard[0], honorBoard[2]].map((c, i) => {
                  if (!c) return null;
                  const pos     = i === 0 ? 2 : i === 1 ? 1 : 3;
                  const heights = { 1: 140, 2: 110, 3: 85 } as Record<number, number>;
                  const sizes   = { 1: 72,  2: 60,  3: 52  } as Record<number, number>;
                  const medals  = { 1: "🥇", 2: "🥈", 3: "🥉" } as Record<number, string>;
                  const glows   = { 1: GOLD, 2: "#C0C0C0", 3: "#CD7F32" } as Record<number, string>;
                  const sz = sizes[pos]!;
                  return (
                    <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                      className="flex flex-col items-center flex-1 max-w-[160px]">
                      {/* Avatar */}
                      <div className="rounded-2xl flex items-center justify-center font-black text-black mb-2"
                        style={{ width: sz, height: sz, fontSize: sz * 0.3,
                          background: `linear-gradient(135deg, ${glows[pos]}, ${glows[pos]}88)`,
                          boxShadow: `0 0 24px ${glows[pos]}50` }}>
                        {c.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="text-xl mb-1">{medals[pos]}</div>
                      <Link href={`/citizen/${c.username}`}>
                        <div className="font-black text-sm text-center text-white hover:text-yellow-400 transition-colors cursor-pointer truncate max-w-full">
                          {c.username}
                        </div>
                      </Link>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color: c.rank.color }}>
                        {c.rank.icon} {c.rank.label}
                      </div>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color: glows[pos] }}>
                        {c.honorInfo.badge} {c.honorInfo.title}
                      </div>
                      {/* Pedestal */}
                      <div className="w-full mt-3 rounded-t-xl flex flex-col items-center justify-end pb-3 border-t border-l border-r"
                        style={{ height: heights[pos], background: `${glows[pos]}12`, borderColor: `${glows[pos]}35` }}>
                        <div className="text-sm font-black" style={{ color: glows[pos] }}>
                          🎖️ {c.honorCount}
                        </div>
                        <div className="text-[10px] text-muted-foreground">honor pts</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ranks 4–10 */}
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {honorBoard.slice(3, 10).map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 px-6 md:px-8 py-3 hover:bg-white/3 transition-colors group">
                <div className="w-7 text-center text-sm font-black text-muted-foreground shrink-0">
                  #{i + 4}
                </div>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black text-black shrink-0"
                  style={{ background: `linear-gradient(135deg, ${c.rank.color}, ${c.rank.color}88)` }}>
                  {c.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/citizen/${c.username}`}>
                      <span className="font-black text-sm text-white hover:text-yellow-400 transition-colors cursor-pointer">
                        {c.username}
                      </span>
                    </Link>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                      style={{ color: c.rank.color, borderColor: `${c.rank.color}40`, background: `${c.rank.color}10` }}>
                      <RankIcon tier={c.rank.tier} /> {c.rank.label}
                    </span>
                    <span className="text-[10px] font-bold" style={{ color: c.honorInfo.color }}>
                      {c.honorInfo.badge} {c.honorInfo.title}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs shrink-0">
                  <span className="font-black" style={{ color: GOLD }}>🎖️ {c.honorCount}</span>
                  <span className="text-primary font-bold hidden sm:block"><Zap className="w-3 h-3 inline" /> {c.xp.toLocaleString()} XP</span>
                </div>
              </motion.div>
            ))}

            {honorBoard.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Medal className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <div className="font-bold">No citizens yet — be the first to earn honor</div>
              </div>
            )}
          </div>

          {/* Honor system legend */}
          <div className="px-6 md:px-8 py-5 border-t" style={{ borderColor: BORDER }}>
            <div className="text-xs font-black tracking-widest mb-3" style={{ color: GOLD }}>
              HOW TO EARN HONOR
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { badge: "🌱", title: "New Citizen",    min: 0  },
                { badge: "🤝", title: "Trusted",        min: 1  },
                { badge: "✅", title: "Respected",      min: 5  },
                { badge: "🎖️", title: "Honorable",     min: 10 },
                { badge: "💎", title: "Distinguished",  min: 25 },
                { badge: "🏆", title: "Imperial Legend",min: 50 },
              ].map(t => (
                <div key={t.title} className="flex flex-col items-center p-2.5 rounded-xl text-center"
                  style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}18` }}>
                  <span className="text-xl mb-1">{t.badge}</span>
                  <div className="text-[10px] font-black text-white">{t.title}</div>
                  <div className="text-[9px] text-muted-foreground">{t.min}+ pts</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════ LIVE CELEBRATIONS STRIP */}
      {liveCels.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-4 pb-16" style={{ zIndex: 1 }}>
          <div className="rounded-3xl border p-6 md:p-8" style={{ background: CARD, borderColor: `${GOLD}35` }}>
            <div className="flex items-center gap-3 mb-5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-black tracking-widest" style={{ color: GOLD }}>
                🏛️ LIVE CELEBRATIONS — CONTRIBUTE NOW
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {liveCels.map(c => (
                <Link key={c.id} href="/celebrations">
                  <div className="flex items-start gap-4 p-4 rounded-2xl border cursor-pointer hover:scale-[1.02] transition-transform"
                    style={{ borderColor: `${GOLD}30`, background: `${GOLD}08` }}>
                    <span className="text-4xl shrink-0">{c.icon}</span>
                    <div className="flex-1">
                      <div className="font-black text-base text-white mb-1">{c.title}</div>
                      <div className="text-sm text-muted-foreground">Share Art · Ideas · Videos</div>
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <span style={{ color: GOLD }} className="font-bold">+{c.coinsReward} Coins/entry</span>
                        <span className="font-black text-yellow-300">🏛️ Best: +{c.topContributorCoins} Coins</span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════ FOOTER CTA */}
      <section className="relative border-t py-24 text-center" style={{ borderColor: BORDER, zIndex: 1 }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 100%, ${GOLD}10, transparent 60%)` }} />
        <div className="relative max-w-2xl mx-auto px-4 space-y-6">
          <div className="text-6xl">♾️</div>
          <h2 className="text-4xl md:text-6xl font-black">
            <span style={{ color: GOLD }}>EMPIRE IS AWAKE</span>
            <br />AND ALIVE
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Every citizen adds a brick. Every debate forges a legend.<br />
            Every celebration becomes history.
          </p>
          {!user && (
            <Link href="/register">
              <button className="inline-flex items-center gap-2 px-10 py-4 rounded-xl font-black text-lg text-black shadow-2xl transition-all hover:scale-105 active:scale-95"
                style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD2})`,
                  boxShadow: `0 0 60px ${GOLD}40` }}>
                <Crown className="w-6 h-6" /> JOIN THE EMPIRE — FREE
              </button>
            </Link>
          )}
          <div className="text-xs tracking-[0.3em] pt-4" style={{ color: `${GOLD}50` }}>
            EDUCATION · SPORT · SCIENCE · ART · BUSINESS · DEBATES · ACHIEVEMENTS
          </div>
        </div>
      </section>

      <style>{`
        @keyframes pulse {
          from { opacity: 0.15; transform: scale(1); }
          to   { opacity: 0.8;  transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
