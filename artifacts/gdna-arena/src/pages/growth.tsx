import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";

const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────────────────────────
interface ArchonDimensions {
  volontas: number; resilentia: number; intellectus: number;
  disciplina: number; societas: number; abundantia: number; auctoritas: number;
}
interface ArchonProfile {
  archonCode: string; archetype: string; dimensions: ArchonDimensions;
  overallScore: number; aiProfile: Record<string, string>;
  session?: { createdAt: string };
}

// ── The 7 Archon Dimensions ────────────────────────────────────────────────────
const DIMENSIONS = [
  { key: "volontas",    latin: "VOLONTAS",    ar: "إرادة الفاتح",     color: "#C9A84C", glyph: "⚔" },
  { key: "resilentia",  latin: "RESILENTIA",  ar: "صمود المحارب",    color: "#E8C97A", glyph: "🛡" },
  { key: "intellectus", latin: "INTELLECTUS", ar: "وضوح الرؤية",     color: "#A8E6CF", glyph: "👁" },
  { key: "disciplina",  latin: "DISCIPLINA",  ar: "انضباط الإمبراطور", color: "#DDA0DD", glyph: "⚙" },
  { key: "societas",    latin: "SOCIETAS",    ar: "قوة التأثير",      color: "#87CEEB", glyph: "◈" },
  { key: "abundantia",  latin: "ABUNDANTIA",  ar: "عقلية الوفرة",    color: "#98FB98", glyph: "∞" },
  { key: "auctoritas",  latin: "AUCTORITAS",  ar: "السلطة الداخلية",  color: "#FFB6C1", glyph: "♔" },
] as const;

// ── The 7 Initiation Questions ─────────────────────────────────────────────────
const QUESTIONS = [
  {
    dim: "VOLONTAS", ar: "إرادة الفاتح", glyph: "⚔",
    q: { en: "When confronted with an obstacle:", ar: "عند مواجهة عقبة:", fr: "Face à un obstacle :", dz: "كي تلقى عقبة:" },
    choices: {
      A: { en: "I strike directly — obstacles exist to be broken", ar: "أضرب مباشرة — العقبات وُجدت لتُكسر" },
      B: { en: "I map the terrain first — strategy before force", ar: "أرسم المشهد أولاً — الاستراتيجية قبل القوة" },
      C: { en: "I wait for the optimal moment — timing is power", ar: "أنتظر اللحظة المثلى — التوقيت هو القوة" },
      D: { en: "I seek counsel — wisdom comes from others", ar: "أطلب المشورة — الحكمة تأتي من الآخرين" },
    },
  },
  {
    dim: "RESILENTIA", ar: "صمود المحارب", glyph: "🛡",
    q: { en: "After a defeat:", ar: "بعد الهزيمة:", fr: "Après une défaite :", dz: "بعد هزيمة:" },
    choices: {
      A: { en: "I rise immediately — failure is information", ar: "أنهض فوراً — الفشل معلومة لا أكثر" },
      B: { en: "I analyze deeply, then rebuild stronger", ar: "أحلل عميقاً ثم أبني أقوى" },
      C: { en: "I need time to process before returning", ar: "أحتاج وقتاً لأستوعب قبل العودة" },
      D: { en: "I question my direction entirely", ar: "أشكك في مساري بالكامل" },
    },
  },
  {
    dim: "INTELLECTUS", ar: "وضوح الرؤية", glyph: "👁",
    q: { en: "Your sharpest clarity comes:", ar: "وضوحك الأقوى يأتي:", fr: "Ta clarté vient :", dz: "وضوحك الأقوى يجي:" },
    choices: {
      A: { en: "Under maximum pressure — fire forges steel", ar: "تحت الضغط الأقصى — النار تصنع الفولاذ" },
      B: { en: "In deep solitary focus — silence reveals truth", ar: "في التركيز العميق المنفرد — الصمت يكشف الحقيقة" },
      C: { en: "In physical movement — the body unlocks the mind", ar: "في الحركة الجسدية — الجسد يفتح العقل" },
      D: { en: "In dialogue with others — minds multiply", ar: "في الحوار مع الآخرين — العقول تتضاعف" },
    },
  },
  {
    dim: "DISCIPLINA", ar: "انضباط الإمبراطور", glyph: "⚙",
    q: { en: "Your daily structure:", ar: "هيكلك اليومي:", fr: "Ta structure quotidienne :", dz: "هيكلك اليومي:" },
    choices: {
      A: { en: "Precise and non-negotiable — the schedule IS the discipline", ar: "دقيق وغير قابل للتفاوض — الجدول هو الانضباط" },
      B: { en: "Structured with calculated flexibility — plan, adapt, execute", ar: "منظم مع مرونة محسوبة — خطط، تكيف، نفذ" },
      C: { en: "Intuitive and flow-based — energy guides the day", ar: "حدسي يعتمد التدفق — الطاقة تقود اليوم" },
      D: { en: "Responsive to circumstance — agility over routine", ar: "استجابي للظروف — الرشاقة على الروتين" },
    },
  },
  {
    dim: "SOCIETAS", ar: "قوة التأثير", glyph: "◈",
    q: { en: "In a collective:", ar: "داخل الجماعة:", fr: "Dans un collectif :", dz: "في الجماعة:" },
    choices: {
      A: { en: "I command — leadership is my natural frequency", ar: "أقود — القيادة هي تردد طبيعي" },
      B: { en: "I inspire from within — influence without title", ar: "أُلهم من الداخل — تأثير بلا لقب" },
      C: { en: "I strengthen the foundation — power behind the throne", ar: "أقوي الأساس — القوة خلف العرش" },
      D: { en: "I operate independently — my work speaks alone", ar: "أعمل منفرداً — عملي يتكلم وحده" },
    },
  },
  {
    dim: "ABUNDANTIA", ar: "عقلية الوفرة", glyph: "∞",
    q: { en: "Your relationship with power and resources:", ar: "علاقتك بالقوة والموارد:", fr: "Ta relation avec le pouvoir :", dz: "علاقتك بالقوة والموارد:" },
    choices: {
      A: { en: "Infinite — the universe is abundant, I claim my share", ar: "لا نهائية — الكون واسع، أطالب بحصتي" },
      B: { en: "Earned — what I build, I own; what I own, I multiply", ar: "مكتسبة — ما بنيت أملك، ما أملك أضاعف" },
      C: { en: "Cautious — secure what you have before expanding", ar: "حذر — أمّن ما لديك قبل التوسع" },
      D: { en: "Scarce — there is never enough, vigilance is survival", ar: "شحيحة — لا يكفي أبداً، اليقظة هي البقاء" },
    },
  },
  {
    dim: "AUCTORITAS", ar: "السلطة الداخلية", glyph: "♔",
    q: { en: "In one sentence — declare your purpose. Why do you exist?", ar: "في جملة واحدة — أعلن هدفك. لماذا توجد؟", fr: "En une phrase — déclare ton but :", dz: "في جملة — قول هدفك:" },
    choices: null, // free text
  },
];

