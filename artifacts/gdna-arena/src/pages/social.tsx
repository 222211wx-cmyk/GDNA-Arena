/**
 * SOCIAL HUB — GDNA Arena
 * Tabs: Feed · Messages · Stories · Live · Citizens
 * Features: Posts, Likes, Comments, DM, Group Chat, WebRTC Calls,
 *           Voice Notes, 24h Stories, Go Live, Follow System, Global Search
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Heart, Share2, Search, Users, Radio, Send,
  Phone, Video, Mic, MicOff, Image, X, Plus, ChevronDown,
  UserPlus, UserCheck, Globe, Flame, Crown, Zap, Eye, Camera,
  Clock, MoreHorizontal, Reply, BookOpen, Bell, TrendingUp,
} from "lucide-react";
import { useAuth }        from "../contexts/AuthContext";
import { useLang }        from "../contexts/LangContext";
import { useCallContext } from "../contexts/CallContext";
import LiveStoryRecorder  from "../components/LiveStoryRecorder";

// ── BASE URL for API calls ────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api  = (path: string) => `${BASE}${path}`;

// ── Local i18n ────────────────────────────────────────────────────────────────
const SOCIAL_T: Record<string, Record<string, string>> = {
  en: {
    title: "Social Hub", feed: "Feed", messages: "Messages", stories: "Stories",
    live: "Live", citizens: "Citizens", notifications: "Notifications",
    search_placeholder: "Search the empire…",
    post_placeholder: "Share your voice with the empire…", post_btn: "Post",
    like: "Like", comment: "Comment", share: "Share", comments: "Comments",
    write_comment: "Write a comment…", send: "Send", reply: "Reply",
    follow: "Follow", following: "Following", follow_back: "Follow Back",
    voice_call: "Voice Call", video_call: "Video Call", voice_note: "Voice Note",
    dm: "Message", new_group: "New Group", group_name: "Group name…",
    no_posts: "No posts yet. Be the first!", no_messages: "No messages yet.",
    no_stories: "No stories yet. Share your moment!", no_citizens: "No citizens found.",
    no_notifications: "No notifications yet", search_results: "Search Results",
    type_message: "Type a message…",
    stories_expire: "Stories expire after 24h", add_story: "Add Story",
    story_text: "Story text (max 200 chars)…", story_image: "Image URL (optional)",
    domain: "Domain", general: "General", sport: "Sport", music: "Music",
    cinema: "Cinema", tech: "Tech", art: "Arts", go_live: "Go Live",
    active_lives: "Live Now", join_live: "Join", login_required: "Login to interact",
    load_more: "Load More", just_now: "just now", ago: "ago",
    xp: "XP", coins: "Coins", rank: "Rank",
    all: "All", following_only: "Following",
    create_group: "Create Group", join_group: "Join",
    online: "Online", offline: "Offline",
    record_voice: "Record Voice Note", stop_recording: "Stop",
    share_copied: "Link copied!", my_profile: "My Profile",
    trending: "Trending", notif_comment: "commented on your post",
    notif_follow: "started following you", notif_reaction: "reacted to your post",
    react: "React",
  },
  ar: {
    title: "المركز الاجتماعي", feed: "المنشورات", messages: "الرسائل",
    stories: "القصص", live: "بث مباشر", citizens: "المواطنون",
    notifications: "الإشعارات",
    search_placeholder: "ابحث في الإمبراطورية…",
    post_placeholder: "شارك صوتك مع الإمبراطورية…", post_btn: "نشر",
    like: "إعجاب", comment: "تعليق", share: "مشاركة", comments: "التعليقات",
    write_comment: "اكتب تعليقاً…", send: "إرسال", reply: "رد",
    follow: "متابعة", following: "يتابع", follow_back: "تابع بالمثل",
    voice_call: "مكالمة صوتية", video_call: "مكالمة فيديو", voice_note: "رسالة صوتية",
    dm: "رسالة", new_group: "مجموعة جديدة", group_name: "اسم المجموعة…",
    no_posts: "لا منشورات بعد. كن الأول!", no_messages: "لا رسائل بعد.",
    no_stories: "لا قصص بعد. شارك لحظتك!", no_citizens: "لم يُعثر على مواطنين.",
    no_notifications: "لا إشعارات بعد", search_results: "نتائج البحث",
    type_message: "اكتب رسالة…",
    stories_expire: "تنتهي القصص بعد 24 ساعة", add_story: "أضف قصة",
    story_text: "نص القصة (200 حرف كحد أقصى)…", story_image: "رابط الصورة (اختياري)",
    domain: "المجال", general: "عام", sport: "رياضة", music: "موسيقى",
    cinema: "سينما", tech: "تقنية", art: "فنون", go_live: "ابدأ البث",
    active_lives: "بث مباشر الآن", join_live: "انضم", login_required: "سجل دخولك للتفاعل",
    load_more: "تحميل المزيد", just_now: "الآن", ago: "منذ",
    xp: "XP", coins: "كوينز", rank: "الرتبة",
    all: "الكل", following_only: "المتابَعون",
    create_group: "إنشاء مجموعة", join_group: "انضم",
    online: "متصل", offline: "غير متصل",
    record_voice: "تسجيل رسالة صوتية", stop_recording: "إيقاف",
    share_copied: "تم نسخ الرابط!", my_profile: "ملفي",
    trending: "الأكثر تداولاً", notif_comment: "علّق على منشورك",
    notif_follow: "بدأ متابعتك", notif_reaction: "تفاعل مع منشورك",
    react: "تفاعل",
  },
};

// ── Types ────────────────────────────────────────────────────────────────────
interface FeedPost {
  id: number; userId?: number; username: string; content: string;
  domain: string; type: string; likes: number; commentCount: number;
  createdAt: string;
}
interface Comment {
  id: number; postId: number; username: string; content: string; createdAt: string;
}
interface DmRoom {
  id: number; name?: string; type: string; icon?: string; createdAt: string;
  members: { userId: number; username: string }[];
  lastMessage?: { content?: string; type: string; createdAt: string } | null;
  unreadCount: number;
}
interface DmMessage {
  id: number; roomId: number; userId?: number; username: string;
  content?: string; audioUrl?: string; type: string; createdAt: string;
}
interface Story {
  id: number; username: string; content: string; imageUrl?: string;
  domain: string; likes: number; expiresAt: string; createdAt: string;
}
interface Citizen {
  id: number; username: string; xp: number; balance: number;
  rank: { label: string; icon: string; color: string };
}

// ── Utility helpers ──────────────────────────────────────────────────────────
function timeAgo(dateStr: string, st: Record<string, string>): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)  return st.just_now;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${st.ago}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${st.ago}`;
  return `${Math.floor(diff / 86400)}d ${st.ago}`;
}

const GOLD = "#C9A84C";
const DOMAIN_ICONS: Record<string, string> = {
  sport: "⚽", music: "🎵", cinema: "🎬", tech: "💡", art: "🎨", general: "🌍",
};

// ── Avatar pill ───────────────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colors = ["#C9A84C", "#3b82f6", "#a78bfa", "#22c55e", "#ef4444", "#f59e0b"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, minWidth: size, background: color, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 900, color: "#000" }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FEED TAB
// ─────────────────────────────────────────────────────────────────────────────
function FeedTab({ user, st, dir }: { user: any; st: Record<string, string>; dir: string }) {
  const [posts,    setPosts]    = useState<FeedPost[]>([]);
  const [content,  setContent]  = useState("");
  const [domain,   setDomain]   = useState("general");
  const [loading,  setLoading]  = useState(false);
  const [posting,  setPosting]  = useState(false);
  const [filter,   setFilter]   = useState("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [likedSet, setLikedSet] = useState<Set<number>>(new Set());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/social/v2/feed?limit=30`));
      const j = await r.json();
      setPosts(j.posts ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function submitPost() {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const r = await fetch(api("/api/social/v2/post"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, domain }),
        credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setPosts(prev => [{ ...j.post }, ...prev]);
        setContent("");
      }
    } finally { setPosting(false); }
  }

  async function likePost(postId: number) {
    if (likedSet.has(postId)) return;
    const r = await fetch(api(`/api/social/v2/post/${postId}/like`), {
      method: "POST", credentials: "include",
    });
    const j = await r.json();
    if (!j.alreadyLiked && j.likes != null) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: j.likes } : p));
    }
    setLikedSet(prev => new Set([...prev, postId]));
  }

  function sharePost(postId: number) {
    navigator.clipboard.writeText(`${window.location.origin}/social#post-${postId}`).catch(() => {});
  }

  const DOMAINS = ["general","sport","music","cinema","tech","art"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Composer */}
      {user && (
        <div style={{ background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Avatar name={user.username} />
            <textarea
              value={content} onChange={e => setContent(e.target.value)}
              placeholder={st.post_placeholder} maxLength={500} dir={dir}
              rows={3}
              style={{ flex: 1, background: "transparent", border: "none", color: "#fff", resize: "none", fontSize: 14, outline: "none", lineHeight: 1.5 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DOMAINS.map(d => (
                <button key={d} onClick={() => setDomain(d)}
                  style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: domain === d ? GOLD : "#222", color: domain === d ? "#000" : "#fff" }}>
                  {DOMAIN_ICONS[d]} {st[d] ?? d}
                </button>
              ))}
            </div>
            <button onClick={submitPost} disabled={!content.trim() || posting}
              style={{ padding: "8px 20px", borderRadius: 20, fontWeight: 900, fontSize: 13, border: "none", cursor: "pointer", background: content.trim() ? GOLD : "#333", color: content.trim() ? "#000" : "#666", opacity: posting ? 0.5 : 1 }}>
              {posting ? "…" : st.post_btn}
            </button>
          </div>
        </div>
      )}

      {/* Trending section */}
      <TrendingSection st={st} dir={dir} onSearch={(tag) => setFilter("all")} />

      {/* Domain filter */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {["all", ...DOMAINS].map(d => (
          <button key={d} onClick={() => setFilter(d)}
            style={{ whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: filter === d ? GOLD : "#111", color: filter === d ? "#000" : "#888" }}>
            {d === "all" ? st.all : `${DOMAIN_ICONS[d]} ${st[d] ?? d}`}
          </button>
        ))}
      </div>

      {/* Posts */}
      {loading && <div style={{ textAlign: "center", color: "#444", padding: 32 }}>…</div>}
      {!loading && posts.length === 0 && (
        <div style={{ textAlign: "center", color: "#444", padding: 48 }}>{st.no_posts}</div>
      )}
      {posts
        .filter(p => filter === "all" || p.domain === filter)
        .map(post => (
          <FeedCard key={post.id} post={post} user={user} st={st} dir={dir}
            liked={likedSet.has(post.id)}
            onLike={() => likePost(post.id)}
            onShare={() => sharePost(post.id)}
            expanded={!!expanded[post.id]}
            onToggleComments={() => setExpanded(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
          />
        ))}
    </div>
  );
}

function FeedCard({ post, user, st, dir, liked, onLike, onShare, expanded, onToggleComments }:
  { post: FeedPost; user: any; st: Record<string, string>; dir: string;
    liked: boolean; onLike: () => void; onShare: () => void;
    expanded: boolean; onToggleComments: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadedComments, setLoadedComments] = useState(false);
  const [sending, setSending] = useState(false);

  async function loadComments() {
    if (loadedComments) return;
    const r = await fetch(api(`/api/social/v2/post/${post.id}/comments`));
    const j = await r.json();
    setComments(j.comments ?? []);
    setLoadedComments(true);
  }

  function handleToggle() {
    onToggleComments();
    if (!loadedComments) loadComments();
  }

  async function sendComment() {
    if (!newComment.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch(api(`/api/social/v2/post/${post.id}/comment`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment }), credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setComments(prev => [...prev, j.comment]);
        setNewComment("");
      }
    } finally { setSending(false); }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      id={`post-${post.id}`}
      style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
        <Avatar name={post.username} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14 }}>{post.username}</p>
          <p style={{ margin: 0, fontSize: 11, color: "#ffffff40" }}>
            {DOMAIN_ICONS[post.domain]} {post.domain} · {timeAgo(post.createdAt, st)}
          </p>
        </div>
      </div>
      {/* Content */}
      <div style={{ padding: "0 16px 12px", color: "#e5e7eb", fontSize: 14, lineHeight: 1.6 }} dir={dir}>
        {post.content}
      </div>
      {/* Actions */}
      <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderTop: `1px solid #ffffff08` }}>
        <ReactionBtn postId={post.id} totalLikes={post.likes} st={st} />
        <ActionBtn icon={<MessageSquare size={15} />}
          label={`${post.commentCount} ${st.comment}`} onClick={handleToggle}
          active={expanded} color={GOLD} />
        <ActionBtn icon={<Share2 size={15} />} label={st.share} onClick={onShare} color="#3b82f6" />
      </div>
      {/* Comments */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            style={{ overflow: "hidden" }}>
            <div style={{ padding: "0 16px 12px", borderTop: `1px solid #ffffff08` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: GOLD, margin: "10px 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>{st.comments}</p>
              {comments.map(c => (
                <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <Avatar name={c.username} size={24} />
                  <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "6px 10px", flex: 1 }}>
                    <span style={{ fontWeight: 700, color: GOLD, fontSize: 12 }}>{c.username}</span>
                    <span style={{ color: "#ccc", fontSize: 13, marginLeft: 8 }} dir={dir}>{c.content}</span>
                  </div>
                </div>
              ))}
              {user && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Avatar name={user.username} size={24} />
                  <input value={newComment} onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendComment()}
                    placeholder={st.write_comment} dir={dir}
                    style={{ flex: 1, background: "#1a1a1a", border: `1px solid ${GOLD}20`, borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 13, outline: "none" }} />
                  <button onClick={sendComment} disabled={sending || !newComment.trim()}
                    style={{ padding: "6px 14px", borderRadius: 8, background: GOLD, border: "none", color: "#000", fontWeight: 800, cursor: "pointer", fontSize: 12, opacity: sending ? 0.5 : 1 }}>
                    {st.send}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionBtn({ icon, label, onClick, active, color }: {
  icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; color: string;
}) {
  return (
    <button onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: active ? `${color}15` : "transparent", color: active ? color : "#ffffff50", fontSize: 12, fontWeight: 600, transition: "all 0.2s" }}>
      {icon}{label}
    </button>
  );
}

