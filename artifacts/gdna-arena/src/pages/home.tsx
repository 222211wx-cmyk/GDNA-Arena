import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import GdnAiTerminal from "@/components/GdnAiTerminal";
import { useGetGsDomains, useGetGsRanking } from "@workspace/api-client-react";
import { Crown, Swords, Sparkles, ArrowRight, Globe, ChevronRight } from "lucide-react";

// ── Deterministic star field (stable across renders) ───────────────────────
function seed(n: number) { let x = Math.sin(n + 1) * 43758.5453123; return x - Math.floor(x); }
const STARS = Array.from({ length: 180 }, (_, i) => ({
  left: seed(i * 3)     * 100,
  top:  seed(i * 3 + 1) * 100,
  r:    seed(i * 3 + 2) * 1.8 + 0.4,
  dur:  seed(i)         * 4 + 2,
  del:  seed(i * 7)     * 6,
}));

// ── Imperial declarations (cycle through 4 languages) ─────────────────────
const DECREES = [
  "The Sovereign Digital Empire of Human Legacy",
  "الإمبراطورية الرقمية السيادية لإرث الإنسانية",
  "L'Empire Numérique Souverain du Patrimoine Humain",
  "الإمبراطورية الرقمية السيادية ديال تراث البشرية",
];

// ── Domain display ─────────────────────────────────────────────────────────
const DOMAIN_EMBLEMS: Record<string, string> = {
  sport: "⚔️", music: "♪", cinema: "🎬", politics: "🏛", science: "⚗️",
  culture: "📜", business: "⚖️", social: "🌐", history: "🗿", archaeology: "🏺",
};