// ── Archon Archetypes ──────────────────────────────────────────────────────────
const ARCHETYPES: Record<string, { color: string; symbol: string; ar: string }> = {
  "THE SOVEREIGN":   { color: "#C9A84C", symbol: "♔", ar: "السيد المطلق" },
  "THE CONQUEROR":   { color: "#FF6B35", symbol: "⚔", ar: "الفاتح" },
  "THE VISIONARY":   { color: "#A8E6CF", symbol: "👁", ar: "الرائي" },
  "THE ARCHITECT":   { color: "#DDA0DD", symbol: "⚙", ar: "المعماري" },
  "THE CATALYST":    { color: "#87CEEB", symbol: "◈", ar: "المحرك" },
  "THE SENTINEL":    { color: "#98FB98", symbol: "🛡", ar: "الحارس" },
  "THE SEEKER":      { color: "#E8C97A", symbol: "◉", ar: "الباحث" },
};

// ── Cipher Animation Characters ────────────────────────────────────────────────
const CIPHER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789♔⚔◈∞⚙▲▼◆◇█▓░";

function useCipherText(target: string, active: boolean, speed = 40) {
  const [display, setDisplay] = useState("");
  const frame = useRef(0);
  useEffect(() => {
    if (!active || !target) return;
    frame.current = 0;
    const id = setInterval(() => {
      frame.current++;
      if (frame.current >= target.length * 3) { setDisplay(target); clearInterval(id); return; }
      setDisplay(
        target.split("").map((ch, i) =>
          i < Math.floor(frame.current / 3)
            ? ch
            : /[A-Z0-9]/.test(ch)
              ? CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]
              : ch
        ).join("")
      );
    }, speed);
    return () => clearInterval(id);
  }, [target, active]);
  return display;
}

// ── Breathing engine ───────────────────────────────────────────────────────────
const BREATH_PHASES = ["inhale", "hold", "exhale", "rest"] as const;
const BREATH_TIMING = { inhale: 4, hold: 4, exhale: 6, rest: 2 };

