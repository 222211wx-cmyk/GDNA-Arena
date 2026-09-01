/**
 * /messages — MESSAGERI - المراسلات
 * Branded MESSAGERI. Limited to public chat, groups, and messaging legends and
 * non-private citizens. This is NOT AMIS; it does not embed Social or games.
 */
import { MessageSquare, ShieldCheck } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { SOCIAL_T, GOLD } from "@/components/social/social-i18n";
import Messenger from "@/components/messenger/Messenger";
import { techT } from "@/i18n/tech-surfaces-copy";

export default function MessagesPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [, navigate] = useLocation();
  const search = useSearch();
  const st  = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir = lang === "ar" ? "rtl" : "ltr";
  const requestedRoom = new URLSearchParams(search).get("room");
  const parsedRoomId = requestedRoom === null ? Number.NaN : Number(requestedRoom);
  const initialRoomId = Number.isSafeInteger(parsedRoomId) && parsedRoomId > 0 ? parsedRoomId : null;
  const hasInvalidRoomParam = requestedRoom !== null && initialRoomId === null;
  const setSelectedRoom = useCallback((roomId: number | null) => {
    navigate(roomId === null ? "/messages" : `/messages?room=${roomId}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (hasInvalidRoomParam) setSelectedRoom(null);
  }, [hasInvalidRoomParam, setSelectedRoom]);

  if (!user) {
    return (
      <div dir={dir} lang={lang === "de" ? "de-DE" : lang} style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#666" }}>
        <MessageSquare size={40} style={{ color: GOLD, opacity: 0.5 }} />
        <p style={{ margin: 0, fontSize: 15 }}>{st.login_required}</p>
        <Link href="/login" style={{ background: GOLD, color: "#000", fontWeight: 800, borderRadius: 8, padding: "8px 22px", textDecoration: "none", fontSize: 13 }} data-testid="link-login-messageri">
          {techT(lang, "messageri")}
        </Link>
      </div>
    );
  }

  return (
    <div dir={dir} lang={lang === "de" ? "de-DE" : lang} style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <MessageSquare size={20} style={{ color: GOLD }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#fff" }} data-testid="heading-messageri">{techT(lang, "messageri")}</h1>
        <span style={{ fontSize: 11, color: "#ffffff40" }}>{st.messages}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#ffffff40", marginInlineStart: "auto" }}>
          <ShieldCheck size={12} style={{ color: GOLD }} /> {st.server_encrypted}
        </span>
      </div>
      <Messenger
        variant="full"
        initialRoomId={initialRoomId}
        onActiveRoomChange={setSelectedRoom}
      />
    </div>
  );
}
