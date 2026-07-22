import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, Loader2, Zap, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED: Record<string, string[]> = {
  en: ["What is GDNA Arena?", "How do I earn coins?", "Best strategy?", "Tell me about play-to-earn"],
  ar: ["ما هي GDNA Arena؟", "كيف أربح عملات؟", "أفضل استراتيجية؟", "اشرح play-to-earn"],
  fr: ["C'est quoi GDNA Arena?", "Comment gagner?", "Meilleure stratégie?", "Explique le play-to-earn"],
  dz: ["شنو هي GDNA Arena؟", "كيفاش نربح؟", "أفضل استراتيجية؟", "شرح ليا play-to-earn"],
};

const WELCOME: Record<string, string> = {
  en: "Greetings, warrior! I am GDN-AI — the legendary genie of GDNA Arena 🔥 Ask me anything!",
  ar: "أهلاً يا محارب! أنا GDN-AI — الجني الأسطوري لـ GDNA Arena 🔥 اسألني أي شيء!",
  fr: "Salutations, guerrier! Je suis GDN-AI 🔥 Demandez-moi n'importe quoi!",
  dz: "السلام، يا مجاهد! أنا GDN-AI — الجني الخارق ديال GDNA Arena 🔥 سولني على أي حاجة!",
};

interface GdnAiTerminalProps {
  compact?: boolean;
}

export default function GdnAiTerminal({ compact = false }: GdnAiTerminalProps) {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME[lang] ?? WELCOME.en },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSuggested, setShowSuggested] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: "assistant", content: WELCOME[lang] ?? WELCOME.en }]);
    setShowSuggested(true);
  }, [lang]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMessage: Message = { role: "user", content: msg };
    const history = messages.slice(1);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError("");
    setShowSuggested(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg, history }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? "Server error");
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggested = SUGGESTED[lang] ?? SUGGESTED.en;
  const chatHeight = compact ? "max-h-[280px]" : "max-h-[380px]";

  return (
    <div className="flex flex-col h-full">
      {/* Terminal header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-black/60 border-b border-primary/20 rounded-t-xl">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <div className="flex-1 flex items-center justify-center gap-2">
          <Sparkles className="w-3 h-3 text-primary animate-pulse" />
          <span className="text-xs font-mono text-primary/80 tracking-widest uppercase">
            GDN-AI Terminal v2.0
          </span>
          <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 border border-green-400/30 px-2 py-0.5 rounded-full">
            <Zap className="w-2.5 h-2.5" /> LIVE
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        className={`flex-1 overflow-y-auto p-4 space-y-3 ${chatHeight} scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent`}
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center border border-primary/40 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-black font-medium rounded-br-sm"
                    : "bg-black/40 border border-primary/20 text-foreground rounded-bl-sm font-mono"
                }`}
                dir="auto"
              >
                {msg.role === "assistant" && (
                  <span className="text-primary/60 text-xs font-mono mr-1">&gt;</span>
                )}
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 w-7 h-7 rounded-full bg-primary/30 flex items-center justify-center border border-primary/50 mt-0.5">
                  <span className="text-xs font-bold text-primary">U</span>
                </div>
              )}
            </motion.div>
          ))}

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-2 justify-start"
            >
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center border border-primary/40">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="bg-black/40 border border-primary/20 px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span className="text-muted-foreground text-xs font-mono">GDN-AI thinking...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="text-center text-destructive text-xs py-1 font-mono">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions */}
      <AnimatePresence>
        {showSuggested && messages.length <= 1 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 pb-2 flex flex-wrap gap-1.5"
          >
            {suggested.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="text-[11px] px-2.5 py-1.5 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors font-mono"
                dir="auto"
              >
                {q}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="flex gap-2 p-3 border-t border-primary/20 bg-black/40 rounded-b-xl">
        <span className="text-primary/50 font-mono text-sm self-center">&gt;_</span>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat_placeholder")}
          className="flex-1 h-10 text-sm bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 font-mono placeholder:text-muted-foreground/40"
          disabled={loading}
          dir="auto"
        />
        <Button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          size="sm"
          className="h-10 px-4 bg-primary hover:bg-primary/90 text-black font-bold neon-glow transition-all"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

/* ─── Floating Widget ─────────────────────────────────── */
export function GdnAiFloating() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="mb-3 w-[360px] rounded-xl border border-primary/30 bg-card/95 backdrop-blur shadow-2xl shadow-primary/20"
          >
            <GdnAiTerminal compact />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full bg-primary neon-glow flex items-center justify-center shadow-lg shadow-primary/40 relative"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronDown className="w-6 h-6 text-black" />
            </motion.span>
          ) : (
            <motion.span
              key="open"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Bot className="w-6 h-6 text-black" />
            </motion.span>
          )}
        </AnimatePresence>
        {/* Pulse dot */}
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-background animate-pulse" />
      </motion.button>
    </div>
  );
}
