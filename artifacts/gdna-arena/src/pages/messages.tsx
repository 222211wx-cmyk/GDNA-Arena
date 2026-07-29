import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Send, Users, Crown, ArrowLeft, Plus, Mic, Video,
  Lock, Globe2, Hash, Phone, VideoIcon, Type, X, Search
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";

interface Room {
  id: number; name: string | null; type: string; icon: string | null;
  memberCount?: number; members?: Member[];
  lastMessage?: DmMessage | null; unreadCount?: number;
}
interface Member  { id: number; roomId: number; userId: number; username: string; joinedAt: string; }
interface DmMessage { id: number; roomId: number; userId: number | null; username: string; content: string | null; audioUrl: string | null; videoUrl: string | null; type: string; isRead: boolean; createdAt: string; }

const GREEN    = "#22c55e";
const DARK_BG  = "#050a05";
const CARD_BG  = "#0a120a";
const BORDER_G = "#22c55e22";

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; return `${Math.floor(m/60)}h`;
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  return (
    <div className={`w-${size} h-${size} rounded-full flex items-center justify-center text-xs font-black text-black shrink-0`}
      style={{ background: `linear-gradient(135deg, ${GREEN}, #16a34a)`, minWidth: `${size*4}px`, minHeight: `${size*4}px` }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [directRooms,  setDirectRooms]  = useState<Room[]>([]);
  const [groupRooms,   setGroupRooms]   = useState<Room[]>([]);
  const [activeRoom,   setActiveRoom]   = useState<Room | null>(null);
  const [messages,     setMessages]     = useState<DmMessage[]>([]);
  const [members,      setMembers]      = useState<Member[]>([]);
  const [input,        setInput]        = useState("");
  const [msgType,      setMsgType]      = useState<"text"|"audio"|"video">("text");
  const [mediaUrl,     setMediaUrl]     = useState("");
  const [sending,      setSending]      = useState(false);
  const [tab,          setTab]          = useState<"direct"|"groups">("direct");
  const [newDmTarget,  setNewDmTarget]  = useState("");
  const [showNewDm,    setShowNewDm]    = useState(false);
  const [error,        setError]        = useState<string|null>(null);
  const [totalUnread,  setTotalUnread]  = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadRooms = useCallback(async () => {
    if (!user) return;
    const [dr, gr] = await Promise.all([
      fetch("/api/messages/rooms", { credentials: "include" }),
      fetch("/api/messages/group-rooms", { credentials: "include" }),
    ]);
    const dd = await dr.json() as { rooms: Room[] };
    const gd = await gr.json() as { rooms: Room[] };
    setDirectRooms(dd.rooms ?? []);
    setGroupRooms(gd.rooms ?? []);
  }, [user]);

  const loadMessages = useCallback(async (roomId: number) => {
    const res = await fetch(`/api/messages/rooms/${roomId}`, { credentials: "include" });
    const data = await res.json() as { messages: DmMessage[]; members: Member[]; room: Room };
    setMessages(data.messages ?? []);
    setMembers(data.members ?? []);
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => {
    if (!activeRoom) return;
    const t = setInterval(() => void loadMessages(activeRoom.id), 4000);
    return () => clearInterval(t);
  }, [activeRoom, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const openRoom = async (room: Room) => {
    setActiveRoom(room);
    await loadMessages(room.id);
  };

  const joinGroup = async (room: Room) => {
    await fetch(`/api/messages/rooms/${room.id}/join`, { method: "POST", credentials: "include" });
    await openRoom(room);
    void loadRooms();
  };

  const startDm = async () => {
    if (!newDmTarget.trim()) return;
    const res = await fetch("/api/messages/rooms", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUsername: newDmTarget.trim(), type: "direct" }),
    });
    const data = await res.json() as { room?: Room; error?: string };
    if (data.error) { setError(data.error); return; }
    if (data.room) {
      setShowNewDm(false); setNewDmTarget(""); void loadRooms();
      setTimeout(() => void openRoom(data.room!), 200);
    }
  };

  const send = async () => {
    if (!activeRoom || sending) return;
    const hasContent = (msgType === "text" && input.trim()) || ((msgType === "audio" || msgType === "video") && mediaUrl.trim());
    if (!hasContent) return;
    setSending(true); setError(null);
    const body: Record<string, string> = { type: msgType };
    if (msgType === "text") body.content = input.trim();
    else if (msgType === "audio") body.audioUrl = mediaUrl.trim();
    else body.videoUrl = mediaUrl.trim();

    const res = await fetch(`/api/messages/rooms/${activeRoom.id}/send`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { setError(data.error ?? "Error"); setSending(false); return; }
    setInput(""); setMediaUrl("");
    await loadMessages(activeRoom.id);
    setSending(false);
  };

  const getRoomLabel = (room: Room) => {
    if (room.type === "group") return room.name ?? "Group Room";
    const other = room.members?.find(m => m.userId !== user?.id);
    return other?.username ?? "Direct Message";
  };

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center" style={{ background: DARK_BG }}>
      <div>
        <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" style={{ color: GREEN }} />
        <h2 className="text-2xl font-black mb-2">Royal Messenger</h2>
        <p className="text-muted-foreground mb-4">Login to access the Empire's communication network</p>
        <Link href="/login">
          <button className="px-6 py-2.5 rounded-xl font-bold text-black" style={{ background: GREEN }}>Join the Empire</button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] flex" style={{ background: DARK_BG, color: "#e5ffe5" }}>
      {/* ── Sidebar ── */}
      <div className={`w-full md:w-80 border-r flex flex-col ${activeRoom ? "hidden md:flex" : "flex"}`}
        style={{ borderColor: BORDER_G, background: CARD_BG }}>

        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: BORDER_G }}>
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-black flex items-center gap-2" style={{ color: GREEN }}>
              <Crown className="w-5 h-5" /> ROYAL MESSENGER
            </h1>
            <button onClick={() => setShowNewDm(true)}
              className="w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:opacity-90"
              style={{ background: GREEN, color: "#000", border: "none" }}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: BORDER_G }}>
            {(["direct", "groups"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-2 text-xs font-bold transition-all"
                style={{ background: tab === t ? `${GREEN}20` : "transparent", color: tab === t ? GREEN : "#666" }}>
                {t === "direct" ? "💬 Direct" : "👥 Groups"}
              </button>
            ))}
          </div>
        </div>

        {/* New DM dialog */}
        <AnimatePresence>
          {showNewDm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b" style={{ borderColor: BORDER_G }}>
              <div className="p-3 space-y-2">
                <input value={newDmTarget} onChange={e => setNewDmTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void startDm(); }}
                  placeholder="Enter citizen username..."
                  className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none"
                  style={{ background: "#050a05", borderColor: `${GREEN}30`, color: "#e5ffe5" }} />
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => void startDm()} className="flex-1 py-1.5 rounded-xl text-xs font-bold text-black" style={{ background: GREEN }}>Start DM</button>
                  <button onClick={() => { setShowNewDm(false); setError(null); }} className="px-3 py-1.5 rounded-xl text-xs border" style={{ borderColor: BORDER_G }}>Cancel</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Room list */}
        <div className="flex-1 overflow-y-auto">
          {tab === "direct" && (
            <>
              {directRooms.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-xs p-4">
                  <Lock className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: GREEN }} />
                  No direct messages yet.<br />Click + to start a private conversation.
                </div>
              ) : directRooms.map(r => (
                <button key={r.id} onClick={() => void openRoom(r)}
                  className="w-full flex items-center gap-3 p-3 border-b text-left hover:opacity-80 transition-opacity"
                  style={{ borderColor: BORDER_G, background: activeRoom?.id === r.id ? `${GREEN}08` : "transparent" }}>
                  <Avatar name={getRoomLabel(r)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{getRoomLabel(r)}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.lastMessage?.content ?? "No messages yet"}</div>
                  </div>
                  {(r.unreadCount ?? 0) > 0 && (
                    <span className="w-5 h-5 rounded-full text-[10px] font-black text-black flex items-center justify-center shrink-0"
                      style={{ background: GREEN }}>{r.unreadCount}</span>
                  )}
                </button>
              ))}
            </>
          )}
          {tab === "groups" && (
            <>
              {groupRooms.map(r => {
                const isMember = directRooms.some(dr => dr.id === r.id) || true; // simplified
                return (
                  <button key={r.id} onClick={() => void joinGroup(r)}
                    className="w-full flex items-center gap-3 p-3 border-b text-left hover:opacity-80 transition-opacity"
                    style={{ borderColor: BORDER_G, background: activeRoom?.id === r.id ? `${GREEN}08` : "transparent" }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg border shrink-0"
                      style={{ borderColor: `${GREEN}30`, background: `${GREEN}10` }}>
                      {r.icon ?? "👥"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.memberCount ?? 0} members</div>
                    </div>
                    <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Chat panel ── */}
      {activeRoom ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: BORDER_G, background: CARD_BG }}>
            <button className="md:hidden" onClick={() => setActiveRoom(null)}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-base border"
              style={{ borderColor: `${GREEN}30`, background: `${GREEN}10` }}>
              {activeRoom.type === "group" ? (activeRoom.icon ?? "👥") : getRoomLabel(activeRoom).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm truncate">{getRoomLabel(activeRoom)}</div>
              <div className="text-xs text-muted-foreground">
                {activeRoom.type === "group" ? `${members.length} members` : "Direct Message · End-to-end"}
              </div>
            </div>
            {/* Type selector */}
            <div className="flex gap-1">
              {([["text", <Type className="w-3 h-3" />], ["audio", <Mic className="w-3 h-3" />], ["video", <VideoIcon className="w-3 h-3" />]] as const).map(([t, icon]) => (
                <button key={t} onClick={() => setMsgType(t)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center border transition-all"
                  style={{ borderColor: msgType === t ? `${GREEN}50` : BORDER_G, background: msgType === t ? `${GREEN}20` : "transparent", color: msgType === t ? GREEN : "#666" }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: GREEN }} />
                <p className="text-sm">Send the first message to begin</p>
              </div>
            )}
            {messages.map(m => {
              const isMe = m.userId === user?.id;
              const ytId = (m.audioUrl ?? m.videoUrl)?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/\s]{11})/)?.[1];
              return (
                <div key={m.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                  {!isMe && <Avatar name={m.username} size={7} />}
                  <div className={`max-w-[75%] space-y-1 ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                    {!isMe && <span className="text-[10px] font-bold text-muted-foreground ml-1">{m.username}</span>}
                    <div className="px-3 py-2 rounded-2xl text-sm"
                      style={{ background: isMe ? GREEN : "#1a2a1a", color: isMe ? "#000" : "#e5ffe5", borderBottomRightRadius: isMe ? "4px" : undefined, borderBottomLeftRadius: !isMe ? "4px" : undefined }}>
                      {m.content && <p>{m.content}</p>}
                      {ytId && (
                        <div className="mt-2 rounded-xl overflow-hidden" style={{ minWidth: "240px" }}>
                          <div className="relative" style={{ paddingTop: "56.25%" }}>
                            <iframe src={`https://www.youtube.com/embed/${ytId}?rel=0`} className="absolute inset-0 w-full h-full" allowFullScreen />
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mx-1">{timeAgo(m.createdAt)}</span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-2 p-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs flex items-center gap-2">
              <X className="w-3 h-3" onClick={() => setError(null)} /> 🛡️ {error}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t space-y-2" style={{ borderColor: BORDER_G, background: CARD_BG }}>
            {(msgType === "audio" || msgType === "video") && (
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="YouTube URL (voice message or video clip)..."
                className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none"
                style={{ background: "#050a05", borderColor: `${GREEN}30`, color: "#e5ffe5" }} />
            )}
            <div className="flex gap-2">
              {msgType === "text" && (
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }}}
                  placeholder="Message the Empire..."
                  maxLength={500}
                  className="flex-1 px-4 py-2.5 rounded-xl border text-sm focus:outline-none"
                  style={{ background: "#050a05", borderColor: `${GREEN}30`, color: "#e5ffe5" }} />
              )}
              {(msgType !== "text") && (
                <div className="flex-1 px-4 py-2.5 rounded-xl border text-sm text-muted-foreground"
                  style={{ background: "#050a05", borderColor: `${GREEN}30` }}>
                  {msgType === "audio" ? "🎙️ Voice message — paste YouTube URL above" : "🎬 Video message — paste YouTube URL above"}
                </div>
              )}
              <button onClick={() => void send()} disabled={sending}
                className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-40 text-black"
                style={{ background: GREEN }}>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground flex-col gap-4">
          <Crown className="w-16 h-16 opacity-10" style={{ color: GREEN }} />
          <p className="font-bold text-lg">Select a conversation</p>
          <p className="text-sm opacity-60">or start a new one with +</p>
        </div>
      )}
    </div>
  );
}
