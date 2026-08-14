/**
 * Messenger — AMIS unified messenger (single source of truth for all surfaces)
 * Variants:
 *  - "full"     → /messages page (sidebar + chat, full height)
 *  - "embedded" → Social Hub messages tab
 *  - "widget"   → CommHub floating panel (single-pane, list ↔ chat)
 * All variants share: composer tools (upload, emoji, GIF, voice, contact,
 * drag&drop, paste), settings (notifications / read receipts / mute),
 * per-message actions (copy, delete own), calls + history, gold DS styling, RTL.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MessageSquare, Users, Phone, X, Mic, MicOff, History, PhoneMissed,
  PhoneCall, Video, Settings, Trash2, Copy, MoreVertical, BellOff, UserPlus, Search, Lock,
} from "lucide-react";
import Avatar from "../social/Avatar";
import { Switch } from "@workspace/gdna-ds/components/ui/switch";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { GOLD, timeAgo, api, SOCIAL_T } from "../social/social-i18n";
import { useCallContext } from "../../contexts/CallContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLang } from "../../contexts/LangContext";
import type { DmRoom, DmMessage, CallRecord } from "../social/social-types";

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: GOLD, color: "#000", borderRadius: 8, padding: "10px 20px", fontWeight: 700, fontSize: 13, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", whiteSpace: "nowrap", pointerEvents: "none" }}>
      {msg}
    </motion.div>
  );
}

// ── CallHistoryPanel ──────────────────────────────────────────────────────────
function CallHistoryPanel({ st, user, onClose }: { st: Record<string, string>; user: { id: number; username: string }; onClose: () => void }) {
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(api("/api/social/v2/call-history"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setRecords(j.records ?? []))
      .finally(() => setLoading(false));
  }, []);

  function statusIcon(r: CallRecord) {
    if (r.status === "missed")   return <PhoneMissed size={14} style={{ color: "#ef4444" }} />;
    if (r.status === "answered") return <PhoneCall   size={14} style={{ color: "#22c55e" }} />;
    return <Phone size={14} style={{ color: "#888" }} />;
  }
  const peer = (r: CallRecord) => r.callerId === user.id ? r.calleeUsername : r.callerUsername;
  const statusLabel = (s: string) =>
    s === "missed" ? (st.call_missed ?? "Missed") : s === "answered" ? (st.call_answered ?? "Answered") : (st.call_ended ?? "Ended");

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      style={{ position: "absolute", inset: 0, background: "#080808", zIndex: 10, display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${GOLD}10` }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${GOLD}10`, display: "flex", alignItems: "center", gap: 10 }}>
        <History size={16} style={{ color: GOLD }} />
        <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14, flex: 1 }}>{st.call_history ?? "Call History"}</p>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}><X size={16} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {loading && <div style={{ textAlign: "center", color: "#444", padding: 32 }}>…</div>}
        {!loading && records.length === 0 && (
          <div style={{ textAlign: "center", color: "#444", padding: 48 }}>
            <Phone size={32} style={{ opacity: 0.2, display: "block", margin: "0 auto 10px" }} />
            <p style={{ margin: 0, fontSize: 13 }}>{st.no_calls ?? "No call history yet"}</p>
          </div>
        )}
        {records.map(r => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderBottom: "1px solid #ffffff06" }}>
            <Avatar name={peer(r)} size={34} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 13 }}>{peer(r)}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                {statusIcon(r)}
                <span style={{ fontSize: 11, color: r.status === "missed" ? "#ef4444" : "#ffffff50" }}>{statusLabel(r.status)}</span>
                <span style={{ fontSize: 11, color: "#ffffff30" }}>·</span>
                <span style={{ fontSize: 11, color: "#ffffff40" }}>
                  {r.callType === "video"
                    ? <><Video size={10} style={{ display: "inline", marginRight: 2 }} />{st.call_video ?? "Video"}</>
                    : <><Phone size={10} style={{ display: "inline", marginRight: 2 }} />{st.call_audio ?? "Audio"}</>}
                </span>
                {r.durationSec > 0 && (
                  <>
                    <span style={{ fontSize: 11, color: "#ffffff30" }}>·</span>
                    <span style={{ fontSize: 11, color: "#ffffff40" }}>{Math.floor(r.durationSec / 60)}:{String(r.durationSec % 60).padStart(2, "0")}</span>
                  </>
                )}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 10, color: "#ffffff25" }}>{timeAgo(r.startedAt, st)}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────
interface MsgSettings { notifications: boolean; readReceipts: boolean }

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between w-full py-3 px-1 border-b border-border/40">
      <span className="text-foreground text-[13px] font-semibold">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function SettingsPanel({ st, activeRoom, onClose, onMuteChanged, showToast }: {
  st: Record<string, string>;
  activeRoom: DmRoom | null;
  onClose: () => void;
  onMuteChanged: (roomId: number, muted: boolean) => void;
  showToast: (m: string) => void;
}) {
  const [settings, setSettings] = useState<MsgSettings | null>(null);
  const [muted, setMuted] = useState(activeRoom?.muted ?? false);

  // Keep the toggle in sync with the room prop (updated after server confirms)
  useEffect(() => { setMuted(activeRoom?.muted ?? false); }, [activeRoom?.muted]);

  useEffect(() => {
    fetch(api("/api/messages/settings"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setSettings({ notifications: j.notifications ?? true, readReceipts: j.readReceipts ?? true }))
      .catch(() => setSettings({ notifications: true, readReceipts: true }));
  }, []);

  async function save(patch: Partial<MsgSettings>) {
    setSettings(s => s ? { ...s, ...patch } : s);
    const r = await fetch(api("/api/messages/settings"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch), credentials: "include",
    }).catch(() => null);
    if (r?.ok) showToast(st.settings_saved ?? "Saved ✅");
  }

  async function toggleMute() {
    if (!activeRoom) return;
    const next = !muted;
    setMuted(next);
    const r = await fetch(api(`/api/messages/rooms/${activeRoom.id}/mute`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted: next }), credentials: "include",
    }).catch(() => null);
    if (r?.ok) { onMuteChanged(activeRoom.id, next); showToast(st.settings_saved ?? "Saved ✅"); }
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      style={{ position: "absolute", inset: 0, background: "#080808", zIndex: 12, display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${GOLD}10` }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${GOLD}10`, display: "flex", alignItems: "center", gap: 10 }}>
        <Settings size={16} style={{ color: GOLD }} />
        <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14, flex: 1 }}>{st.msg_settings ?? "Messenger settings"}</p>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}><X size={16} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {!settings ? <div style={{ textAlign: "center", color: "#444", padding: 32 }}>…</div> : (
          <>
            <ToggleRow label={st.notif_pref ?? "Notifications"} value={settings.notifications}
              onChange={v => save({ notifications: v })} />
            <p className="mt-0.5 mb-1.5 mx-1 text-[10.5px] text-muted-foreground">{st.notif_hint ?? ""}</p>
            <ToggleRow label={st.read_receipts ?? "Read receipts"} value={settings.readReceipts}
              onChange={v => save({ readReceipts: v })} />
            <p className="mt-0.5 mb-1.5 mx-1 text-[10.5px] text-muted-foreground">{st.receipts_hint ?? ""}</p>
            {activeRoom && (
              <ToggleRow label={`${st.mute_conv ?? "Mute conversation"} · ${activeRoom.type === "group" ? (activeRoom.name ?? "Group") : ""}`.trim()}
                value={muted} onChange={toggleMute} />
            )}
            <div className="mt-4 flex items-center gap-1.5 text-muted-foreground text-[11px]">
              <Lock size={12} /> {st.server_encrypted ?? "Encrypted via server"}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Contacts panel (all citizens: DM / call / add friend) ────────────────────
interface Contact { id: number; username: string; lastSeenAt?: string | null }

function ContactsList({ st, user, onDm, onCall }: {
  st: Record<string, string>;
  user: { id: number; username: string };
  onDm: (username: string) => void;
  onCall: (username: string, video: boolean) => void;
}) {
  const call = useCallContext();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(api("/api/citizens?limit=200"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setContacts((j.citizens ?? []).filter((c: Contact) => c.id !== user.id)))
      .finally(() => setLoading(false));
  }, [user.id]);

  async function addFriend(username: string) {
    await fetch(api(`/api/social/v2/follow/${encodeURIComponent(username)}`), { method: "POST", credentials: "include" }).catch(() => {});
  }

  const filtered = contacts.filter(c => c.username.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ position: "relative", margin: "2px 0 4px" }}>
        <Search size={13} style={{ position: "absolute", top: 9, insetInlineStart: 10, color: "#555" }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={st.search_contacts ?? "Search…"}
          style={{ width: "100%", boxSizing: "border-box", background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "7px 10px 7px 30px", color: "#fff", fontSize: 12, outline: "none" }} />
      </div>
      {loading && <p style={{ color: "#444", fontSize: 12, textAlign: "center" }}>…</p>}
      {!loading && filtered.length === 0 && <p style={{ color: "#444", fontSize: 12, textAlign: "center", marginTop: 16 }}>{st.no_contacts ?? "No citizens found"}</p>}
      {filtered.map(c => {
        const online = call.onlineUsers.includes(c.username);
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", borderRadius: 8 }}>
            <div style={{ position: "relative" }}>
              <Avatar name={c.username} size={32} />
              {online && <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, background: "#22c55e", borderRadius: "50%", border: "2px solid #000" }} />}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.username}</p>
              <p style={{ margin: 0, fontSize: 10, color: online ? "#22c55e" : "#ffffff30" }}>{online ? (st.online ?? "Online") : (st.offline ?? "Offline")}</p>
            </div>
            <button onClick={() => onDm(c.username)} title={st.dm ?? "DM"}
              style={{ width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", background: `${GOLD}20`, color: GOLD, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MessageSquare size={13} />
            </button>
            <button onClick={() => onCall(c.username, false)} title={st.voice_call ?? "Call"}
              style={{ width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", background: "#22c55e20", color: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Phone size={13} />
            </button>
            <button onClick={() => addFriend(c.username)} title={st.add_friend ?? "Add friend"}
              style={{ width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", background: "#1a1a1a", color: "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <UserPlus size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Groups discovery (public group rooms with join) ──────────────────────────
interface GroupRoom { id: number; name?: string; type: string; icon?: string; memberCount?: number }

function GroupsList({ st, myRoomIds, onJoined, onOpen }: {
  st: Record<string, string>;
  myRoomIds: Set<number>;
  onJoined: (roomId: number) => void;
  onOpen: (roomId: number) => void;
}) {
  const [groups, setGroups] = useState<GroupRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<number | null>(null);

  useEffect(() => {
    fetch(api("/api/messages/group-rooms"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setGroups(j.rooms ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function join(roomId: number) {
    setJoining(roomId);
    try {
      const r = await fetch(api(`/api/messages/rooms/${roomId}/join`), { method: "POST", credentials: "include" });
      if (r.ok || r.status === 409) onJoined(roomId);
    } finally { setJoining(null); }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
      {loading && <p style={{ color: "#444", fontSize: 12, textAlign: "center" }}>…</p>}
      {!loading && groups.length === 0 && <p style={{ color: "#444", fontSize: 12, textAlign: "center", marginTop: 16 }}>{st.no_messages}</p>}
      {groups.map(g => {
        const isMember = myRoomIds.has(g.id);
        return (
          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 6px", borderRadius: 8 }}>
            <div style={{ width: 34, height: 34, background: "#222", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{g.icon ?? "👥"}</div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name ?? "Group"}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: "#ffffff35" }}>👥 {g.memberCount ?? 0}</p>
            </div>
            {isMember ? (
              <Button size="sm" variant="secondary" className="h-7 px-3 text-[11px]" onClick={() => onOpen(g.id)}>
                {st.dm ?? "Open"}
              </Button>
            ) : (
              <Button size="sm" className="h-7 px-3 text-[11px]" disabled={joining === g.id} onClick={() => join(g.id)}>
                {joining === g.id ? "…" : (st.join_group ?? "Join")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveUrl(url: string): string {
  return url.startsWith("/api/") ? api(url) : url;
}

const EMOJI_GROUPS: [string, string[]][] = [
  ["😀", ["😀","😃","😄","😁","😂","🤣","😊","😍","🥰","😘","😜","🤪","😎","🤩","🥳","😏","😢","😭","😡","🤬","😱","🥺","😴","🤔","🤫","🤗","😇","🙄","😬","🤯"]],
  ["👍", ["👍","👎","👏","🙏","💪","🤝","✌️","🤞","👊","✊","🖐️","👋","🫡","💅","🤙","👀","🧠","❤️","💛","💚","💙","🖤","💔","💯","✨","🔥","⚡","💥","🎉","🎊"]],
  ["👑", ["👑","🏆","🥇","🥈","🥉","⭐","🌟","💎","🏅","🎖️","⚔️","🛡️","🏰","🦁","🦅","🐉","🇲🇦","🌍","🚀","💰","🪙","📈","🎯","🧿","🕌","🌙","☀️","🌹","🗿","♾️"]],
  ["⚽", ["⚽","🏀","🎾","🏐","🎮","🕹️","🎲","♟️","🎵","🎶","🎤","🎧","🎸","🥁","🎬","🎥","📸","🍕","🍔","🌮","🍩","☕","🍵","🥤","🚗","✈️","⏰","📱","💻","📚"]],
];

// ── Main Messenger ────────────────────────────────────────────────────────────
export type MessengerVariant = "full" | "embedded" | "widget";

export default function Messenger({ variant = "embedded" }: { variant?: MessengerVariant }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const st  = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir = lang === "ar" ? "rtl" : "ltr";
  const call = useCallContext();

  const [rooms,       setRooms]       = useState<DmRoom[]>([]);
  const [sideTab,     setSideTab]     = useState<"chats" | "groups" | "contacts">("chats");
  const [activeRoom,  setActiveRoom]  = useState<DmRoom | null>(null);
  const [messages,    setMessages]    = useState<DmMessage[]>([]);
  const [text,        setText]        = useState("");
  const [sending,     setSending]     = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [newTarget,   setNewTarget]   = useState("");
  const [groupName,   setGroupName]   = useState("");
  const [isGroup,     setIsGroup]     = useState(false);
  const [recording,   setRecording]   = useState(false);
  const [showImgInput, setShowImgInput] = useState(false);
  const [imgUrl,      setImgUrl]      = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast,       setToast]       = useState("");
  const [uploading,   setUploading]   = useState(false);
  const [showEmoji,   setShowEmoji]   = useState(false);
  const [emojiGroup,  setEmojiGroup]  = useState(0);
  const [showGif,     setShowGif]     = useState(false);
  const [gifQuery,    setGifQuery]    = useState("");
  const [gifs,        setGifs]        = useState<{ id: string; url: string; preview: string; title: string }[]>([]);
  const [gifLoading,  setGifLoading]  = useState(false);
  const [pending,     setPending]     = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [dragOver,    setDragOver]    = useState(false);
  const [menuMsgId,   setMenuMsgId]   = useState<number | null>(null);
  const [isMobile,    setIsMobile]    = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef  = useRef<HTMLInputElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const endRef      = useRef<HTMLDivElement>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const isWidget = variant === "widget";
  // Widget behaves like mobile: single pane list ↔ chat
  const singlePane = isWidget || isMobile;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Load rooms ──────────────────────────────────────────────────────────────
  const loadRooms = useCallback(async (): Promise<DmRoom[]> => {
    if (!user) return [];
    const r = await fetch(api("/api/messages/rooms"), { credentials: "include" });
    const j = await r.json();
    const list: DmRoom[] = j.rooms ?? [];
    setRooms(list);
    return list;
  }, [user]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // ── Poll messages for active room ───────────────────────────────────────────
  useEffect(() => {
    if (!activeRoom) return;
    loadMessages(activeRoom.id);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(activeRoom.id), 3000);
    return () => clearInterval(pollRef.current);
  }, [activeRoom?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Screenshot detection in active DM ──────────────────────────────────────
  useEffect(() => {
    if (!activeRoom || variant !== "full") return;
    const handleVis = () => { if (document.visibilityState === "hidden") setToast(st.screenshot_warning ?? "⚠️ Screenshot may have been taken"); };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [activeRoom, st.screenshot_warning, variant]);

  async function loadMessages(roomId: number) {
    const r = await fetch(api(`/api/messages/rooms/${roomId}`), { credentials: "include" });
    const j = await r.json();
    setMessages(j.messages ?? []);
  }

  async function openRoom(room: DmRoom) {
    setShowHistory(false); setShowSettings(false);
    setActiveRoom(room);
    await loadMessages(room.id);
  }

  function getPeerName(room: DmRoom): string {
    if (room.type === "group") return room.name ?? "Group";
    const other = room.members.find(m => m.username !== user?.username);
    return other?.username ?? "Chat";
  }

  // Open a room by id from a FRESH rooms fetch so members are populated —
  // the POST /rooms response has no member list, which would break the peer
  // name ("Chat") and the call buttons in the chat header.
  async function openRoomById(roomId: number, fallback?: Partial<DmRoom>) {
    const list = await loadRooms();
    const found = list.find(r => r.id === roomId);
    if (found) openRoom(found);
    else if (fallback) openRoom({ members: [], unreadCount: 0, ...fallback, id: roomId } as DmRoom);
  }

  async function openDmWith(username: string) {
    const r = await fetch(api("/api/messages/rooms"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "direct", targetUsername: username }), credentials: "include",
    });
    if (r.ok) {
      const j = await r.json();
      setSideTab("chats");
      if (j.room) await openRoomById(j.room.id, j.room);
    }
  }

  async function sendMessage(audioUrl?: string, override?: object) {
    if (!activeRoom || (!text.trim() && !audioUrl && !imgUrl.trim() && !override) || sending) return;
    setSending(true);
    try {
      let body: object;
      if (override)            body = override;
      else if (audioUrl)       body = { audioUrl, type: "audio" };
      else if (imgUrl.trim())  body = { fileUrl: imgUrl.trim(), type: "file", content: "[Image]" };
      else                     body = { content: text.trim(), type: "text" };
      const r = await fetch(api(`/api/messages/rooms/${activeRoom.id}/send`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setMessages(prev => [...prev, j.message]);
        setText(""); setImgUrl(""); setShowImgInput(false);
        loadRooms();
      }
    } finally { setSending(false); }
  }

  async function deleteMessage(msgId: number) {
    if (!activeRoom) return;
    setMenuMsgId(null);
    const r = await fetch(api(`/api/messages/rooms/${activeRoom.id}/messages/${msgId}`), {
      method: "DELETE", credentials: "include",
    });
    if (r.ok) {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setToast(st.msg_deleted ?? "Message deleted");
      loadRooms();
    } else {
      const j = await r.json().catch(() => ({} as { error?: string }));
      setToast(j.error ?? "❌");
    }
  }

  function copyMessage(msg: DmMessage) {
    setMenuMsgId(null);
    const t = msg.content ?? msg.fileUrl ?? msg.audioUrl ?? "";
    navigator.clipboard?.writeText(t).then(() => setToast(st.copied ?? "Copied!")).catch(() => {});
  }

  async function uploadAndSend(file: File | Blob, fallbackName = "attachment") {
    if (!activeRoom || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file instanceof File ? file.name : `${fallbackName}.webm`);
      const r = await fetch(api("/api/messages/upload"), { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setToast(j.error ?? "فشل رفع الملف ❌");
        return;
      }
      const j = await r.json() as { url: string; kind: string; name: string };
      const body =
        j.kind === "audio" ? { audioUrl: j.url, type: "audio" } :
        j.kind === "video" ? { videoUrl: j.url, type: "video" } :
        { fileUrl: j.url, type: "file", content: j.kind === "image" ? "[Image]" : `📁 ${j.name}` };
      await sendMessage(undefined, body);
    } finally { setUploading(false); }
  }

  async function searchGifs(q: string) {
    setGifLoading(true);
    try {
      const r = await fetch(api(`/api/gifs/search?q=${encodeURIComponent(q)}`), { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setToast(j.error ?? "فشل البحث عن GIF ❌"); setGifs([]); return; }
      setGifs(j.gifs ?? []);
    } catch { setToast("فشل البحث عن GIF ❌"); }
    finally { setGifLoading(false); }
  }

  function toggleGif() {
    setShowGif(v => {
      const next = !v;
      if (next) { setShowEmoji(false); if (gifs.length === 0) searchGifs(""); }
      return next;
    });
  }

  async function sendGif(url: string) {
    setShowGif(false);
    await sendMessage(undefined, { fileUrl: url, type: "file", content: "[GIF]" });
  }

  function stageFile(f: File) {
    if (f.size > 25 * 1024 * 1024) { setToast("الحد الأقصى 25MB ⚠️"); return; }
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    const isMedia = f.type.startsWith("image/") || f.type.startsWith("video/");
    setPending({ file: f, previewUrl: isMedia ? URL.createObjectURL(f) : null });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) stageFile(f);
  }

  async function confirmPending() {
    if (!pending) return;
    const p = pending;
    setPending(null);
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    await uploadAndSend(p.file);
  }

  function cancelPending() {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && activeRoom) stageFile(f);
  }

  function onPaste(e: React.ClipboardEvent) {
    const f = Array.from(e.clipboardData.files ?? [])[0];
    if (f) { e.preventDefault(); stageFile(f); }
  }

  async function pickContact() {
    const nav = navigator as Navigator & { contacts?: { select: (p: string[], o?: { multiple?: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> } };
    if (!nav.contacts?.select) { setToast("اختيار جهات الاتصال متاح فقط على الهاتف 📱"); return; }
    try {
      const [c] = await nav.contacts.select(["name", "tel"]);
      if (c) {
        const card = `👤 ${c.name?.[0] ?? "جهة اتصال"}${c.tel?.[0] ? ` — 📞 ${c.tel[0]}` : ""}`;
        await sendMessage(undefined, { content: card, type: "text" });
      }
    } catch { /* user cancelled */ }
  }

  async function startNewChat() {
    if (!newTarget.trim() && !isGroup) return;
    const body = isGroup
      ? { type: "group", roomName: groupName || "Group", icon: "👥" }
      : { type: "direct", targetUsername: newTarget.trim() };
    const r = await fetch(api("/api/messages/rooms"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "include",
    });
    if (r.ok) {
      const j = await r.json();
      setShowNew(false); setNewTarget(""); setGroupName("");
      if (j.room) await openRoomById(j.room.id, j.room);
      else await loadRooms();
    }
  }

  async function startVoiceNote() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current   = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        uploadAndSend(blob, "voice-note");
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    } catch { /* mic denied */ }
  }

  function stopVoiceNote() { recorderRef.current?.stop(); }

  if (!user) return (
    <div style={{ textAlign: "center", padding: isWidget ? 30 : 60, color: "#444" }} dir={dir}>
      <MessageSquare size={36} style={{ opacity: 0.2, display: "block", margin: "0 auto 12px" }} />
      <p style={{ margin: 0, fontSize: 14 }}>{st.login_required}</p>
    </div>
  );

  const containerHeight =
    variant === "full"     ? "calc(100dvh - 160px)" :
    variant === "embedded" ? "calc(100dvh - 280px)" : "100%";

  // Single-pane surfaces (widget, mobile) show exactly ONE pane at a time:
  // the overlays (history/settings) live in the chat pane, so the sidebar
  // must yield to them or they render at zero width.
  const overlayOpen = showHistory || showSettings;
  const showSidebar = !singlePane || (!activeRoom && !overlayOpen);
  const showChat    = !singlePane || !!activeRoom || overlayOpen;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div dir={dir} style={{ display: "flex", gap: singlePane ? 0 : 12, height: containerHeight, minHeight: isWidget ? 0 : 440, overscrollBehavior: "none" }}>
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        {showSidebar && (
        <div style={{ width: singlePane ? "100%" : 250, minWidth: singlePane ? 0 : 190, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          {/* Action buttons */}
          <div style={{ display: "flex", gap: 5 }}>
            <button onClick={() => { setIsGroup(false); setShowNew(true); }}
              style={{ flex: 1, padding: "7px 0", borderRadius: 8, background: GOLD, border: "none", color: "#000", fontWeight: 800, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <MessageSquare size={11} />{st.dm}
            </button>
            <button onClick={() => { setIsGroup(true); setShowNew(true); }}
              style={{ flex: 1, padding: "7px 0", borderRadius: 8, background: "#1a1a1a", border: `1px solid ${GOLD}20`, color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <Users size={11} />{st.new_group}
            </button>
            <button onClick={() => { setShowHistory(v => !v); setShowSettings(false); setActiveRoom(null); }}
              title={st.call_history ?? "Call History"}
              style={{ width: 34, padding: "7px 0", borderRadius: 8, background: showHistory ? `${GOLD}20` : "#1a1a1a", border: `1px solid ${showHistory ? GOLD : `${GOLD}20`}`, color: showHistory ? GOLD : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={13} />
            </button>
            <button onClick={() => { setShowSettings(v => !v); setShowHistory(false); if (singlePane) setActiveRoom(null); }}
              title={st.msg_settings ?? "Settings"}
              style={{ width: 34, padding: "7px 0", borderRadius: 8, background: showSettings ? `${GOLD}20` : "#1a1a1a", border: `1px solid ${showSettings ? GOLD : `${GOLD}20`}`, color: showSettings ? GOLD : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Settings size={13} />
            </button>
          </div>

          {/* chats | groups | contacts tabs */}
          <div style={{ display: "flex", gap: 4 }}>
            {([["chats", st.chats ?? "Chats"], ["groups", st.groups ?? "Groups"], ["contacts", st.contacts ?? "Contacts"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSideTab(key)}
                style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800,
                  background: sideTab === key ? `${GOLD}20` : "transparent", color: sideTab === key ? GOLD : "#777" }}>
                {label}
              </button>
            ))}
          </div>

          {/* New chat form */}
          {showNew && (
            <div className="rounded-lg border border-border bg-card p-2.5">
              {isGroup
                ? <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={st.group_name} dir={dir} className="h-8 text-xs" />
                : <Input value={newTarget} onChange={e => setNewTarget(e.target.value)} placeholder="Username…" className="h-8 text-xs" />
              }
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" className="h-7 flex-1 text-[11px]" onClick={startNewChat}>
                  {isGroup ? st.create_group : st.send}
                </Button>
                <Button size="sm" variant="secondary" className="h-7 px-2"
                  onClick={() => { setShowNew(false); setNewTarget(""); setGroupName(""); }}>
                  <X size={11} />
                </Button>
              </div>
            </div>
          )}

          {/* Room list / contacts */}
          {sideTab === "contacts" ? (
            <ContactsList st={st} user={user} onDm={openDmWith} onCall={(u, v) => call.startCall(u, v)} />
          ) : sideTab === "groups" ? (
            <GroupsList st={st} myRoomIds={new Set(rooms.map(r => r.id))}
              onJoined={roomId => { setSideTab("chats"); openRoomById(roomId); }}
              onOpen={roomId => { setSideTab("chats"); openRoomById(roomId); }} />
          ) : (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
            {rooms.length === 0 && (
              <p style={{ color: "#444", fontSize: 12, textAlign: "center", marginTop: 20 }}>{st.no_messages}</p>
            )}
            {rooms.map(room => {
              const peerName = getPeerName(room);
              const isActive = activeRoom?.id === room.id;
              const isOnline = room.type === "direct" && call.onlineUsers.includes(peerName);
              return (
                <button key={room.id} onClick={() => openRoom(room)}
                  style={{ textAlign: "start", padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: isActive ? `${GOLD}15` : "transparent", display: "flex", gap: 8, alignItems: "center", width: "100%", transition: "background 0.15s" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {room.type === "group"
                      ? <div style={{ width: 34, height: 34, background: "#222", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{room.icon ?? "👥"}</div>
                      : <Avatar name={peerName} size={34} />
                    }
                    {isOnline && (
                      <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, background: "#22c55e", borderRadius: "50%", border: "2px solid #000" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                      <p style={{ margin: 0, fontWeight: 700, color: isActive ? GOLD : "#fff", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                        {peerName}
                        {room.muted && <BellOff size={11} style={{ color: "#666", flexShrink: 0 }} />}
                      </p>
                      {room.unreadCount > 0 && !room.muted && (
                        <span style={{ background: "#ef4444", color: "#fff", borderRadius: 9, padding: "1px 5px", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                          {room.unreadCount}
                        </span>
                      )}
                    </div>
                    {room.lastMessage && (
                      <p style={{ margin: 0, color: "#ffffff35", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {room.lastMessage.type === "audio" ? "🎤 Voice note" : room.lastMessage.type === "file" ? "🖼 Image" : room.lastMessage.content}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          )}
        </div>
        )}

        {/* ── Chat window ─────────────────────────────────────────────── */}
        {showChat && (
        <div
          onDragOver={e => { e.preventDefault(); if (activeRoom) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={isMobile && activeRoom && !isWidget
            ? { position: "fixed", inset: 0, height: "100dvh", zIndex: 100, display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden", overscrollBehavior: "none" }
            : { flex: 1, display: "flex", flexDirection: "column", background: "#080808", border: `1px solid ${dragOver ? GOLD : `${GOLD}10`}`, borderRadius: 12, overflow: "hidden", position: "relative", transition: "border-color 0.15s", minWidth: 0 }}>
          {/* Drag overlay */}
          {dragOver && (
            <div style={{ position: "absolute", inset: 0, background: "#000000cc", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
              <span style={{ fontSize: 40 }}>📎</span>
              <p style={{ margin: 0, color: GOLD, fontWeight: 800, fontSize: 15 }}>أفلت الملف هنا للإرسال</p>
            </div>
          )}
          <AnimatePresence>
            {showHistory && <CallHistoryPanel st={st} user={user} onClose={() => setShowHistory(false)} />}
            {showSettings && (
              <SettingsPanel st={st} activeRoom={activeRoom} onClose={() => setShowSettings(false)}
                onMuteChanged={(roomId, muted) => {
                  setRooms(prev => prev.map(r => r.id === roomId ? { ...r, muted } : r));
                  setActiveRoom(prev => prev && prev.id === roomId ? { ...prev, muted } : prev);
                  loadRooms(); // re-sync from server so all mounted surfaces agree
                }}
                showToast={setToast} />
            )}
          </AnimatePresence>

          {!activeRoom && !showHistory && !showSettings ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#333" }}>
              <MessageSquare size={40} />
              <p style={{ margin: 0, fontSize: 14 }}>{st.no_messages}</p>
            </div>
          ) : activeRoom ? (
            <>
              {/* Chat header */}
              <div style={{ padding: "11px 14px", borderBottom: `1px solid ${GOLD}10`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {singlePane && (
                  <button onClick={() => setActiveRoom(null)} title={st.back ?? "Back"}
                    style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: "#1a1a1a", color: GOLD, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {dir === "rtl" ? "›" : "‹"}
                  </button>
                )}
                <Avatar name={getPeerName(activeRoom)} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getPeerName(activeRoom)}
                    {activeRoom.muted && <BellOff size={12} style={{ color: "#666", flexShrink: 0 }} />}
                  </p>
                  <p style={{ margin: 0, fontSize: 10.5, color: "#ffffff30", display: "flex", alignItems: "center", gap: 5, overflow: "hidden", whiteSpace: "nowrap" }}>
                    <span style={{ color: activeRoom.type === "direct" && call.onlineUsers.includes(getPeerName(activeRoom)) ? "#22c55e" : "#ffffff30" }}>
                      {activeRoom.type === "direct"
                        ? (call.onlineUsers.includes(getPeerName(activeRoom)) ? `● ${st.online}` : st.offline)
                        : (st.groups ?? "Group")}
                    </span>
                    <span>·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Lock size={9} />{st.server_encrypted ?? "Encrypted via server"}</span>
                  </p>
                </div>
                {activeRoom.type === "direct" && (
                  <div style={{ display: "flex", gap: 5 }}>
                    <button onClick={() => call.startCall(getPeerName(activeRoom), false)} title={st.voice_call}
                      style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: "#22c55e20", color: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      📞
                    </button>
                    <button onClick={() => call.startCall(getPeerName(activeRoom), true)} title={st.video_call}
                      style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: "#3b82f620", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      🎥
                    </button>
                  </div>
                )}
                <button onClick={() => setShowSettings(true)} title={st.msg_settings ?? "Settings"}
                  style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: "#1a1a1a", color: "#888", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Settings size={14} />
                </button>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}
                onClick={() => setMenuMsgId(null)}>
                {messages.map(msg => {
                  const mine = msg.username === user.username;
                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6, position: "relative" }}>
                      {!mine && <Avatar name={msg.username} size={24} />}
                      <div style={{ maxWidth: "70%", background: mine ? GOLD : "#1a1a1a", borderRadius: mine ? "14px 14px 2px 14px" : "14px 14px 14px 2px", padding: "8px 12px", userSelect: "text", WebkitUserSelect: "text", position: "relative" }}>
                        {!mine && <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: GOLD }}>{msg.username}</p>}
                        {msg.type === "audio" && msg.audioUrl ? (
                          <audio controls src={resolveUrl(msg.audioUrl)} style={{ maxWidth: 200, height: 36 }} />
                        ) : msg.type === "video" && msg.videoUrl ? (
                          <video controls src={resolveUrl(msg.videoUrl)} style={{ maxWidth: 220, maxHeight: 220, borderRadius: 6, display: "block" }} />
                        ) : msg.type === "file" && msg.fileUrl && msg.content?.startsWith("📁") ? (
                          <a href={resolveUrl(msg.fileUrl)} target="_blank" rel="noreferrer"
                            style={{ color: mine ? "#000" : GOLD, fontSize: 13, fontWeight: 700, wordBreak: "break-word" }}>
                            {msg.content}
                          </a>
                        ) : msg.type === "file" && msg.fileUrl ? (
                          <img src={resolveUrl(msg.fileUrl)} alt="attachment" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6, display: "block" }}
                            onError={e => { (e.target as HTMLImageElement).alt = "Image unavailable"; }} />
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: mine ? "#000" : "#e5e7eb", wordBreak: "break-word" }} dir={dir}>{msg.content}</p>
                        )}
                        <p style={{ margin: "4px 0 0", fontSize: 10, color: mine ? "#00000060" : "#ffffff30", textAlign: "right" }}>
                          {timeAgo(msg.createdAt, st)}
                        </p>
                      </div>
                      {/* Message action menu trigger */}
                      <button onClick={e => { e.stopPropagation(); setMenuMsgId(v => v === msg.id ? null : msg.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#555", padding: 2, alignSelf: "center", flexShrink: 0 }}>
                        <MoreVertical size={13} />
                      </button>
                      {menuMsgId === msg.id && (
                        <div onClick={e => e.stopPropagation()}
                          className="absolute bottom-full z-30 min-w-[120px] overflow-hidden rounded-md border border-border bg-popover shadow-lg"
                          style={{ insetInlineEnd: mine ? 0 : "auto", insetInlineStart: mine ? "auto" : 30 }}>
                          {(msg.content || msg.fileUrl || msg.audioUrl) && (
                            <button onClick={() => copyMessage(msg)}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-popover-foreground hover:bg-accent">
                              <Copy size={12} /> {st.copy_msg ?? "Copy"}
                            </button>
                          )}
                          {mine && (
                            <button onClick={() => deleteMessage(msg.id)}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-destructive hover:bg-accent">
                              <Trash2 size={12} /> {st.delete_msg ?? "Delete"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              {/* Image URL input row */}
              {showImgInput && (
                <div style={{ padding: "6px 12px", borderTop: `1px solid ${GOLD}08`, display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={imgUrl} onChange={e => setImgUrl(e.target.value)}
                    placeholder={st.image_url ?? "Paste image URL…"} dir={dir}
                    style={{ flex: 1, background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 12, outline: "none" }} />
                  <button onClick={() => { setShowImgInput(false); setImgUrl(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}><X size={14} /></button>
                </div>
              )}

              {/* Emoji panel */}
              {showEmoji && (
                <div style={{ borderTop: `1px solid ${GOLD}08` }}>
                  <div style={{ display: "flex", gap: 4, padding: "6px 12px 0" }}>
                    {EMOJI_GROUPS.map(([icon], i) => (
                      <button key={icon} onClick={() => setEmojiGroup(i)}
                        style={{ background: emojiGroup === i ? `${GOLD}25` : "none", border: "none", fontSize: 16, cursor: "pointer", padding: "3px 8px", borderRadius: 6, lineHeight: 1 }}>
                        {icon}
                      </button>
                    ))}
                  </div>
                  <div style={{ padding: "6px 12px 8px", display: "flex", flexWrap: "wrap", gap: 2, maxHeight: 120, overflowY: "auto" }}>
                    {EMOJI_GROUPS[emojiGroup][1].map(e => (
                      <button key={e} onClick={() => setText(t => t + e)}
                        style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", padding: 3, lineHeight: 1 }}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* GIF panel */}
              {showGif && (
                <div style={{ borderTop: `1px solid ${GOLD}08` }}>
                  <div style={{ display: "flex", gap: 6, padding: "8px 12px 4px", alignItems: "center" }}>
                    <input value={gifQuery} onChange={e => setGifQuery(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchGifs(gifQuery)}
                      placeholder="🎬 قلب على GIF…" dir={dir}
                      style={{ flex: 1, background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 12, outline: "none" }} />
                    <button onClick={() => searchGifs(gifQuery)} disabled={gifLoading}
                      style={{ background: `${GOLD}25`, border: "none", borderRadius: 8, padding: "6px 12px", color: GOLD, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                      {gifLoading ? "⏳" : "بحث"}
                    </button>
                  </div>
                  <div style={{ padding: "4px 12px 8px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                    {gifs.map(g => (
                      <button key={g.id} onClick={() => sendGif(g.url)} title={g.title}
                        style={{ background: "#111", border: `1px solid ${GOLD}10`, borderRadius: 6, padding: 0, cursor: "pointer", overflow: "hidden", height: 70 }}>
                        <img src={g.preview} alt={g.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </button>
                    ))}
                    {!gifLoading && gifs.length === 0 && (
                      <p style={{ gridColumn: "1/-1", margin: 0, fontSize: 12, color: "#666", textAlign: "center", padding: 8 }}>ما كاين حتى GIF — جرب كلمة أخرى</p>
                    )}
                  </div>
                </div>
              )}

              {/* Attachment preview before sending */}
              {pending && (
                <div style={{ padding: "10px 14px", borderTop: `1px solid ${GOLD}08`, display: "flex", gap: 10, alignItems: "center" }}>
                  {pending.previewUrl && pending.file.type.startsWith("image/") ? (
                    <img src={pending.previewUrl} alt="preview" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8, border: `1px solid ${GOLD}30` }} />
                  ) : pending.previewUrl ? (
                    <video src={pending.previewUrl} style={{ maxWidth: 140, maxHeight: 120, borderRadius: 8, border: `1px solid ${GOLD}30` }} muted />
                  ) : (
                    <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#ddd" }}>📁 {pending.file.name}</div>
                  )}
                  <div style={{ flex: 1, fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pending.file.name} · {(pending.file.size / 1024 / 1024).toFixed(1)}MB
                  </div>
                  <button onClick={confirmPending} disabled={uploading} title={st.send}
                    style={{ width: 38, height: 38, borderRadius: "50%", background: GOLD, border: "none", color: "#000", cursor: "pointer", fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                    ➤
                  </button>
                  <button onClick={cancelPending} title="إلغاء"
                    style={{ width: 32, height: 32, borderRadius: "50%", background: "#1a1a1a", border: "none", color: "#ef4444", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Uploading indicator */}
              {uploading && (
                <div style={{ padding: "6px 14px", borderTop: `1px solid ${GOLD}08`, fontSize: 12, color: GOLD }}>
                  ⏳ {st.uploading ?? "جاري رفع الملف…"}
                </div>
              )}

              {/* Hidden pickers */}
              <input ref={galleryRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={onPickFile} />
              <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPickFile} />
              <input ref={fileRef}    type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx" style={{ display: "none" }} onChange={onPickFile} />

              {/* Toolbar + input bar */}
              <div style={{ padding: "10px 12px", paddingBottom: "calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${GOLD}08`, display: "flex", gap: 5, alignItems: "center", flexShrink: 0, flexWrap: "nowrap", overflowX: "auto", position: "sticky", bottom: 0, background: "#080808", zIndex: 25 }}>
                {(((singlePane)
                  ? [
                      ["📎", st.attach_file ?? "صور وفيديو وملفات",   () => fileRef.current?.click()],
                      ["😀", st.attach_emoji ?? "ايموجي",             () => { setShowGif(false); setShowEmoji(v => !v); }],
                      ["🎬", "GIF",                                    toggleGif],
                    ]
                  : [
                      ["📎", st.attach_gallery ?? "معرض الصور والفيديو", () => galleryRef.current?.click()],
                      ["📷", st.attach_camera ?? "كاميرا",               () => cameraRef.current?.click()],
                      ["👤", st.attach_contact ?? "جهات الاتصال",         pickContact],
                      ["😀", st.attach_emoji ?? "ايموجي",                 () => { setShowGif(false); setShowEmoji(v => !v); }],
                      ["🎬", "GIF",                                        toggleGif],
                      ["📁", st.attach_file ?? "ملفات",                   () => fileRef.current?.click()],
                    ]) as [string, string, () => void][]).map(([icon, title, fn]) => (
                  <button key={icon} onClick={fn} title={title} disabled={uploading}
                    style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: (icon === "😀" && showEmoji) || (icon === "🎬" && showGif) ? `${GOLD}25` : "#1a1a1a", fontSize: 15,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      opacity: uploading ? 0.5 : 1 }}>
                    {icon}
                  </button>
                ))}
                {/* Voice note */}
                <button onClick={recording ? stopVoiceNote : startVoiceNote}
                  title={recording ? st.stop_recording : st.record_voice}
                  style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: recording ? "#ef4444" : "#1a1a1a", color: recording ? "#fff" : "#888", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {recording ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
                {/* Text input */}
                <input value={text} onChange={e => setText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  onPaste={onPaste}
                  placeholder={st.type_message} dir={dir} disabled={recording}
                  style={{ flex: 1, background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 20, padding: "8px 14px", color: "#fff", fontSize: 13, outline: "none", minWidth: 100 }} />
                {/* Send — gold */}
                <button onClick={() => sendMessage()}
                  disabled={(!text.trim() && !imgUrl.trim()) || sending}
                  title={st.send}
                  style={{ width: 36, height: 36, borderRadius: "50%", background: (text.trim() || imgUrl.trim()) ? GOLD : "#1a1a1a", border: "none", color: (text.trim() || imgUrl.trim()) ? "#000" : "#444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16, fontWeight: 800 }}>
                  ➤
                </button>
              </div>
            </>
          ) : null}
        </div>
        )}
      </div>

      <AnimatePresence>
        {toast && <Toast msg={toast} onDone={() => setToast("")} />}
      </AnimatePresence>
    </>
  );
}
