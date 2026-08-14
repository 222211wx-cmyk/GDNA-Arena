// ══════════════════════════════════════════════════════════════════════════════
//  CommHub — Floating shell around the unified AMIS Messenger (widget variant)
//  مركز التواصل العائم — نفس الماسنجر الموحّد فكل مكان
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { GOLD, api } from "@/components/social/social-i18n";
import Messenger from "@/components/messenger/Messenger";

export default function CommHub() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifOn, setNotifOn] = useState(true);

  const loadUnread = useCallback(async () => {
    if (!user) return;
    try {
      // Honor the user's messenger notification setting: when off, no badge.
      const [ur, sr] = await Promise.all([
        fetch(api("/api/messages/unread-count"), { credentials: "include" }),
        fetch(api("/api/messages/settings"), { credentials: "include" }),
      ]);
      const j = await ur.json();
      const s = await sr.json().catch(() => ({}));
      setUnread(j.count ?? 0);
      setNotifOn(s.notifications ?? true);
    } catch { /* offline */ }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadUnread();
    const t = setInterval(loadUnread, open ? 8000 : 20000);
    return () => clearInterval(t);
  }, [user, open, loadUnread]);

  if (!user) return null;

  return (
    <>
      {/* Floating panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "fixed",
              bottom: "calc(84px + env(safe-area-inset-bottom))",
              insetInlineEnd: 16,
              width: "min(94vw, 400px)",
              height: "min(72dvh, 580px)",
              background: "#0a0a0a",
              border: `1px solid ${GOLD}30`,
              borderRadius: 16,
              boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
              zIndex: 900,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${GOLD}15`, flexShrink: 0 }}>
              <MessageSquare size={15} style={{ color: GOLD }} />
              <span style={{ fontWeight: 900, color: "#fff", fontSize: 13, flex: 1 }}>AMIS 👑</span>
              <button onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#666", display: "flex" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 8, display: "flex", flexDirection: "column" }}>
              <Messenger variant="widget" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <button onClick={() => { setOpen(v => !v); if (!open) loadUnread(); }}
        title="AMIS"
        style={{
          position: "fixed",
          bottom: "calc(20px + env(safe-area-inset-bottom))",
          insetInlineEnd: 16,
          width: 54, height: 54, borderRadius: "50%",
          background: open ? "#1a1a1a" : GOLD,
          border: open ? `1px solid ${GOLD}40` : "none",
          color: open ? GOLD : "#000",
          cursor: "pointer", zIndex: 901,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
        }}>
        {open ? <X size={22} /> : <MessageSquare size={22} />}
        {!open && notifOn && unread > 0 && (
          <span style={{
            position: "absolute", top: -2, insetInlineEnd: -2,
            background: "#ef4444", color: "#fff", borderRadius: 10,
            minWidth: 20, height: 20, padding: "0 5px",
            fontSize: 11, fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "2px solid #000",
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
