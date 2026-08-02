/**
 * MessagesTab — DM + Group chat, audio/video calls, call history, screenshot detection
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Users, Phone, X, Mic, MicOff, Send, Image, History, PhoneMissed, PhoneCall, Video } from "lucide-react";
import Avatar from "./Avatar";
import { GOLD, timeAgo, api } from "./social-i18n";
import { useCallContext } from "../../contexts/CallContext";
import type { DmRoom, DmMessage, CallRecord } from "./social-types";

// ── Toast for screenshot detection ────────────────────────────────────────────
function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "#f59e0b", color: "#000", borderRadius: 8, padding: "10px 20px", fontWeight: 700, fontSize: 13, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", whiteSpace: "nowrap", pointerEvents: "none" }}>
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

  function peer(r: CallRecord) {
    return r.callerId === user.id ? r.calleeUsername : r.callerUsername;
  }

  function statusLabel(status: string, st: Record<string,string>) {
    if (status === "missed")   return st.call_missed   ?? "Missed";
    if (status === "answered") return st.call_answered ?? "Answered";
    return st.call_ended ?? "Ended";
  }

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
                <span style={{ fontSize: 11, color: r.status === "missed" ? "#ef4444" : "#ffffff50" }}>
                  {statusLabel(r.status, st)}
                </span>
                <span style={{ fontSize: 11, color: "#ffffff30" }}>·</span>
                <span style={{ fontSize: 11, color: "#ffffff40" }}>
                  {r.callType === "video" ? <><Video size={10} style={{ display: "inline", marginRight: 2 }} />{st.call_video ?? "Video"}</> : <><Phone size={10} style={{ display: "inline", marginRight: 2 }} />{st.call_audio ?? "Audio"}</>}
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

// ── Main MessagesTab ──────────────────────────────────────────────────────────
interface Props {
  user: { id: number; username: string } | null;
  st: Record<string, string>;
  dir: string;
}

export default function MessagesTab({ user, st, dir }: Props) {
  const call = useCallContext();
  const [rooms,       setRooms]       = useState<DmRoom[]>([]);
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
  const [toast,       setToast]       = useState("");
  // Call tracking for history
  const callStartRef  = useRef<{ peer: string; type: string; start: number } | null>(null);
  const recorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef     = useRef<Blob[]>([]);
  const endRef        = useRef<HTMLDivElement>(null);
  const pollRef       = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // ── Load rooms ──────────────────────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!user) return;
    const r = await fetch(api("/api/messages/rooms"), { credentials: "include" });
    const j = await r.json();
    setRooms(j.rooms ?? []);
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
    if (!activeRoom) return;
    const handleBlur = () => setToast(st.screenshot_warning ?? "⚠️ Screenshot may have been taken");
    const handleVis  = () => { if (document.visibilityState === "hidden") setToast(st.screenshot_warning ?? "⚠️ Screenshot may have been taken"); };
    window.addEventListener("blur",             handleBlur);
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      window.removeEventListener("blur",             handleBlur);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, [activeRoom, st.screenshot_warning]);

  // ── Call history tracking ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    if ((call.callStatus === "calling" || call.callStatus === "active") && !callStartRef.current) {
      callStartRef.current = { peer: call.activePeer ?? "", type: "audio", start: Date.now() };
    }
    if ((call.callStatus === "idle" || call.callStatus === "ended") && callStartRef.current) {
      const { peer, start } = callStartRef.current;
      const durationSec = Math.floor((Date.now() - start) / 1000);
      const status = durationSec > 3 ? "answered" : "missed";
      fetch(api("/api/social/v2/call-history"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calleeUsername: peer, callType: "audio", status, durationSec }),
        credentials: "include",
      }).catch(() => {});
      callStartRef.current = null;
    }
  }, [call.callStatus, call.activePeer, user]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function loadMessages(roomId: number) {
    const r = await fetch(api(`/api/messages/rooms/${roomId}`), { credentials: "include" });
    const j = await r.json();
    setMessages(j.messages ?? []);
  }

  async function openRoom(room: DmRoom) {
    setShowHistory(false);
    setActiveRoom(room);
    await loadMessages(room.id);
  }

  function getPeerName(room: DmRoom): string {
    if (room.type === "group") return room.name ?? "Group";
    const other = room.members.find(m => m.username !== user?.username);
    return other?.username ?? "Chat";
  }

  async function sendMessage(audioUrl?: string) {
    if (!activeRoom || (!text.trim() && !audioUrl && !imgUrl.trim()) || sending) return;
    setSending(true);
    try {
      let body: object;
      if (audioUrl) {
        body = { audioUrl, type: "audio" };
      } else if (imgUrl.trim()) {
        body = { fileUrl: imgUrl.trim(), type: "file", content: "[Image]" };
      } else {
        body = { content: text.trim(), type: "text" };
      }
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
      await loadRooms();
      if (j.room) openRoom({ ...j.room, members: [], unreadCount: 0 });
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
        sendMessage(URL.createObjectURL(blob));
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    } catch { /* mic denied */ }
  }

  function stopVoiceNote() { recorderRef.current?.stop(); }

  if (!user) return (
    <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
      <MessageSquare size={36} style={{ opacity: 0.2, display: "block", margin: "0 auto 12px" }} />
      <p style={{ margin: 0, fontSize: 14 }}>{st.login_required}</p>
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 12, height: "calc(100vh - 280px)", minHeight: 440 }}>
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div style={{ width: 240, minWidth: 190, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
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
            <button onClick={() => { setShowHistory(v => !v); setActiveRoom(null); }}
              title={st.call_history ?? "Call History"}
              style={{ width: 34, padding: "7px 0", borderRadius: 8, background: showHistory ? `${GOLD}20` : "#1a1a1a", border: `1px solid ${showHistory ? GOLD : `${GOLD}20`}`, color: showHistory ? GOLD : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={13} />
            </button>
          </div>

          {/* New chat form */}
          {showNew && (
            <div style={{ background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 8, padding: 10 }}>
              {isGroup
                ? <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={st.group_name}
                    style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}20`, borderRadius: 6, padding: "6px 8px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                : <input value={newTarget} onChange={e => setNewTarget(e.target.value)} placeholder="Username…"
                    style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}20`, borderRadius: 6, padding: "6px 8px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              }
              <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                <button onClick={startNewChat}
                  style={{ flex: 1, padding: "6px 0", background: GOLD, border: "none", borderRadius: 6, fontWeight: 800, fontSize: 11, cursor: "pointer", color: "#000" }}>
                  {isGroup ? st.create_group : st.send}
                </button>
                <button onClick={() => { setShowNew(false); setNewTarget(""); setGroupName(""); }}
                  style={{ padding: "6px 8px", background: "#222", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer" }}>
                  <X size={11} />
                </button>
              </div>
            </div>
          )}

          {/* Room list */}
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
                  style={{ textAlign: "left", padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: isActive ? `${GOLD}15` : "transparent", display: "flex", gap: 8, alignItems: "center", width: "100%", transition: "background 0.15s" }}>
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ margin: 0, fontWeight: 700, color: isActive ? GOLD : "#fff", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {peerName}
                      </p>
                      {room.unreadCount > 0 && (
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
        </div>

        {/* ── Chat window ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#080808", border: `1px solid ${GOLD}10`, borderRadius: 12, overflow: "hidden", position: "relative" }}>
          {/* Call History Panel overlay */}
          <AnimatePresence>
            {showHistory && (
              <CallHistoryPanel st={st} user={user} onClose={() => setShowHistory(false)} />
            )}
          </AnimatePresence>

          {!activeRoom && !showHistory ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#333" }}>
              <MessageSquare size={40} />
              <p style={{ margin: 0, fontSize: 14 }}>{st.no_messages}</p>
            </div>
          ) : activeRoom ? (
            <>
              {/* Chat header */}
              <div style={{ padding: "11px 14px", borderBottom: `1px solid ${GOLD}10`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <Avatar name={getPeerName(activeRoom)} size={32} />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14 }}>{getPeerName(activeRoom)}</p>
                  <p style={{ margin: 0, fontSize: 11, color: call.onlineUsers.includes(getPeerName(activeRoom)) ? "#22c55e" : "#ffffff30" }}>
                    {call.onlineUsers.includes(getPeerName(activeRoom)) ? `● ${st.online}` : st.offline}
                  </p>
                </div>
                {/* Call buttons (direct only) */}
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
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map(msg => {
                  const mine = msg.username === user.username;
                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6 }}>
                      {!mine && <Avatar name={msg.username} size={24} />}
                      <div style={{ maxWidth: "70%", background: mine ? GOLD : "#1a1a1a", borderRadius: mine ? "14px 14px 2px 14px" : "14px 14px 14px 2px", padding: "8px 12px" }}>
                        {!mine && <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: GOLD }}>{msg.username}</p>}
                        {msg.type === "audio" && msg.audioUrl ? (
                          <audio controls src={msg.audioUrl} style={{ maxWidth: 200, height: 36 }} />
                        ) : msg.type === "file" && msg.fileUrl ? (
                          <img src={msg.fileUrl} alt="attachment" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6, display: "block" }}
                            onError={e => { (e.target as HTMLImageElement).alt = "Image unavailable"; }} />
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: mine ? "#000" : "#e5e7eb", wordBreak: "break-word" }} dir={dir}>{msg.content}</p>
                        )}
                        <p style={{ margin: "4px 0 0", fontSize: 10, color: mine ? "#00000060" : "#ffffff30", textAlign: "right" }}>
                          {timeAgo(msg.createdAt, st)}
                        </p>
                      </div>
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

              {/* Input bar */}
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${GOLD}08`, display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
                {/* Voice note */}
                <button onClick={recording ? stopVoiceNote : startVoiceNote}
                  title={recording ? st.stop_recording : st.record_voice}
                  style={{ width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", background: recording ? "#ef4444" : "#1a1a1a", color: recording ? "#fff" : "#888", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {recording ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
                {/* Attach image */}
                <button onClick={() => setShowImgInput(v => !v)} title={st.attach_image ?? "Image"}
                  style={{ width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", background: showImgInput ? `${GOLD}20` : "#1a1a1a", color: showImgInput ? GOLD : "#888", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Image size={14} />
                </button>
                {/* Text input */}
                <input value={text} onChange={e => setText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder={st.type_message} dir={dir} disabled={recording}
                  style={{ flex: 1, background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 20, padding: "8px 14px", color: "#fff", fontSize: 13, outline: "none", minWidth: 0 }} />
                {/* Send */}
                <button onClick={() => sendMessage()}
                  disabled={(!text.trim() && !imgUrl.trim()) || sending}
                  style={{ width: 34, height: 34, borderRadius: "50%", background: (text.trim() || imgUrl.trim()) ? GOLD : "#1a1a1a", border: "none", color: (text.trim() || imgUrl.trim()) ? "#000" : "#444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Send size={14} />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Screenshot toast */}
      <AnimatePresence>
        {toast && <Toast msg={toast} onDone={() => setToast("")} />}
      </AnimatePresence>
    </>
  );
}
