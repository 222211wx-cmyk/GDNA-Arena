import { useState, useEffect, useCallback } from "react";
import { useAuth }  from "../contexts/AuthContext";
import { useLang }  from "../contexts/LangContext";
import { useCallContext } from "../contexts/CallContext";
import { Phone, Video, UserPlus, UserCheck, Users, Search, Loader2, MessageSquare } from "lucide-react";
import { Link } from "wouter";

const GOLD = "#FFD700";
const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const api  = (path: string) => `${BASE()}${path}`;

interface Citizen {
  id: number; username: string; xp: number; balance: number;
  isFollowing?: boolean; followsMe?: boolean;
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const colors = ["#e74c3c","#e67e22","#2ecc71","#3498db","#9b59b6","#1abc9c","#e91e63","#ff5722"];
  const bg = colors[name.charCodeAt(0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, fontSize: size * 0.4, color: "#fff", flexShrink: 0,
    }}>
      {name[0].toUpperCase()}
    </div>
  );
}

export default function FriendsPage() {
  const { user }    = useAuth();
  const { lang }    = useLang();
  const call        = useCallContext() as any;
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [following, setFollowing] = useState<Citizen[]>([]);
  const [suggested, setSuggested] = useState<Citizen[]>([]);
  const [search,    setSearch]    = useState("");
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState<"friends" | "discover">("friends");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, cRes] = await Promise.all([
        fetch(api("/api/social/v2/following"), { credentials: "include" }),
        fetch(api("/api/citizens?limit=20"), { credentials: "include" }),
      ]);
      const fData = fRes.ok ? await fRes.json() : { following: [] };
      const cData = cRes.ok ? await cRes.json() : { citizens: [] };
      setFollowing(fData.following ?? []);
      const followingIds = new Set((fData.following ?? []).map((f: Citizen) => f.id));
      setSuggested((cData.citizens ?? []).filter((c: Citizen) => c.id !== user?.id && !followingIds.has(c.id)).slice(0, 12));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) load(); else setLoading(false); }, [user, load]);

  const toggleFollow = async (targetId: number, currently: boolean) => {
    const method = currently ? "DELETE" : "POST";
    await fetch(api(`/api/social/v2/follow/${targetId}`), { method, credentials: "include" });
    load();
  };

  const startCall = (username: string, type: "audio" | "video") => {
    if (!call?.startCall) return;
    call.startCall(username, type);
  };

  const filtered = (tab === "friends" ? following : suggested).filter(c =>
    !search || c.username.toLowerCase().includes(search.toLowerCase())
  );

  const t = {
    title:    lang === "ar" ? "العلاقات"    : "Relationships",
    friends:  lang === "ar" ? "الأصدقاء"   : "Following",
    discover: lang === "ar" ? "اكتشف"       : "Discover",
    search:   lang === "ar" ? "ابحث..."     : "Search...",
    follow:   lang === "ar" ? "متابعة"      : "Follow",
    unfollow: lang === "ar" ? "إلغاء المتابعة" : "Unfollow",
    voice:    lang === "ar" ? "مكالمة صوتية" : "Voice Call",
    video:    lang === "ar" ? "مكالمة فيديو" : "Video Call",
    message:  lang === "ar" ? "رسالة"       : "Message",
    empty_f:  lang === "ar" ? "لا تتابع أحداً بعد — اكتشف مواطنين جدد" : "Not following anyone yet",
    empty_d:  lang === "ar" ? "لا يوجد مواطنون آخرون" : "No other citizens found",
    login:    lang === "ar" ? "سجّل دخولك للوصول لعلاقاتك" : "Login to manage your relationships",
    coins:    lang === "ar" ? "عملات" : "coins",
    xp:       "XP",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir={dir}>
      {/* Header */}
      <div style={{ background: "#0a0a0a", borderBottom: `1px solid ${GOLD}20`, padding: "28px 24px 16px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>
            <span style={{ color: GOLD }}>◈</span> {t.title}
          </h1>
          <p style={{ margin: 0, color: "#ffffff40", fontSize: 13 }}>
            {user ? `@${user.username}` : t.login}
          </p>
          {user && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {(["friends", "discover"] as const).map(tb => (
                <button key={tb} onClick={() => setTab(tb)} style={{
                  padding: "8px 20px", borderRadius: 20, border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: 13,
                  background: tab === tb ? `${GOLD}20` : "transparent",
                  color:      tab === tb ? GOLD : "#ffffff50",
                  borderBottom: tab === tb ? `2px solid ${GOLD}` : "2px solid transparent",
                }}>
                  {tb === "friends" ? <><Users size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{t.friends}</> : <><UserPlus size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{t.discover}</>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 24px" }}>
        {!user ? (
          <div style={{ textAlign: "center", padding: 60, color: "#666" }}>
            <Users size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
            <p>{t.login}</p>
          </div>
        ) : loading ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Loader2 size={32} style={{ color: GOLD, animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* Search */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 20,
              padding: "9px 16px", marginBottom: 20,
            }}>
              <Search size={14} style={{ color: "#666" }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t.search}
                style={{ flex: 1, background: "none", border: "none", color: "#fff", fontSize: 14, outline: "none" }}
              />
            </div>

            {/* Citizen cards */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
                <Users size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
                <p>{tab === "friends" ? t.empty_f : t.empty_d}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map(citizen => (
                  <div key={citizen.id} style={{
                    display: "flex", alignItems: "center", gap: 14,
                    background: "#0d0d0d", border: `1px solid ${GOLD}15`,
                    borderRadius: 14, padding: "14px 18px",
                  }}>
                    <Avatar name={citizen.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>@{citizen.username}</div>
                      <div style={{ color: "#ffffff50", fontSize: 12, marginTop: 2 }}>
                        {citizen.xp?.toLocaleString()} {t.xp}
                        <span style={{ marginLeft: 10 }}>🪙 {citizen.balance?.toLocaleString()} {t.coins}</span>
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {tab === "friends" && (
                        <>
                          <Link href="/messages">
                            <button title={t.message} style={{
                              background: `${GOLD}15`, border: `1px solid ${GOLD}30`,
                              borderRadius: 10, padding: "7px 10px", cursor: "pointer", color: GOLD,
                              display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
                            }}>
                              <MessageSquare size={14} />
                            </button>
                          </Link>
                          <button onClick={() => startCall(citizen.username, "audio")}
                            title={t.voice}
                            style={{
                              background: "#0a2a0a", border: "1px solid #0a0",
                              borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "#0f0",
                              display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                            }}>
                            <Phone size={14} />
                            <span style={{ display: window.innerWidth > 500 ? "inline" : "none" }}>{lang === "ar" ? "صوتي" : "Voice"}</span>
                          </button>
                          <button onClick={() => startCall(citizen.username, "video")}
                            title={t.video}
                            style={{
                              background: "#0a1a2a", border: "1px solid #09f",
                              borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "#09f",
                              display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                            }}>
                            <Video size={14} />
                            <span style={{ display: window.innerWidth > 500 ? "inline" : "none" }}>{lang === "ar" ? "فيديو" : "Video"}</span>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => toggleFollow(citizen.id, tab === "friends")}
                        style={{
                          background: tab === "friends" ? "#1a0a0a" : `${GOLD}15`,
                          border: tab === "friends" ? "1px solid #800" : `1px solid ${GOLD}40`,
                          borderRadius: 10, padding: "7px 14px", cursor: "pointer",
                          color: tab === "friends" ? "#f55" : GOLD,
                          fontSize: 12, fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 6,
                        }}>
                        {tab === "friends"
                          ? <><UserCheck size={13} />{t.unfollow}</>
                          : <><UserPlus  size={13} />{t.follow}</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
