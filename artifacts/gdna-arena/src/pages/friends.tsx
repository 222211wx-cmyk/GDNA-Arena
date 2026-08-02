/**
 * AMIS / الأصدقاء — complete rewrite
 * Fix: removed BASE_URL helper — API calls use /api/... directly (no prefix)
 * Layout: two stacked sections, no tabs, no extra buttons
 *   Section 1 — أصدقائي   : friends list  + 📞 📹 💬 remove
 *   Section 2 — جميع المستخدمين : all other users  + 📞 📹 إضافة
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth }        from "../contexts/AuthContext";
import { useCallContext } from "../contexts/CallContext";
import { Phone, Video, UserPlus, Users, MessageSquare, Loader2, Bell, UserCheck } from "lucide-react";
import { useLocation }    from "wouter";
import { motion, AnimatePresence } from "framer-motion";

const GOLD  = "#FFD700";
const GREEN = "#22c55e";

interface Citizen {
  id: number; username: string; xp: number; balance: number;
  lastSeenAt?: string | null;
}

const COLORS = ["#e74c3c","#e67e22","#27ae60","#2980b9","#8e44ad","#16a085","#c0392b","#d35400"];

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const bg = COLORS[(name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, fontSize: Math.round(size * 0.38), color: "#fff",
      boxShadow: `0 0 0 2px #111, 0 0 0 3.5px ${bg}55`,
    }}>
      {name[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function StatusBadge({ lastSeenAt }: { lastSeenAt?: string | null }) {
  if (!lastSeenAt) return <span style={{ fontSize: 11, color: "#555" }}>○ غير متصل</span>;
  const m = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (m < 5)  return <span style={{ fontSize: 11, color: GREEN,  fontWeight: 700 }}>● متصل الآن</span>;
  if (m < 30) return <span style={{ fontSize: 11, color: GOLD,   fontWeight: 700 }}>● مشغول</span>;
  const ago = m < 60 ? `${m} د` : m < 1440 ? `${Math.floor(m/60)} س` : `${Math.floor(m/1440)} ي`;
  return <span style={{ fontSize: 11, color: "#666" }}>○ آخر ظهور {ago}</span>;
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 14px" }}>
      <div style={{ flex: 1, height: 1, background: "#ffffff10" }} />
      <span style={{ color: GOLD, fontWeight: 900, fontSize: 12, letterSpacing: 1 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#ffffff10" }} />
    </div>
  );
}

/* ── Small icon action button ── */
function ActBtn({
  icon, label, color, bg, border, onClick, disabled,
}: {
  icon: React.ReactNode; label?: string; color: string;
  bg: string; border: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: bg, border, borderRadius: 10,
        padding: label ? "7px 12px" : "8px 10px",
        cursor: disabled ? "default" : "pointer",
        color, display: "flex", alignItems: "center", gap: 5,
        fontSize: 12, fontWeight: 700, opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}>
      {icon}{label}
    </button>
  );
}