// ══════════════════════════════════════════════════════════════════════════════
export default function Growth() {
  const { user } = useAuth();
  const { lang } = useLang();

  // ── Phases: "boot" | "initiation" | "encoding" | "profile" ──────────────
  const [phase, setPhase] = useState<"boot" | "initiation" | "encoding" | "profile">("boot");
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [bootDone, setBootDone] = useState(false);

  // ── Initiation state ─────────────────────────────────────────────────────
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");

  // ── Encoding state ───────────────────────────────────────────────────────
  const [encodingLines, setEncodingLines] = useState<string[]>([]);
  const [encodingDone, setEncodingDone] = useState(false);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  // ── Profile state ────────────────────────────────────────────────────────
  const [archonProfile, setArchonProfile] = useState<ArchonProfile | null>(null);
  const [existingProfile, setExistingProfile] = useState<ArchonProfile | null>(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [missionResult, setMissionResult] = useState<Record<string, string> | null>(null);
  const [missionDim, setMissionDim] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "oracle" | "calibration">("profile");
  const [breathPhase, setBreathPhase] = useState<typeof BREATH_PHASES[number]>("inhale");
  const [breathing, setBreathing] = useState(false);
  const [breathCount, setBreathCount] = useState(0);
  const breathTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const t = useCallback((key: string) => key, []); // Fallback — uses keys from i18n

  // ── Load existing profile ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    fetch(`${BASE()}/api/archon/profile`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.session) {
          const s = d.session;
          setExistingProfile({
            archonCode: s.archonCode,
            archetype: s.archetype ?? "THE SEEKER",
            dimensions: {
              volontas: s.volontas, resilentia: s.resilentia, intellectus: s.intellectus,
              disciplina: s.disciplina, societas: s.societas, abundantia: s.abundantia, auctoritas: s.auctoritas,
            },
            overallScore: Math.round([s.volontas, s.resilentia, s.intellectus, s.disciplina, s.societas, s.abundantia, s.auctoritas].reduce((a: number, b: number) => a + b, 0) / 7),
            aiProfile: (s.aiProfile as Record<string, string>) ?? {},
            session: s,
          });
          setPhase("profile");
        }
      })
      .catch(() => {});
  }, [user]);

  // ── Boot sequence ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "boot" || !user) return;
    const lines = [
      "ARCHON SYSTEM v4.2 — INITIALIZING...",
      "SCANNING NEURAL SIGNATURE...",
      "LOADING 7 DIMENSION ENGINE...",
      "EMPIRE INTELLIGENCE GRID: CONNECTED",
      "ENCRYPTION LAYER: ACTIVE",
      "CITIZEN VERIFIED — CLEARANCE LEVEL: OMEGA",
      ">>> ARCHON READY <<<",
    ];
    let i = 0;
    const id = setInterval(() => {
      if (i >= lines.length) { clearInterval(id); setBootDone(true); return; }
      setBootLines(prev => [...prev, lines[i]]);
      i++;
    }, 380);
    return () => clearInterval(id);
  }, [phase, user]);

  // ── Breathing engine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!breathing) { if (breathTimer.current) clearInterval(breathTimer.current); return; }
    let ph = 0;
    const cycle = () => {
      const cur = BREATH_PHASES[ph % 4];
      setBreathPhase(cur);
      if (cur === "inhale") setBreathCount(c => c + 1);
      ph++;
    };
    cycle();
    breathTimer.current = setInterval(cycle, 4000);
    return () => { if (breathTimer.current) clearInterval(breathTimer.current); };
  }, [breathing]);

  // ── Submit initiation ─────────────────────────────────────────────────────
  async function submitInitiation() {
    const allAnswers = { ...answers, Q7: freeText || "To grow beyond my limits." };
    setPhase("encoding");
    setApiLoading(true);
    setApiError("");

    // Encoding animation
    const encLines = [
      "TRANSMITTING PSYCHOGRAPHIC DATA...",
      "VOLONTAS VECTOR: COMPUTING...",
      "RESILENTIA MATRIX: COMPILING...",
      "INTELLECTUS FREQUENCY: MAPPING...",
      "DISCIPLINA CORE: CALIBRATING...",
      "SOCIETAS FIELD: ANALYZING...",
      "ABUNDANTIA INDEX: PROCESSING...",
      "AUCTORITAS SIGNATURE: ENCODING...",
      "RUNNING ARCHON CLASSIFICATION ALGORITHM...",
      "GENERATING ENCRYPTED IDENTITY CODE...",
    ];
    let i = 0;
    const animId = setInterval(() => {
      if (i >= encLines.length) { clearInterval(animId); setEncodingDone(true); return; }
      setEncodingLines(prev => [...prev, encLines[i]]);
      i++;
    }, 320);

    try {
      const res = await fetch(`${BASE()}/api/archon/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          answers: allAnswers, lang,
          userStats: user ? { xp: user.xp, wins: user.wins, gamesPlayed: user.gamesPlayed, balance: user.balance, username: user.username } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ARCHON GRID DISRUPTED");
      setArchonProfile({
        archonCode: data.archonCode,
        archetype: data.archetype,
        dimensions: data.dimensions,
        overallScore: data.overallScore,
        aiProfile: data.aiProfile ?? {},
      });
      setTimeout(() => setPhase("profile"), 3200);
    } catch (err: unknown) {
      clearInterval(animId);
      setApiError(err instanceof Error ? err.message : "ARCHON GRID DISRUPTED");
    } finally {
      setApiLoading(false);
    }
  }

  // ── Generate daily mission ────────────────────────────────────────────────
  async function generateMission(dimKey: string) {
    const profile = archonProfile ?? existingProfile;
    if (!profile) return;
    setMissionLoading(true);
    setMissionDim(dimKey);
    setMissionResult(null);
    try {
      const res = await fetch(`${BASE()}/api/archon/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dimension: dimKey.toUpperCase(), archetype: profile.archetype, lang }),
      });
      const data = await res.json();
      setMissionResult(data);
    } catch {
      setMissionResult({ directive: "CLASSIFIED: Execute 15 minutes of deliberate focus on this dimension. No distractions.", duration: "15 min", intensity: "HIGH" });
    } finally {
      setMissionLoading(false);
    }
  }

  const activeProfile = archonProfile ?? existingProfile;
  const archInfo = activeProfile ? (ARCHETYPES[activeProfile.archetype] ?? ARCHETYPES["THE SEEKER"]) : null;

  // ──────────────────────────────────────────────────────────────────────────
  // NOT LOGGED IN
  // ──────────────────────────────────────────────────────────────────────────
  if (!user) return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0">
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className="absolute w-px bg-yellow-400/10 animate-pulse"
            style={{ left: `${Math.random() * 100}%`, top: 0, bottom: 0, animationDelay: `${Math.random() * 3}s` }} />
        ))}
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 text-center space-y-8 p-12 border border-yellow-400/30 bg-black/90">
        <div className="text-yellow-400 font-mono text-xs tracking-[0.4em] uppercase">ARCHON SYSTEM v4.2</div>
        <div className="text-6xl font-black text-red-500 font-mono">ACCESS DENIED</div>
        <div className="text-yellow-400/60 font-mono text-sm tracking-widest">
          CITIZEN AUTHENTICATION REQUIRED<br/>TO ACCESS IMPERIAL MIND FORGE
        </div>
        <div className="border-t border-yellow-400/20 pt-6 space-y-3">
          <p className="text-yellow-400/40 font-mono text-xs">CLEARANCE LEVEL: OMEGA — INITIATES ONLY</p>
          <Link href="/login">
            <button className="px-8 py-3 border border-yellow-400 text-yellow-400 font-mono font-black text-sm tracking-[0.3em] uppercase hover:bg-yellow-400 hover:text-black transition-all">
              ⚡ AUTHENTICATE IDENTITY
            </button>
          </Link>
        </div>
      </motion.div>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // BOOT SEQUENCE
  // ──────────────────────────────────────────────────────────────────────────
  if (phase === "boot") return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      <div className="w-full max-w-2xl font-mono">
        <div className="border border-yellow-400/40 p-8 space-y-2">
          <div className="text-yellow-400/60 text-xs tracking-widest mb-6">
            ╔══════════════════════════════════════════╗<br/>
            ║         ARCHON INTELLIGENCE CORE         ║<br/>
            ║       GDNA EMPIRE — CLASSIFIED           ║<br/>
            ╚══════════════════════════════════════════╝
          </div>
          {bootLines.map((line, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              className={`text-sm tracking-wider ${line.startsWith(">>>") ? "text-yellow-400 font-black text-base" : "text-green-400/80"}`}>
              {line.startsWith(">>>") ? line : `> ${line}`}
            </motion.div>
          ))}
          {bootLines.length < 7 && (
            <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.6 }}
              className="text-green-400 text-sm">█</motion.span>
          )}
          {bootDone && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="pt-6 space-y-4">
              <div className="border-t border-yellow-400/30 pt-4">
                <p className="text-yellow-400/60 text-xs tracking-widest mb-4">SELECT OPERATION:</p>
                <div className="space-y-2">
                  <button
                    onClick={() => { setPhase("initiation"); setQIndex(0); setAnswers({}); setFreeText(""); }}
                    className="w-full text-left px-4 py-3 border border-yellow-400/40 text-yellow-400 font-mono text-sm tracking-wider hover:bg-yellow-400/10 hover:border-yellow-400 transition-all"
                  >
                    ⚡ [1] INITIATE NEW ARCHON ASSESSMENT
                    <span className="text-yellow-400/40 ml-2 text-xs">— Unlock your psychological DNA</span>
                  </button>
                  {existingProfile && (
                    <button
                      onClick={() => setPhase("profile")}
                      className="w-full text-left px-4 py-3 border border-yellow-400/20 text-yellow-400/60 font-mono text-sm tracking-wider hover:bg-yellow-400/5 hover:border-yellow-400/40 transition-all"
                    >
                      ♔ [2] ACCESS EXISTING ARCHON PROFILE
                      <span className="text-yellow-400/40 ml-2 text-xs">— {existingProfile.archetype} · {existingProfile.archonCode}</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // INITIATION — 7 QUESTIONS
  // ──────────────────────────────────────────────────────────────────────────
  if (phase === "initiation") {
    const q = QUESTIONS[qIndex];
    const isRTL = ["ar", "dz"].includes(lang);
    const qText = (q.q as Record<string, string>)[lang] ?? q.q.en;
    const progress = ((qIndex) / QUESTIONS.length) * 100;

    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        {/* Header */}
        <div className="w-full max-w-2xl mb-6">
          <div className="flex items-center justify-between font-mono text-xs text-yellow-400/40 tracking-widest mb-2">
            <span>ARCHON INITIATION PROTOCOL</span>
            <span>QUESTION {qIndex + 1} / {QUESTIONS.length}</span>
          </div>
          <div className="h-px bg-yellow-400/10 w-full relative">
            <motion.div className="h-px bg-yellow-400 absolute left-0 top-0"
              animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
          </div>
          <div className="mt-2 flex gap-1">
            {QUESTIONS.map((_, i) => (
              <div key={i} className={`flex-1 h-0.5 transition-colors ${i < qIndex ? "bg-yellow-400" : i === qIndex ? "bg-yellow-400/60" : "bg-yellow-400/15"}`} />
            ))}
          </div>
        </div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div key={qIndex}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.97 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-2xl border border-yellow-400/30 bg-black p-8 space-y-6"
          >
            {/* Dimension badge */}
            <div className="flex items-center gap-3">
              <span className="text-2xl">{q.glyph}</span>
              <div>
                <div className="font-mono text-yellow-400 text-xs tracking-[0.4em] uppercase">{q.dim}</div>
                <div className="text-yellow-400/50 font-mono text-xs" dir="rtl">{q.ar}</div>
              </div>
              <div className="ml-auto font-mono text-yellow-400/30 text-xs">
                DIMENSION {qIndex + 1}
              </div>
            </div>

            {/* Question text */}
            <div className="border-l-2 border-yellow-400/40 pl-4">
              <p className={`text-white font-bold text-lg leading-relaxed ${isRTL ? "text-right" : ""}`} dir={isRTL ? "rtl" : "ltr"}>
                {qText}
              </p>
            </div>

            {/* Choices or free text */}
            {q.choices ? (
              <div className="space-y-2">
                {(Object.entries(q.choices) as [string, Record<string, string>][]).map(([letter, texts]) => {
                  const selected = answers[`Q${qIndex + 1}`] === letter;
                  const txt = texts[lang] ?? texts.en;
                  return (
                    <motion.button key={letter}
                      whileHover={{ x: 4 }}
                      onClick={() => {
                        setAnswers(prev => ({ ...prev, [`Q${qIndex + 1}`]: letter }));
                        setTimeout(() => {
                          if (qIndex < QUESTIONS.length - 1) setQIndex(i => i + 1);
                          else submitInitiation();
                        }, 220);
                      }}
                      className={`w-full text-left px-5 py-3 border font-mono text-sm tracking-wide transition-all flex items-center gap-4 ${
                        selected
                          ? "border-yellow-400 bg-yellow-400/10 text-yellow-400"
                          : "border-yellow-400/20 text-yellow-400/60 hover:border-yellow-400/50 hover:text-yellow-400/90 hover:bg-yellow-400/5"
                      }`}
                      dir={isRTL ? "rtl" : "ltr"}
                    >
                      <span className={`font-black text-lg shrink-0 ${selected ? "text-yellow-400" : "text-yellow-400/30"}`}>{letter}</span>
                      <span>{txt}</span>
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              // Free text Q7
              <div className="space-y-3">
                <textarea
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder={isRTL ? "اكتب هنا..." : "Type your declaration..."}
                  dir={isRTL ? "rtl" : "ltr"}
                  maxLength={200}
                  rows={3}
                  className="w-full bg-transparent border border-yellow-400/30 text-yellow-400 font-mono text-sm p-4 placeholder:text-yellow-400/20 focus:outline-none focus:border-yellow-400/60 resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-yellow-400/30 font-mono text-xs">{freeText.length}/200</span>
                  <button
                    onClick={() => submitInitiation()}
                    disabled={!freeText.trim()}
                    className="px-6 py-2 border border-yellow-400 text-yellow-400 font-mono font-black text-sm tracking-widest uppercase hover:bg-yellow-400 hover:text-black transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    TRANSMIT ▶
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Back */}
        {qIndex > 0 && (
          <button onClick={() => setQIndex(i => i - 1)}
            className="mt-4 text-yellow-400/30 font-mono text-xs hover:text-yellow-400/60 transition-colors">
            ← PREVIOUS DIMENSION
          </button>
        )}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENCODING — Matrix encryption animation
  // ──────────────────────────────────────────────────────────────────────────
  if (phase === "encoding") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="w-full max-w-2xl font-mono space-y-0">
          <div className="border border-yellow-400/30 p-8">
            <div className="text-yellow-400/50 text-xs tracking-widest mb-6">
              ║ ARCHON ENCODING SEQUENCE — CLASSIFIED OPERATION ║
            </div>
            {encodingLines.map((line, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="text-green-400/80 text-sm tracking-wider py-0.5">
                <span className="text-yellow-400/40 mr-2">[{String(i + 1).padStart(2, "0")}]</span>
                {line}
                {i === encodingLines.length - 1 && !encodingDone && (
                  <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.5 }} className="ml-1">▋</motion.span>
                )}
                {i === encodingLines.length - 1 && (
                  <span className="text-green-400 ml-2">{encodingDone && i < encodingLines.length - 1 ? "✓" : i < encodingLines.length - 1 ? "✓" : ""}</span>
                )}
              </motion.div>
            ))}

            {apiError && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-red-400 border border-red-400/30 p-4">
                ERROR: {apiError}
                <button onClick={() => { setPhase("boot"); setEncodingLines([]); setEncodingDone(false); }}
                  className="block mt-2 text-yellow-400 text-xs hover:underline">← RESTART PROTOCOL</button>
              </motion.div>
            )}

            {encodingDone && !apiLoading && !apiError && archonProfile && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                className="mt-6 border-t border-yellow-400/30 pt-6 space-y-3">
                <div className="text-yellow-400 font-black text-lg tracking-widest">ARCHON CODE GENERATED</div>
                <div className="text-3xl font-black text-yellow-400 tracking-[0.2em] font-mono"
                  style={{ textShadow: "0 0 20px #C9A84C80" }}>
                  {archonProfile.archonCode}
                </div>
                <div className="text-green-400/60 text-xs tracking-wider">
                  ARCHETYPE CLASSIFIED: <span className="text-green-400 font-black">{archonProfile.archetype}</span>
                </div>
                <div className="text-yellow-400/40 text-xs">LOADING ARCHON PROFILE INTERFACE...</div>
              </motion.div>
            )}

            {(apiLoading || (!encodingDone && !apiError)) && (
              <div className="mt-4 flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className="w-1.5 h-1.5 bg-yellow-400 rounded-full"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ARCHON PROFILE
  // ──────────────────────────────────────────────────────────────────────────
  if (phase === "profile" && activeProfile) {
    const ai = activeProfile.aiProfile ?? {};
    const archInfo2 = ARCHETYPES[activeProfile.archetype] ?? ARCHETYPES["THE SEEKER"];
    const dimVals = activeProfile.dimensions;
    const dimEntries = DIMENSIONS.map(d => ({ ...d, score: (dimVals as unknown as Record<string, number>)[d.key] ?? 0 }));

    return (
      <div className="min-h-screen bg-black text-white">
        {/* ── Imperial Header ─────────────────────────────────────────── */}
        <div className="border-b border-yellow-400/20 bg-black sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
            <div className="font-mono text-yellow-400 text-xs tracking-[0.3em]">ARCHON SYSTEM</div>
            <div className="h-4 w-px bg-yellow-400/20" />
            <div className="font-mono text-yellow-400/60 text-xs tracking-widest">{activeProfile.archonCode}</div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-2xl">{archInfo2.symbol}</span>
              <span className="font-mono font-black text-xs tracking-widest" style={{ color: archInfo2.color }}>
                {activeProfile.archetype}
              </span>
              <span className="text-yellow-400/30 font-mono text-xs">· {activeProfile.overallScore}/100</span>
            </div>
          </div>
          {/* Tabs */}
          <div className="max-w-6xl mx-auto px-4 flex gap-0 border-t border-yellow-400/10">
            {([
              { id: "profile", label: "DIMENSIONAL PROFILE", symbol: "◈" },
              { id: "oracle", label: "ORACLE INTELLIGENCE", symbol: "👁" },
              { id: "calibration", label: "BREATH CALIBRATION", symbol: "∿" },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2.5 font-mono text-xs tracking-widest border-b-2 transition-all ${
                  activeTab === tab.id
                    ? "border-yellow-400 text-yellow-400"
                    : "border-transparent text-yellow-400/30 hover:text-yellow-400/60"
                }`}>
                {tab.symbol} {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-8">
          {/* ── Re-assess CTA ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-6">
            <div className="font-mono text-yellow-400/40 text-xs tracking-widest">
              CITIZEN: {user?.username?.toUpperCase()} · CLEARANCE: OMEGA
            </div>
            <button
              onClick={() => { setPhase("boot"); setArchonProfile(null); setQIndex(0); setAnswers({}); setFreeText(""); setBootLines([]); setBootDone(false); setEncodingLines([]); setEncodingDone(false); }}
              className="px-4 py-1.5 border border-yellow-400/30 text-yellow-400/50 font-mono text-xs tracking-widest hover:border-yellow-400/60 hover:text-yellow-400/80 transition-all"
            >
              ↺ RE-INITIATE PROTOCOL
            </button>
          </div>

          {/* ════════════════════════════════════════════════════════════ */}
          {/* TAB: DIMENSIONAL PROFILE                                    */}
          {/* ════════════════════════════════════════════════════════════ */}
          {activeTab === "profile" && (
            <div className="space-y-8">
              {/* Archetype hero */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="border p-8 text-center space-y-4 relative overflow-hidden"
                style={{ borderColor: `${archInfo2.color}40` }}>
                <div className="absolute inset-0 opacity-5"
                  style={{ background: `radial-gradient(circle at 50% 50%, ${archInfo2.color}, transparent 70%)` }} />
                <div className="text-5xl mb-2">{archInfo2.symbol}</div>
                <div className="font-mono text-xs tracking-[0.5em] text-yellow-400/40">ARCHON CLASSIFICATION</div>
                <div className="text-5xl font-black font-mono tracking-widest" style={{ color: archInfo2.color, textShadow: `0 0 40px ${archInfo2.color}60` }}>
                  {activeProfile.archetype}
                </div>
                {archInfo2.ar && (
                  <div className="font-mono text-lg text-yellow-400/60" dir="rtl">{archInfo2.ar}</div>
                )}
                {ai.archetype_declaration && (
                  <p className="text-sm text-white/60 max-w-2xl mx-auto leading-relaxed font-mono border-t border-yellow-400/10 pt-4 mt-4">
                    "{ai.archetype_declaration}"
                  </p>
                )}
                <div className="inline-block px-6 py-2 border font-mono font-black text-sm tracking-[0.3em]"
                  style={{ borderColor: `${archInfo2.color}60`, color: archInfo2.color }}>
                  {activeProfile.archonCode}
                </div>
                {ai.cipher_phrase && (
                  <div className="font-mono text-xs text-yellow-400/30 tracking-[0.4em] uppercase">{ai.cipher_phrase}</div>
                )}
              </motion.div>

              {/* 7 Dimensions grid */}
              <div>
                <div className="font-mono text-yellow-400/50 text-xs tracking-[0.4em] mb-4">◈ 7-DIMENSION NEURAL MAP</div>
                <div className="grid gap-3">
                  {dimEntries.map((dim, i) => (
                    <motion.div key={dim.key}
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                      className="border border-yellow-400/10 p-4 hover:border-yellow-400/30 transition-all group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: `linear-gradient(90deg, ${dim.color}08 0%, transparent 100%)` }} />
                      <div className="relative flex items-center gap-4">
                        <span className="text-xl shrink-0">{dim.glyph}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-sm tracking-widest" style={{ color: dim.color }}>{dim.latin}</span>
                              <span className="font-mono text-xs text-white/30" dir="rtl">{dim.ar}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-black text-sm" style={{ color: dim.color }}>{dim.score}</span>
                              <span className="font-mono text-xs text-white/20">/100</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-white/5 relative overflow-hidden">
                            <motion.div className="h-full absolute left-0 top-0"
                              style={{ background: `linear-gradient(90deg, ${dim.color}90, ${dim.color})` }}
                              initial={{ width: 0 }}
                              animate={{ width: `${dim.score}%` }}
                              transition={{ duration: 1.2, delay: 0.3 + i * 0.08, ease: "easeOut" }} />
                          </div>
                        </div>
                        <button
                          onClick={() => generateMission(dim.key)}
                          disabled={missionLoading && missionDim === dim.key}
                          className="shrink-0 px-3 py-1 border font-mono text-xs tracking-widest transition-all opacity-40 group-hover:opacity-100"
                          style={{ borderColor: `${dim.color}50`, color: dim.color }}
                        >
                          {missionLoading && missionDim === dim.key ? "LOADING..." : "DIRECTIVE ▶"}
                        </button>
                      </div>
                      {/* Mission result inline */}
                      <AnimatePresence>
                        {missionResult && missionDim === dim.key && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="mt-3 pt-3 border-t font-mono" style={{ borderColor: `${dim.color}20` }}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs tracking-widest" style={{ color: dim.color }}>CLASSIFIED DIRECTIVE</span>
                                <span className="text-xs text-white/30">· {missionResult.duration} · {missionResult.intensity}</span>
                              </div>
                              <p className="text-sm text-white/70 leading-relaxed">{missionResult.directive}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Strength + Shadow */}
              {(ai.core_strength || ai.shadow_mission) && (
                <div className="grid md:grid-cols-2 gap-4">
                  {ai.core_strength && (
                    <div className="border border-green-400/20 p-5 space-y-2">
                      <div className="font-mono text-green-400 text-xs tracking-[0.4em]">▲ CORE STRENGTH</div>
                      <p className="text-sm text-white/70 leading-relaxed font-mono">{ai.core_strength}</p>
                    </div>
                  )}
                  {ai.shadow_mission && (
                    <div className="border border-red-400/20 p-5 space-y-2">
                      <div className="font-mono text-red-400 text-xs tracking-[0.4em]">▼ SHADOW MISSION</div>
                      <p className="text-sm text-white/70 leading-relaxed font-mono">{ai.shadow_mission}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Imperial decree */}
              {ai.imperial_decree && (
                <div className="border border-yellow-400/30 p-6 text-center space-y-3">
                  <div className="font-mono text-yellow-400/50 text-xs tracking-[0.5em]">♔ IMPERIAL DECREE</div>
                  <p className="text-base text-yellow-400/80 font-mono leading-relaxed italic">"{ai.imperial_decree}"</p>
                </div>
              )}

              {/* Daily directive */}
              {ai.daily_directive && (
                <div className="border border-yellow-400 p-5 flex items-start gap-4"
                  style={{ boxShadow: "0 0 20px #C9A84C15" }}>
                  <span className="text-2xl shrink-0">⚡</span>
                  <div>
                    <div className="font-mono text-yellow-400 text-xs tracking-[0.4em] mb-2">TODAY'S CLASSIFIED DIRECTIVE</div>
                    <p className="text-sm text-white/80 font-mono leading-relaxed">{ai.daily_directive}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════ */}
          {/* TAB: ORACLE INTELLIGENCE                                    */}
          {/* ════════════════════════════════════════════════════════════ */}
          {activeTab === "oracle" && (
            <div className="space-y-6">
              <div className="font-mono text-yellow-400/40 text-xs tracking-[0.4em] mb-2">
                👁 ARCHON TEMPORAL INTELLIGENCE — CLASSIFIED PROJECTIONS
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { phase: "30-DAY PROTOCOL",    key: "30_day_protocol",    color: "#C9A84C",  sym: "▶" },
                  { phase: "90-DAY EXPANSION",   key: "90_day_expansion",   color: "#A8E6CF",  sym: "▷▶" },
                  { phase: "1-YEAR SOVEREIGNTY", key: "1_year_sovereignty", color: "#DDA0DD",  sym: "♔" },
                ].map((r, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.12 }}
                    className="border p-5 space-y-3" style={{ borderColor: `${r.color}30` }}>
                    <div className="font-mono font-black text-xs tracking-[0.3em]" style={{ color: r.color }}>
                      {r.sym} {r.phase}
                    </div>
                    <p className="text-sm text-white/70 font-mono leading-relaxed">
                      {ai[r.key] ?? "ORACLE PROCESSING..."}
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* Archetype deep dive */}
              <div className="border border-yellow-400/20 p-6 space-y-4">
                <div className="font-mono text-yellow-400/50 text-xs tracking-[0.4em]">◈ DOMINANT + SHADOW DIMENSIONS</div>
                <div className="grid md:grid-cols-2 gap-4">
                  {ai.dominant_dimension && (
                    <div className="space-y-1">
                      <div className="font-mono text-green-400 text-xs tracking-widest">DOMINANT FORCE</div>
                      <div className="font-mono font-black text-xl text-green-400">{ai.dominant_dimension}</div>
                      <div className="text-xs text-white/40 font-mono">Your supreme instrument. Sharpen it.</div>
                    </div>
                  )}
                  {ai.shadow_dimension && (
                    <div className="space-y-1">
                      <div className="font-mono text-red-400/80 text-xs tracking-widest">SHADOW FRONTIER</div>
                      <div className="font-mono font-black text-xl text-red-400/80">{ai.shadow_dimension}</div>
                      <div className="text-xs text-white/40 font-mono">Your next conquest. Face it.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Historical score bars in oracle */}
              <div className="border border-yellow-400/10 p-6">
                <div className="font-mono text-yellow-400/50 text-xs tracking-[0.4em] mb-4">◉ DIMENSIONAL RADAR</div>
                <div className="space-y-3">
                  {dimEntries.sort((a, b) => b.score - a.score).map((dim, i) => (
                    <div key={dim.key} className="flex items-center gap-3 font-mono text-xs">
                      <span className="w-4 text-white/30">{i + 1}</span>
                      <span className="w-28 tracking-widest" style={{ color: dim.color }}>{dim.latin}</span>
                      <div className="flex-1 h-1 bg-white/5 relative overflow-hidden">
                        <motion.div className="h-full absolute left-0"
                          style={{ background: dim.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${dim.score}%` }}
                          transition={{ duration: 1, delay: i * 0.07 }} />
                      </div>
                      <span className="w-8 text-right" style={{ color: dim.color }}>{dim.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════ */}
          {/* TAB: BREATH CALIBRATION                                     */}
          {/* ════════════════════════════════════════════════════════════ */}
          {activeTab === "calibration" && (
            <div className="space-y-6">
              <div className="font-mono text-yellow-400/40 text-xs tracking-[0.4em] mb-2">
                ∿ ARCHON BREATH CALIBRATION PROTOCOL
              </div>

              <div className="border border-yellow-400/20 p-8 flex flex-col md:flex-row items-center gap-10">
                {/* The orb */}
                <div className="relative flex items-center justify-center shrink-0">
                  <motion.div
                    animate={
                      breathPhase === "inhale" ? { scale: 1.6, opacity: 0.9 } :
                      breathPhase === "hold"   ? { scale: 1.6, opacity: 0.7 } :
                      breathPhase === "exhale" ? { scale: 1.0, opacity: 0.5 } :
                      { scale: 1.0, opacity: 0.3 }
                    }
                    transition={{ duration: breathPhase === "inhale" ? 4 : breathPhase === "exhale" ? 6 : 0.3, ease: "easeInOut" }}
                    className="w-36 h-36 rounded-full border"
                    style={{
                      borderColor: breathing ? "#C9A84C" : "#C9A84C30",
                      background: breathing ? "radial-gradient(circle, #C9A84C20, transparent)" : "transparent",
                      boxShadow: breathing ? "0 0 60px #C9A84C30" : "none",
                    }}
                  />
                  <div className="absolute text-center">
                    <p className={`text-xs font-mono font-black uppercase tracking-widest ${breathing ? "text-yellow-400" : "text-yellow-400/30"}`}>
                      {breathing ? breathPhase.toUpperCase() : "STANDBY"}
                    </p>
                    {breathing && breathCount > 0 && (
                      <p className="text-yellow-400/40 font-mono text-xs mt-1">CYCLE {breathCount}</p>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-5">
                  <div className="font-mono text-sm text-white/60 leading-relaxed border-l border-yellow-400/30 pl-4">
                    The Archon Breath Protocol synchronizes your neural oscillations with the 4-4-6-2 imperial rhythm.
                    <br />Used by elite commanders before critical decisions.
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {(["inhale","hold","exhale","rest"] as const).map(p => (
                      <div key={p} className={`px-2 py-2 border font-mono text-xs transition-all ${
                        breathPhase === p && breathing
                          ? "border-yellow-400 bg-yellow-400/10 text-yellow-400 font-black"
                          : "border-yellow-400/10 text-yellow-400/30"
                      }`}>
                        <p className="uppercase tracking-wider">{p}</p>
                        <p className="text-xs mt-0.5 font-black">{BREATH_TIMING[p]}s</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setBreathing(!breathing);
                      if (breathing) { setBreathCount(0); setBreathPhase("inhale"); }
                    }}
                    className={`px-8 py-3 border font-mono font-black text-sm tracking-[0.3em] uppercase transition-all ${
                      breathing
                        ? "border-red-400/40 text-red-400 hover:bg-red-400/10"
                        : "border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
                    }`}
                  >
                    {breathing ? "⏹ DISENGAGE" : "⚡ ENGAGE PROTOCOL"}
                  </button>
                </div>
              </div>

              {/* NLP programs */}
              <div className="border border-yellow-400/10 p-6 space-y-4">
                <div className="font-mono text-yellow-400/50 text-xs tracking-[0.4em]">◈ IMPERIAL MIND PROTOCOLS</div>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    { name: "ANCHOR PROTOCOL", desc: "Link peak states to a physical trigger. Fire it under pressure.", dur: "5 min", color: "#C9A84C" },
                    { name: "VISION IMPRINT",  desc: "Project your 1-year sovereignty state with full sensory detail.", dur: "7 min", color: "#A8E6CF" },
                    { name: "REFRAME SEQUENCE",desc: "Decode a limiting belief and install its opposite as a command.", dur: "3 min", color: "#98FB98" },
                    { name: "PEAK IGNITION",   desc: "Physiological + mental activation sequence. Full power in 10 min.", dur: "10 min", color: "#DDA0DD" },
                  ].map((prog, i) => (
                    <div key={i} className="border border-white/5 p-4 space-y-2 hover:border-yellow-400/20 transition-all cursor-pointer">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-black text-xs tracking-wider" style={{ color: prog.color }}>{prog.name}</span>
                        <span className="font-mono text-xs text-white/30">{prog.dur}</span>
                      </div>
                      <p className="text-xs text-white/50 font-mono leading-relaxed">{prog.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-12 pt-6 border-t border-yellow-400/10 flex items-center justify-between font-mono text-xs text-yellow-400/20">
            <span>ARCHON SYSTEM v4.2 · GDNA EMPIRE · CLASSIFIED</span>
            <div className="flex gap-4">
              <Link href="/games"><span className="hover:text-yellow-400/50 cursor-pointer transition-colors">BATTLE ARENA</span></Link>
              <Link href="/games/globalstar"><span className="hover:text-yellow-400/50 cursor-pointer transition-colors">GLOBALSTAR</span></Link>
              <Link href="/chronicle"><span className="hover:text-yellow-400/50 cursor-pointer transition-colors">CHRONICLES</span></Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for encoding phase without profile yet
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="font-mono text-yellow-400 animate-pulse tracking-widest">ARCHON PROCESSING...</div>
    </div>
  );
}