// ── Emoji Reaction Button ─────────────────────────────────────────────────────
const EMOJIS = ["❤️", "😂", "😮", "😡", "👏"] as const;

function ReactionBtn({ postId, totalLikes, st }: { postId: number; totalLikes: number; st: Record<string, string> }) {
  const [open,         setOpen]         = useState(false);
  const [myReaction,   setMyReaction]   = useState<string | null>(null);
  const [counts,       setCounts]       = useState<Record<string, number>>({});
  const [total,        setTotal]        = useState(totalLikes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load existing reaction on mount
  useEffect(() => {
    fetch(api(`/api/social/v2/post/${postId}/reactions`))
      .then(r => r.json())
      .then(j => {
        if (j.reactions) setCounts(j.reactions);
        if (j.yourReaction) setMyReaction(j.yourReaction);
        if (j.reactions) setTotal(Object.values(j.reactions as Record<string, number>).reduce((a, b) => a + b, 0));
      }).catch(() => {});
  }, [postId]);

  async function sendReaction(emoji: string) {
    setOpen(false);
    const prevReaction = myReaction;
    setMyReaction(emoji);
    try {
      const r = await fetch(api(`/api/social/v2/post/${postId}/react`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: emoji }), credentials: "include",
      });
      const j = await r.json();
      if (j.reactions) {
        setCounts(j.reactions);
        setTotal(Object.values(j.reactions as Record<string, number>).reduce((a, b) => a + b, 0));
      }
    } catch { setMyReaction(prevReaction); }
  }

  const topEmoji = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const displayEmoji = myReaction ?? topEmoji ?? "❤️";

  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => { clearTimeout(timerRef.current); setOpen(true); }}
      onMouseLeave={() => { timerRef.current = setTimeout(() => setOpen(false), 300); }}>
      <button onClick={() => myReaction ? sendReaction(myReaction) : setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
          background: myReaction ? "#ef444415" : "transparent", color: myReaction ? "#ef4444" : "#ffffff50",
          fontSize: 12, fontWeight: 600, transition: "all 0.2s" }}>
        <span style={{ fontSize: 15 }}>{displayEmoji}</span>
        {total > 0 && <span>{total}</span>}
        {!myReaction && <span>{st.react}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, scale: 0.8, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8, y: 8 }} transition={{ duration: 0.15 }}
            style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: "#1a1a1a", border: `1px solid ${GOLD}20`, borderRadius: 24, padding: "6px 10px", display: "flex", gap: 4, zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.8)", whiteSpace: "nowrap" }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => sendReaction(e)}
                title={`${counts[e] ?? 0}`}
                style={{ background: myReaction === e ? "#ffffff20" : "none", border: "none", cursor: "pointer", fontSize: 22, padding: "2px 4px", borderRadius: 12, transition: "transform 0.1s", lineHeight: 1 }}
                onMouseEnter={el => { (el.currentTarget as HTMLButtonElement).style.transform = "scale(1.3)"; }}
                onMouseLeave={el => { (el.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}>
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING SECTION
// ─────────────────────────────────────────────────────────────────────────────
function TrendingSection({ st, dir, onSearch }: { st: Record<string, string>; dir: string; onSearch: (tag: string) => void }) {
  const [data, setData] = useState<{ topPosts: any[]; hashtags: { tag: string; count: number }[] } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(api("/api/social/v2/trending"))
      .then(r => r.json())
      .then(j => setData(j))
      .catch(() => {});
  }, []);

  if (!data || (data.hashtags.length === 0 && data.topPosts.length === 0)) return null;

  return (
    <div style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", color: "#fff" }}>
        <TrendingUp size={14} style={{ color: GOLD }} />
        <span style={{ fontWeight: 800, fontSize: 12, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{st.trending}</span>
        {data.hashtags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flex: 1, overflowX: "auto" }}>
            {data.hashtags.slice(0, 4).map(h => (
              <span key={h.tag} style={{ background: `${GOLD}15`, color: GOLD, borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                {h.tag}
              </span>
            ))}
          </div>
        )}
        <span style={{ fontSize: 10, color: "#ffffff30" }}>{open ? "▲" : "▼"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            style={{ overflow: "hidden" }}>
            <div style={{ padding: "0 14px 12px", borderTop: `1px solid #ffffff08` }}>
              {/* Top Posts */}
              {data.topPosts.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#ffffff40", textTransform: "uppercase", letterSpacing: 1 }}>Hot Posts</p>
                  {data.topPosts.slice(0, 3).map((p: any) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid #ffffff05` }}>
                      <Avatar name={p.username} size={22} />
                      <p style={{ flex: 1, margin: 0, fontSize: 12, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir={dir}>{p.content.slice(0, 70)}</p>
                      <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, whiteSpace: "nowrap" }}>❤️ {p.likes}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* All hashtags */}
              {data.hashtags.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {data.hashtags.map(h => (
                    <button key={h.tag} onClick={() => onSearch(h.tag)}
                      style={{ background: `${GOLD}10`, color: GOLD, border: `1px solid ${GOLD}20`, borderRadius: 12, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {h.tag} <span style={{ color: "#ffffff40" }}>·{h.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES TAB
// ─────────────────────────────────────────────────────────────────────────────
function MessagesTab({ user, st, dir }: { user: any; st: Record<string, string>; dir: string }) {
  const call = useCallContext();
  const [rooms,      setRooms]      = useState<DmRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<DmRoom | null>(null);
  const [messages,   setMessages]   = useState<DmMessage[]>([]);
  const [text,       setText]       = useState("");
  const [sending,    setSending]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [newTarget,  setNewTarget]  = useState("");
  const [groupName,  setGroupName]  = useState("");
  const [isGroup,    setIsGroup]    = useState(false);
  const [recording,  setRecording]  = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const endRef      = useRef<HTMLDivElement>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    loadRooms();
  }, [user]);

  useEffect(() => {
    if (!activeRoom) return;
    loadMessages(activeRoom.id);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(activeRoom.id), 3000);
    return () => clearInterval(pollRef.current);
  }, [activeRoom?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadRooms() {
    const r = await fetch(api("/api/messages/rooms"), { credentials: "include" });
    const j = await r.json();
    setRooms(j.rooms ?? []);
  }

  async function loadMessages(roomId: number) {
    const r = await fetch(api(`/api/messages/rooms/${roomId}`), { credentials: "include" });
    const j = await r.json();
    setMessages(j.messages ?? []);
  }

  async function openRoom(room: DmRoom) {
    setActiveRoom(room);
    await loadMessages(room.id);
  }

  async function sendMessage(audioUrl?: string) {
    if (!activeRoom || (!text.trim() && !audioUrl) || sending) return;
    setSending(true);
    try {
      const body = audioUrl
        ? { audioUrl, type: "audio" }
        : { content: text.trim(), type: "text" };
      const r = await fetch(api(`/api/messages/rooms/${activeRoom.id}/send`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setMessages(prev => [...prev, j.message]);
        setText("");
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
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url  = URL.createObjectURL(blob);
        sendMessage(url);
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    } catch { /* mic denied */ }
  }

  function stopVoiceNote() {
    recorderRef.current?.stop();
  }

  function getPeerName(room: DmRoom): string {
    if (room.type === "group") return room.name ?? "Group";
    const other = room.members.find(m => m.username !== user?.username);
    return other?.username ?? "Chat";
  }

  if (!user) return (
    <div style={{ textAlign: "center", padding: 48, color: "#444" }}>
      {st.login_required}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 12, height: "calc(100vh - 280px)", minHeight: 400 }}>
      {/* Room list */}
      <div style={{ width: 240, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setIsGroup(false); setShowNew(true); }}
            style={{ flex: 1, padding: "8px 0", borderRadius: 8, background: GOLD, border: "none", color: "#000", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
            <MessageSquare size={12} style={{ display: "inline", marginRight: 4 }} />{st.dm}
          </button>
          <button onClick={() => { setIsGroup(true); setShowNew(true); }}
            style={{ flex: 1, padding: "8px 0", borderRadius: 8, background: "#1a1a1a", border: `1px solid ${GOLD}20`, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            <Users size={12} style={{ display: "inline", marginRight: 4 }} />{st.new_group}
          </button>
        </div>
        {showNew && (
          <div style={{ background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 8, padding: 10 }}>
            {isGroup
              ? <input value={groupName} onChange={e => setGroupName(e.target.value)}
                  placeholder={st.group_name}
                  style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}20`, borderRadius: 6, padding: "6px 8px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              : <input value={newTarget} onChange={e => setNewTarget(e.target.value)}
                  placeholder="Username…"
                  style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}20`, borderRadius: 6, padding: "6px 8px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
            }
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={startNewChat}
                style={{ flex: 1, padding: "6px 0", background: GOLD, border: "none", borderRadius: 6, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                {isGroup ? st.create_group : st.send}
              </button>
              <button onClick={() => setShowNew(false)}
                style={{ padding: "6px 10px", background: "#222", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer" }}>
                <X size={12} />
              </button>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {rooms.length === 0 && <p style={{ color: "#444", fontSize: 12, textAlign: "center", marginTop: 20 }}>{st.no_messages}</p>}
          {rooms.map(room => {
            const peerName = getPeerName(room);
            const isActive = activeRoom?.id === room.id;
            const onlineNow = room.type === "direct"
              ? call.onlineUsers.includes(peerName) : false;
            return (
              <button key={room.id} onClick={() => openRoom(room)}
                style={{ textAlign: "left", padding: 10, borderRadius: 8, border: "none", cursor: "pointer", background: isActive ? `${GOLD}15` : "transparent", display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                <div style={{ position: "relative" }}>
                  {room.type === "group"
                    ? <div style={{ width: 34, height: 34, background: "#222", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{room.icon ?? "👥"}</div>
                    : <Avatar name={peerName} size={34} />
                  }
                  {onlineNow && <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, background: "#22c55e", borderRadius: "50%", border: "2px solid #000" }} />}
                </div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ margin: 0, fontWeight: 700, color: isActive ? GOLD : "#fff", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peerName}</p>
                    {room.unreadCount > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 9, padding: "1px 5px", fontSize: 10, fontWeight: 800 }}>{room.unreadCount}</span>}
                  </div>
                  {room.lastMessage && <p style={{ margin: 0, color: "#ffffff40", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.lastMessage.type === "audio" ? "🎤 Voice note" : room.lastMessage.content}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat window */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#080808", border: `1px solid ${GOLD}10`, borderRadius: 12, overflow: "hidden" }}>
        {!activeRoom ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#333" }}>
            <MessageSquare size={40} />
            <p style={{ margin: 0, fontSize: 14 }}>{st.no_messages}</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${GOLD}10`, display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={getPeerName(activeRoom)} size={32} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14 }}>{getPeerName(activeRoom)}</p>
                <p style={{ margin: 0, fontSize: 11, color: call.onlineUsers.includes(getPeerName(activeRoom)) ? "#22c55e" : "#ffffff30" }}>
                  {call.onlineUsers.includes(getPeerName(activeRoom)) ? `● ${st.online}` : st.offline}
                </p>
              </div>
              {/* Call buttons */}
              {activeRoom.type === "direct" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <CallBtn icon="📞" title={st.voice_call} onClick={() => call.startCall(getPeerName(activeRoom), false)} color="#22c55e" />
                  <CallBtn icon="🎥" title={st.video_call} onClick={() => call.startCall(getPeerName(activeRoom), true)} color="#3b82f6" />
                </div>
              )}
            </div>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map(msg => {
                const mine = msg.username === user?.username;
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6 }}>
                    {!mine && <Avatar name={msg.username} size={24} />}
                    <div style={{ maxWidth: "70%", background: mine ? GOLD : "#1a1a1a", borderRadius: mine ? "14px 14px 2px 14px" : "14px 14px 14px 2px", padding: "8px 12px" }}>
                      {!mine && <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: mine ? "#000" : GOLD }}>{msg.username}</p>}
                      {msg.type === "audio" && msg.audioUrl
                        ? <audio controls src={msg.audioUrl} style={{ maxWidth: 200, height: 36 }} />
                        : <p style={{ margin: 0, fontSize: 13, color: mine ? "#000" : "#e5e7eb", wordBreak: "break-word" }} dir={dir}>{msg.content}</p>
                      }
                      <p style={{ margin: "4px 0 0", fontSize: 10, color: mine ? "#00000060" : "#ffffff30", textAlign: "right" }}>{timeAgo(msg.createdAt, st)}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            {/* Input */}
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${GOLD}10`, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={recording ? stopVoiceNote : startVoiceNote}
                title={recording ? st.stop_recording : st.record_voice}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer", background: recording ? "#ef4444" : "#1a1a1a", color: recording ? "#fff" : "#888", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, animation: recording ? "pulse 1s infinite" : "none" }}>
                {recording ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder={st.type_message} dir={dir} disabled={recording}
                style={{ flex: 1, background: "#111", border: `1px solid ${GOLD}15`, borderRadius: 20, padding: "8px 14px", color: "#fff", fontSize: 13, outline: "none" }} />
              <button onClick={() => sendMessage()} disabled={!text.trim() || sending}
                style={{ width: 36, height: 36, borderRadius: "50%", background: text.trim() ? GOLD : "#1a1a1a", border: "none", color: text.trim() ? "#000" : "#444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Send size={15} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CallBtn({ icon, title, onClick, color }: { icon: string; title: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick} title={title}
      style={{ width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", background: `${color}20`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
      {icon}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STORIES TAB
// ─────────────────────────────────────────────────────────────────────────────
function StoriesTab({ user, st, dir }: { user: any; st: Record<string, string>; dir: string }) {
  const [stories,   setStories]   = useState<Story[]>([]);
  const [content,   setContent]   = useState("");
  const [imageUrl,  setImageUrl]  = useState("");
  const [domain,    setDomain]    = useState("general");
  const [posting,   setPosting]   = useState(false);
  const [viewer,    setViewer]    = useState<Story | null>(null);
  const [likedSet,  setLikedSet]  = useState<Set<number>>(new Set());

  const DOMAINS = ["general","sport","music","cinema","tech","art"];

  useEffect(() => { loadStories(); }, []);

  async function loadStories() {
    const r = await fetch(api("/api/stories/feed"));
    const j = await r.json();
    setStories(j.stories ?? []);
  }

  async function postStory() {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const r = await fetch(api("/api/stories"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageUrl: imageUrl || undefined, domain, type: imageUrl ? "text" : "text" }),
        credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setStories(prev => [j.story, ...prev]);
        setContent(""); setImageUrl("");
      }
    } finally { setPosting(false); }
  }

  async function likeStory(storyId: number) {
    if (likedSet.has(storyId)) return;
    const r = await fetch(api(`/api/stories/${storyId}/like`), { method: "POST", credentials: "include" });
    const j = await r.json();
    if (!j.alreadyLiked && j.likes != null) {
      setStories(prev => prev.map(s => s.id === storyId ? { ...s, likes: j.likes } : s));
    }
    setLikedSet(prev => new Set([...prev, storyId]));
  }

  function msLeft(expiresAt: string) {
    const h = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 3600000));
    if (h < 1) return "< 1h";
    return `${h}h`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Composer */}
      {user && (
        <div style={{ background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 12, padding: 16 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>
            {st.add_story}
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "#ffffff40" }}>
            <Clock size={11} style={{ display: "inline", marginRight: 4 }} />{st.stories_expire}
          </p>
          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder={st.story_text} maxLength={200} dir={dir} rows={2}
            style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder={st.story_image}
              style={{ flex: 1, minWidth: 120, background: "#000", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none" }} />
            <select value={domain} onChange={e => setDomain(e.target.value)}
              style={{ background: "#000", border: `1px solid ${GOLD}15`, borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", cursor: "pointer" }}>
              {DOMAINS.map(d => <option key={d} value={d}>{DOMAIN_ICONS[d]} {st[d] ?? d}</option>)}
            </select>
            <button onClick={postStory} disabled={!content.trim() || posting}
              style={{ padding: "8px 20px", background: content.trim() ? GOLD : "#333", border: "none", borderRadius: 8, color: content.trim() ? "#000" : "#666", fontWeight: 800, cursor: "pointer", fontSize: 13, opacity: posting ? 0.5 : 1 }}>
              {posting ? "…" : st.add_story}
            </button>
          </div>
        </div>
      )}

      {/* Stories grid */}
      {stories.length === 0 && (
        <div style={{ textAlign: "center", color: "#444", padding: 48 }}>{st.no_stories}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {stories.map(story => (
          <motion.div key={story.id} whileHover={{ scale: 1.02 }}
            onClick={() => setViewer(story)}
            style={{ borderRadius: 12, overflow: "hidden", cursor: "pointer", border: `1px solid ${GOLD}20`, background: "#0d0d0d", position: "relative", aspectRatio: "9/14" }}>
            {story.imageUrl
              ? <img src={story.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, #0d0d0d, #1a1a1a)` }} />
            }
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 50%)", padding: 10, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <Avatar name={story.username} size={20} />
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#fff" }}>{story.username}</p>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{story.content}</p>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 10, color: `${GOLD}80` }}>⏳ {msLeft(story.expiresAt)}</span>
                <button onClick={e => { e.stopPropagation(); likeStory(story.id); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: likedSet.has(story.id) ? "#ef4444" : "#ffffff60", fontSize: 11, padding: 0 }}>
                  ❤️ {story.likes}
                </button>
              </div>
            </div>
            <div style={{ position: "absolute", top: 8, right: 8, background: GOLD, borderRadius: 8, padding: "2px 6px", fontSize: 10, fontWeight: 700, color: "#000" }}>
              {DOMAIN_ICONS[story.domain]}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Story viewer modal */}
      <AnimatePresence>
        {viewer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setViewer(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              style={{ background: "#111", borderRadius: 16, overflow: "hidden", width: 360, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
              {viewer.imageUrl && <img src={viewer.imageUrl} alt="" style={{ width: "100%", maxHeight: 300, objectFit: "cover" }} />}
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Avatar name={viewer.username} size={28} />
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 13 }}>{viewer.username}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#ffffff40" }}>{timeAgo(viewer.createdAt, st)} · ⏳ {msLeft(viewer.expiresAt)}</p>
                  </div>
                  <button onClick={() => setViewer(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#666" }}>
                    <X size={18} />
                  </button>
                </div>
                <p style={{ color: "#e5e7eb", fontSize: 14, lineHeight: 1.6, margin: 0 }} dir={dir}>{viewer.content}</p>
                <button onClick={() => likeStory(viewer.id)}
                  style={{ marginTop: 12, background: likedSet.has(viewer.id) ? "#ef444420" : "#1a1a1a", border: "none", borderRadius: 8, padding: "8px 16px", color: likedSet.has(viewer.id) ? "#ef4444" : "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  ❤️ {viewer.likes} {st.like}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TAB
// ─────────────────────────────────────────────────────────────────────────────
function LiveTab({ user, st }: { user: any; st: Record<string, string> }) {
  const call = useCallContext();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#111", border: `1px solid #ef444420`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Radio size={16} style={{ color: "#ef4444" }} />
          <p style={{ margin: 0, fontWeight: 900, color: "#ef4444", fontSize: 14, textTransform: "uppercase", letterSpacing: 1 }}>
            {st.go_live}
          </p>
        </div>
        <LiveStoryRecorder
          liveStatus={call.liveStatus}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          currentLiveId={call.currentLiveId ?? null}
          activeLives={call.activeLives ?? []}
          onStartLive={(title, domain) => call.startLive(title, domain)}
          onEndLive={() => call.endLive()}
          onJoinLive={(id) => call.joinLive(id)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CITIZENS TAB
// ─────────────────────────────────────────────────────────────────────────────
function CitizensTab({ user, st }: { user: any; st: Record<string, string> }) {
  const call = useCallContext();
  const [q,          setQ]          = useState("");
  const [citizens,   setCitizens]   = useState<Citizen[]>([]);
  const [following,  setFollowing]  = useState<Set<number>>(new Set());
  const [loading,    setLoading]    = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadCitizens("");
    if (user) loadFollowing();
  }, [user]);

  async function loadCitizens(query: string) {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/social/v2/citizens?q=${encodeURIComponent(query)}&limit=30`));
      const j = await r.json();
      setCitizens(j.citizens ?? []);
    } finally { setLoading(false); }
  }

  async function loadFollowing() {
    const r = await fetch(api("/api/social/v2/my-following"), { credentials: "include" });
    const j = await r.json();
    setFollowing(new Set(j.following ?? []));
  }

  function handleSearch(val: string) {
    setQ(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadCitizens(val), 300);
  }

  async function toggleFollow(citizen: Citizen) {
    if (!user) return;
    if (following.has(citizen.id)) {
      await fetch(api(`/api/social/v2/follow/${citizen.username}`), {
        method: "DELETE", credentials: "include",
      });
      setFollowing(prev => { const s = new Set(prev); s.delete(citizen.id); return s; });
    } else {
      await fetch(api(`/api/social/v2/follow/${citizen.username}`), {
        method: "POST", credentials: "include",
      });
      setFollowing(prev => new Set([...prev, citizen.id]));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#666" }} />
        <input value={q} onChange={e => handleSearch(e.target.value)}
          placeholder={`${st.search_placeholder}`}
          style={{ width: "100%", background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 10, padding: "10px 12px 10px 36px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>

      {loading && <div style={{ textAlign: "center", color: "#444", padding: 20 }}>…</div>}
      {!loading && citizens.length === 0 && <div style={{ textAlign: "center", color: "#444", padding: 48 }}>{st.no_citizens}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {citizens.map(c => {
          const isFollowing = following.has(c.id);
          const isOnline = call.onlineUsers.includes(c.username);
          const isMe = c.id === user?.id;
          return (
            <motion.div key={c.id} whileHover={{ scale: 1.01 }}
              style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ position: "relative" }}>
                  <Avatar name={c.username} size={38} />
                  {isOnline && <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, background: "#22c55e", borderRadius: "50%", border: "2px solid #0d0d0d" }} />}
                </div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.username}</p>
                  <p style={{ margin: 0, fontSize: 11, color: c.rank.color }}>
                    {c.rank.icon} {c.rank.label}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, fontSize: 11, color: "#ffffff50", justifyContent: "space-between" }}>
                <span>⚡ {c.xp.toLocaleString()} {st.xp}</span>
                <span>🪙 {c.balance.toLocaleString()}</span>
              </div>
              {!isMe && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => toggleFollow(c)} disabled={!user}
                    style={{ flex: 1, padding: "6px 0", borderRadius: 8, cursor: user ? "pointer" : "default", fontWeight: 700, fontSize: 11,
                      background: isFollowing ? "#1a1a1a" : GOLD, color: isFollowing ? GOLD : "#000",
                      border: isFollowing ? `1px solid ${GOLD}40` : "none" } as any}>
                    {isFollowing ? <><UserCheck size={11} style={{ display: "inline", marginRight: 3 }} />{st.following}</> : <><UserPlus size={11} style={{ display: "inline", marginRight: 3 }} />{st.follow}</>}
                  </button>
                  {isOnline && (
                    <>
                      <CallBtn icon="📞" title={st.voice_call} onClick={() => call.startCall(c.username, false)} color="#22c55e" />
                      <CallBtn icon="🎥" title={st.video_call} onClick={() => call.startCall(c.username, true)} color="#3b82f6" />
                    </>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS TAB
// ─────────────────────────────────────────────────────────────────────────────
interface NotifItem { type: string; username: string; content: string; postSnippet?: string; createdAt: string; }

function NotificationsTab({ user, st, dir }: { user: any; st: Record<string, string>; dir: string }) {
  const [notifs,  setNotifs]  = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch(api("/api/social/v2/notifications"), { credentials: "include" })
      .then(r => r.json())
      .then(j => setNotifs(j.notifications ?? []))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return (
    <div style={{ textAlign: "center", padding: 48, color: "#444" }}>{st.login_required}</div>
  );

  const icon = (type: string) => type === "comment" ? "💬" : type === "reaction" ? "😊" : type === "follow" ? "👤" : "🔔";
  const label = (n: NotifItem) => {
    if (n.type === "comment") return `${st.notif_comment}`;
    if (n.type === "reaction") return `${st.notif_reaction} ${n.content}`;
    return st.notif_follow;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {loading && <div style={{ textAlign: "center", color: "#444", padding: 32 }}>…</div>}
      {!loading && notifs.length === 0 && (
        <div style={{ textAlign: "center", color: "#444", padding: 48 }}>
          <Bell size={32} style={{ opacity: 0.3, display: "block", margin: "0 auto 12px" }} />
          {st.no_notifications}
        </div>
      )}
      {notifs.map((n, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: dir === "rtl" ? 10 : -10 }} animate={{ opacity: 1, x: 0 }}
          style={{ background: "#0d0d0d", border: `1px solid ${GOLD}10`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: n.type === "follow" ? "#3b82f620" : n.type === "reaction" ? "#ef444420" : `${GOLD}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
            {icon(n.type)}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#e5e7eb" }}>
              <strong style={{ color: GOLD }}>{n.username}</strong>{" "}{label(n)}
            </p>
            {n.postSnippet && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#ffffff40", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir={dir}>
                "{n.postSnippet}…"
              </p>
            )}
            {n.type === "comment" && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ccc" }} dir={dir}>"{n.content}"</p>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "#ffffff25" }}>{timeAgo(n.createdAt, st)}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH RESULTS OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function SearchResults({ q, st, onClose, dir }: { q: string; st: Record<string, string>; onClose: () => void; dir: string }) {
  const [results, setResults] = useState<{ posts: any[]; citizens: any[]; stories: any[] } | null>(null);

  useEffect(() => {
    if (!q || q.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      const r = await fetch(api(`/api/social/v2/search?q=${encodeURIComponent(q)}`));
      const j = await r.json();
      setResults(j);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  if (!results) return null;
  const total = (results.posts?.length ?? 0) + (results.citizens?.length ?? 0) + (results.stories?.length ?? 0);

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 10, zIndex: 999, maxHeight: 400, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}>
      {total === 0 ? (
        <p style={{ padding: "16px 16px", color: "#444", margin: 0, fontSize: 13 }}>No results for "{q}"</p>
      ) : (
        <>
          {results.citizens.length > 0 && (
            <div style={{ padding: 8 }}>
              <p style={{ margin: "4px 8px 8px", fontSize: 10, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{st.citizens}</p>
              {results.citizens.map((c: any) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
                  onClick={onClose}>
                  <Avatar name={c.username} size={28} />
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 13 }}>{c.username}</p>
                    <p style={{ margin: 0, fontSize: 11, color: c.rank.color }}>{c.rank.icon} {c.rank.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {results.posts.length > 0 && (
            <div style={{ padding: 8, borderTop: `1px solid #ffffff08` }}>
              <p style={{ margin: "4px 8px 8px", fontSize: 10, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{st.feed}</p>
              {results.posts.map((p: any) => (
                <div key={p.id} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer" }} onClick={onClose}>
                  <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 12 }}>{p.username}</p>
                  <p style={{ margin: "2px 0 0", color: "#999", fontSize: 12 }} dir={dir}>{p.content.slice(0, 80)}{p.content.length > 80 ? "…" : ""}</p>
                </div>
              ))}
            </div>
          )}
          {results.stories.length > 0 && (
            <div style={{ padding: 8, borderTop: `1px solid #ffffff08` }}>
              <p style={{ margin: "4px 8px 8px", fontSize: 10, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{st.stories}</p>
              {results.stories.map((s: any) => (
                <div key={s.id} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer" }} onClick={onClose}>
                  <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: 12 }}>{s.username}</p>
                  <p style={{ margin: "2px 0 0", color: "#999", fontSize: 12 }}>{s.content.slice(0, 80)}{s.content.length > 80 ? "…" : ""}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
type Tab = "feed" | "messages" | "stories" | "live" | "citizens" | "notifications";

export default function SocialPage() {
  const { user }     = useAuth();
  const { lang }     = useLang();
  const st           = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const dir          = lang === "ar" ? "rtl" : "ltr";

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
    { id: "feed",          icon: <Globe size={15} />,         label: st.feed          },
    { id: "messages",      icon: <MessageSquare size={15} />, label: st.messages      },
    { id: "stories",       icon: <BookOpen size={15} />,      label: st.stories       },
    { id: "live",          icon: <Radio size={15} />,         label: st.live          },
    { id: "citizens",      icon: <Users size={15} />,         label: st.citizens      },
    { id: "notifications", icon: <Bell size={15} />,          label: st.notifications },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir={dir}>
      {/* Header */}
      <div style={{ background: "rgba(5,5,5,0.95)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${GOLD}15`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 16px" }}>
          {/* Title + Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>
                <span style={{ color: GOLD }}>◈</span> {st.title}
              </h1>
              {user && <p style={{ margin: 0, fontSize: 11, color: "#ffffff50" }}>{user.username} · {user.xp?.toLocaleString()} {st.xp}</p>}
            </div>
            {/* Global search */}
            <div ref={searchRef} style={{ flex: 1, position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", background: "#111", border: `1px solid ${searchOpen ? GOLD : `${GOLD}20`}`, borderRadius: 20, padding: "8px 14px", gap: 8, transition: "border-color 0.2s" }}>
                <Search size={14} style={{ color: "#666", flexShrink: 0 }} />
                <input value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder={st.search_placeholder}
                  style={{ flex: 1, background: "none", border: "none", color: "#fff", fontSize: 13, outline: "none" }} />
                {searchQ && <button onClick={() => { setSearchQ(""); setSearchOpen(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0 }}><X size={14} /></button>}
              </div>
              {searchOpen && searchQ.length >= 2 && (
                <SearchResults q={searchQ} st={st} onClose={() => { setSearchOpen(false); setSearchQ(""); }} dir={dir} />
              )}
            </div>
          </div>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", transition: "all 0.2s",
                  background: tab === t.id ? `${GOLD}20` : "transparent",
                  color: tab === t.id ? GOLD : "#ffffff50",
                  borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
                }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px" }}>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === "feed"          && <FeedTab          user={user} st={st} dir={dir} />}
            {tab === "messages"      && <MessagesTab      user={user} st={st} dir={dir} />}
            {tab === "stories"       && <StoriesTab       user={user} st={st} dir={dir} />}
            {tab === "live"          && <LiveTab          user={user} st={st} />}
            {tab === "citizens"      && <CitizensTab      user={user} st={st} />}
            {tab === "notifications" && <NotificationsTab user={user} st={st} dir={dir} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
