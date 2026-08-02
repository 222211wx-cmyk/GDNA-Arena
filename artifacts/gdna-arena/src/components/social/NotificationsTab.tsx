/**
 * NotificationsTab — per-user activity feed: comments, reactions, follows, missed calls
 */
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Bell } from "lucide-react";
import { GOLD, timeAgo, api } from "./social-i18n";
import type { NotifItem } from "./social-types";

function notifIcon(type: string) {
  if (type === "comment")      return "💬";
  if (type === "reaction")     return "😊";
  if (type === "follow")       return "👤";
  if (type === "call_missed")  return "📞";
  return "🔔";
}

function notifBg(type: string) {
  if (type === "comment")      return "#C9A84C20";
  if (type === "reaction")     return "#ef444420";
  if (type === "follow")       return "#3b82f620";
  if (type === "call_missed")  return "#ef444420";
  return "#ffffff10";
}

function notifLabel(n: NotifItem, st: Record<string, string>): string {
  if (n.type === "comment")     return st.notif_comment   ?? "commented on your post";
  if (n.type === "reaction")    return `${st.notif_reaction ?? "reacted"} ${n.content}`;
  if (n.type === "follow")      return st.notif_follow    ?? "started following you";
  if (n.type === "call_missed") return "missed your call";
  return n.content;
}

interface Props {
  user: { id: number; username: string } | null;
  st: Record<string, string>;
  dir: string;
}

export default function NotificationsTab({ user, st, dir }: Props) {
  const [notifs,  setNotifs]  = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [allRead, setAllRead] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const r = await fetch(api("/api/social/v2/notifications"), { credentials: "include" });
      const j = await r.json();
      setNotifs(j.notifications ?? []);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) return (
    <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
      <Bell size={36} style={{ opacity: 0.2, display: "block", margin: "0 auto 12px" }} />
      <p style={{ margin: 0, fontSize: 14 }}>{st.login_required}</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header */}
      {notifs.length > 0 && !allRead && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => setAllRead(true)}
            style={{ background: "none", border: `1px solid ${GOLD}30`, borderRadius: 8, padding: "5px 12px", color: GOLD, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {st.mark_read ?? "Mark all read"}
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: "center", color: "#444", padding: 40 }}>…</div>}
      {!loading && notifs.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
          <Bell size={36} style={{ opacity: 0.2, display: "block", margin: "0 auto 12px" }} />
          <p style={{ margin: 0, fontSize: 14 }}>{st.no_notifications}</p>
        </div>
      )}

      {notifs.map((n, i) => (
        <motion.div key={i}
          initial={{ opacity: 0, x: dir === "rtl" ? 10 : -10 }}
          animate={{ opacity: allRead ? 0.45 : 1, x: 0 }}
          style={{
            background: "#0d0d0d", border: `1px solid ${GOLD}10`, borderRadius: 10,
            padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10,
          }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: notifBg(n.type),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}>
            {notifIcon(n.type)}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#e5e7eb" }}>
              <strong style={{ color: GOLD }}>{n.username}</strong>
              {" "}
              {notifLabel(n, st)}
            </p>
            {n.postSnippet && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#ffffff40", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir={dir}>
                "{n.postSnippet}…"
              </p>
            )}
            {n.type === "comment" && n.content && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ccc", fontStyle: "italic" }} dir={dir}>
                "{n.content}"
              </p>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "#ffffff25" }}>
              {timeAgo(n.createdAt, st)}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