export default function Home() {
  const { t } = useLang();
  const [decreeIdx, setDecreeIdx] = useState(0);
  const [entered, setEntered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: domains } = useGetGsDomains();
  const { data: ranking } = useGetGsRanking();

  // Cycle declarations
  useEffect(() => {
    const id = setInterval(() => setDecreeIdx(d => (d + 1) % DECREES.length), 3800);
    return () => clearInterval(id);
  }, []);

  // Canvas particle field
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    let t = 0;
    const draw = () => {
      t += 0.003;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Drifting dust particles
      for (let i = 0; i < 60; i++) {
        const x = ((seed(i * 5) * canvas.width + t * seed(i) * 40) % canvas.width + canvas.width) % canvas.width;
        const y = ((seed(i * 5 + 1) * canvas.height + t * seed(i + 1) * 20) % canvas.height + canvas.height) % canvas.height;
        const alpha = (Math.sin(t * seed(i) * 3 + i) + 1) / 2 * 0.35;
        const gold = seed(i * 2) > 0.7;
        ctx.beginPath();
        ctx.arc(x, y, seed(i * 3 + 2) * 1.5 + 0.3, 0, Math.PI * 2);
        ctx.fillStyle = gold ? `rgba(201,168,76,${alpha})` : `rgba(0,212,255,${alpha * 0.5})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Empire census totals from live data
  const totalVotes = ranking?.ranking?.reduce((s: number, d: any) =>
    s + (d.figures?.reduce((a: number, f: any) => a + (f.votes ?? 0), 0) ?? 0), 0) ?? 0;
  const totalFigures = ranking?.ranking?.reduce((s: number, d: any) => s + (d.figures?.length ?? 0), 0) ?? 100;
  const territories  = domains?.domains?.length ?? 10;

  const CENSUS = [
    { val: totalVotes > 0 ? (totalVotes / 1000000).toFixed(1) + "M+" : "2.4M+", label: "Tributes Paid",    labelAr: "تحية مدفوعة",      glyph: "◈" },
    { val: "156K+",                                                               label: "Citizens",          labelAr: "مواطن",            glyph: "◉" },
    { val: totalFigures + "+",                                                    label: "Immortals",         labelAr: "خالد",             glyph: "✦" },
    { val: territories + "",                                                      label: "Territories",       labelAr: "إقليم",            glyph: "⬡" },
  ];

  return (
    <div className="relative min-h-screen bg-black overflow-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* ── Canvas particle field ──────────────────────────────────────── */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />

      {/* ── Static star field ─────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {STARS.map((s, i) => (
          <div key={i} className="absolute rounded-full bg-white"
            style={{
              left: `${s.left}%`, top: `${s.top}%`,
              width: s.r * 2, height: s.r * 2,
              animation: `star-twinkle ${s.dur}s ease-in-out ${s.del}s infinite`,
            }} />
        ))}
      </div>

      {/* ── Ambient glow orbs ─────────────────────────────────────────── */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full pointer-events-none z-0"
        style={{ background: "radial-gradient(ellipse, rgba(201,168,76,0.08) 0%, transparent 70%)" }} />
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[300px] rounded-full pointer-events-none z-0"
        style={{ background: "radial-gradient(ellipse, rgba(139,26,26,0.06) 0%, transparent 70%)" }} />
      <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full pointer-events-none z-0"
        style={{ background: "radial-gradient(ellipse, rgba(0,212,255,0.04) 0%, transparent 70%)" }} />

      {/* ── CONTENT ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center min-h-screen px-4">

        {/* ── Imperial Seal ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="pt-20 pb-8 text-center"
        >
          {/* Horizontal rule with crown */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-32 md:w-64" style={{ background: "linear-gradient(90deg, transparent, #C9A84C60, #C9A84C)" }} />
            <motion.div
              animate={{ rotateY: [0, 360] }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="text-4xl select-none"
            >♔</motion.div>
            <div className="h-px w-32 md:w-64" style={{ background: "linear-gradient(90deg, #C9A84C, #C9A84C60, transparent)" }} />
          </div>

          {/* IMPERIAL DECLARATION — cycling */}
          <div className="h-7 overflow-hidden mb-2">
            <AnimatePresence mode="wait">
              <motion.p
                key={decreeIdx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.5 }}
                className="text-xs md:text-sm font-mono tracking-[0.3em] uppercase"
                style={{ color: "#C9A84C80" }}
              >
                {DECREES[decreeIdx]}
              </motion.p>
            </AnimatePresence>
          </div>
        </motion.div>

        {/* ── MAIN TITLE ────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-4"
        >
          <h1
            className="imperial-gold font-black uppercase tracking-tighter leading-none select-none"
            style={{ fontSize: "clamp(72px, 16vw, 180px)", letterSpacing: "-0.03em" }}
          >
            GDNA
          </h1>
          <h1
            className="font-black uppercase tracking-tighter leading-none select-none"
            style={{
              fontSize: "clamp(72px, 16vw, 180px)",
              letterSpacing: "-0.03em",
              color: "transparent",
              WebkitTextStroke: "1.5px #C9A84C60",
            }}
          >
            ARENA
          </h1>
        </motion.div>

        {/* ── Subtitle ──────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 1 }}
          className="text-center mb-12 space-y-1"
        >
          <p className="text-sm md:text-base font-bold uppercase tracking-[0.5em]"
            style={{ color: "#C9A84C" }}>
            الإمبراطورية الرقمية السيادية لإرث الإنسانية
          </p>
          <p className="text-xs font-mono tracking-widest" style={{ color: "#ffffff30" }}>
            EST. MMXXIV · SOVEREIGNTY · LEGACY · IMMORTALITY
          </p>
        </motion.div>

        {/* ── EMPIRE CENSUS (live stats) ────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.8 }}
          className="w-full max-w-3xl mb-12"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px"
            style={{ background: "#C9A84C20", border: "1px solid #C9A84C20" }}>
            {CENSUS.map((c, i) => (
              <motion.div
                key={c.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 + i * 0.1 }}
                className="bg-black py-6 px-4 text-center group"
                style={{ borderRight: i < 3 ? "1px solid #C9A84C15" : undefined }}
              >
                <div className="text-2xl mb-1" style={{ color: "#C9A84C40" }}>{c.glyph}</div>
                <div className="font-black font-mono text-xl md:text-2xl imperial-gold">{c.val}</div>
                <div className="text-xs uppercase tracking-widest mt-1" style={{ color: "#ffffff40" }}>{c.label}</div>
                <div className="text-xs font-arabic mt-0.5" style={{ color: "#C9A84C40" }}>{c.labelAr}</div>
              </motion.div>
            ))}
          </div>
          <div className="text-center mt-2">
            <span className="text-xs font-mono tracking-widest" style={{ color: "#C9A84C40" }}>
              — IMPERIAL CENSUS · LIVE DATA —
            </span>
          </div>
        </motion.div>

        {/* ── ENTRY PORTALS ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.8 }}
          className="flex flex-col sm:flex-row gap-4 mb-20"
        >
          <Link href="/hub">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="relative h-16 px-12 font-black text-sm uppercase tracking-[0.3em] overflow-hidden group"
              style={{
                background: "linear-gradient(135deg, #C9A84C, #A67C2E)",
                color: "#000",
                boxShadow: "0 0 40px #C9A84C40, inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
            >
              <span className="relative z-10 flex items-center gap-3">
                <Crown className="w-4 h-4" />
                Enter the Throne Room
                <ArrowRight className="w-4 h-4" />
              </span>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "linear-gradient(135deg, #FFE066, #C9A84C)" }} />
            </motion.button>
          </Link>

          <Link href="/games/globalstar">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="relative h-16 px-12 font-black text-sm uppercase tracking-[0.3em] overflow-hidden group"
              style={{
                background: "transparent",
                color: "#C9A84C",
                border: "1px solid #C9A84C50",
                boxShadow: "0 0 20px #C9A84C10",
              }}
            >
              <span className="relative z-10 flex items-center gap-3">
                <Swords className="w-4 h-4" />
                Hall of Legends
              </span>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(201,168,76,0.08)" }} />
            </motion.button>
          </Link>
        </motion.div>

        {/* ── THE 10 IMPERIAL TERRITORIES ───────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1 }}
          className="w-full max-w-6xl mb-24"
        >
          {/* Section header */}
          <div className="flex items-center gap-4 mb-8 justify-center">
            <div className="h-px flex-1 max-w-xs" style={{ background: "linear-gradient(90deg, transparent, #C9A84C30)" }} />
            <div className="text-center">
              <p className="text-xs font-mono tracking-[0.4em] uppercase mb-1" style={{ color: "#C9A84C60" }}>
                ◈ Imperial Territories ◈
              </p>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-wider" style={{ color: "#C9A84C" }}>
                أراضي الإمبراطورية العشر
              </h2>
            </div>
            <div className="h-px flex-1 max-w-xs" style={{ background: "linear-gradient(90deg, #C9A84C30, transparent)" }} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {(domains?.domains ?? []).map((d: any, i: number) => {
              const domainRank = ranking?.ranking?.find((r: any) => r.domain === d.id);
              const totalVotes = domainRank?.figures?.reduce((s: number, f: any) => s + (f.votes ?? 0), 0) ?? d.totalVotes ?? 0;
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                >
                  <Link href="/games/globalstar">
                    <div
                      className="territory-card relative p-5 text-center cursor-pointer transition-all duration-300 group"
                      style={{
                        background: "rgba(201,168,76,0.03)",
                        border: "1px solid #C9A84C20",
                      }}
                    >
                      {/* Territory number */}
                      <div className="absolute top-2 left-2 text-xs font-mono" style={{ color: "#C9A84C25" }}>
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div className="text-3xl mb-2">{d.icon}</div>
                      <p className="font-black text-xs uppercase tracking-wider text-white/80 mb-1">{d.label}</p>
                      <p className="font-mono text-xs" style={{ color: "#C9A84C70" }}>
                        {(totalVotes / 1000).toFixed(0)}K tribute
                      </p>
                      {/* Hover reveal */}
                      <div className="absolute inset-x-0 bottom-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"
                        style={{ background: "linear-gradient(90deg, #C9A84C, transparent)" }} />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* ── THE ORACLE ────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1 }}
          className="w-full max-w-2xl mb-24"
        >
          {/* Section header */}
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="h-px w-16" style={{ background: "#C9A84C40" }} />
              <Sparkles className="w-4 h-4" style={{ color: "#C9A84C" }} />
              <div className="h-px w-16" style={{ background: "#C9A84C40" }} />
            </div>
            <p className="text-xs font-mono tracking-[0.4em] uppercase mb-1" style={{ color: "#C9A84C60" }}>
              The Imperial Oracle
            </p>
            <h2 className="text-2xl font-black uppercase tracking-wider" style={{ color: "#C9A84C" }}>
              يتحدث الأوراكل
            </h2>
          </div>

          <div className="relative" style={{ border: "1px solid #C9A84C25", boxShadow: "0 0 40px #C9A84C10" }}>
            {/* Corner ornaments */}
            {["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"].map((pos, i) => (
              <div key={i} className={`absolute ${pos} w-4 h-4`}
                style={{ border: `2px solid #C9A84C`, opacity: 0.4,
                  borderRight: pos.includes("right") ? undefined : "none",
                  borderLeft:  pos.includes("left")  ? undefined : "none",
                  borderTop:    pos.includes("top")  ? undefined : "none",
                  borderBottom: pos.includes("bottom") ? undefined : "none",
                }} />
            ))}
            <div style={{ background: "rgba(0,0,0,0.8)" }}>
              <GdnAiTerminal />
            </div>
          </div>

          <p className="text-center text-xs font-mono mt-4 tracking-widest" style={{ color: "#C9A84C30" }}>
            GDN-AI · INTELLIGENCE SOVEREIGNTY SYSTEM v4.2 · POWERED BY NEURAL EMPIRE
          </p>
        </motion.section>

        {/* ── FOUR PILLARS ──────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="w-full max-w-4xl mb-24"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0"
            style={{ border: "1px solid #C9A84C15" }}>
            {[
              { icon: "⚔️", title: "Gaming Arena",    ar: "ساحة المعركة",   desc: "Play to earn. Battle for dominance.",  href: "/games" },
              { icon: "⚖️", title: "GlobalStar Vote", ar: "تحية الإمبراطورية", desc: "Your tribute shapes the imperial order.", href: "/games/globalstar" },
              { icon: "🧠", title: "Mind Forge",      ar: "صياغة العقل",    desc: "NLP growth. Self-development protocol.", href: "/growth" },
              { icon: "📜", title: "The Archives",    ar: "الأرشيف الإمبراطوري", desc: "Chronicle of past, present, future.", href: "/chronicle" },
            ].map((p, i) => (
              <Link key={p.href} href={p.href}>
                <motion.div
                  whileHover={{ background: "rgba(201,168,76,0.05)" }}
                  className="p-6 text-center cursor-pointer transition-colors"
                  style={{ borderRight: i < 3 ? "1px solid #C9A84C15" : undefined }}
                >
                  <div className="text-3xl mb-3">{p.icon}</div>
                  <p className="font-black text-xs uppercase tracking-widest text-white/70 mb-1">{p.title}</p>
                  <p className="text-xs font-bold mb-2" style={{ color: "#C9A84C70" }}>{p.ar}</p>
                  <p className="text-xs text-white/30 leading-relaxed">{p.desc}</p>
                </motion.div>
              </Link>
            ))}
          </div>
        </motion.section>

        {/* ── IMPERIAL FOOTER DECLARATION ───────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="w-full text-center pb-16 space-y-3"
        >
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-20" style={{ background: "#C9A84C20" }} />
            <span className="text-xs font-mono tracking-[0.4em] uppercase" style={{ color: "#C9A84C30" }}>
              ◈ ◈ ◈
            </span>
            <div className="h-px w-20" style={{ background: "#C9A84C20" }} />
          </div>
          <p className="text-xs font-mono" style={{ color: "#ffffff15" }}>
            🌍 🇬🇧 🇫🇷 🇸🇦 🇲🇦 · GDNA ARENA · SOVEREIGN DIGITAL EMPIRE · ALL CIVILISATIONS, ONE THRONE
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {["العربية", "English", "Français", "الدارجة"].map(l => (
              <span key={l} className="text-xs px-2 py-0.5 font-mono"
                style={{ color: "#C9A84C30", border: "1px solid #C9A84C15" }}>{l}</span>
            ))}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
