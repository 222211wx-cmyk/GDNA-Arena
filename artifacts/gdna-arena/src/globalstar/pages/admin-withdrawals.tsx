import { useEffect, useState, useCallback } from "react";

// ── بوابة إدارة طلبات السحب — محمية بـ ADMIN_SECRET ──────────────────────────
const GOLD = "#FFD700";
const API = (p: string) => p; // deployed at root; dev proxy handles /api

interface Withdrawal {
  id: number;
  uploader_name: string;
  amount_coins: string;
  amount_mad: string;
  amount_usd: string;
  status: "pending" | "approved" | "paid" | "rejected";
  requested_at: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:  { label: "⏳ قيد الانتظار", color: "#fbbf24" },
  approved: { label: "✅ موافَق عليه",  color: "#22c55e" },
  paid:     { label: "💰 مدفوع",        color: "#3b82f6" },
  rejected: { label: "❌ مرفوض",        color: "#ef4444" },
};

export default function AdminWithdrawals() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem("gdna_admin_secret") ?? "");
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) h["x-admin-secret"] = secret;
    return h;
  }, [secret]);

  const load = useCallback(async (sec: string) => {
    setError("");
    const h: Record<string, string> = {};
    if (sec) h["x-admin-secret"] = sec;
    const r = await fetch(API("/api/gs/admin/withdrawals"), { headers: h, credentials: "include" });
    if (!r.ok) {
      setAuthed(false);
      sessionStorage.removeItem("gdna_admin_secret");
      setError(r.status === 403 ? "المفتاح غير صحيح — الدخول مرفوض" : "خطأ في الخادم");
      return;
    }
    const j = await r.json();
    setRows(j.withdrawals ?? []);
    setAuthed(true);
    if (sec) sessionStorage.setItem("gdna_admin_secret", sec);
  }, []);

  useEffect(() => { if (secret) load(secret); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(id: number, status: string) {
    setBusy(id);
    try {
      const r = await fetch(API(`/api/gs/admin/withdrawals/${id}`), {
        method: "PATCH", headers: headers(), credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const j = await r.json();
        setRows(prev => prev.map(w => (w.id === id ? j.withdrawal : w)));
      } else {
        setError("فشل تحديث الحالة");
      }
    } finally { setBusy(null); }
  }

  const pendingTotal = rows.filter(w => w.status === "pending")
    .reduce((s, w) => s + parseFloat(w.amount_mad || "0"), 0);

  if (!authed) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: "#050505", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 380, background: "#0d0d0d", border: `1px solid ${GOLD}30`, borderRadius: 16, padding: 28, textAlign: "center" }}>
          <p style={{ fontSize: 40, margin: "0 0 8px" }}>👑</p>
          <h1 style={{ color: GOLD, fontSize: 18, fontWeight: 900, margin: "0 0 6px" }}>بوابة الإدارة — طلبات السحب</h1>
          <p style={{ color: "#888", fontSize: 12, margin: "0 0 18px" }}>أدخل مفتاح الإدارة السري للمتابعة</p>
          <input type="password" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && input.trim() && (setSecret(input.trim()), load(input.trim()))}
            placeholder="ADMIN_SECRET"
            style={{ width: "100%", boxSizing: "border-box", background: "#111", border: `1px solid ${GOLD}25`, borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none", marginBottom: 12, textAlign: "center" }} />
          <button onClick={() => { if (input.trim()) { setSecret(input.trim()); load(input.trim()); } }}
            style={{ width: "100%", background: GOLD, border: "none", borderRadius: 10, padding: "10px 0", color: "#000", fontWeight: 900, fontSize: 14, cursor: "pointer" }}>
            دخول
          </button>
          {error && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#050505", padding: "24px 16px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <h1 style={{ color: GOLD, fontSize: 20, fontWeight: 900, margin: 0, flex: 1 }}>👑 إدارة طلبات السحب</h1>
          <div style={{ background: "#0d0d0d", border: `1px solid ${GOLD}25`, borderRadius: 10, padding: "8px 14px", fontSize: 13, color: "#fff" }}>
            المستحق (قيد الانتظار): <b style={{ color: GOLD }}>{pendingTotal.toFixed(2)} MAD</b>
          </div>
          <button onClick={() => load(secret)} style={{ background: "#1a1a1a", border: `1px solid ${GOLD}20`, borderRadius: 10, padding: "8px 14px", color: GOLD, fontSize: 13, cursor: "pointer" }}>
            🔄 تحديث
          </button>
        </div>
        {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}
        {rows.length === 0 ? (
          <p style={{ color: "#666", textAlign: "center", padding: 40 }}>لا توجد طلبات سحب بعد</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map(w => (
              <div key={w.id} style={{ background: "#0d0d0d", border: `1px solid ${GOLD}15`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ margin: 0, color: "#fff", fontWeight: 800, fontSize: 14 }}>{w.uploader_name}</p>
                  <p style={{ margin: "2px 0 0", color: "#888", fontSize: 11 }}>{new Date(w.requested_at).toLocaleString("ar-MA")}</p>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: 16 }}>{parseFloat(w.amount_mad).toFixed(2)} MAD</p>
                  <p style={{ margin: 0, color: "#666", fontSize: 11 }}>{parseFloat(w.amount_coins).toFixed(0)} 🪙 · ${parseFloat(w.amount_usd).toFixed(2)}</p>
                </div>
                <span style={{ color: STATUS_META[w.status]?.color, fontSize: 13, fontWeight: 800, minWidth: 110, textAlign: "center" }}>
                  {STATUS_META[w.status]?.label ?? w.status}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {w.status === "pending" && (
                    <>
                      <button disabled={busy === w.id} onClick={() => setStatus(w.id, "approved")}
                        style={{ background: "#22c55e20", border: "1px solid #22c55e50", borderRadius: 8, padding: "6px 12px", color: "#22c55e", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>موافقة</button>
                      <button disabled={busy === w.id} onClick={() => setStatus(w.id, "rejected")}
                        style={{ background: "#ef444420", border: "1px solid #ef444450", borderRadius: 8, padding: "6px 12px", color: "#ef4444", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>رفض</button>
                    </>
                  )}
                  {w.status === "approved" && (
                    <button disabled={busy === w.id} onClick={() => setStatus(w.id, "paid")}
                      style={{ background: "#3b82f620", border: "1px solid #3b82f650", borderRadius: 8, padding: "6px 12px", color: "#3b82f6", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>تم الدفع 💰</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
