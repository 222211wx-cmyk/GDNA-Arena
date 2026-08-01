// ══════════════════════════════════════════════════════════════════════════════
//  CommHub — Floating Communication Center (every page, always accessible)
//  مركز التواصل العائم — دائماً في متناول اليد من أي صفحة
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Phone, Video, X, Send, ChevronDown,
  Users, Search, Circle, Radio, Zap, ArrowLeft
} from "lucide-react";
import { useCallContext } from "@/contexts/CallContext";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";

const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

interface Room { id: number; type: string; participants: any[]; lastMessage?: any; unreadCount?: number; }
interface Msg  { id: number; content: string; userId: number; createdAt: string; }

function getRoomName(room: Room, myId: number) {
  const other = room.participants?.find((p: any) => p.userId !== myId);
  return other?.username ?? "Chat";
}

function Avatar({ name, size = 8, online = false }: { name: string; size?: number; online?: boolean }) {
  const colors = ["#C9A84C","#00D4FF","#22c55e","#ef4444","#a855f7","#f97316"];
  const c = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className="relative shrink-0" style={{ width: size * 4, height: size * 4 }}>
      <div className="w-full h-full rounded-full flex items-center justify-center font-black text-black text-sm"
        style={{ background: c, fontSize: size < 8 ? 10 : 13 }}>
        {name.charAt(0).toUpperCase()}
      </div>
      {online && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black"
          style={{ background: "#22c55e" }} />
      )}
    </div>
  );
}

// ── Typing dots animation ─────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-0.5 px-1">
      {[0,1,2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: "#C9A84C60", animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }} />
      ))}
    </div>
  );
}

