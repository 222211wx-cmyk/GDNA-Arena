/**
 * Messenger — AMIS unified messenger, WhatsApp-style layout (single source of truth)
 * Variants:
 *  - "full"     → /messages page (WhatsApp-like app: bottom tabs + full-page chat)
 *  - "embedded" → Social Hub messages tab
 *  - "widget"   → CommHub floating panel
 * Structure:
 *  - 4 fixed bottom tabs: Discussions | Actus | Communautés | Appels
 *  - Chat = full page: header (avatar+name+call) / messages with date separators /
 *    big RTL-friendly composer with 5 fixed buttons: camera, image, file, voice, emoji
 *  - No GIPHY. Keyboard-stable (dvh + interactive-widget=resizes-content).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  MessageSquare, Users, Phone, X, Mic, History, PhoneMissed, Square,
  PhoneCall, Video, Settings, Trash2, Copy, MoreVertical, BellOff, Search, Lock,
  Camera, Image as ImageIcon, Paperclip, Smile, Send, Newspaper, Plus, ArrowLeft, ArrowRight, Wifi, LoaderCircle,
  FileImage,
} from "lucide-react";
import Avatar from "../social/Avatar";
import { Switch } from "@workspace/gdna-ds/components/ui/switch";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { GOLD, timeAgo, api, SOCIAL_T } from "../social/social-i18n";
import { useCallContext } from "../../contexts/CallContext";
import { useAuth, type AuthUser } from "../../contexts/AuthContext";
import { useLang } from "../../contexts/LangContext";
import type { DmRoom, DmMessage, CallRecord } from "../social/social-types";
const BG      = "#0a0a0a";   // app background
const BG_BAR  = "#111111";   // header / tab bars
const BG_CHAT = "#050505";   // chat wallpaper
const BUBBLE_OTHER = "#1e1e1e";

// Server rate limit: 15 uploads / 10 minutes — mirror it client-side for a friendly message.
const UPLOAD_BATCH_LIMIT = 15;

// A file staged in the pre-send preview strip.
interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "staged" | "uploading" | "error";
  progress: number; // 0–100 (upload phase only)
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: GOLD, color: "#000", borderRadius: 8, padding: "10px 20px", fontWeight: 700, fontSize: 13, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", whiteSpace: "nowrap", pointerEvents: "none" }}>
      {msg}
    </motion.div>
  );
}

// ── Date separators ───────────────────────────────────────────────────────────
function dayKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(iso: string, lang: string) {
  const d = new Date(iso), now = new Date();
  const today = dayKey(now.toISOString()) === dayKey(iso);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y.toISOString()) === dayKey(iso);
  if (today) return lang === "ar" ? "اليوم" : lang === "fr" ? "Aujourd'hui" : "Today";
  if (yesterday) return lang === "ar" ? "أمس" : lang === "fr" ? "Hier" : "Yesterday";
  return d.toLocaleDateString(lang === "ar" ? "ar-MA" : lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function SettingsPanel({ st, activeRoom, onClose, onMuteChanged, onRoomDeleted, showToast }: {
  st: Record<string, string>;
  activeRoom: DmRoom | null;
  onClose: () => void;
  onMuteChanged: (roomId: number, muted: boolean) => void;
  onRoomDeleted: (roomId: number) => void;
  showToast: (m: string) => void;
}) {
  const [settings, setSettings] = useState<MsgSettings | null>(null);
  const [muted, setMuted] = useState(activeRoom?.muted ?? false);
  const [deletingConversation, setDeletingConversation] = useState(false);

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

  async function deleteConversation() {
    if (!activeRoom || deletingConversation) return;
    const confirmMessage = st.delete_conversation_confirm
      ?? "Delete this conversation from your messages? The other member keeps their copy.";
    if (!window.confirm(confirmMessage)) return;

    setDeletingConversation(true);
    const r = await fetch(api(`/api/messages/rooms/${activeRoom.id}`), {
      method: "DELETE", credentials: "include",
    }).catch(() => null);
    if (r?.ok) {
      onRoomDeleted(activeRoom.id);
      showToast(st.conversation_deleted ?? "Conversation deleted");
    } else {
      const j = await r?.json().catch(() => ({} as { error?: string }));
      showToast(j?.error ?? "❌");
    }
    setDeletingConversation(false);
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      style={{ position: "absolute", inset: 0, background: BG, zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", background: BG_BAR, borderBottom: `1px solid ${GOLD}12`, display: "flex", alignItems: "center", gap: 10 }}>
        <Settings size={17} style={{ color: GOLD }} />
        <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 15, flex: 1 }}>{st.msg_settings ?? "Messenger settings"}</p>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", padding: 6 }}><X size={18} /></button>
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
            {activeRoom && (
              <div className="mt-5 border-t border-border/40 pt-4">
                <Button type="button" variant="destructive" className="w-full justify-start gap-2"
                  disabled={deletingConversation} onClick={deleteConversation}>
                  <Trash2 size={15} />
                  {deletingConversation
                    ? (st.deleting_conversation ?? "Deleting conversation…")
                    : (st.delete_conversation ?? "Delete conversation")}
                </Button>
                <p className="mt-2 px-1 text-[10.5px] text-muted-foreground">
                  {st.delete_conversation_hint ?? "This removes the conversation from your messages only."}
                </p>
              </div>
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

// ── Contacts panel ────────────────────────────────────────────────────────────
interface Contact { id: number; username: string; lastSeenAt?: string | null }

function ContactsPanel({ st, user, title, onClose, onDm, onCall, callMode }: {
  st: Record<string, string>;
  user: { id: number; username: string };
  title: string;
  onClose: () => void;
  onDm: (username: string) => void;
  onCall: (username: string, video: boolean) => void;
  callMode?: boolean;
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

  const filtered = contacts.filter(c => c.username.toLowerCase().includes(q.toLowerCase()));

  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
      style={{ position: "absolute", inset: 0, background: BG, zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", background: BG_BAR, borderBottom: `1px solid ${GOLD}12`, display: "flex", alignItems: "center", gap: 10 }}>
        <Users size={17} style={{ color: GOLD }} />
        <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 15, flex: 1 }}>{title}</p>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", padding: 6 }}><X size={18} /></button>
      </div>
      <div style={{ padding: "10px 14px" }}>
        <div style={{ position: "relative" }}>
          <Search size={15} style={{ position: "absolute", top: 12, insetInlineStart: 12, color: "#555" }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={st.search_contacts ?? "Search…"} dir="auto"
            style={{ width: "100%", boxSizing: "border-box", background: "#161616", border: `1px solid ${GOLD}15`, borderRadius: 12, padding: "10px 12px", paddingInlineStart: 36, color: "#fff", fontSize: 15, outline: "none" }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
        {loading && <p style={{ color: "#444", fontSize: 13, textAlign: "center", padding: 24 }}>…</p>}
        {!loading && filtered.length === 0 && <p style={{ color: "#444", fontSize: 13, textAlign: "center", marginTop: 24 }}>{st.no_contacts ?? "No citizens found"}</p>}
        {filtered.map(c => {
          const online = call.onlineUsers.includes(c.username);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderBottom: "1px solid #ffffff08" }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Avatar name={c.username} size={44} />
                {online && <div style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, background: "#22c55e", borderRadius: "50%", border: "2px solid #000" }} />}
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.username}</p>
                <p style={{ margin: 0, fontSize: 12, color: online ? "#22c55e" : "#ffffff35" }}>{online ? (st.online ?? "Online") : (st.offline ?? "Offline")}</p>
              </div>
              {callMode ? (
                <>
                  <button onClick={() => { onClose(); onCall(c.username, false); }} title={st.voice_call ?? "Call"}
                    style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: "#22c55e20", color: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Phone size={17} />
                  </button>
                  <button onClick={() => { onClose(); onCall(c.username, true); }} title={st.video_call ?? "Video"}
                    style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: "#3b82f620", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Video size={17} />
                  </button>
                </>
              ) : (
                <button onClick={() => { onClose(); onDm(c.username); }} title={st.dm ?? "DM"}
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: `${GOLD}20`, color: GOLD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MessageSquare size={17} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Actus (Empire Pulse feed, read-only) ─────────────────────────────────────
interface PulsePost { id: number; username: string; content: string; domain?: string; createdAt: string }

function ActusTab({ st }: { st: Record<string, string> }) {
  const [posts, setPosts] = useState<PulsePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(api("/api/pulse/feed?limit=25"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setPosts(j.posts ?? []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 16px" }}>
      <a href="/pulse" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: `${GOLD}10`, border: `1px solid ${GOLD}25`, borderRadius: 12, textDecoration: "none", marginBottom: 10 }}>
        <Newspaper size={18} style={{ color: GOLD }} />
        <span style={{ color: GOLD, fontWeight: 800, fontSize: 14 }}>Empire Pulse — {st.open ?? "فتح"}</span>
      </a>
      {loading && <p style={{ color: "#444", textAlign: "center", padding: 24 }}>…</p>}
      {failed && <p style={{ color: "#666", textAlign: "center", padding: 24, fontSize: 13 }}>{st.no_messages}</p>}
      {posts.map(p => (
        <div key={p.id} style={{ display: "flex", gap: 10, padding: "12px 4px", borderBottom: "1px solid #ffffff08" }}>
          <Avatar name={p.username} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14 }}>{p.username}</p>
              <span style={{ fontSize: 11, color: "#ffffff30", flexShrink: 0 }}>{timeAgo(p.createdAt, st)}</span>
            </div>
            <p style={{ margin: "3px 0 0", color: "#d5d5d5", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word" }} dir="auto">{p.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Communautés ───────────────────────────────────────────────────────────────
interface GroupRoom { id: number; name?: string; type: string; icon?: string; memberCount?: number }

function CommunautesTab({ st, myRoomIds, onJoined, onOpen, onCreate }: {
  st: Record<string, string>;
  myRoomIds: Set<number>;
  onJoined: (roomId: number) => void;
  onOpen: (roomId: number) => void;
  onCreate: () => void;
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
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 16px" }}>
      <button onClick={onCreate}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: `${GOLD}10`, border: `1px solid ${GOLD}25`, borderRadius: 12, cursor: "pointer", marginBottom: 10 }}>
        <Plus size={18} style={{ color: GOLD }} />
        <span style={{ color: GOLD, fontWeight: 800, fontSize: 14 }}>{st.new_group ?? "New group"}</span>
      </button>
      {loading && <p style={{ color: "#444", textAlign: "center", padding: 24 }}>…</p>}
      {!loading && groups.length === 0 && <p style={{ color: "#444", fontSize: 13, textAlign: "center", marginTop: 24 }}>{st.no_messages}</p>}
      {groups.map(g => {
        const isMember = myRoomIds.has(g.id);
        return (
          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: "1px solid #ffffff08" }}>
            <div style={{ width: 44, height: 44, background: "#222", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{g.icon ?? "👥"}</div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name ?? "Group"}</p>
              <p style={{ margin: 0, fontSize: 12, color: "#ffffff35" }}>👥 {g.memberCount ?? 0}</p>
            </div>
            {isMember ? (
              <Button size="sm" variant="secondary" className="h-8 px-4 text-xs" onClick={() => onOpen(g.id)}>
                {st.dm ?? "Open"}
              </Button>
            ) : (
              <Button size="sm" className="h-8 px-4 text-xs" disabled={joining === g.id} onClick={() => join(g.id)}>
                {joining === g.id ? "…" : (st.join_group ?? "Join")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Appels ────────────────────────────────────────────────────────────────────
function AppelsTab({ st, user, onNewCall, connectionTest, onTestConnection }: {
  st: Record<string, string>;
  user: { id: number; username: string };
  onNewCall: () => void;
  connectionTest: "idle" | "testing" | "ready" | "unstable" | "failed";
  onTestConnection: () => void;
}) {
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(api("/api/social/v2/call-history"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setRecords(j.records ?? []))
      .finally(() => setLoading(false));
  }, []);

  const peer = (r: CallRecord) => r.callerId === user.id ? r.calleeUsername : r.callerUsername;
  const statusLabel = (s: string) =>
    s === "missed" ? (st.call_missed ?? "Missed") : s === "answered" ? (st.call_answered ?? "Answered") : (st.call_ended ?? "Ended");
  const connectionResult = connectionTest === "ready"
    ? { label: "Agora path ready for a call", className: "border-chart-3/40 bg-chart-3/10 text-chart-3" }
    : connectionTest === "unstable"
      ? { label: "Network is unstable — call quality may be affected", className: "border-primary/40 bg-primary/10 text-primary" }
      : connectionTest === "failed"
        ? { label: "Unable to reach Agora — try another network", className: "border-destructive/40 bg-destructive/10 text-destructive" }
        : null;

  function statusIcon(r: CallRecord) {
    if (r.status === "missed")   return <PhoneMissed size={14} style={{ color: "#ef4444" }} />;
    if (r.status === "answered") return <PhoneCall   size={14} style={{ color: "#22c55e" }} />;
    return <Phone size={14} style={{ color: "#888" }} />;
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 16px" }}>
      <div className="mb-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-card-foreground">Call connection</p>
            <p className="m-0 text-xs text-muted-foreground">Check your Agora call path before dialing.</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={onTestConnection} disabled={connectionTest === "testing"}>
            {connectionTest === "testing" && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            {connectionTest === "testing" ? "Testing…" : "Test connection"}
          </Button>
        </div>
        {connectionResult && (
          <div className={`mt-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-semibold ${connectionResult.className}`}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
            <span>{connectionResult.label}</span>
          </div>
        )}
      </div>
      <button onClick={onNewCall}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#22c55e12", border: "1px solid #22c55e30", borderRadius: 12, cursor: "pointer", marginBottom: 10 }}>
        <Phone size={18} style={{ color: "#22c55e" }} />
        <span style={{ color: "#22c55e", fontWeight: 800, fontSize: 14 }}>{st.voice_call ?? "New call"}</span>
      </button>
      {loading && <p style={{ color: "#444", textAlign: "center", padding: 24 }}>…</p>}
      {!loading && records.length === 0 && (
        <div style={{ textAlign: "center", color: "#444", padding: 48 }}>
          <History size={32} style={{ opacity: 0.2, display: "block", margin: "0 auto 10px" }} />
          <p style={{ margin: 0, fontSize: 13 }}>{st.no_calls ?? "No call history yet"}</p>
        </div>
      )}
      {records.map(r => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: "1px solid #ffffff08" }}>
          <Avatar name={peer(r)} size={44} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 15 }}>{peer(r)}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              {statusIcon(r)}
              <span style={{ fontSize: 12, color: r.status === "missed" ? "#ef4444" : "#ffffff50" }}>{statusLabel(r.status)}</span>
              <span style={{ fontSize: 12, color: "#ffffff30" }}>·</span>
              <span style={{ fontSize: 12, color: "#ffffff40" }}>
                {r.callType === "video" ? (st.call_video ?? "Video") : (st.call_audio ?? "Audio")}
              </span>
              {r.durationSec > 0 && (
                <>
                  <span style={{ fontSize: 12, color: "#ffffff30" }}>·</span>
                  <span style={{ fontSize: 12, color: "#ffffff40" }}>{Math.floor(r.durationSec / 60)}:{String(r.durationSec % 60).padStart(2, "0")}</span>
                </>
              )}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "#ffffff25" }}>{timeAgo(r.startedAt, st)}</p>
        </div>
      ))}
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

type BottomTab = "discussions" | "actus" | "communautes" | "appels";

const TAB_LABELS: Record<BottomTab, string> = {
  discussions: "Discussions",
  actus: "Actus",
  communautes: "Communautés",
  appels: "Appels",
};

// ── Main Messenger ────────────────────────────────────────────────────────────
export type MessengerVariant = "full" | "embedded" | "widget";

export default function Messenger({ variant = "embedded" }: { variant?: MessengerVariant }) {
  const { user } = useAuth();
  // A citizen identity is a hard state boundary. Remounting the complete AMIS
  // surface on login/logout/account switch guarantees that no room, message,
  // unread count, draft, upload, or panel from the previous citizen survives
  // for even one rendered frame.
  return (
    <IdentityBoundMessenger
      key={user ? `citizen:${user.id}` : "anonymous"}
      user={user}
      variant={variant}
    />
  );
}

function IdentityBoundMessenger({ variant, user }: {
  variant: MessengerVariant;
  user: AuthUser | null;
}) {
  const { lang } = useLang();
  const st  = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir = lang === "ar" ? "rtl" : "ltr";
  const call = useCallContext();

  const [tab,         setTab]         = useState<BottomTab>("discussions");
  const [rooms,       setRooms]       = useState<DmRoom[]>([]);
  const [roomQuery,   setRoomQuery]   = useState("");
  const [activeRoom,  setActiveRoom]  = useState<DmRoom | null>(null);
  const [messages,    setMessages]    = useState<DmMessage[]>([]);
  const [text,        setText]        = useState("");
  const [sending,     setSending]     = useState(false);
  const [showGroupNew, setShowGroupNew] = useState(false);
  const [groupName,   setGroupName]   = useState("");
  const [recording,   setRecording]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showContacts, setShowContacts] = useState<false | "dm" | "call">(false);
  const [toast,       setToast]       = useState("");
  const [uploading,   setUploading]   = useState(false);
  const [showEmoji,   setShowEmoji]   = useState(false);
  const [emojiGroup,  setEmojiGroup]  = useState(0);
  const [pending,     setPending]     = useState<PendingFile[]>([]);
  const [dragOver,    setDragOver]    = useState(false);
  const [menuMsgId,   setMenuMsgId]   = useState<number | null>(null);
  const [isMobile,    setIsMobile]    = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const pendingRef = useRef<PendingFile[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef  = useRef<HTMLInputElement>(null);
  const gifRef     = useRef<HTMLInputElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const activeUploadsRef = useRef<Set<XMLHttpRequest>>(new Set());
  const recCancelledRef = useRef(false);
  const chunksRef   = useRef<Blob[]>([]);
  const mountedRef  = useRef(true);
  const activeRoomIdRef = useRef<number | null>(null);
  const endRef      = useRef<HTMLDivElement>(null);
  const textRef     = useRef<HTMLTextAreaElement>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const isWidget = variant === "widget";

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Unmount cleanup: stop any live recording (mic!) and drop its delayed upload.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recCancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch { /* already stopped */ }
      recStreamRef.current?.getTracks().forEach(t => t.stop());
      for (const xhr of activeUploadsRef.current) xhr.abort();
      activeUploadsRef.current.clear();
      for (const item of pendingRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  // Keep the view pinned to the newest message when the mobile keyboard
  // opens/closes (visualViewport resize) so the screen doesn't "jump".
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onVV = () => { endRef.current?.scrollIntoView({ block: "end" }); };
    vv.addEventListener("resize", onVV);
    return () => vv.removeEventListener("resize", onVV);
  }, []);

  // ── Load rooms ──────────────────────────────────────────────────────────────
  const loadRooms = useCallback(async (): Promise<DmRoom[]> => {
    if (!user) return [];
    const r = await fetch(api("/api/messages/rooms"), { credentials: "include" });
    if (!r.ok) return [];
    const j = await r.json();
    const list: DmRoom[] = j.rooms ?? [];
    if (mountedRef.current) setRooms(list);
    return list;
  }, [user?.id]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // Keep every mounted Messenger surface in sync when one removes a room.
  useEffect(() => {
    const onRoomDeleted = (event: Event) => {
      const roomId = (event as CustomEvent<{ roomId?: number }>).detail?.roomId;
      if (typeof roomId !== "number") return;
      setRooms(prev => prev.filter(room => room.id !== roomId));
      if (activeRoomIdRef.current === roomId) {
        activeRoomIdRef.current = null;
        setActiveRoom(null);
        setMessages([]);
        setShowSettings(false);
        setShowEmoji(false);
        setMenuMsgId(null);
      }
    };
    window.addEventListener("amis:room-deleted", onRoomDeleted);
    return () => window.removeEventListener("amis:room-deleted", onRoomDeleted);
  }, []);

  const removeRoomFromAllSurfaces = useCallback((roomId: number) => {
    window.dispatchEvent(new CustomEvent("amis:room-deleted", { detail: { roomId } }));
  }, []);

  const appendMessage = useCallback((message: DmMessage) => {
    setMessages(prev => {
      if (prev.some(existing => existing.id === message.id)) return prev;
      return [...prev, message].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
  }, []);

  // Realtime events come from CallProvider's one authenticated /api/ws
  // connection. The server has already checked room membership; client-side
  // room/id checks simply keep this Messenger instance scoped to its open room.
  useEffect(() => {
    const onMessage = (event: Event) => {
      const detail = (event as CustomEvent<{
        roomId?: number;
        message?: DmMessage;
        recipientUserId?: number;
      }>).detail;
      if (!detail?.message) return;
      if (typeof detail.recipientUserId === "number" && detail.recipientUserId !== user?.id) return;
      if (detail.roomId === activeRoomIdRef.current) {
        appendMessage(detail.message);
        void loadMessages(detail.roomId);
      }
      void loadRooms();
    };
    const onReconnect = () => {
      void loadRooms();
      if (activeRoomIdRef.current !== null) void loadMessages(activeRoomIdRef.current);
    };
    window.addEventListener("gdna:chat-message", onMessage);
    window.addEventListener("gdna:realtime-connected", onReconnect);
    return () => {
      window.removeEventListener("gdna:chat-message", onMessage);
      window.removeEventListener("gdna:realtime-connected", onReconnect);
    };
  }, [appendMessage, loadRooms, user?.id]);

  // REST is for the initial view, reconnect recovery, and a quiet fallback if a
  // browser misses an event — not the visible delivery mechanism.
  useEffect(() => {
    if (!activeRoom) return;
    loadMessages(activeRoom.id);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(activeRoom.id), 30_000);
    return () => clearInterval(pollRef.current);
  }, [activeRoom?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadMessages(roomId: number) {
    const r = await fetch(api(`/api/messages/rooms/${roomId}`), { credentials: "include" });
    if (!r.ok) return;
    const j = await r.json();
    // Only commit if this room is still the active one (guards stale responses
    // from a previously opened room resolving late) and we're still mounted.
    if (mountedRef.current && activeRoomIdRef.current === roomId) {
      setMessages(j.messages ?? []);
      if (Array.isArray(j.members)) {
        setActiveRoom(prev => prev?.id === roomId ? { ...prev, members: j.members } : prev);
      }
    }
  }

  async function openRoom(room: DmRoom) {
    setShowSettings(false); setShowContacts(false); setShowEmoji(false);
    activeRoomIdRef.current = room.id;
    setMessages([]);
    setActiveRoom(room);
    await loadMessages(room.id);
  }

  function getPeerName(room: DmRoom): string {
    if (room.type === "group") return room.name ?? "Group";
    const other = room.members.find(m => m.username !== user?.username);
    return other?.username ?? "Chat";
  }

  // Open a room by id from a FRESH rooms fetch so members are populated.
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
      setTab("discussions");
      if (j.room) await openRoomById(j.room.id, j.room);
    }
  }

  async function createGroup() {
    const r = await fetch(api("/api/messages/rooms"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "group", roomName: groupName || "Group", icon: "👥" }), credentials: "include",
    });
    if (r.ok) {
      const j = await r.json();
      setShowGroupNew(false); setGroupName("");
      if (j.room) await openRoomById(j.room.id, j.room);
      else await loadRooms();
    }
  }

  async function sendMessage(override?: object) {
    if (!activeRoom || (!text.trim() && !override) || sending) return;
    setSending(true);
    try {
      const body: object = override ?? { content: text.trim(), type: "text" };
      const roomId = activeRoom.id;
      const r = await fetch(api(`/api/messages/rooms/${roomId}/send`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        if (mountedRef.current && activeRoomIdRef.current === roomId) appendMessage(j.message);
        if (!override) { setText(""); if (textRef.current) textRef.current.style.height = "auto"; }
        loadRooms();
      } else {
        const j = await r.json().catch(() => ({} as { error?: string }));
        if (j.error) setToast(j.error);
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

  // Upload one file/blob with real progress events (XHR — fetch has no upload progress).
  function uploadWithProgress(file: File | Blob, fallbackName: string, onProgress: (pct: number) => void) {
    return new Promise<{ ok: boolean; status: number; json: any }>((resolve) => {
      const fd = new FormData();
      fd.append("file", file, file instanceof File ? file.name : `${fallbackName}.webm`);
      const xhr = new XMLHttpRequest();
      activeUploadsRef.current.add(xhr);
      xhr.open("POST", api("/api/messages/upload"));
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        activeUploadsRef.current.delete(xhr);
        let json: any = {};
        try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
      };
      xhr.onerror = () => {
        activeUploadsRef.current.delete(xhr);
        resolve({ ok: false, status: 0, json: {} });
      };
      xhr.onabort = () => {
        activeUploadsRef.current.delete(xhr);
        resolve({ ok: false, status: 0, json: {} });
      };
      xhr.send(fd);
    });
  }

  async function uploadAndSend(file: File | Blob, fallbackName = "attachment", onProgress: (pct: number) => void = () => {}) {
    if (!activeRoom) return false;
    const r = await uploadWithProgress(file, fallbackName, onProgress);
    if (!mountedRef.current) return false;
    if (!r.ok) {
      setToast(r.status === 429
        ? (r.json.error ?? (st.upload_limit ?? "تجاوزت الحد المسموح من الملفات — حاول بعد قليل ⏳"))
        : (r.json.error ?? "فشل رفع الملف ❌"));
      return false;
    }
    const j = r.json as { url: string; kind: string; name: string };
    const body =
      j.kind === "audio" ? { audioUrl: j.url, type: "audio" } :
      j.kind === "video" ? { videoUrl: j.url, type: "video" } :
      { fileUrl: j.url, type: "file", content: j.kind === "image" ? "[Image]" : `📁 ${j.name}` };
    await sendMessage(body);
    return true;
  }

  // Stage one or more files into the pre-send preview strip.
  function stageFiles(files: File[]) {
    if (!files.length) return;
    const staged: PendingFile[] = [];
    let tooBig = 0;
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { tooBig++; continue; }
      const isMedia = f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/");
      staged.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        previewUrl: isMedia ? URL.createObjectURL(f) : null,
        status: "staged",
        progress: 0,
      });
    }
    if (tooBig) setToast("الحد الأقصى 25MB ⚠️");
    setPending(prev => {
      const room = UPLOAD_BATCH_LIMIT - prev.length;
      if (staged.length > room) {
        setToast(st.upload_limit_batch ?? `يمكن إرسال ${UPLOAD_BATCH_LIMIT} ملفاً كحد أقصى كل 10 دقائق 📎`);
        staged.slice(room).forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      }
      return [...prev, ...staged.slice(0, Math.max(0, room))];
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    stageFiles(files);
  }

  // Upload every staged file sequentially with per-file progress, then clear.
  async function confirmPending() {
    if (uploading) return;
    setUploading(true);
    try {
      // Snapshot the queue; new stages during upload wait for the next batch.
      const queue = pendingRef.current.filter(p => p.status !== "uploading");
      for (const item of queue) {
        // Skip files the user removed while earlier ones were uploading.
        if (!pendingRef.current.some(p => p.id === item.id)) continue;
        setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "uploading", progress: 0 } : p));
        const ok = await uploadAndSend(item.file, "attachment",
          pct => setPending(prev => prev.map(p => p.id === item.id ? { ...p, progress: pct } : p)));
        if (ok) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          setPending(prev => prev.filter(p => p.id !== item.id));
        } else {
          setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "error", progress: 0 } : p));
          // Rate-limited: stop hammering the server; remaining files stay staged.
          break;
        }
      }
    } finally { setUploading(false); }
  }

  function removePending(id: string) {
    setPending(prev => {
      const item = prev.find(p => p.id === id);
      if (item?.status === "uploading") return prev; // can't cancel mid-flight
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }

  function cancelPending() {
    setPending(prev => {
      prev.forEach(p => { if (p.previewUrl && p.status !== "uploading") URL.revokeObjectURL(p.previewUrl); });
      return prev.filter(p => p.status === "uploading");
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length && activeRoom) stageFiles(files);
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length) { e.preventDefault(); stageFiles(files); }
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
        recStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (recCancelledRef.current || !mountedRef.current) return; // unmounted: drop, never upload
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          stageFiles([new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" })]);
        }
      };
      recStreamRef.current = stream;
      recCancelledRef.current = false;
      rec.start();
      setRecording(true);
    } catch { setToast("تعذّر الوصول إلى الميكروفون — تحقق من الإذن أو الجهاز ⚠️"); }
  }

  function stopVoiceNote(discard = false) {
    recCancelledRef.current = discard;
    recStreamRef.current?.getTracks().forEach(track => track.stop());
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else setRecording(false);
  }

  // A call must take precedence over a voice-note capture. useCall dispatches
  // this event just before it validates the microphone.
  useEffect(() => {
    const stopForCall = () => stopVoiceNote(true);
    window.addEventListener("gdna:voice-note-stop", stopForCall);
    return () => window.removeEventListener("gdna:voice-note-stop", stopForCall);
  });

  function autoGrow() {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  // group messages by day for separators
  const grouped = useMemo(() => {
    const out: { label: string; msgs: DmMessage[] }[] = [];
    let lastKey = "";
    for (const m of messages) {
      const k = dayKey(m.createdAt);
      if (k !== lastKey) { out.push({ label: dayLabel(m.createdAt, lang), msgs: [m] }); lastKey = k; }
      else out[out.length - 1].msgs.push(m);
    }
    return out;
  }, [messages, lang]);

  const totalUnread = rooms.reduce((n, r) => n + (r.muted ? 0 : r.unreadCount), 0);

  if (!user) return (
    <div style={{ textAlign: "center", padding: isWidget ? 30 : 60, color: "#444" }} dir={dir}>
      <MessageSquare size={36} style={{ opacity: 0.2, display: "block", margin: "0 auto 12px" }} />
      <p style={{ margin: 0, fontSize: 14 }}>{st.login_required}</p>
    </div>
  );

  const containerHeight =
    variant === "full"     ? "calc(100dvh - 130px)" :
    variant === "embedded" ? "calc(100dvh - 280px)" : "100%";

  const filteredRooms = rooms.filter(r => getPeerName(r).toLowerCase().includes(roomQuery.toLowerCase()));

  const BackArrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  // ── Chat page (full screen when open) ───────────────────────────────────────
  const chatPage = activeRoom && (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      dir={dir}
      style={variant === "full"
        ? { position: "fixed", inset: 0, height: "100dvh", zIndex: 1200, display: "flex", flexDirection: "column", background: BG_CHAT, overflow: "hidden", overscrollBehavior: "none" }
        : { position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", background: BG_CHAT, overflow: "hidden" }}>
      {/* Drag overlay */}
      {dragOver && (
        <div style={{ position: "absolute", inset: 0, background: "#000000cc", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
          <span style={{ fontSize: 40 }}>📎</span>
          <p style={{ margin: 0, color: GOLD, fontWeight: 800, fontSize: 15 }}>أفلت الملف هنا للإرسال</p>
        </div>
      )}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel st={st} activeRoom={activeRoom} onClose={() => setShowSettings(false)}
            onMuteChanged={(roomId, muted) => {
              setRooms(prev => prev.map(r => r.id === roomId ? { ...r, muted } : r));
              setActiveRoom(prev => prev && prev.id === roomId ? { ...prev, muted } : prev);
              loadRooms();
            }}
            onRoomDeleted={removeRoomFromAllSurfaces}
            showToast={setToast} />
        )}
      </AnimatePresence>

      {/* ── Header: back + avatar + name + call buttons ── */}
      <div style={{ padding: "10px 12px", paddingTop: "calc(10px + env(safe-area-inset-top))", background: BG_BAR, borderBottom: `1px solid ${GOLD}12`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button onClick={() => { stopVoiceNote(true); activeRoomIdRef.current = null; setActiveRoom(null); setShowEmoji(false); }} title={st.back ?? "Back"}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", cursor: "pointer", background: "transparent", color: GOLD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <BackArrow size={22} />
        </button>
        <Avatar name={getPeerName(activeRoom)} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 16, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getPeerName(activeRoom)}
            {activeRoom.muted && <BellOff size={13} style={{ color: "#666", flexShrink: 0 }} />}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "#ffffff40", overflow: "hidden", whiteSpace: "nowrap" }}>
            <span style={{ color: activeRoom.type === "direct" && call.onlineUsers.includes(getPeerName(activeRoom)) ? "#22c55e" : "#ffffff40" }}>
              {activeRoom.type === "direct"
                ? (call.onlineUsers.includes(getPeerName(activeRoom)) ? `● ${st.online}` : st.offline)
                : (st.groups ?? "Group")}
            </span>
          </p>
        </div>
        {activeRoom.type === "direct" && (
          <>
            <button onClick={() => call.startCall(getPeerName(activeRoom), true)} title={st.video_call}
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: "transparent", color: GOLD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Video size={21} />
            </button>
            <button onClick={() => call.startCall(getPeerName(activeRoom), false)} title={st.voice_call}
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: "transparent", color: GOLD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Phone size={20} />
            </button>
          </>
        )}
        <button onClick={() => setShowSettings(true)} title={st.msg_settings ?? "Settings"}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", cursor: "pointer", background: "transparent", color: "#999", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <MoreVertical size={20} />
        </button>
      </div>

      {/* ── Messages with date separators ── */}
      <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "12px 12px 4px", display: "flex", flexDirection: "column", gap: 4, WebkitOverflowScrolling: "touch" }}
        onClick={() => setMenuMsgId(null)}>
        {grouped.map(group => (
          <div key={group.label + group.msgs[0]?.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ alignSelf: "center", background: "#1a1a1a", color: "#aaa", fontSize: 11.5, fontWeight: 700, borderRadius: 8, padding: "4px 12px", margin: "8px 0" }}>
              {group.label}
            </div>
            {group.msgs.map(msg => {
              const mine = msg.username === user.username;
              const seen = mine && activeRoom.members.some(member =>
                member.userId !== user.id &&
                member.lastReadAt != null &&
                new Date(member.lastReadAt).getTime() >= new Date(msg.createdAt).getTime());
              return (
                <div key={msg.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6, position: "relative" }}>
                  <div style={{ maxWidth: "78%", background: mine ? GOLD : BUBBLE_OTHER, borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "8px 12px 6px", userSelect: "text", WebkitUserSelect: "text", position: "relative", boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
                    {!mine && activeRoom.type === "group" && <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 800, color: GOLD }}>{msg.username}</p>}
                    {msg.type === "audio" && msg.audioUrl ? (
                      <audio controls src={resolveUrl(msg.audioUrl)} style={{ maxWidth: 220, height: 38 }} />
                    ) : msg.type === "video" && msg.videoUrl ? (
                      <video controls src={resolveUrl(msg.videoUrl)} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: "block" }} />
                    ) : msg.type === "file" && msg.fileUrl && msg.content?.startsWith("📁") ? (
                      <a href={resolveUrl(msg.fileUrl)} target="_blank" rel="noreferrer"
                        style={{ color: mine ? "#000" : GOLD, fontSize: 14, fontWeight: 700, wordBreak: "break-word" }}>
                        {msg.content}
                      </a>
                    ) : msg.type === "file" && msg.fileUrl ? (
                      <img src={resolveUrl(msg.fileUrl)} alt="attachment" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: "block" }}
                        onError={e => { (e.target as HTMLImageElement).alt = "Image unavailable"; }} />
                    ) : (
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: mine ? "#000" : "#eaeaea", wordBreak: "break-word", whiteSpace: "pre-wrap" }} dir="auto">{msg.content}</p>
                    )}
                    <p style={{ margin: "3px 0 0", fontSize: 10.5, color: mine ? "#00000060" : "#ffffff35", textAlign: "end" }}>
                      {clockTime(msg.createdAt)}
                      {seen && <span aria-label="Seen" title="Seen" style={{ marginInlineStart: 5, fontSize: 12, fontWeight: 900, letterSpacing: -1 }}>✓✓</span>}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setMenuMsgId(v => v === msg.id ? null : msg.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#555", padding: 2, alignSelf: "center", flexShrink: 0 }}>
                    <MoreVertical size={14} />
                  </button>
                  {menuMsgId === msg.id && (
                    <div onClick={e => e.stopPropagation()}
                      className="absolute bottom-full z-30 min-w-[130px] overflow-hidden rounded-md border border-border bg-popover shadow-lg"
                      style={{ insetInlineEnd: mine ? 0 : "auto", insetInlineStart: mine ? "auto" : 8 }}>
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
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* ── Attachment preview strip (multi-file, per-file progress) ── */}
      {pending.length > 0 && (
        <div style={{ padding: "10px 14px", background: BG_BAR, borderTop: `1px solid ${GOLD}10`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
            {pending.map(p => (
              <div key={p.id} style={{ position: "relative", flexShrink: 0, width: 96 }}>
                <div style={{ width: 96, height: 96, borderRadius: 8, overflow: "hidden", border: `1px solid ${p.status === "error" ? "#ef4444" : `${GOLD}30`}`, background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.previewUrl && p.file.type.startsWith("image/") ? (
                    <img src={p.previewUrl} alt={p.file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : p.previewUrl && p.file.type.startsWith("video/") ? (
                    <video src={p.previewUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                  ) : p.previewUrl && p.file.type.startsWith("audio/") ? (
                    <audio controls src={p.previewUrl} style={{ width: 88, height: 34 }} />
                  ) : (
                    <div style={{ fontSize: 11, color: "#ddd", padding: 6, textAlign: "center", overflow: "hidden", wordBreak: "break-all" }}>📁 {p.file.name.slice(0, 28)}</div>
                  )}
                  {p.status === "uploading" && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8 }}>
                      <span style={{ color: GOLD, fontSize: 13, fontWeight: 800 }}>{p.progress}%</span>
                      <div style={{ width: 64, height: 4, borderRadius: 2, background: "#333" }}>
                        <div style={{ width: `${p.progress}%`, height: "100%", borderRadius: 2, background: GOLD, transition: "width .2s" }} />
                      </div>
                    </div>
                  )}
                  {p.status === "error" && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, color: "#ef4444", fontSize: 12, fontWeight: 800 }}>
                      ⚠️
                    </div>
                  )}
                </div>
                {p.status !== "uploading" && (
                  <button onClick={() => removePending(p.id)} title="إلغاء"
                    style={{ position: "absolute", top: -6, insetInlineEnd: -6, width: 22, height: 22, borderRadius: "50%", background: "#1a1a1a", border: `1px solid ${GOLD}30`, color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                    <X size={12} />
                  </button>
                )}
                <div style={{ fontSize: 10, color: "#888", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.file.name} · {(p.file.size / 1024 / 1024).toFixed(1)}MB
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <div style={{ flex: 1, fontSize: 12, color: uploading ? GOLD : "#888" }}>
              {uploading
                ? `⏳ ${st.uploading ?? "جاري رفع الملف…"} (${pending.filter(p => p.status === "uploading").length ? pending.findIndex(p => p.status === "uploading") + 1 : pending.length}/${pending.length})`
                : `${pending.length} 📎`}
            </div>
            <button onClick={confirmPending} disabled={uploading || pending.every(p => p.status === "uploading")} title={st.send}
              style={{ width: 42, height: 42, borderRadius: "50%", background: uploading ? "#1c1c1c" : GOLD, border: "none", color: uploading ? "#555" : "#000", cursor: uploading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Send size={18} />
            </button>
            <button onClick={cancelPending} disabled={uploading} title="إلغاء"
              style={{ width: 34, height: 34, borderRadius: "50%", background: "#1a1a1a", border: "none", color: "#ef4444", cursor: uploading ? "default" : "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: uploading ? 0.5 : 1 }}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Emoji panel ── */}
      {showEmoji && (
        <div style={{ background: BG_BAR, borderTop: `1px solid ${GOLD}10`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, padding: "6px 12px 0" }}>
            {EMOJI_GROUPS.map(([icon], i) => (
              <button key={icon} onClick={() => setEmojiGroup(i)}
                style={{ background: emojiGroup === i ? `${GOLD}25` : "none", border: "none", fontSize: 17, cursor: "pointer", padding: "4px 10px", borderRadius: 6, lineHeight: 1 }}>
                {icon}
              </button>
            ))}
          </div>
          <div style={{ padding: "6px 12px 8px", display: "flex", flexWrap: "wrap", gap: 2, maxHeight: 140, overflowY: "auto" }}>
            {EMOJI_GROUPS[emojiGroup][1].map(e => (
              <button key={e} onClick={() => { setText(t => t + e); autoGrow(); }}
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", padding: 4, lineHeight: 1 }}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden pickers */}
      <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPickFile} />
      <input ref={gifRef}     type="file" accept="image/gif" style={{ display: "none" }} onChange={onPickFile} />
      <input ref={galleryRef} type="file" multiple accept="image/*,video/*" style={{ display: "none" }} onChange={onPickFile} />
      <input ref={fileRef}    type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx" style={{ display: "none" }} onChange={onPickFile} />

      {/* ── Composer: explicit Camera, Microphone, and GIF controls ── */}
      <div style={{ padding: "8px 10px", paddingBottom: "calc(8px + env(safe-area-inset-bottom))", background: BG_BAR, borderTop: `1px solid ${GOLD}10`, flexShrink: 0 }}>
        {recording && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 8px" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" }} />
            <span style={{ color: "#ef4444", fontSize: 13, fontWeight: 800 }}>{st.record_voice ?? "Recording…"} 🎙️</span>
          </div>
        )}
        {/* Row 1: BIG input + send */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea ref={textRef} value={text} rows={1}
            onChange={e => { setText(e.target.value); autoGrow(); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            onPaste={onPaste}
            onFocus={() => setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 250)}
            placeholder={st.type_message} dir="auto" disabled={recording}
            style={{ flex: 1, background: "#1c1c1c", border: `1px solid ${GOLD}20`, borderRadius: 22, padding: "11px 16px", color: "#fff", fontSize: 16, lineHeight: 1.4, outline: "none", minWidth: 80, resize: "none", maxHeight: 120, fontFamily: "inherit" }} />
          <button onClick={() => sendMessage()} disabled={!text.trim() || sending} title={st.send}
            style={{ width: 46, height: 46, borderRadius: "50%", background: text.trim() ? GOLD : "#1c1c1c", border: "none", color: text.trim() ? "#000" : "#555", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Send size={20} style={dir === "rtl" ? { transform: "scaleX(-1)" } : undefined} />
          </button>
        </div>
        {/* Row 2: mobile-safe tools — camera | gallery | GIF | file | microphone | emoji */}
        <div style={{ display: "flex", gap: 6, justifyContent: "space-around", marginTop: 8 }}>
          {([
            [<Camera key="c" size={20} />, st.attach_camera ?? "Camera", () => cameraRef.current?.click(), false],
            [<ImageIcon key="i" size={20} />, st.attach_gallery ?? "Gallery", () => galleryRef.current?.click(), false],
            [<FileImage key="g" size={20} />, st.attach_gif ?? "GIF", () => gifRef.current?.click(), false],
            [<Paperclip key="f" size={20} />, st.attach_file ?? "فيشي", () => fileRef.current?.click(), false],
            [recording ? <Square key="m" size={18} /> : <Mic key="m" size={20} />, recording ? (st.stop_recording ?? "Stop") : (st.record_voice ?? "Microphone"), () => recording ? stopVoiceNote() : startVoiceNote(), recording],
            [<Smile key="e" size={20} />, st.attach_emoji ?? "ايموجي", () => setShowEmoji(v => !v), showEmoji],
          ] as [React.ReactNode, string, () => void, boolean][]).map(([icon, title, fn, active], idx) => (
            <button key={idx} onClick={fn} title={title} aria-label={title} disabled={uploading}
              style={{ flex: 1, maxWidth: 64, height: 42, borderRadius: 14, border: "none", cursor: "pointer",
                background: active ? (idx === 3 ? "#ef4444" : `${GOLD}25`) : "#1c1c1c",
                color: active ? (idx === 3 ? "#fff" : GOLD) : "#bbb",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: uploading ? 0.5 : 1 }}>
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div dir={dir} style={{ position: "relative", height: containerHeight, minHeight: isWidget ? 0 : 440, display: "flex", flexDirection: "column", background: BG, borderRadius: isWidget ? 0 : 14, overflow: "hidden", border: isWidget ? "none" : `1px solid ${GOLD}12`, maxWidth: variant === "full" ? 860 : undefined, margin: variant === "full" ? "0 auto" : undefined, width: "100%", overscrollBehavior: "none" }}>

        {/* ── Top bar ── */}
        <div style={{ padding: "12px 16px", background: BG_BAR, borderBottom: `1px solid ${GOLD}12`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <p style={{ margin: 0, fontWeight: 900, color: GOLD, fontSize: 17, flex: 1, letterSpacing: 0.5 }}>AMIS 👑</p>
          <button onClick={() => setShowSettings(true)} title={st.msg_settings ?? "Settings"}
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer", background: "transparent", color: "#999", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Settings size={18} />
          </button>
        </div>

        {/* ── Tab content ── */}
        {tab === "discussions" && (
          <>
            <div style={{ padding: "10px 14px 4px" }}>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", top: 12, insetInlineStart: 12, color: "#555" }} />
                <input value={roomQuery} onChange={e => setRoomQuery(e.target.value)} placeholder={st.search_contacts ?? "Search…"} dir="auto"
                  style={{ width: "100%", boxSizing: "border-box", background: "#161616", border: `1px solid ${GOLD}15`, borderRadius: 12, padding: "10px 12px", paddingInlineStart: 36, color: "#fff", fontSize: 15, outline: "none" }} />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 80px" }}>
              {filteredRooms.length === 0 && (
                <p style={{ color: "#444", fontSize: 13, textAlign: "center", marginTop: 32 }}>{st.no_messages}</p>
              )}
              {filteredRooms.map(room => {
                const peerName = getPeerName(room);
                const isOnline = room.type === "direct" && call.onlineUsers.includes(peerName);
                return (
                  <button key={room.id} onClick={() => openRoom(room)}
                    style={{ textAlign: "start", padding: "11px 10px", borderRadius: 12, border: "none", cursor: "pointer", background: "transparent", display: "flex", gap: 12, alignItems: "center", width: "100%", borderBottom: "1px solid #ffffff06" }}>
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      {room.type === "group"
                        ? <div style={{ width: 48, height: 48, background: "#222", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{room.icon ?? "👥"}</div>
                        : <Avatar name={peerName} size={48} />
                      }
                      {isOnline && (
                        <div style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, background: "#22c55e", borderRadius: "50%", border: "2px solid #000" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                        <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                          {peerName}
                          {room.muted && <BellOff size={12} style={{ color: "#666", flexShrink: 0 }} />}
                        </p>
                        {room.lastMessage && (
                          <span style={{ fontSize: 11.5, color: room.unreadCount > 0 && !room.muted ? GOLD : "#ffffff30", flexShrink: 0, fontWeight: room.unreadCount > 0 ? 800 : 400 }}>
                            {timeAgo(room.lastMessage.createdAt ?? "", st)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <p style={{ margin: 0, color: "#ffffff45", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">
                          {room.lastMessage
                            ? (room.lastMessage.type === "audio" ? "🎤 Voice" : room.lastMessage.type === "file" ? "🖼 Image" : room.lastMessage.type === "video" ? "🎥 Video" : room.lastMessage.content)
                            : "—"}
                        </p>
                        {room.unreadCount > 0 && !room.muted && (
                          <span style={{ background: GOLD, color: "#000", borderRadius: 10, minWidth: 20, textAlign: "center", padding: "2px 6px", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>
                            {room.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* FAB: new chat */}
            <button onClick={() => setShowContacts("dm")}
              style={{ position: "absolute", bottom: 76, insetInlineEnd: 18, width: 54, height: 54, borderRadius: 16, background: GOLD, border: "none", color: "#000", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: 20 }}>
              <MessageSquare size={23} />
            </button>
          </>
        )}

        {tab === "actus" && <ActusTab st={st} />}

        {tab === "communautes" && (
          <>
            {showGroupNew && (
              <div className="m-3 rounded-lg border border-border bg-card p-3">
                <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={st.group_name} dir="auto" className="h-10 text-sm" />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="h-9 flex-1 text-xs" onClick={createGroup}>{st.create_group}</Button>
                  <Button size="sm" variant="secondary" className="h-9 px-3" onClick={() => { setShowGroupNew(false); setGroupName(""); }}>
                    <X size={13} />
                  </Button>
                </div>
              </div>
            )}
            <CommunautesTab st={st} myRoomIds={new Set(rooms.map(r => r.id))}
              onJoined={roomId => { setTab("discussions"); openRoomById(roomId); }}
              onOpen={roomId => { setTab("discussions"); openRoomById(roomId); }}
              onCreate={() => setShowGroupNew(true)} />
          </>
        )}

        {tab === "appels" && (
          <AppelsTab
            st={st}
            user={user}
            onNewCall={() => setShowContacts("call")}
            connectionTest={call.connectionTest}
            onTestConnection={call.testConnection}
          />
        )}

        {/* ── Fixed bottom tab bar ── */}
        <div style={{ display: "flex", background: BG_BAR, borderTop: `1px solid ${GOLD}15`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {(Object.keys(TAB_LABELS) as BottomTab[]).map(k => {
            const active = tab === k;
            const Icon = k === "discussions" ? MessageSquare : k === "actus" ? Newspaper : k === "communautes" ? Users : Phone;
            return (
              <button key={k} onClick={() => { setTab(k); activeRoomIdRef.current = null; setActiveRoom(null); }}
                style={{ flex: 1, padding: "9px 0 7px", border: "none", cursor: "pointer", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <Icon size={21} style={{ color: active ? GOLD : "#777" }} />
                  {k === "discussions" && totalUnread > 0 && (
                    <span style={{ position: "absolute", top: -5, insetInlineEnd: -9, background: GOLD, color: "#000", borderRadius: 9, minWidth: 16, textAlign: "center", fontSize: 9.5, fontWeight: 900, padding: "1px 4px" }}>
                      {totalUnread}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10.5, fontWeight: active ? 900 : 600, color: active ? GOLD : "#777" }}>{TAB_LABELS[k]}</span>
                {active && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2.5, background: GOLD, borderRadius: 2 }} />}
              </button>
            );
          })}
        </div>

        {/* ── Overlays over list view ── */}
        <AnimatePresence>
          {showContacts && (
            <ContactsPanel st={st} user={user}
              title={showContacts === "call" ? (st.voice_call ?? "New call") : (st.dm ?? "New chat")}
              callMode={showContacts === "call"}
              onClose={() => setShowContacts(false)}
              onDm={openDmWith}
              onCall={(u, v) => call.startCall(u, v)} />
          )}
          {showSettings && !activeRoom && (
            <SettingsPanel st={st} activeRoom={null} onClose={() => setShowSettings(false)}
              onMuteChanged={() => loadRooms()} onRoomDeleted={removeRoomFromAllSurfaces} showToast={setToast} />
          )}
        </AnimatePresence>

        {/* ── Chat page (widget/embedded: overlays container) ── */}
        {variant !== "full" && chatPage}
      </div>

      {/* Chat page for the full variant: portaled to <body> so it is a TRUE
          fullscreen page — no ancestor transform can trap position:fixed,
          and the site navbar stays underneath (zIndex 1200 > navbar z-50). */}
      {variant === "full" && chatPage && createPortal(chatPage, document.body)}

      <AnimatePresence>
        {toast && <Toast msg={toast} onDone={() => setToast("")} />}
      </AnimatePresence>
    </>
  );
}
