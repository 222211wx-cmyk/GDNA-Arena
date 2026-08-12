/**
 * Ameeq — الواجهة المستقلة ديال الموظف الحكومي EMP-001
 * Standalone RTL chat page at /ameeq
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/components/social/social-i18n";

const EMPLOYEE_NAME = "Ameeq AI";
const OWNER = "GDNA Arena";
const EMPLOYEE_ID = "EMP-001";

type Msg = {
  from: "user" | "ai";
  text: string;
  empireNote?: boolean;
  ownerDomain?: string;
  signature?: string;
};

export default function AmeeqPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { from: "ai", text: "مرحبا. اسألني أي شيء." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendCommand() {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setMessages((m) => [...m, { from: "user", text: cmd }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(api("/api/ameeq"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { from: "ai", text: `⚠️ ${data.error ?? "وقع مشكل. عاود من بعد."}` }]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          from: "ai",
          text: data.response ?? "…",
          empireNote: Boolean(data.empireNote),
          ownerDomain: data.ownerDomain,
          signature: data.signature,
        },
      ]);
    } catch {
      setMessages((m) => [...m, { from: "ai", text: "⚠️ الموظف مشغول حالياً. عاود من بعد." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" lang="ar" style={{
      background: "#0a0a0a", color: "#fff", fontFamily: "'Tajawal', sans-serif",
      margin: 0, display: "flex", flexDirection: "column", height: "calc(100vh - 115px)", minHeight: 420,
    }}>
      <header style={{ background: "#111", padding: 15, textAlign: "center", borderBottom: "2px solid gold" }}>
        <div style={{ fontSize: 11, color: "gold" }}>
          🏛️ موظف حكومي رقم {EMPLOYEE_ID} | تابع لـ {OWNER}
        </div>
        <h1 style={{ margin: "6px 0 0" }}>👑 {EMPLOYEE_NAME}</h1>
      </header>

      <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            margin: "10px 0", padding: "12px 18px", borderRadius: 12, maxWidth: "80%",
            whiteSpace: "pre-wrap",
            ...(msg.from === "user"
              ? { background: "#222", marginLeft: "auto" }
              : { background: "#1a1a1a", border: "1px solid #333" }),
          }}>
            {msg.from === "ai" && msg.signature ? (
              <>
                <b>{EMPLOYEE_NAME}</b>
                <hr style={{ borderColor: "#333" }} />
                <div>{msg.text}</div>
                {msg.empireNote && msg.ownerDomain && (
                  <div style={{ marginTop: 10 }}>
                    🏛️ <b>ملاحظة رسمية:</b> هذا الأمر يخص {OWNER}.
                    <br />
                    للوصول:{" "}
                    <a href={`https://${msg.ownerDomain}`} target="_blank" rel="noreferrer" style={{ color: "gold" }}>
                      {msg.ownerDomain}
                    </a>
                  </div>
                )}
                <hr style={{ borderColor: "#333" }} />
                <i style={{ fontSize: 12, color: "#999" }}>{msg.signature}</i>
              </>
            ) : (
              msg.text
            )}
          </div>
        ))}
        {busy && (
          <div style={{ margin: "10px 0", padding: "12px 18px", borderRadius: 12, maxWidth: "80%", background: "#1a1a1a", border: "1px solid #333", color: "#999" }}>
            ⏳ {EMPLOYEE_NAME} كيكتب…
          </div>
        )}
      </div>

      <footer style={{ display: "flex", padding: 15, background: "#111" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") sendCommand(); }}
          placeholder="اكتب أمرك هنا..."
          maxLength={500}
          style={{ flex: 1, padding: 14, borderRadius: 10, border: "none", background: "#222", color: "#fff", outline: "none" }}
        />
        <button
          onClick={sendCommand}
          disabled={busy}
          style={{ padding: "14px 25px", marginRight: 10, borderRadius: 10, border: "none", background: "gold", color: "#000", fontWeight: "bold", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          إرسال
        </button>
      </footer>
    </div>
  );
}