// ── Main CommHub component ────────────────────────────────────────────────────
export default function CommHub() {
  const { user } = useAuth();
  const call = useCallContext();

  const [open,      setOpen]      = useState(false);
  const [tab,       setTab]       = useState<"chats" | "online">("chats");

  const [rooms,     setRooms]     = useState<Room[]>([]);
  const [active,    setActive]    = useState<Room | null>(null);
  const [msgs,      setMsgs]      = useState<Msg[]>([]);
  const [input,     setInput]     = useState("");
  const [sending,   setSending]   = useState(false);
  const [search,    setSearch]    = useState("");
  const [unread,    setUnread]    = useState(0);
  const [typingPeer, setTypingPeer] = useState<string | null>(null);
  const [newDm,     setNewDm]     = useState("");
  const [showNew,   setShowNew]   = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load rooms
  const loadRooms = useCallback(async () => {
    if (!user) return;
    try {
      const r = await fetch(`${BASE()}/api/messages/rooms`, { credentials: "include" });
      const d = await r.json() as { rooms: Room[] };
      const list = d.rooms ?? [];
      setRooms(list);
      setUnread(list.reduce((s, r) => s + (r.unreadCount ?? 0), 0));
    } catch {}
  }, [user]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => {
    if (!open || !user) return;
    pollRef.current = setInterval(loadRooms, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, user, loadRooms]);

  // Load messages when room selected
  const openRoom = async (room: Room) => {
    setActive(room);
    try {
      const r = await fetch(`${BASE()}/api/messages/rooms/${room.id}`, { credentials: "include" });
      const d = await r.json() as { messages: Msg[] };
      setMsgs(d.messages ?? []);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch {}
  };

  // Poll messages
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${BASE()}/api/messages/rooms/${active.id}`, { credentials: "include" });
        const d = await r.json() as { messages: Msg[] };
        if (d.messages?.length !== msgs.length) {
          setMsgs(d.messages ?? []);
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [active, msgs.length]);

  const send = async () => {
    if (!active || !input.trim() || sending) return;
    const content = input.trim();
    setSending(true);
    setInput("");
    // Optimistic
    setMsgs(p => [...p, { id: Date.now(), content, userId: user!.id, createdAt: new Date().toISOString() }]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    try {
      await fetch(`${BASE()}/api/messages/rooms/${active.id}/send`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text", content }),
      });
    } catch {}
    setSending(false);
  };

  const startDm = async () => {
    if (!newDm.trim()) return;
    try {
      const r = await fetch(`${BASE()}/api/messages/rooms`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUsername: newDm.trim(), type: "direct" }),
      });
      const d = await r.json() as { room?: Room };
      if (d.room) { setShowNew(false); setNewDm(""); await loadRooms(); openRoom(d.room); }
    } catch {}
  };

  // Scroll on open
  useEffect(() => {
    if (open && active) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    if (open && !active) inputRef.current?.focus();
  }, [open, active]);

  const filtered = rooms.filter(r => getRoomName(r, user?.id ?? 0).toLowerCase().includes(search.toLowerCase()));
  const activeRoomName = active ? getRoomName(active, user?.id ?? 0) : "";
  const isOnline = (name: string) => call.onlineUsers.includes(name.toLowerCase());

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!user) return (
    <div className="fixed bottom-6 right-6 z-[9990]" title="Sign in to message">
      <Link href="/login">
        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-2xl"
          style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
          <MessageSquare className="w-6 h-6 text-black" />
        </motion.button>
      </Link>
    </div>
  );

  return (
    <div className="fixed bottom-6 right-6 z-[9990] flex flex-col items-end gap-3">

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col overflow-hidden rounded-2xl shadow-2xl"
            style={{
              width: 340,
              height: 520,
              background: "#080808",
              border: "1px solid #C9A84C25",
            }}
          >
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid #C9A84C15", background: "#050505" }}>

              {active ? (
                <>
                  <button onClick={() => { setActive(null); setMsgs([]); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                    style={{ color: "#ffffff50", background: "#ffffff08" }}>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <Avatar name={activeRoomName} size={7} online={isOnline(activeRoomName)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-white truncate">{activeRoomName}</p>
                    <p className="text-[10px] font-mono" style={{ color: isOnline(activeRoomName) ? "#22c55e" : "#ffffff30" }}>
                      {typingPeer ? <><TypingDots /></> : isOnline(activeRoomName) ? "Online now" : "Offline"}
                    </p>
                  </div>
                  {/* Call buttons */}
                  <button onClick={() => call.startCall(activeRoomName, false)}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}
                    title="Voice call">
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => call.startCall(activeRoomName, true)}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}
                    title="Video call">
                    <Video className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  {/* Tabs */}
                  <div className="flex-1 flex gap-1">
                    {(["chats", "online"] as const).map(t => (
                      <button key={t} onClick={() => setTab(t)}
                        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all"
                        style={{
                          color: tab === t ? "#C9A84C" : "#ffffff30",
                          borderBottom: tab === t ? "2px solid #C9A84C" : "2px solid transparent",
                        }}>
                        {t === "chats" ? <><MessageSquare className="w-3 h-3 inline mr-1" />Messages</> : <><Users className="w-3 h-3 inline mr-1" />{call.onlineUsers.length} Online</>}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowNew(v => !v)}
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-all font-black text-black text-lg"
                    style={{ background: "#C9A84C" }} title="New message">
                    +
                  </button>
                </>
              )}

              <button onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                style={{ color: "#ffffff30", background: "#ffffff08" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* ── New DM bar ───────────────────────────────────────────────── */}
            <AnimatePresence>
              {showNew && !active && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                  className="overflow-hidden shrink-0">
                  <div className="flex gap-2 px-3 py-2" style={{ borderBottom: "1px solid #C9A84C10", background: "#0a0a0a" }}>
                    <input value={newDm} onChange={e => setNewDm(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && startDm()}
                      placeholder="Username..."
                      className="flex-1 px-2 py-1.5 text-xs focus:outline-none"
                      style={{ background: "#111", border: "1px solid #C9A84C20", color: "#fff" }}
                      dir="auto" autoFocus />
                    <button onClick={startDm}
                      className="px-3 py-1.5 text-xs font-bold text-black"
                      style={{ background: "#C9A84C" }}>
                      Start
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Body ────────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden flex flex-col">

              {/* CHATS TAB */}
              {!active && tab === "chats" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Search */}
                  <div className="px-3 py-2 shrink-0" style={{ borderBottom: "1px solid #C9A84C08" }}>
                    <div className="flex items-center gap-2 px-2 py-1.5"
                      style={{ background: "#111", border: "1px solid #C9A84C15" }}>
                      <Search className="w-3 h-3 shrink-0" style={{ color: "#ffffff30" }} />
                      <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="flex-1 text-xs bg-transparent focus:outline-none text-white"
                        dir="auto" />
                    </div>
                  </div>

                  {/* Room list */}
                  <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                        <MessageSquare className="w-10 h-10 opacity-10" style={{ color: "#C9A84C" }} />
                        <p className="text-xs text-center" style={{ color: "#ffffff25" }}>No chats yet</p>
                        <button onClick={() => setShowNew(true)}
                          className="px-4 py-2 text-xs font-bold text-black"
                          style={{ background: "#C9A84C" }}>Start a Chat</button>
                      </div>
                    ) : filtered.map(r => {
                      const name = getRoomName(r, user.id);
                      const online = isOnline(name);
                      return (
                        <button key={r.id} onClick={() => openRoom(r)}
                          className="w-full flex items-center gap-3 px-3 py-3 text-left transition-all"
                          style={{ borderBottom: "1px solid #C9A84C06", background: "transparent" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#C9A84C08")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          <Avatar name={name} size={9} online={online} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-bold text-white truncate">{name}</span>
                              {online && <span className="text-[9px] font-mono shrink-0" style={{ color: "#22c55e" }}>● online</span>}
                            </div>
                            <p className="text-[11px] truncate" style={{ color: "#ffffff35" }}>
                              {r.lastMessage?.content ?? "Start the conversation..."}
                            </p>
                          </div>
                          {(r.unreadCount ?? 0) > 0 && (
                            <span className="w-5 h-5 rounded-full text-[9px] font-black text-black flex items-center justify-center shrink-0"
                              style={{ background: "#C9A84C" }}>{r.unreadCount}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ONLINE TAB */}
              {!active && tab === "online" && (
                <div className="flex-1 overflow-y-auto">
                  {call.onlineUsers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                      <Circle className="w-10 h-10 opacity-10" style={{ color: "#22c55e" }} />
                      <p className="text-xs text-center" style={{ color: "#ffffff25" }}>No one online right now</p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-0.5">
                      {call.onlineUsers
                        .filter(u => u !== user.username.toLowerCase())
                        .map(username => (
                        <div key={username}
                          className="flex items-center gap-3 px-3 py-2.5 transition-all"
                          style={{ borderBottom: "1px solid #C9A84C06" }}>
                          <Avatar name={username} size={8} online />
                          <span className="flex-1 text-sm font-bold text-white capitalize">{username}</span>
                          <div className="flex gap-1.5">
                            {/* Message */}
                            <button
                              onClick={async () => {
                                const r = await fetch(`${BASE()}/api/messages/rooms`, {
                                  method: "POST", credentials: "include",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ targetUsername: username, type: "direct" }),
                                });
                                const d = await r.json() as { room?: Room };
                                if (d.room) { await loadRooms(); openRoom(d.room); }
                              }}
                              className="w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90"
                              style={{ background: "rgba(201,168,76,0.12)", color: "#C9A84C" }}>
                              <MessageSquare className="w-3 h-3" />
                            </button>
                            {/* Audio call */}
                            <button onClick={() => call.startCall(username, false)}
                              className="w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90"
                              style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                              <Phone className="w-3 h-3" />
                            </button>
                            {/* Video call */}
                            <button onClick={() => call.startCall(username, true)}
                              className="w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90"
                              style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
                              <Video className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Active live streams */}
                  {call.activeLives.length > 0 && (
                    <div className="mx-3 mt-3 mb-2">
                      <p className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "#ef444450" }}>
                        Live Now
                      </p>
                      {call.activeLives.map(live => (
                        <div key={live.liveId} className="flex items-center gap-2 px-3 py-2"
                          style={{ border: "1px solid #ef444425", background: "rgba(239,68,68,0.05)" }}>
                          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate capitalize">{live.host}</p>
                            <p className="text-[10px] truncate" style={{ color: "#ffffff30" }}>{live.title}</p>
                          </div>
                          <button onClick={() => { call.joinLive(live.liveId); setOpen(false); }}
                            className="px-2 py-1 text-[10px] font-bold text-white"
                            style={{ background: "#ef4444" }}>
                            <Radio className="w-2.5 h-2.5 inline mr-0.5" />Join
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CHAT VIEW */}
              {active && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                    {msgs.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full gap-2 opacity-30">
                        <Zap className="w-8 h-8" style={{ color: "#C9A84C" }} />
                        <p className="text-xs text-white">Start the conversation</p>
                      </div>
                    )}
                    {msgs.map(m => {
                      const isMe = m.userId === user.id;
                      return (
                        <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className="max-w-[78%]">
                            <div className="px-3 py-2 text-xs leading-relaxed"
                              dir="auto"
                              style={{
                                background: isMe
                                  ? "linear-gradient(135deg, #C9A84C, #FFD700)"
                                  : "#1a1a1a",
                                color: isMe ? "#000" : "#ffffffcc",
                                borderRadius: isMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                              }}>
                              {m.content}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {typingPeer && (
                      <div className="flex justify-start">
                        <div className="px-3 py-2" style={{ background: "#1a1a1a", borderRadius: "14px 14px 14px 2px" }}>
                          <TypingDots />
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>

                  {/* Input */}
                  <div className="shrink-0 flex gap-2 p-2"
                    style={{ borderTop: "1px solid #C9A84C10", background: "#050505" }}>
                    <input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
                      placeholder="Your message..."
                      className="flex-1 px-3 py-2 text-xs focus:outline-none"
                      style={{ background: "#111", border: "1px solid #C9A84C15", color: "#fff", borderRadius: 10 }}
                      dir="auto"
                    />
                    <button onClick={send} disabled={sending || !input.trim()}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
                      style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
                      <Send className="w-3.5 h-3.5 text-black" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Trigger Button ──────────────────────────────────────── */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        onClick={() => setOpen(v => !v)}
        className="relative w-14 h-14 rounded-full flex items-center justify-center shadow-2xl"
        style={{
          background: open
            ? "#1a1a1a"
            : "linear-gradient(135deg, #C9A84C, #FFD700)",
          border: open ? "1px solid #C9A84C40" : "none",
        }}
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.12 }}>
              <ChevronDown className="w-6 h-6" style={{ color: "#C9A84C" }} />
            </motion.div>
          ) : (
            <motion.div key="open" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={{ duration: 0.12 }}>
              <MessageSquare className="w-6 h-6 text-black" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unread badge */}
        {!open && unread > 0 && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white px-1"
            style={{ background: "#ef4444" }}>
            {unread > 9 ? "9+" : unread}
          </motion.div>
        )}

        {/* Online pulse ring */}
        {!open && call.connected && (
          <div className="absolute inset-0 rounded-full animate-ping opacity-20"
            style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }} />
        )}
      </motion.button>
    </div>
  );
}
