import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";

const TOPICS: { id: string; label: string }[] = [
  { id: "plan", label: "خطة اليوم" },
  { id: "motivation", label: "تحفيز" },
  { id: "progress", label: "تحليل التقدم" },
  { id: "problem", label: "حل مشكلة" },
];

const SPEECH_LANG: Record<string, string> = { ar: "ar-MA", fr: "fr-FR", en: "en-US", es: "es-ES", de: "de-DE" };

// حفظ التاريخ — آخر 10 استشارات فقط
function saveToHistory(topic: string, reply: string) {
  try {
    const history = JSON.parse(localStorage.getItem("ameeq_history") || "[]") as unknown[];
    history.unshift({ topic, reply, date: new Date().toLocaleString() });
    localStorage.setItem("ameeq_history", JSON.stringify(history.slice(0, 10)));
  } catch { /* localStorage unavailable — ignore */ }
}

function speak(text: string, lang: string) {
  try {
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = SPEECH_LANG[lang] ?? lang;
    speechSynthesis.speak(speech);
  } catch { /* speech unsupported — ignore */ }
}

export default function RoyalPalace() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const [activeTopic, setActiveTopic] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [listening, setListening] = useState(false);

  if (!user) return null;

  const consultGovernor = async (topic: (typeof TOPICS)[number]) => {
    setLoadingId(topic.id);
    setActiveTopic(topic.label);
    setAnswer("");
    setError("");
    try {
      const res = await fetch("/api/governor/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic: topic.label, lang }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "فشل الاتصال");
      setAnswer(data.reply);
      saveToHistory(topic.label, data.reply);
      speak(data.reply, lang);
    } catch {
      setError("الحاكم مشغول فـ اجتماع. عاود من بعد.");
    } finally {
      setLoadingId(null);
    }
  };

  // 🎙️ استشارة صوتية — تكلم مع الحاكم
  const startVoiceConsult = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("المتصفح ديالك ما كيدعمش التعرف على الصوت. جرب Chrome.");
      return;
    }
    const rec = new SR();
    rec.lang = SPEECH_LANG[lang] ?? "ar-MA";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    setError("");
    rec.onresult = async (e: any) => {
      const transcript: string = e.results[0][0].transcript;
      setListening(false);
      setLoadingId("voice");
      setActiveTopic(`🎙️ ${transcript}`);
      setAnswer("");
      try {
        const res = await fetch("/api/governor/consult", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ question: transcript.slice(0, 300), lang }),
        });
        const data = (await res.json()) as { reply?: string; error?: string };
        if (!res.ok || !data.reply) throw new Error(data.error ?? "فشل الاتصال");
        setAnswer(data.reply);
        saveToHistory(`🎙️ ${transcript}`, data.reply);
        speak(data.reply, lang);
      } catch {
        setError("الحاكم مشغول فـ اجتماع. عاود من بعد.");
      } finally {
        setLoadingId(null);
      }
    };
    rec.onerror = () => { setListening(false); setError("ما سمعتش مزيان — عاود جرب."); };
    rec.onend = () => setListening(false);
    rec.start();
  };

  return (
    <div dir="rtl" className="palace rounded-[15px] p-5 mt-5 space-y-4"
      style={{ background: "#0f172a", border: "2px solid #25D366" }}>
      <h3 className="flex items-center justify-center gap-2 font-black text-lg md:text-xl text-center"
        style={{ color: "#25D366", fontFamily: "'Orbitron', 'Inter', sans-serif" }}>
        <Crown className="w-5 h-5" />
        🏛️ قصر استشارة الحاكم Ameeq
      </h3>

      <div className="flex flex-wrap justify-center">
        {TOPICS.map((topic) => (
          <button
            key={topic.id}
            onClick={() => consultGovernor(topic)}
            disabled={loadingId !== null}
            className="royal-btn text-white font-bold text-sm rounded-[10px] p-3 m-1 w-[48%] disabled:opacity-50"
            style={{ background: "linear-gradient(90deg, #25D366, #008575)", border: "none" }}
          >
            {loadingId === topic.id ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {topic.label}
              </span>
            ) : (
              topic.label
            )}
          </button>
        ))}
      </div>

      {/* 🎙️ زر الاستشارة الصوتية */}
      <div style={{ textAlign: "center", marginTop: 15 }}>
        <button
          id="micBtn"
          onClick={startVoiceConsult}
          disabled={loadingId !== null || listening}
          className="text-2xl rounded-full w-14 h-14 transition-all duration-300 disabled:opacity-50"
          style={{
            background: listening ? "#2ecc71" : "#1e293b",
            border: "2px solid #25D366",
            boxShadow: listening ? "0 0 15px #25D366" : "none",
          }}
          title="تكلم مع الحاكم"
        >
          {listening ? <span className="animate-pulse">🎙️</span> : "🎙️"}
        </button>
        {listening && <div className="text-xs mt-2" style={{ color: "#25D366" }}>كنسمع ليك... تكلم دابا</div>}
      </div>

      <AnimatePresence>
        {(answer || error) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`msg-ai rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap ${
              error ? "border-red-400/40 text-red-300" : "border-yellow-400/20 bg-yellow-400/5 text-white/85"
            }`}
          >
            {error || (
              <>
                <div className="text-yellow-400/70 text-xs font-bold mb-2">👑 {activeTopic}</div>
                {answer}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
