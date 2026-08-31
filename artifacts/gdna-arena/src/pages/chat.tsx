import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Loader2, Zap } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Card } from "@workspace/gdna-ds/components/ui/card";
import { useLang } from "@/contexts/LangContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED: Record<string, string[]> = {
  en: ["✅ Is my Smart System active?", "How do I earn coins?", "Best strategy for games?", "Explain play-to-earn"],
  ar: ["✅ هل النظام الذكي نشط؟ أعطني تقريري", "كيف أربح عملات؟", "أفضل استراتيجية للألعاب؟", "اشرح play-to-earn"],
  fr: ["✅ Smart System actif? Montre mon rapport", "Comment gagner des pièces?", "Meilleure stratégie pour les jeux?", "Explique le play-to-earn"],
  dz: ["✅ واش النظام الذكي نشط؟ عطيني تقريري", "كيفاش نربح كوينز؟", "أفضل استراتيجية؟", "شرح ليا play-to-earn"],
};

const WELCOME: Record<string, string> = {
  en: "Neural grid online. ✅ GDN-SMART SYSTEM: ACTIVE — monitoring Gaming, Education, Business, Social, Competitions & XP in real time. Ask me for your personalised report.",
  ar: "الشبكة العصبية متصلة. ✅ نظام GDN-SMART: نشط — يراقب الألعاب، التعليم، الأعمال، الاجتماعي، المسابقات وXP في الوقت الفعلي. اسألني عن تقريرك الشخصي.",
  fr: "Grille neurale en ligne. ✅ GDN-SMART SYSTEM: ACTIF — surveillance Gaming, Education, Business, Social, Competitions & XP en temps reel. Demandez votre rapport personnalise.",
  dz: "الشبكة العصبية متصلة. ✅ نظام GDN-SMART: نشط — يراقب الألعاب، التعليم، البيزنس، السوشيال وXP. سول على تقريرك الشخصي.",
};

export default function ChatPage() {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME[lang] ?? WELCOME.en },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: "assistant", content: WELCOME[lang] ?? WELCOME.en }]);
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

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col max-w-3xl mx-auto p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="p-3 rounded-full bg-primary/20 neon-glow">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black uppercase tracking-wider neon-text-glow">
            {t("chat_title")}
          </h1>
          <span className="flex items-center gap-1 text-xs text-green-400 bg-green-400/10 border border-green-400/30 px-2 py-1 rounded-full">
            <Zap className="w-3 h-3" /> ONLINE
          </span>
        </div>
        <p className="text-muted-foreground text-sm uppercase tracking-widest">
          {t("chat_sub")}
        </p>
      </motion.div>

      <Card className="flex-1 bg-card/30 border-primary/20 p-4 overflow-y-auto mb-4 space-y-4 min-h-[400px] max-h-[55vh]">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`message-${i}`}
            >
              {msg.role === "assistant" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/40">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground font-medium rounded-br-sm"
                    : "bg-card border border-primary/20 text-foreground rounded-bl-sm"
                }`}
                dir="auto"
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center border border-primary/50">
                  <User className="w-4 h-4 text-primary" />
                </div>
              )}
            </motion.div>
          ))}

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3 justify-start"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/40">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-card border border-primary/20 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-muted-foreground text-sm">GDN-AI ...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="text-center text-destructive text-sm py-2">{error}</div>
        )}
        <div ref={bottomRef} />
      </Card>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggested.map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              className="text-xs px-3 py-2 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
              dir="auto"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat_placeholder")}
          className="flex-1 h-12 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary"
          disabled={loading}
          dir="auto"
          data-testid="input-chat"
        />
        <Button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          className="h-12 px-5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold neon-glow transition-all"
          data-testid="button-send"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </Button>
      </div>
    </div>
  );
}
