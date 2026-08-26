/**
 * FeedCard — single post card with reactions, comments, share, and save
 */
import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Share2, Bookmark, BookmarkCheck } from "lucide-react";
import Avatar from "./Avatar";
import { GOLD, DOMAIN_ICONS, timeAgo, api } from "./social-i18n";
import type { FeedPost, Comment } from "./social-types";
import { useConnectivity } from "@/contexts/ConnectivityContext";

const EMOJIS = ["❤️", "😂", "😮", "😡", "👏"] as const;

// ── ActionBtn ─────────────────────────────────────────────────────────────────
function ActionBtn({ icon, label, onClick, active, color, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  active?: boolean; color: string; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "6px 10px", borderRadius: 8, border: "none", cursor: disabled ? "default" : "pointer",
        background: active ? `${color}18` : "transparent",
        color: active ? color : "#ffffff50",
        fontSize: 12, fontWeight: 600, transition: "all 0.2s",
        opacity: disabled ? 0.5 : 1,
      }}>
      {icon}{label}
    </button>
  );
}

// ── ReactionBtn ───────────────────────────────────────────────────────────────
function ReactionBtn({ postId, initialLikes }: { postId: number; initialLikes: number }) {
  const { isOnline } = useConnectivity();
  const [open,       setOpen]       = useState(false);
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [counts,     setCounts]     = useState<Record<string, number>>({});
  const [total,      setTotal]      = useState(initialLikes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch(api(`/api/social/v2/post/${postId}/reactions`))
      .then(r => r.json())
      .then(j => {
        if (j.reactions) {
          setCounts(j.reactions);
          setTotal(Object.values(j.reactions as Record<string,number>).reduce((a,b) => a+b, 0));
        }
        if (j.yourReaction) setMyReaction(j.yourReaction);
      }).catch(() => {});
  }, [postId]);

  async function sendReaction(emoji: string) {
    if (!isOnline) return;
    setOpen(false);
    const prev = myReaction;
    setMyReaction(emoji);
    try {
      const r = await fetch(api(`/api/social/v2/post/${postId}/react`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: emoji }), credentials: "include",
      });
      const j = await r.json();
      if (j.reactions) {
        setCounts(j.reactions);
        setTotal(Object.values(j.reactions as Record<string,number>).reduce((a,b) => a+b, 0));
      }
    } catch { setMyReaction(prev); }
  }

  const topEmoji = Object.entries(counts).sort((a,b) => b[1]-a[1])[0]?.[0];
  const displayEmoji = myReaction ?? topEmoji ?? "❤️";

  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => { clearTimeout(timerRef.current); setOpen(true); }}
      onMouseLeave={() => { timerRef.current = setTimeout(() => setOpen(false), 300); }}>
      <button
        onClick={() => myReaction ? sendReaction(myReaction) : setOpen(v => !v)}
        disabled={!isOnline}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer",
          background: myReaction ? "#ef444418" : "transparent",
          color: myReaction ? "#ef4444" : "#ffffff50",
          fontSize: 12, fontWeight: 600, transition: "all 0.2s",
        }}>
        <span style={{ fontSize: 15 }}>{displayEmoji}</span>
        {total > 0 && <span>{total}</span>}
        {!myReaction && <span>React</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "absolute", bottom: "calc(100% + 4px)", left: 0,
              background: "#1a1a1a", border: `1px solid ${GOLD}25`,
              borderRadius: 24, padding: "6px 10px",
              display: "flex", gap: 4, zIndex: 200,
              boxShadow: "0 4px 24px rgba(0,0,0,0.85)", whiteSpace: "nowrap",
            }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => sendReaction(e)} title={`${counts[e] ?? 0}`}
                disabled={!isOnline}
                style={{
                  background: myReaction === e ? "#ffffff20" : "none",
                  border: "none", cursor: "pointer", fontSize: 22,
                  padding: "2px 4px", borderRadius: 12, transition: "transform 0.1s", lineHeight: 1,
                }}
                onMouseEnter={ev => { (ev.currentTarget as HTMLButtonElement).style.transform = "scale(1.35)"; }}
                onMouseLeave={ev => { (ev.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}>
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main FeedCard ─────────────────────────────────────────────────────────────
interface Props {
  post: FeedPost;
  user: { id: number; username: string } | null;
  st: Record<string, string>;
  dir: string;
  saved: boolean;
  onSaveToggle: () => void;
}

export default function FeedCard({ post, user, st, dir, saved, onSaveToggle }: Props) {
  const { isOnline } = useConnectivity();
  const [comments,       setComments]       = useState<Comment[]>([]);
  const [newComment,     setNewComment]     = useState("");
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [expanded,       setExpanded]       = useState(false);
  const [sending,        setSending]        = useState(false);
  const [shareToast,     setShareToast]     = useState(false);

  function handleShare() {
    navigator.clipboard.writeText(`https://helixly.app/social#post-${post.id}`).catch(() => {});
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2000);
  }

  async function loadComments() {
    if (commentsLoaded) return;
    const r = await fetch(api(`/api/social/v2/post/${post.id}/comments`));
    const j = await r.json();
    setComments(j.comments ?? []);
    setCommentsLoaded(true);
  }

  function toggleComments() {
    if (!expanded) loadComments();
    setExpanded(v => !v);
  }

  async function sendComment() {
    if (!newComment.trim() || sending || !user || !isOnline) return;
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
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      id={`post-${post.id}`}
      style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
        <Avatar name={post.username} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 800, color: "#fff", fontSize: 14 }}>{post.username}</p>
          <p style={{ margin: 0, fontSize: 11, color: "#ffffff40" }}>
            {DOMAIN_ICONS[post.domain] ?? "🌍"} {post.domain} · {timeAgo(post.createdAt, st)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "0 16px 12px", color: "#e5e7eb", fontSize: 14, lineHeight: 1.6 }} dir={dir}>
        {post.content}
      </div>

      {/* Attached media — image or YouTube embed */}
      {post.imageUrl && post.mediaType === "video" && (() => {
        const ytId = post.imageUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]{11})/)?.[1];
        return ytId ? (
          <div style={{ margin: "0 16px 12px", borderRadius: 10, overflow: "hidden", aspectRatio: "16/9", background: "#000" }}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1`}
              title="YouTube video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          </div>
        ) : null;
      })()}
      {post.imageUrl && post.mediaType !== "video" && (
        <div style={{ margin: "0 16px 12px" }}>
          <img src={post.imageUrl} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 8 }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 2, padding: "8px 10px", borderTop: `1px solid #ffffff08`, flexWrap: "wrap" }}>
        <ReactionBtn postId={post.id} initialLikes={post.likes} />
        <ActionBtn icon={<MessageSquare size={14} />}
          label={`${post.commentCount > 0 ? post.commentCount + " " : ""}${st.comment}`}
          onClick={toggleComments} active={expanded} color={GOLD} />
        <div style={{ position: "relative" }}>
          <ActionBtn icon={<Share2 size={14} />} label={st.share} onClick={handleShare} color="#3b82f6" />
          {shareToast && (
            <span style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: "#22c55e", color: "#000", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
              {st.share_copied ?? "Copied!"}
            </span>
          )}
        </div>
        <ActionBtn icon={saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          label={saved ? st.saved : st.save}
          onClick={onSaveToggle} active={saved} color={GOLD}
          disabled={!user || !isOnline} />
      </div>

      {/* Comments */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            style={{ overflow: "hidden" }}>
            <div style={{ padding: "0 16px 14px", borderTop: `1px solid #ffffff08` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: GOLD, margin: "10px 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>
                {st.comments}
              </p>
              {comments.length === 0 && (
                <p style={{ color: "#ffffff30", fontSize: 12, margin: "0 0 8px" }}>No comments yet.</p>
              )}
              {comments.map(c => (
                <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <Avatar name={c.username} size={24} />
                  <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "6px 10px", flex: 1 }}>
                    <span style={{ fontWeight: 700, color: GOLD, fontSize: 12 }}>{c.username}</span>
                    <span style={{ color: "#ccc", fontSize: 13, marginLeft: 8 }} dir={dir}>{c.content}</span>
                    <p style={{ margin: "3px 0 0", fontSize: 10, color: "#ffffff25" }}>{timeAgo(c.createdAt, st)}</p>
                  </div>
                </div>
              ))}
              {user ? (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Avatar name={user.username} size={24} />
                  <input value={newComment} onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendComment()}
                    placeholder={st.write_comment} dir={dir}
                    style={{ flex: 1, background: "#1a1a1a", border: `1px solid ${GOLD}20`, borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 13, outline: "none" }} />
                  <button onClick={sendComment} disabled={sending || !newComment.trim() || !isOnline}
                    style={{ padding: "6px 14px", borderRadius: 8, background: GOLD, border: "none", color: "#000", fontWeight: 800, cursor: "pointer", fontSize: 12, opacity: sending ? 0.5 : 1 }}>
                    {st.send}
                  </button>
                </div>
              ) : (
                <p style={{ color: "#ffffff30", fontSize: 12, fontStyle: "italic" }}>{st.login_required}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