export default function FriendsPage() {
  const { user, loading: authLoading } = useAuth();
  const call        = useCallContext();
  const [, navigate] = useLocation();

  const [friends,    setFriends]    = useState<Citizen[]>([]);
  const [allUsers,   setAllUsers]   = useState<Citizen[]>([]);
  const [friendIds,  setFriendIds]  = useState<Set<number>>(new Set());
  const [pageLoading, setPageLoading] = useState(false);
  const [addingId,   setAddingId]   = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [dmLoadingId,setDmLoadingId]= useState<number | null>(null);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);

  const incoming = call.incomingCall;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Load all data — always use /api/... directly (no BASE_URL prefix) ── */
  const loadData = useCallback(async () => {
    if (!user) return;
    setPageLoading(true);
    try {
      const [fRes, cRes] = await Promise.all([
        fetch("/api/social/v2/following",  { credentials: "include" }),
        fetch("/api/citizens?limit=200",   { credentials: "include" }),
      ]);
      const fData = fRes.ok ? (await fRes.json() as { following: Citizen[] }) : { following: [] };
      const cData = cRes.ok ? (await cRes.json() as { citizens: Citizen[] })  : { citizens: [] };

      const list = fData.following ?? [];
      const ids  = new Set(list.map(f => f.id));
      setFriends(list);
      setFriendIds(ids);
      // exclude self, exclude already-friends
      setAllUsers((cData.citizens ?? []).filter(c => c.id !== user.id));
    } finally {
      setPageLoading(false);
    }
  }, [user]);

  useEffect(() => { void loadData(); }, [loadData]);

  /* ── Add friend ── */
  const addFriend = async (c: Citizen) => {
    setAddingId(c.id);
    try {
      const res = await fetch(`/api/social/v2/follow/${encodeURIComponent(c.username)}`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) { await loadData(); showToast(`✅ تمت إضافة @${c.username}`); }
      else        { showToast("تعذّر الإضافة، حاول مجدداً", false); }
    } finally { setAddingId(null); }
  };

  /* ── Remove friend ── */
  const removeFriend = async (c: Citizen) => {
    setRemovingId(c.id);
    try {
      await fetch(`/api/social/v2/follow/${encodeURIComponent(c.username)}`, {
        method: "DELETE", credentials: "include",
      });
      await loadData();
      showToast(`تم إزالة @${c.username}`);
    } finally { setRemovingId(null); }
  };

  /* ── Open DM ── */
  const openDM = async (c: Citizen) => {
    setDmLoadingId(c.id);
    try {
      await fetch("/api/messages/rooms", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUsername: c.username, type: "direct" }),
      });
      navigate("/messages");
    } catch { showToast("تعذّر فتح المحادثة", false); }
    finally  { setDmLoadingId(null); }
  };

  /* ── Auth loading ── */
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#050505", display: "flex",
      alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={36} style={{ color: GOLD, animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  /* ── Not logged in ── */
  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#050505", display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14, color: "#fff" }}>
      <Users size={52} style={{ opacity: 0.15 }} />
      <p style={{ color: "#888", fontSize: 14 }}>سجّل دخولك للوصول لقائمة أصدقائك</p>
      <button onClick={() => navigate("/login")}
        style={{ background: GOLD, color: "#000", border: "none", borderRadius: 12,
          padding: "10px 32px", fontWeight: 900, cursor: "pointer", fontSize: 14 }}>
        تسجيل الدخول
      </button>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const discoverList = allUsers.filter(u => !friendIds.has(u.id));

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir="rtl">

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
              background: toast.ok ? "#071a07" : "#1a0707",
              border: `1px solid ${toast.ok ? GREEN : "#f44"}60`,
              borderRadius: 12, padding: "10px 24px",
              color: toast.ok ? GREEN : "#f44",
              fontWeight: 700, fontSize: 13, whiteSpace: "nowrap",
              boxShadow: `0 4px 24px ${toast.ok ? GREEN : "#f44"}25` }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Incoming call banner ── */}
      <AnimatePresence>
        {incoming && (
          <motion.div initial={{ opacity: 0, y: -50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", top: 60, left: 0, right: 0, zIndex: 1000,
              background: "#071a07", borderBottom: `2px solid ${GREEN}`,
              padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <Bell size={16} style={{ color: GREEN, flexShrink: 0 }} />
            <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>
              📞 مكالمة واردة من <span style={{ color: GREEN }}>@{incoming.from}</span>
              {incoming.video ? " · فيديو" : " · صوتية"}
            </span>
            <button onClick={() => call.answerCall()}
              style={{ background: GREEN, color: "#000", border: "none", borderRadius: 9,
                padding: "7px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>✅ رد</button>
            <button onClick={() => call.rejectCall()}
              style={{ background: "#1a0505", color: "#f55", border: "1px solid #500",
                borderRadius: 9, padding: "7px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>❌ رفض</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div style={{ background: "#080808", borderBottom: `1px solid ${GOLD}18`, padding: "22px 24px 18px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>
            <span style={{ color: GOLD }}>◈</span> الأصدقاء
          </h1>
          <p style={{ margin: 0, color: "#ffffff30", fontSize: 12 }}>@{user.username}</p>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "22px 20px" }}>

        {pageLoading ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Loader2 size={34} style={{ color: GOLD, animation: "spin 1s linear infinite" }} />
            <p style={{ color: "#555", marginTop: 10, fontSize: 13 }}>جارٍ التحميل...</p>
          </div>
        ) : (
          <>
            {/* ══ SECTION 1: أصدقائي ══ */}
            <SectionTitle label={`👥 أصدقائي (${friends.length})`} />

            {friends.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0 32px",
                background: "#0a0a0a", borderRadius: 14, border: "1px dashed #ffffff12",
                color: "#555", fontSize: 13, marginBottom: 28 }}>
                <Users size={32} style={{ opacity: 0.1, marginBottom: 8 }} />
                <p style={{ margin: 0 }}>لا أصدقاء بعد — أضف من القائمة أدناه 👇</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 28 }}>
                {friends.map(f => (
                  <motion.div key={f.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                    style={{ display: "flex", alignItems: "center", gap: 13,
                      background: "#0d0d0d", border: `1px solid ${GOLD}18`,
                      borderRadius: 14, padding: "12px 14px" }}>
                    <Avatar name={f.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>@{f.username}</div>
                      <StatusBadge lastSeenAt={f.lastSeenAt} />
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActBtn icon={<MessageSquare size={14} />} label="رسالة"
                        color={GOLD} bg={`${GOLD}12`} border={`1px solid ${GOLD}30`}
                        onClick={() => void openDM(f)} disabled={dmLoadingId === f.id} />
                      <ActBtn icon={<Phone size={14} />} label="صوتي"
                        color={GREEN} bg="#071a07" border={`1px solid ${GREEN}50`}
                        onClick={() => call.startCall(f.username, false)} />
                      <ActBtn icon={<Video size={14} />} label="فيديو"
                        color="#09f" bg="#07101a" border="1px solid #09f5"
                        onClick={() => call.startCall(f.username, true)} />
                      <ActBtn icon={removingId === f.id ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <UserCheck size={13} />}
                        color="#f44" bg="#130303" border="1px solid #400"
                        onClick={() => void removeFriend(f)} disabled={removingId === f.id} />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ══ SECTION 2: جميع المستخدمين ══ */}
            <SectionTitle label={`🌐 جميع المستخدمين (${discoverList.length})`} />

            {discoverList.length === 0 && !pageLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 13 }}>
                <UserCheck size={32} style={{ opacity: 0.12, marginBottom: 8 }} />
                <p style={{ margin: 0 }}>أضفت جميع المستخدمين المتاحين 🎉</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {discoverList.map(c => (
                  <motion.div key={c.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                    style={{ display: "flex", alignItems: "center", gap: 13,
                      background: "#0b0b0b", border: "1px solid #ffffff0c",
                      borderRadius: 14, padding: "12px 14px" }}>
                    {/* Photo ronde */}
                    <Avatar name={c.username} />
                    {/* Nom + statut */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>@{c.username}</div>
                      <StatusBadge lastSeenAt={c.lastSeenAt} />
                    </div>
                    {/* Actions: 📞 📹 + إضافة */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActBtn icon={<Phone size={14} />}
                        color={GREEN} bg="#071a07" border={`1px solid ${GREEN}40`}
                        onClick={() => call.startCall(c.username, false)} />
                      <ActBtn icon={<Video size={14} />}
                        color="#09f" bg="#07101a" border="1px solid #09f4"
                        onClick={() => call.startCall(c.username, true)} />
                      <ActBtn
                        icon={addingId === c.id
                          ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} />
                          : <UserPlus size={13} />}
                        label={addingId === c.id ? "" : "إضافة"}
                        color={GOLD} bg={`${GOLD}15`} border={`1px solid ${GOLD}40`}
                        onClick={() => void addFriend(c)} disabled={addingId === c.id} />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
