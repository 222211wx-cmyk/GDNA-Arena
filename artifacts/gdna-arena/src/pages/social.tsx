/**
 * Social Hub — thin shell
 * All feature logic lives in src/components/social/
 */
import { useState, useEffect, useRef } from "react";
import SmartDomainWidget from "@/components/SmartDomainWidget";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, MessageSquare, BookOpen, Radio, Users, Bell, Search, X } from "lucide-react";
import { useAuth }     from "../contexts/AuthContext";
import { useLang }     from "../contexts/LangContext";
import FeedTab          from "../components/social/FeedTab";
import MessagesTab      from "../components/social/MessagesTab";
import StoriesRow       from "../components/social/StoriesRow";
import LiveTab          from "../components/social/LiveTab";
import CitizensTab      from "../components/social/CitizensTab";
import NotificationsTab from "../components/social/NotificationsTab";
import SearchDropdown   from "../components/social/SearchDropdown";
import { SOCIAL_T, GOLD } from "../components/social/social-i18n";

type Tab = "feed" | "messages" | "stories" | "live" | "citizens" | "notifications";

export default function SocialPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const st  = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [tab,        setTab]        = useState<Tab>("feed");
  const [searchQ,    setSearchQ]    = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close search on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "feed",          icon: <Globe          size={14} />, label: st.feed          },
    { id: "messages",      icon: <MessageSquare  size={14} />, label: st.messages      },
    { id: "stories",       icon: <BookOpen       size={14} />, label: st.stories       },
    { id: "live",          icon: <Radio          size={14} />, label: st.live          },
    { id: "citizens",      icon: <Users          size={14} />, label: st.citizens      },
    { id: "notifications", icon: <Bell           size={14} />, label: st.notifications },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir={dir}>
      {/* Sticky header */}
      <div style={{ background: "rgba(5,5,5,0.96)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${GOLD}15`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "12px 16px" }}>
          {/* Title row + Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ flexShrink: 0 }}>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>
                <span style={{ color: GOLD }}>◈</span> {st.title}
              </h1>
              {user && (
                <p style={{ margin: 0, fontSize: 11, color: "#ffffff40" }}>
                  {user.username} · {(user.xp ?? 0).toLocaleString()} XP
                </p>
              )}
            </div>
            {/* Global search */}
            <div ref={searchRef} style={{ flex: 1, position: "relative" }}>
              <div style={{
                display: "flex", alignItems: "center",
                background: "#111", border: `1px solid ${searchOpen ? GOLD : `${GOLD}20`}`,
                borderRadius: 20, padding: "7px 14px", gap: 8, transition: "border-color 0.2s",
              }}>
                <Search size={13} style={{ color: "#666", flexShrink: 0 }} />
                <input
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder={st.search_placeholder}
                  style={{ flex: 1, background: "none", border: "none", color: "#fff", fontSize: 13, outline: "none", minWidth: 0 }}
                />
                {searchQ && (
                  <button onClick={() => { setSearchQ(""); setSearchOpen(false); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0, display: "flex" }}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {searchOpen && searchQ.length >= 2 && (
                <SearchDropdown
                  q={searchQ} st={st} dir={dir}
                  onClose={() => { setSearchOpen(false); setSearchQ(""); }}
                />
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", transition: "all 0.2s",
                  background: tab === t.id ? `${GOLD}20` : "transparent",
                  color:      tab === t.id ? GOLD : "#ffffff45",
                  borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
                }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Smart Domain Widget */}
      <div style={{ maxWidth: 880, margin: "12px auto 0", padding: "0 16px" }}>
        <SmartDomainWidget domainId="social" label="Module Social" />
      </div>

      {/* Tab content */}
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "20px 16px" }}>
        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.13 }}>
            {tab === "feed"          && <FeedTab          user={user} st={st} dir={dir} />}
            {tab === "messages"      && <MessagesTab      user={user} st={st} dir={dir} />}
            {tab === "stories"       && <StoriesRow       user={user} st={st} dir={dir} />}
            {tab === "live"          && <LiveTab          user={user} st={st} />}
            {tab === "citizens"      && <CitizensTab      user={user} st={st} />}
            {tab === "notifications" && <NotificationsTab user={user} st={st} dir={dir} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
