import { useState, useEffect, useCallback } from "react";
import { useAuth }        from "../contexts/AuthContext";
import { useCallContext } from "../contexts/CallContext";
import { Phone, Video, UserPlus, UserCheck, Users, MessageSquare, Loader2, Bell } from "lucide-react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

const GOLD   = "#FFD700";
const GREEN  = "#22c55e";
const BASE   = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const api    = (p: string) => `${BASE()}${p}`;

/* ─── Types ─── */
interface Citizen {
  id: number; username: string; xp: number; balance: number;
  lastSeenAt?: string | null;
}

/* ─── Helpers ─── */
function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const colors = ["#e74c3c","#e67e22","#2ecc71","#3498db","#9b59b6","#1abc9c","#e91e63","#ff5722"];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: colors[name.charCodeAt(0) % colors.length],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, fontSize: size * 0.38, color: "#fff", flexShrink: 0,
    }}>
      {name[0].toUpperCase()}
    </div>
  );
}

function onlineStatus(ts?: string | null) {
  if (!ts) return { label: "غير متصل", color: "#555" };
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 5)  return { label: "● متصل",   color: GREEN };
  if (m < 30) return { label: "● مشغول",  color: GOLD  };
  return             { label: "○ غير متصل", color: "#555" };
}

/* ═══════════════════════════════════════════════════════════ */
export default function FriendsPage() {
  const { user }   = useAuth();
  const call       = useCallContext();

  const [tab,          setTab]          = useState<"friends" | "discover">("friends");
  const [friends,      setFriends]      = useState<Citizen[]>([]);
  const [allUsers,     setAllUsers]     = useState<Citizen[]>([]);
  const [friendIds,    setFriendIds]    = useState<Set<number>>(new Set());
  const [loading,      setLoading]      = useState(true);
  const [addingId,     setAddingId]     = useState<number | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);

  /* ─── incoming call banner ─── */
  const incoming = call.incomingCall;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  /* ─── Load friends (following) ─── */
  const loadFriends = useCallback(async () => {
    if (!user) return;
    const res = await fetch(api("/api/social/v2/following"), { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json() as { following: Citizen[] };
    const list = d.following ?? [];
    setFriends(list);
    setFriendIds(new Set(list.map(f => f.id)));
  }, [user]);

  /* ─── Load ALL users for discover ─── */
  const loadAllUsers = useCallback(async () => {
    if (!user) return;
    const res = await fetch(api("/api/citizens?limit=200"), { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json() as { citizens: Citizen[] };
    setAllUsers((d.citizens ?? []).filter(c => c.id !== user.id));
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    void Promise.all([loadFriends(), loadAllUsers()]).finally(() => setLoading(false));
  }, [user, loadFriends, loadAllUsers]);

  /* ─── Add friend ─── */
  const addFriend = async (username: string, id: number) => {
    setAddingId(id);
    try {
      await fetch(api(`/api/social/v2/follow/${encodeURIComponent(username)}`), {
        method: "POST", credentials: "include",
      });
      await loadFriends();
      showToast(`تمت إضافة @${username} ✅`);
    } finally { setAddingId(null); }
  };

  /* ─── Remove friend ─── */
  const removeFriend = async (username: string) => {
    await fetch(api(`/api/social/v2/follow/${encodeURIComponent(username)}`), {
      method: "DELETE", credentials: "include",
    });
    await loadFriends();
    showToast(`تم إزالة @${username}`);
  };

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#050505", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#fff" }}>
      <Users size={48} style={{ opacity: 0.2 }} />
      <p style={{ color: "#666" }}>سجّل دخولك للوصول لقائمة أصدقائك</p>
    </div>
  );

  const discoverList = allUsers.filter(u => !friendIds.has(u.id));

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir="rtl">

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", zIndex: 999,
              background: "#0a2a0a", border: `1px solid ${GREEN}50`, borderRadius: 12,
              padding: "10px 20px", color: GREEN, fontWeight: 700, fontSize: 13 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Incoming Call Banner ── */}
      <AnimatePresence>
        {incoming && (
          <motion.div initial={{ opacity: 0, y: -40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", top: 64, left: 0, right: 0, zIndex: 1000,
              background: "linear-gradient(90deg,#0a2a0a,#0d1f0d)", borderBottom: `2px solid ${GREEN}`,
              padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
            <Bell size={18} style={{ color: GREEN }} />
            <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>
              📞 مكالمة واردة من <span style={{ color: GREEN }}>@{incoming.from}</span>
              {incoming.video ? " (فيديو)" : " (صوتية)"}
            </span>
            <button onClick={() => call.answerCall()}
              style={{ background: GREEN, color: "#000", border: "none", borderRadius: 10, padding: "7px 18px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
              ✅ رد
            </button>
            <button onClick={() => call.rejectCall()}
              style={{ background: "#2a0a0a", color: "#f55", border: "1px solid #500", borderRadius: 10, padding: "7px 18px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
              ❌ رفض
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div style={{ background: "#0a0a0a", borderBottom: `1px solid ${GOLD}20`, padding: "28px 24px 0" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>
            <span style={{ color: GOLD }}>◈</span> الأصدقاء
          </h1>
          <p style={{ margin: "0 0 16px", color: "#ffffff40", fontSize: 12 }}>@{user.username}</p>

          {/* ── Tabs ── */}
          <div style={{ display: "flex", gap: 4 }}>
            {([
              { id: "friends",  icon: <Users size={13} />,   label: `أصدقائي (${friends.length})`           },
              { id: "discover", icon: <UserPlus size={13} />, label: `قائمة المستخدمين المتاحين (${discoverList.length})` },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13,
                background:     tab === t.id ? "#111"          : "transparent",
                color:          tab === t.id ? GOLD            : "#ffffff50",
                borderBottom:   tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
              }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Loader2 size={32} style={{ color: GOLD, animation: "spin 1s linear infinite" }} />
          </div>
        ) : tab === "friends" ? (
          /* ════ FRIENDS TAB ════ */
          friends.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
              <Users size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
              <p style={{ fontSize: 14 }}>لا تتابع أحداً بعد</p>
              <button onClick={() => setTab("discover")}
                style={{ marginTop: 12, background: `${GOLD}15`, border: `1px solid ${GOLD}30`,
                  borderRadius: 12, padding: "10px 24px", color: GOLD, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                اكتشف مواطنين ← 
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {friends.map(f => {
                const st = onlineStatus(f.lastSeenAt);
                return (
                  <motion.div key={f.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    style={{ display: "flex", alignItems: "center", gap: 14,
                      background: "#0d0d0d", border: `1px solid ${GOLD}18`,
                      borderRadius: 14, padding: "14px 16px" }}>
                    <Avatar name={f.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>@{f.username}</div>
                      <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600, color: st.color }}>{st.label}</div>
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {/* Message */}
                      <Link href="/messages">
                        <button title="رسالة" style={{ background: `${GOLD}12`, border: `1px solid ${GOLD}25`,
                          borderRadius: 10, padding: "7px 10px", cursor: "pointer", color: GOLD,
                          display: "flex", alignItems: "center" }}>
                          <MessageSquare size={14} />
                        </button>
                      </Link>
                      {/* Voice */}
                      <button onClick={() => call.startCall(f.username, false)} title="مكالمة صوتية"
                        style={{ background: "#0a2a0a", border: "1px solid #0a0",
                          borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "#0f0",
                          display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
                        <Phone size={14} /> <span>صوتي</span>
                      </button>
                      {/* Video */}
                      <button onClick={() => call.startCall(f.username, true)} title="مكالمة فيديو"
                        style={{ background: "#0a1a2a", border: "1px solid #09f",
                          borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "#09f",
                          display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
                        <Video size={14} /> <span>فيديو</span>
                      </button>
                      {/* Remove */}
                      <button onClick={() => void removeFriend(f.username)} title="إزالة"
                        style={{ background: "#1a0505", border: "1px solid #500",
                          borderRadius: 10, padding: "7px 10px", cursor: "pointer", color: "#f55",
                          display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700 }}>
                        <UserCheck size={13} /> إزالة
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )
        ) : (
          /* ════ DISCOVER TAB — ALL USERS AUTO-LOADED ════ */
          <>
            <p style={{ color: "#ffffff40", fontSize: 12, marginBottom: 14, textAlign: "center" }}>
              جميع المواطنين المسجّلين — اضغط «إضافة» لمتابعتهم وإجراء مكالمات
            </p>
            {discoverList.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
                <UserCheck size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
                <p>أضفت جميع المواطنين المتاحين 🎉</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {discoverList.map(c => (
                  <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    style={{ display: "flex", alignItems: "center", gap: 14,
                      background: "#0d0d0d", border: `1px solid #ffffff10`,
                      borderRadius: 14, padding: "14px 16px" }}>
                    <Avatar name={c.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>@{c.username}</div>
                      <div style={{ color: "#ffffff35", fontSize: 11, marginTop: 2 }}>
                        ⚡ {c.xp?.toLocaleString()} XP &nbsp;·&nbsp; 🪙 {c.balance?.toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => void addFriend(c.username, c.id)}
                      disabled={addingId === c.id}
                      style={{ background: addingId === c.id ? "#111" : `${GOLD}18`,
                        border: `1px solid ${GOLD}40`, borderRadius: 10,
                        padding: "8px 18px", cursor: addingId === c.id ? "default" : "pointer",
                        color: GOLD, fontSize: 12, fontWeight: 800,
                        display: "flex", alignItems: "center", gap: 6, opacity: addingId === c.id ? 0.5 : 1 }}>
                      {addingId === c.id
                        ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} />
                        : <><UserPlus size={13} /> إضافة</>}
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
