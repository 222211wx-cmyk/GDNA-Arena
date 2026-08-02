/**
 * FeedTab — post composer, trending strip, domain filters, and feed list
 */
import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Image } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard from "./FeedCard";
import Avatar from "./Avatar";
import { GOLD, DOMAIN_ICONS, DOMAINS, timeAgo, api } from "./social-i18n";
import type { FeedPost } from "./social-types";

// ── TrendingSection ───────────────────────────────────────────────────────────
function TrendingSection({ st, dir }: { st: Record<string, string>; dir: string }) {
  const [data, setData] = useState<{ topPosts: any[]; hashtags: { tag: string; count: number }[] } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(api("/api/social/v2/trending")).then(r => r.json()).then(j => setData(j)).catch(() => {});
  }, []);

  if (!data || (data.hashtags.length === 0 && data.topPosts.length === 0)) return null;

  return (
    <div style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", color: "#fff" }}>
        <TrendingUp size={14} style={{ color: GOLD, flexShrink: 0 }} />
        <span style={{ fontWeight: 800, fontSize: 12, color: GOLD, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>
          {st.trending}
        </span>
        <div style={{ display: "flex", gap: 6, flex: 1, overflowX: "hidden" }}>
          {data.hashtags.slice(0, 4).map(h => (
            <span key={h.tag} style={{ background: `${GOLD}15`, color: GOLD, borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
              {h.tag}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 10, color: "#ffffff30", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            style={{ overflow: "hidden" }}>
            <div style={{ padding: "0 14px 12px", borderTop: "1px solid #ffffff08" }}>
              {data.topPosts.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#ffffff40", textTransform: "uppercase", letterSpacing: 1 }}>Hot Posts</p>
                  {data.topPosts.slice(0, 3).map((p: any) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #ffffff05" }}>
                      <Avatar name={p.username} size={22} />
                      <p style={{ flex: 1, margin: 0, fontSize: 12, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir={dir}>
                        {p.content.slice(0, 70)}
                      </p>
                      <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, whiteSpace: "nowrap" }}>❤️ {p.likes}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.hashtags.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {data.hashtags.map(h => (
                    <span key={h.tag}
                      style={{ background: `${GOLD}10`, color: GOLD, border: `1px solid ${GOLD}20`, borderRadius: 12, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                      {h.tag} <span style={{ color: "#ffffff40" }}>·{h.count}</span>
                    </span>
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

// ── Main FeedTab ──────────────────────────────────────────────────────────────
interface Props {
  user: { id: number; username: string } | null;
  st: Record<string, string>;
  dir: string;
}

export default function FeedTab({ user, st, dir }: Props) {
  const [posts,    setPosts]    = useState<FeedPost[]>([]);
  const [content,  setContent]  = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showImg,  setShowImg]  = useState(false);
  const [domain,   setDomain]   = useState("general");
  const [filter,   setFilter]   = useState("all");
  const [loading,  setLoading]  = useState(false);
  const [posting,  setPosting]  = useState(false);
  const [savedSet, setSavedSet] = useState<Set<number>>(new Set());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(api("/api/social/v2/feed?limit=40"));
      const j = await r.json();
      setPosts(j.posts ?? []);
    } finally { setLoading(false); }
  }, []);

  const loadSaved = useCallback(async () => {
    if (!user) return;
    const r = await fetch(api("/api/social/v2/my-saved"), { credentials: "include" });
    const j = await r.json();
    setSavedSet(new Set<number>(j.savedIds ?? []));
  }, [user]);

  useEffect(() => { loadFeed(); }, [loadFeed]);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  async function submitPost() {
    if (!content.trim() || posting || !user) return;
    setPosting(true);
    try {
      const r = await fetch(api("/api/social/v2/post"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), domain, imageUrl: imageUrl.trim() || undefined }),
        credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        setPosts(prev => [j.post, ...prev]);
        setContent(""); setImageUrl(""); setShowImg(false);
      }
    } finally { setPosting(false); }
  }

  async function toggleSave(postId: number) {
    if (!user) return;
    if (savedSet.has(postId)) {
      await fetch(api(`/api/social/v2/post/${postId}/save`), { method: "DELETE", credentials: "include" });
      setSavedSet(prev => { const s = new Set(prev); s.delete(postId); return s; });
    } else {
      await fetch(api(`/api/social/v2/post/${postId}/save`), { method: "POST", credentials: "include" });
      setSavedSet(prev => new Set([...prev, postId]));
    }
  }

  const filtered = filter === "all" ? posts : posts.filter(p => p.domain === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Composer */}
      {user ? (
        <div style={{ background: "#111", border: `1px solid ${GOLD}20`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Avatar name={user.username} />
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder={st.post_placeholder} maxLength={500} dir={dir} rows={3}
              style={{ flex: 1, background: "transparent", border: "none", color: "#fff", resize: "none", fontSize: 14, outline: "none", lineHeight: 1.5 }} />
          </div>
          {/* Optional image URL */}
          {showImg && (
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder={st.post_image ?? "Image URL (optional)"}
              style={{ width: "100%", background: "#000", border: `1px solid ${GOLD}20`, borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box", marginTop: 8 }} />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DOMAINS.map(d => (
                <button key={d} onClick={() => setDomain(d)}
                  style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: domain === d ? GOLD : "#222", color: domain === d ? "#000" : "#fff" }}>
                  {DOMAIN_ICONS[d]} {st[d] ?? d}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setShowImg(v => !v)} title={st.attach_image ?? "Image"}
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${GOLD}25`, background: showImg ? `${GOLD}20` : "#1a1a1a", color: showImg ? GOLD : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Image size={14} />
              </button>
              <button onClick={submitPost} disabled={!content.trim() || posting}
                style={{ padding: "8px 22px", borderRadius: 20, fontWeight: 900, fontSize: 13, border: "none", cursor: "pointer", background: content.trim() ? GOLD : "#333", color: content.trim() ? "#000" : "#666", opacity: posting ? 0.5 : 1 }}>
                {posting ? "…" : st.post_btn}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "16px 0", color: "#ffffff30", fontSize: 13 }}>
          {st.login_required}
        </div>
      )}

      {/* Trending */}
      <TrendingSection st={st} dir={dir} />

      {/* Domain filter */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {["all", ...DOMAINS].map(d => (
          <button key={d} onClick={() => setFilter(d)}
            style={{ whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: filter === d ? GOLD : "#111", color: filter === d ? "#000" : "#888", flexShrink: 0 }}>
            {d === "all" ? st.all : `${DOMAIN_ICONS[d]} ${st[d] ?? d}`}
          </button>
        ))}
      </div>

      {/* Posts */}
      {loading && <div style={{ textAlign: "center", color: "#444", padding: 40 }}>…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", color: "#444", padding: 60, fontSize: 14 }}>{st.no_posts}</div>
      )}
      {filtered.map(post => (
        <FeedCard key={post.id} post={post} user={user} st={st} dir={dir}
          saved={savedSet.has(post.id)}
          onSaveToggle={() => toggleSave(post.id)}
        />
      ))}
    </div>
  );
}
