import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  MessageSquare, BookOpen, Users, Heart, Flame, Crown, Plus,
  Send, Clock, Loader2, X, Mic, Video, Type, ArrowRight,
  Zap, Radio, Star, Eye, Phone, PhoneCall
} from "lucide-react";
import { useCallContext } from "@/contexts/CallContext";
import LiveStoryRecorder from "@/components/LiveStoryRecorder";

const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// ─── Types ───────────────────────────────────────────────────────────────────
interface Story {
  id: number; username: string; content: string;
  audioUrl: string | null; type: string; domain: string;
  likes: number; expiresAt: string; createdAt: string;
}
interface FeedPost {
  id: number; username: string; content: string;
  domain: string; type: string; likes: number;
  createdAt: string; reactions?: Record<string, number>;
}
interface DmRoom {
  id: number; name: string | null; type: string; icon: string | null;
  members?: Array<{ userId: number; username: string }>;
  lastMessage?: { content: string | null; createdAt: string } | null;
  unreadCount?: number;
}
interface Citizen {
  id: number; username: string; xp: number; balance: number;
  wins: number; gamesPlayed: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}س`;
  return `${Math.floor(h / 24)}ي`;
}
function hoursLeft(d: string) {
  return Math.max(0, Math.floor((new Date(d).getTime() - Date.now()) / 3600000));
}
function Avatar({ name, size = 9, color = "#22c55e" }: { name: string; size?: number; color?: string }) {
  return (
    <div className="rounded-full flex items-center justify-center font-black text-black shrink-0"
      style={{ width: size * 4, height: size * 4, minWidth: size * 4, background: `linear-gradient(135deg, ${color}, ${color}99)`, fontSize: size * 1.4 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const DOMAIN_COLOR: Record<string, string> = {
  sport: "#22d3ee", tech: "#a78bfa", science: "#38bdf8",
  music: "#f472b6", business: "#4ade80", art: "#fb923c",
  education: "#22c55e", general: "#64748b",
};
const DOMAIN_ICON: Record<string, string> = {
  sport: "⚡", tech: "🔮", science: "🔬", music: "🎵",
  business: "💰", art: "🎨", education: "📚", general: "🌍",
};

const REACTIONS = [
  { emoji: "❤️", key: "heart",  label: "قلب"  },
  { emoji: "🔥", key: "fire",   label: "نار"  },
  { emoji: "👑", key: "crown",  label: "تاج"  },
  { emoji: "⚡", key: "zap",    label: "طاقة" },
];

// ─── Stories Strip ────────────────────────────────────────────────────────────
function StoriesStrip({ user }: { user: any }) {
  const [stories, setStories] = useState<Story[]>([]);
  const [posting, setPosting] = useState(false);
  const [newStory, setNewStory] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [domain, setDomain] = useState("general");
  const [active, setActive] = useState<Story | null>(null);

  useEffect(() => {
    fetch(`${BASE()}/api/stories/feed`, { credentials: "include" })
      .then(r => r.json()).then(d => setStories(d.stories ?? [])).catch(() => {});
  }, []);

  const postStory = async () => {
    if (!newStory.trim() || posting) return;
    setPosting(true);
    await fetch(`${BASE()}/api/stories`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newStory.trim(), type: "text", domain }),
    });
    setNewStory(""); setShowCompose(false); setPosting(false);
    const r = await fetch(`${BASE()}/api/stories/feed`, { credentials: "include" });
    const d = await r.json() as { stories: Story[] };
    setStories(d.stories ?? []);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Radio className="w-4 h-4" style={{ color: "#C9A84C" }} />
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#C9A84C" }}>
          STORIES · {stories.length} active
        </span>
        {user && (
          <button onClick={() => setShowCompose(v => !v)}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs font-bold"
            style={{ border: "1px solid #C9A84C40", color: "#C9A84C", background: "rgba(201,168,76,0.08)" }}>
            <Plus className="w-3 h-3" /> نشر
          </button>
        )}
      </div>

      {/* Compose */}
      <AnimatePresence>
        {showCompose && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-3">
            <div className="p-3 space-y-2" style={{ border: "1px solid #C9A84C25", background: "rgba(201,168,76,0.04)" }}>
              <textarea value={newStory} onChange={e => setNewStory(e.target.value)}
                placeholder="شارك لحظتك مع الإمبراطورية... (+10 عملات)"
                maxLength={400} rows={2}
                className="w-full px-3 py-2 text-sm resize-none focus:outline-none"
                style={{ background: "#0a0a0a", border: "1px solid #C9A84C20", color: "#fff" }}
                dir="auto" />
              <div className="flex gap-2 items-center">
                <select value={domain} onChange={e => setDomain(e.target.value)}
                  className="text-xs px-2 py-1 focus:outline-none"
                  style={{ background: "#111", border: "1px solid #C9A84C20", color: "#aaa" }}>
                  {Object.keys(DOMAIN_ICON).map(k => (
                    <option key={k} value={k}>{DOMAIN_ICON[k]} {k}</option>
                  ))}
                </select>
                <button onClick={postStory} disabled={!newStory.trim() || posting}
                  className="ml-auto px-4 py-1.5 text-xs font-black text-black disabled:opacity-40"
                  style={{ background: "#C9A84C" }}>
                  {posting ? "..." : "نشر"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        {stories.length === 0 ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: "#ffffff30" }}>
            <BookOpen className="w-4 h-4" /> لا ستوريات بعد — كن الأول
          </div>
        ) : stories.slice(0, 20).map(s => {
          const dc = DOMAIN_COLOR[s.domain] ?? "#64748b";
          const hl = hoursLeft(s.expiresAt);
          return (
            <button key={s.id} onClick={() => setActive(s)}
              className="flex flex-col items-center gap-1.5 shrink-0 group">
              <div className="relative w-14 h-14 rounded-full p-0.5"
                style={{ background: `conic-gradient(${dc} 0%, ${dc}${hl < 3 ? "40" : "80"} 100%, transparent 100%)` }}>
                <div className="w-full h-full rounded-full flex items-center justify-center font-black text-lg"
                  style={{ background: "#111", border: "2px solid #111" }}>
                  {DOMAIN_ICON[s.domain] ?? "🌍"}
                </div>
                {hl < 3 && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full text-[8px] flex items-center justify-center font-black"
                    style={{ background: "#ef4444", color: "#fff" }}>{hl}h</span>
                )}
              </div>
              <span className="text-[10px] font-bold max-w-[56px] truncate" style={{ color: "#ffffff70" }}>
                {s.username}
              </span>
            </button>
          );
        })}
        <Link href="/stories">
          <button className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ border: "1px dashed #C9A84C30" }}>
              <ArrowRight className="w-5 h-5" style={{ color: "#C9A84C40" }} />
            </div>
            <span className="text-[10px]" style={{ color: "#C9A84C40" }}>الكل</span>
          </button>
        </Link>
      </div>

      {/* Story viewer modal */}
      <AnimatePresence>
        {active && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.92)" }} onClick={() => setActive(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="w-full max-w-sm p-6 space-y-4"
              style={{ background: "#0a0a0a", border: `1px solid ${DOMAIN_COLOR[active.domain] ?? "#333"}40` }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <Avatar name={active.username} color={DOMAIN_COLOR[active.domain]} />
                <div>
                  <div className="font-bold text-sm">{active.username}</div>
                  <div className="text-xs" style={{ color: "#ffffff40" }}>
                    {timeAgo(active.createdAt)} · {hoursLeft(active.expiresAt)}س متبقية
                  </div>
                </div>
                <button onClick={() => setActive(null)} className="ml-auto" style={{ color: "#ffffff40" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm leading-relaxed" dir="auto">{active.content}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5"
                  style={{ background: `${DOMAIN_COLOR[active.domain]}20`, color: DOMAIN_COLOR[active.domain] ?? "#fff" }}>
                  {DOMAIN_ICON[active.domain]} {active.domain}
                </span>
                <span className="text-xs ml-auto" style={{ color: "#ffffff40" }}>
                  ❤️ {active.likes}
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Feed Post Card ───────────────────────────────────────────────────────────
function FeedCard({ post, userId }: { post: FeedPost; userId?: number }) {
  const [reactions, setReactions] = useState<Record<string, number>>(post.reactions ?? {});
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);

  const react = async (key: string) => {
    if (myReaction === key) return;
    setMyReaction(key);
    setReactions(r => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
    await fetch(`${BASE()}/api/social/react`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: post.id, reaction: key }),
    }).catch(() => {});
  };

  const like = async () => {
    if (liked) return;
    setLiked(true);
    await fetch(`${BASE()}/api/pulse/${post.id}/like`, { method: "POST", credentials: "include" }).catch(() => {});
  };

  const dc = DOMAIN_COLOR[post.domain] ?? "#64748b";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="p-4 space-y-3"
      style={{ border: "1px solid #ffffff08", background: "rgba(255,255,255,0.02)" }}>

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Avatar name={post.username} color={dc} size={8} />
        <div className="flex-1 min-w-0">
          <Link href={`/citizen/${post.username}`}>
            <span className="text-sm font-bold hover:opacity-80 cursor-pointer">{post.username}</span>
          </Link>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "#ffffff35" }}>
            <span>{timeAgo(post.createdAt)}</span>
            <span>·</span>
            <span style={{ color: dc }}>{DOMAIN_ICON[post.domain]} {post.domain}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <p className="text-sm leading-relaxed" style={{ color: "#ffffffc0" }} dir="auto">
        {post.content}
      </p>

      {/* Reactions */}
      <div className="flex items-center gap-1.5 pt-1">
        {REACTIONS.map(r => (
          <button key={r.key} onClick={() => react(r.key)}
            className="flex items-center gap-1 px-2 py-1 text-xs transition-all"
            style={{
              border: `1px solid ${myReaction === r.key ? "#C9A84C40" : "#ffffff10"}`,
              background: myReaction === r.key ? "rgba(201,168,76,0.1)" : "transparent",
              color: myReaction === r.key ? "#C9A84C" : "#ffffff40",
            }}>
            <span className="text-sm leading-none">{r.emoji}</span>
            {(reactions[r.key] ?? 0) > 0 && (
              <span className="font-mono">{reactions[r.key]}</span>
            )}
          </button>
        ))}
        <button onClick={like}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-xs"
          style={{
            border: `1px solid ${liked ? "#ef444440" : "#ffffff10"}`,
            color: liked ? "#ef4444" : "#ffffff40",
            background: liked ? "rgba(239,68,68,0.08)" : "transparent",
          }}>
          <Heart className={`w-3 h-3 ${liked ? "fill-current" : ""}`} />
          <span>{post.likes + (liked ? 1 : 0)}</span>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Quick Messages Panel ─────────────────────────────────────────────────────
function QuickMessages({ user }: { user: any }) {
  const call = useCallContext();
  const [rooms, setRooms] = useState<DmRoom[]>([]);
  const [input, setInput] = useState<Record<number, string>>({});
  const [active, setActive] = useState<DmRoom | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [newDm, setNewDm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadRooms = useCallback(async () => {
    if (!user) return;
    const r = await fetch(`${BASE()}/api/messages/rooms`, { credentials: "include" });
    const d = await r.json() as { rooms: DmRoom[] };
    setRooms(d.rooms ?? []);
  }, [user]);

  const openRoom = async (room: DmRoom) => {
    setActive(room);
    const r = await fetch(`${BASE()}/api/messages/rooms/${room.id}`, { credentials: "include" });
    const d = await r.json() as { messages: any[] };
    setMsgs(d.messages ?? []);
  };

  const send = async () => {
    if (!active || !input[active.id]?.trim() || sending) return;
    setSending(true);
    await fetch(`${BASE()}/api/messages/rooms/${active.id}/send`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "text", content: input[active.id].trim() }),
    });
    setInput(v => ({ ...v, [active.id]: "" }));
    const r = await fetch(`${BASE()}/api/messages/rooms/${active.id}`, { credentials: "include" });
    const d = await r.json() as { messages: any[] };
    setMsgs(d.messages ?? []);
    setSending(false);
  };

  const startDm = async () => {
    if (!newDm.trim()) return;
    const r = await fetch(`${BASE()}/api/messages/rooms`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUsername: newDm.trim(), type: "direct" }),
    });
    const d = await r.json() as { room?: DmRoom };
    if (d.room) { setShowNew(false); setNewDm(""); loadRooms(); openRoom(d.room); }
  };

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => openRoom(active), 5000);
    return () => clearInterval(t);
  }, [active]);

  const getRoomName = (r: DmRoom) => {
    if (r.type === "group") return r.name ?? "مجموعة";
    return r.members?.find(m => m.userId !== user?.id)?.username ?? "محادثة";
  };

  if (!user) return (
    <div className="text-center py-12 space-y-3">
      <MessageSquare className="w-12 h-12 mx-auto opacity-20" style={{ color: "#C9A84C" }} />
      <p className="text-sm" style={{ color: "#ffffff40" }}>سجّل دخولك للوصول للرسائل</p>
      <Link href="/login">
        <button className="px-4 py-2 text-sm font-bold text-black" style={{ background: "#C9A84C" }}>
          دخول الإمبراطورية
        </button>
      </Link>
    </div>
  );

  return (
    <div className="flex h-[420px]" style={{ border: "1px solid #C9A84C15" }}>
      {/* Sidebar */}
      <div className={`border-r flex flex-col ${active ? "hidden md:flex" : "flex"}`}
        style={{ width: 220, borderColor: "#C9A84C15", background: "#080808" }}>
        <div className="p-3 flex items-center justify-between" style={{ borderBottom: "1px solid #C9A84C15" }}>
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#C9A84C" }}>
            الرسائل
          </span>
          <button onClick={() => setShowNew(v => !v)}
            className="w-6 h-6 flex items-center justify-center text-black"
            style={{ background: "#C9A84C" }}>
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {showNew && (
          <div className="p-2 space-y-1" style={{ borderBottom: "1px solid #C9A84C10" }}>
            <input value={newDm} onChange={e => setNewDm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startDm()}
              placeholder="اسم المواطن..."
              className="w-full px-2 py-1 text-xs focus:outline-none"
              style={{ background: "#111", border: "1px solid #C9A84C20", color: "#fff" }}
              dir="auto" />
            <button onClick={startDm} className="w-full py-1 text-xs font-bold text-black"
              style={{ background: "#C9A84C" }}>
              بدء المحادثة
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {rooms.length === 0 ? (
            <div className="text-center py-6 px-2">
              <p className="text-[10px]" style={{ color: "#ffffff25" }}>لا محادثات — ابدأ DM</p>
            </div>
          ) : rooms.map(r => (
            <button key={r.id} onClick={() => openRoom(r)}
              className="w-full flex items-center gap-2 p-2.5 text-left"
              style={{ background: active?.id === r.id ? "rgba(201,168,76,0.08)" : "transparent", borderBottom: "1px solid #C9A84C08" }}>
              <Avatar name={getRoomName(r)} size={7} color="#C9A84C" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate">{getRoomName(r)}</div>
                <div className="text-[10px] truncate" style={{ color: "#ffffff30" }}>
                  {r.lastMessage?.content ?? "لا رسائل"}
                </div>
              </div>
              {(r.unreadCount ?? 0) > 0 && (
                <span className="w-4 h-4 rounded-full text-[9px] font-black text-black flex items-center justify-center shrink-0"
                  style={{ background: "#C9A84C" }}>{r.unreadCount}</span>
              )}
            </button>
          ))}
        </div>

        <Link href="/messages">
          <button className="w-full py-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ borderTop: "1px solid #C9A84C15", color: "#C9A84C50" }}>
            فتح الرسائل الكاملة →
          </button>
        </Link>
      </div>

      {/* Chat */}
      {active ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid #C9A84C15", background: "#080808" }}>
            <button className="md:hidden mr-1" onClick={() => setActive(null)} style={{ color: "#ffffff40" }}>←</button>
            <Avatar name={getRoomName(active)} size={7} color="#C9A84C" />
            <span className="text-sm font-bold flex-1">{getRoomName(active)}</span>
            {/* Call buttons */}
            <button title="مكالمة صوتية"
              onClick={() => call.startCall(getRoomName(active), false)}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid #22c55e30", color: "#22c55e" }}>
              <Phone className="w-3.5 h-3.5" />
            </button>
            <button title="مكالمة فيديو"
              onClick={() => call.startCall(getRoomName(active), true)}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid #3b82f630", color: "#3b82f6" }}>
              <Video className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.map(m => {
              const isMe = m.userId === user?.id;
              return (
                <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                  <div className="text-xs px-3 py-1.5 max-w-[80%]"
                    dir="auto"
                    style={{
                      background: isMe ? "#C9A84C" : "#1a1a1a",
                      color: isMe ? "#000" : "#ffffffc0",
                    }}>
                    {m.content}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 p-2" style={{ borderTop: "1px solid #C9A84C15", background: "#080808" }}>
            <input
              value={input[active.id] ?? ""}
              onChange={e => setInput(v => ({ ...v, [active.id]: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="رسالتك..."
              className="flex-1 px-3 py-1.5 text-xs focus:outline-none"
              style={{ background: "#111", border: "1px solid #C9A84C20", color: "#fff" }}
              dir="auto"
            />
            <button onClick={send} disabled={sending}
              className="px-3 py-1.5 text-black font-bold text-xs disabled:opacity-40"
              style={{ background: "#C9A84C" }}>
              {sending ? "..." : <Send className="w-3 h-3" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-center p-8">
          <div>
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-10" style={{ color: "#C9A84C" }} />
            <p className="text-xs" style={{ color: "#ffffff25" }}>اختر محادثة أو ابدأ واحدة جديدة</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Citizens Online ──────────────────────────────────────────────────────────
function CitizensOnline() {
  const [citizens, setCitizens] = useState<Citizen[]>([]);

  useEffect(() => {
    fetch(`${BASE()}/api/citizens`, { credentials: "include" })
      .then(r => r.json()).then(d => setCitizens(d.citizens?.slice(0, 24) ?? [])).catch(() => {});
  }, []);

  const ranks = [
    { min: 0,    label: "Foot Soldier", color: "#8B7355" },
    { min: 1000, label: "Knight",       color: "#aaa9ad" },
    { min: 3500, label: "Commander",    color: "#C9A84C" },
    { min: 7500, label: "Champion",     color: "#00D4FF" },
  ];
  const getRank = (xp: number) => [...ranks].reverse().find(r => xp >= r.min) ?? ranks[0];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {citizens.map((c, i) => {
        const r = getRank(c.xp);
        return (
          <Link key={c.id} href={`/citizen/${c.username}`}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
              className="p-3 text-center hover:opacity-80 transition-opacity cursor-pointer"
              style={{ border: "1px solid #ffffff08", background: "rgba(255,255,255,0.02)" }}>
              <div className="mx-auto mb-2">
                <Avatar name={c.username} size={9} color={r.color} />
              </div>
              <div className="text-xs font-bold truncate">{c.username}</div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: r.color }}>{r.label}</div>
              <div className="flex items-center justify-center gap-2 mt-1.5">
                <span className="text-[9px] font-mono" style={{ color: "#C9A84C80" }}>{c.balance.toLocaleString()} ¢</span>
                <span className="text-[9px] font-mono" style={{ color: "#ffffff25" }}>{c.xp} XP</span>
              </div>
            </motion.div>
          </Link>
        );
      })}
      {citizens.length === 0 && Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="p-3 animate-pulse" style={{ border: "1px solid #ffffff05", background: "rgba(255,255,255,0.01)", height: 88 }} />
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const TABS = [
  { key: "feed",     label: "الفيد",       icon: <Zap       className="w-4 h-4" /> },
  { key: "live",     label: "لايف",        icon: <Radio     className="w-4 h-4" />, badge: "🔴" },
  { key: "messages", label: "الرسائل",     icon: <MessageSquare className="w-4 h-4" /> },
  { key: "citizens", label: "المواطنون",   icon: <Users     className="w-4 h-4" /> },
];

export default function SocialPage() {
  const { user } = useAuth();
  const call = useCallContext();
  const [tab, setTab] = useState<"feed" | "live" | "messages" | "citizens">("feed");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [pulse, setPulse] = useState<any>({ citizens: 0, voices: 0 });

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const [fr, sr] = await Promise.all([
        fetch(`${BASE()}/api/pulse/feed?limit=30`, { credentials: "include" }),
        fetch(`${BASE()}/api/pulse/stats`, { credentials: "include" }),
      ]);
      const fd = await fr.json() as { posts: FeedPost[] };
      const sd = await sr.json();
      setPosts(fd.posts ?? []);
      setPulse(sd);
    } catch {} finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Compose state
  const [compose, setCompose] = useState("");
  const [composeDomain, setComposeDomain] = useState("general");
  const [posting, setPosting] = useState(false);

  const publishPost = async () => {
    if (!compose.trim() || posting) return;
    setPosting(true);
    await fetch(`${BASE()}/api/pulse`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: compose.trim(), domain: composeDomain, type: "text" }),
    }).catch(() => {});
    setCompose("");
    setPosting(false);
    loadFeed();
  };

  return (
    <div className="min-h-screen" style={{ background: "#050505" }}>

      {/* ── Hero bar ── */}
      <div className="sticky top-14 z-40 border-b" style={{ background: "rgba(5,5,5,0.97)", borderColor: "#C9A84C15", backdropFilter: "blur(12px)" }}>
        <div className="max-w-4xl mx-auto px-4">
          {/* Title row */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
                <span className="text-xs font-mono uppercase tracking-widest" style={{ color: "#22c55e" }}>LIVE</span>
              </div>
              <h1 className="text-lg font-black uppercase tracking-wider" style={{ color: "#C9A84C" }}>
                SOCIAL HUB
              </h1>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono" style={{ color: "#ffffff25" }}>
              <span><Star className="w-3 h-3 inline mr-1" style={{ color: "#C9A84C50" }} />{pulse.citizens ?? "—"}</span>
              <span><Eye className="w-3 h-3 inline mr-1" />{posts.length} منشور</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all relative"
                style={{
                  color: tab === t.key ? (t.key === "live" ? "#ef4444" : "#C9A84C") : "#ffffff35",
                  borderBottom: tab === t.key ? `2px solid ${t.key === "live" ? "#ef4444" : "#C9A84C"}` : "2px solid transparent",
                }}>
                {t.icon} {t.label}
                {t.key === "live" && call.activeLives.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* ── FEED TAB ── */}
        {tab === "feed" && (
          <div className="space-y-4">
            {/* Stories strip always visible in feed */}
            <div className="p-4" style={{ border: "1px solid #C9A84C20", background: "rgba(201,168,76,0.02)" }}>
              <StoriesStrip user={user} />
            </div>

            {/* Compose box */}
            {user ? (
              <div className="p-4 space-y-3" style={{ border: "1px solid #C9A84C20", background: "rgba(201,168,76,0.02)" }}>
                <div className="flex items-center gap-3 mb-1">
                  <Avatar name={user.username} color="#C9A84C" size={8} />
                  <span className="text-sm font-bold">{user.username}</span>
                  <span className="ml-auto text-xs font-bold" style={{ color: "#22c55e" }}>+20 XP</span>
                </div>
                <textarea
                  value={compose} onChange={e => setCompose(e.target.value)}
                  placeholder="ماذا تقول للإمبراطورية اليوم؟..."
                  maxLength={500} rows={2}
                  className="w-full px-3 py-2 text-sm resize-none focus:outline-none"
                  style={{ background: "#0a0a0a", border: "1px solid #C9A84C15", color: "#fff" }}
                  dir="auto"
                />
                <div className="flex gap-2 items-center">
                  <select value={composeDomain} onChange={e => setComposeDomain(e.target.value)}
                    className="text-xs px-2 py-1 focus:outline-none"
                    style={{ background: "#111", border: "1px solid #C9A84C20", color: "#aaa" }}>
                    {Object.keys(DOMAIN_ICON).map(k => (
                      <option key={k} value={k}>{DOMAIN_ICON[k]} {k}</option>
                    ))}
                  </select>
                  <span className="text-xs ml-auto" style={{ color: "#ffffff25" }}>{compose.length}/500</span>
                  <button onClick={publishPost} disabled={!compose.trim() || posting}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-black text-black disabled:opacity-40"
                    style={{ background: "#C9A84C" }}>
                    {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    نشر
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 text-center space-y-3" style={{ border: "1px solid #C9A84C20" }}>
                <p className="text-sm" style={{ color: "#ffffff40" }}>سجّل دخولك للتفاعل مع المواطنين</p>
                <div className="flex gap-2 justify-center">
                  <Link href="/login"><button className="px-4 py-2 text-sm font-bold text-black" style={{ background: "#C9A84C" }}>دخول</button></Link>
                  <Link href="/register"><button className="px-4 py-2 text-sm font-bold" style={{ border: "1px solid #C9A84C40", color: "#C9A84C" }}>تسجيل</button></Link>
                </div>
              </div>
            )}

            {/* Posts */}
            {feedLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#C9A84C40" }} />
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-12" style={{ color: "#ffffff25" }}>
                <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: "#C9A84C" }} />
                <p className="text-sm">لا منشورات بعد</p>
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map(p => <FeedCard key={p.id} post={p} userId={user?.id} />)}
              </div>
            )}
          </div>
        )}

        {/* ── LIVE TAB ── */}
        {tab === "live" && (
          <div className="space-y-4">
            {!user ? (
              <div className="text-center py-10 space-y-3">
                <Radio className="w-12 h-12 mx-auto opacity-20" style={{ color: "#ef4444" }} />
                <p className="text-sm" style={{ color: "#ffffff40" }}>سجّل دخولك لبدء بث مباشر</p>
                <Link href="/login"><button className="px-4 py-2 text-sm font-bold text-white" style={{ background: "#ef4444" }}>دخول الإمبراطورية</button></Link>
              </div>
            ) : (
              <LiveStoryRecorder
                liveStatus={call.liveStatus}
                localStream={call.localStream}
                currentLiveId={call.currentLiveId}
                activeLives={call.activeLives}
                onStartLive={call.startLive}
                onEndLive={call.endLive}
                onJoinLive={call.joinLive}
                remoteStream={call.remoteStream}
              />
            )}
          </div>
        )}

        {/* ── STORIES TAB (hidden, kept for data) ── */}
        {tab === ("stories" as any) && (
          <div className="space-y-4">
            <div className="p-4" style={{ border: "1px solid #C9A84C20", background: "rgba(201,168,76,0.02)" }}>
              <StoriesStrip user={user} />
            </div>
            <div className="text-center py-4">
              <Link href="/stories">
                <button className="flex items-center gap-2 mx-auto px-6 py-3 font-bold text-black"
                  style={{ background: "#C9A84C" }}>
                  <BookOpen className="w-4 h-4" /> فتح صفحة الستوريات الكاملة
                </button>
              </Link>
            </div>
          </div>
        )}

        {/* ── MESSAGES TAB ── */}
        {tab === "messages" && (
          <QuickMessages user={user} />
        )}

        {/* ── CITIZENS TAB ── */}
        {tab === "citizens" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-widest" style={{ color: "#C9A84C60" }}>
                مواطنو الإمبراطورية
              </span>
              <Link href="/citizens">
                <button className="text-xs font-mono" style={{ color: "#C9A84C40" }}>
                  عرض الكل →
                </button>
              </Link>
            </div>
            <CitizensOnline />
          </div>
        )}
      </div>
    </div>
  );
}
