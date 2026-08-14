/**
 * /messages — AMIS full-page messenger. One unified messenger everywhere:
 * this page, the Social Hub tab, and the floating CommHub widget all render
 * the same shared <Messenger /> component.
 */
import { MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { SOCIAL_T, GOLD } from "@/components/social/social-i18n";
import Messenger from "@/components/messenger/Messenger";

export default function MessagesPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const st  = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir = lang === "ar" ? "rtl" : "ltr";

  if (!user) {
    return (
      <div dir={dir} style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#666" }}>
        <MessageSquare size={40} style={{ color: GOLD, opacity: 0.5 }} />
        <p style={{ margin: 0, fontSize: 15 }}>{st.login_required}</p>
        <Link href="/login" style={{ background: GOLD, color: "#000", fontWeight: 800, borderRadius: 8, padding: "8px 22px", textDecoration: "none", fontSize: 13 }}>
          AMIS 👑
        </Link>
      </div>
    );
  }

  return (
    <div dir={dir} style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <MessageSquare size={20} style={{ color: GOLD }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#fff" }}>AMIS</h1>
        <span style={{ fontSize: 11, color: "#ffffff40" }}>👑 {st.server_encrypted}</span>
      </div>
      <Messenger variant="full" />
    </div>
  );
}
