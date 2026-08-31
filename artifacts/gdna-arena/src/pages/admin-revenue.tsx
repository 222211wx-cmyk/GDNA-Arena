import { useState, useEffect, useCallback } from "react";
import { GOLD, GOLD_A } from "../components/social/social-i18n";

/* ── الإدارة المالية الملكية الموحدة ─────────────────────────────────────────
 * One admin page, three sections:
 *  [القديم]  existing views/likes rates + division split (rights system)
 *  [التابات] ChatTabManager — every conversation/clip is a tab with revenue
 *  [التوزيع] PPOAuditor — beneficiaries (shares MUST sum to 100%) + distributions
 * All data lives in the ONE platform database via /api/rights/* and /api/ppo/*.
 */

const API = (p: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${p}`;

type Beneficiary = { id: number; user_id: number; username: string; role: string; share_rate: string; total_earned: string; status: string };
type RoomTab = { id: number; name: string | null; type: string; revenue: string };
type ClipTab = { kind: string; id: number; title: string | null; earnings: string };
type Distribution = {
  id: number;
  period: string;
  total_profit: string;
  created_at: string;
  items: {
    userId: number;
    role: string;
    shareRate: string;
    amount: string;
    walletAmount?: number;
    credited?: boolean;
  }[];
};
type Overview = {
  revenue: { uploads: number; posts: number; rooms: number; total: number };
  distributed: number; pool: number;
  beneficiaries: Beneficiary[]; roomTabs: RoomTab[]; clipTabs: ClipTab[]; distributions: Distribution[];
};
type Rate = { content_type: string; rate: string; unit: string };
type Division = { division: string; sharePct: number; amount: number };

const fmt = (v: string | number) => Number(v).toLocaleString("fr-MA", { maximumFractionDigits: 2 });

export default function AdminRevenuePage() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem("gdna_admin_secret") ?? "");
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"old" | "tabs" | "ppo">("ppo");
  const [ov, setOv] = useState<Overview | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [msg, setMsg] = useState("");
  // PPO form
  const [bUser, setBUser] = useState(""); const [bRole, setBRole] = useState(""); const [bShare, setBShare] = useState("");
  const [period, setPeriod] = useState("");
  const [tabDraft, setTabDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) h["x-admin-secret"] = secret;
    return h;
  }, [secret]);

  const load = useCallback(async (sec: string) => {
    setError("");
    const h: Record<string, string> = {};
    if (sec) h["x-admin-secret"] = sec;
    const r = await fetch(API("/api/ppo/overview"), { headers: h, credentials: "include" });
    if (!r.ok) {
      setAuthed(false); sessionStorage.removeItem("gdna_admin_secret");
      setError(r.status === 403 ? "المفتاح غير صحيح — الدخول مرفوض" : "خطأ في الخادم");
      return;
    }
    setOv(await r.json());
    setAuthed(true);
    if (sec) sessionStorage.setItem("gdna_admin_secret", sec);
    void fetch(API("/api/rights/settings"), { credentials: "include" })
      .then(res => res.ok ? res.json() : { settings: [] }).then(d => setRates(d.settings ?? []));
    void fetch(API("/api/rights/admin/finance"), { headers: h, credentials: "include" })
      .then(res => res.ok ? res.json() : null).then(d => { if (d) setDivisions(d.divisions ?? []); });
  }, []);

  useEffect(() => { if (secret) void load(secret); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function call(method: string, path: string, body?: unknown) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(API(path), { method, headers: headers(), credentials: "include", body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? "فشلت العملية"); return null; }
      await load(secret);
      return j;
    } finally { setBusy(false); }
  }

  const activeSum = ov?.beneficiaries.filter(b => b.status === "active").reduce((s, b) => s + parseFloat(b.share_rate), 0) ?? 0;

  if (!authed) {
    return (
      <div dir="rtl" style={{ maxWidth: 420, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <h1 style={{ color: GOLD, fontSize: 22, marginBottom: 12 }}>👑 الإدارة المالية الملكية</h1>
        <p style={{ color: "#999", fontSize: 14, marginBottom: 16 }}>ادخل المفتاح الإداري أو سجّل الدخول بحساب إداري</p>
        <input type="password" value={input} onChange={e => setInput(e.target.value)} placeholder="المفتاح الإداري"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${GOLD_A(0.267)}`, background: "#111", color: "#eee", marginBottom: 10 }} />
        <button onClick={() => { setSecret(input); void load(input); }}
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: GOLD, color: "#111", fontWeight: 700, cursor: "pointer" }}>
          دخول
        </button>
        <button onClick={() => void load("")} style={{ marginTop: 8, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13 }}>
          دخول بجلسة إدارية
        </button>
        {error && <p style={{ color: "#f87171", marginTop: 10 }}>{error}</p>}
      </div>
    );
  }

  const card: React.CSSProperties = { background: "#141414", border: `1px solid ${GOLD_A(0.133)}`, borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp: React.CSSProperties = { padding: 8, borderRadius: 8, border: "1px solid #333", background: "#0d0d0d", color: "#eee", fontSize: 14 };
  const btn: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "none", background: GOLD, color: "#111", fontWeight: 700, cursor: "pointer" };

  return (
    <div dir="rtl" style={{ maxWidth: 860, margin: "0 auto", padding: 16 }}>
      <h1 style={{ color: GOLD, fontSize: 22, margin: "10px 0" }}>👑 الإدارة المالية الملكية الموحدة</h1>
      {ov && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {[["إجمالي الإيراد", ov.revenue.total], ["توزّع", ov.distributed], ["الربح الجاهز للتوزيع", ov.pool]].map(([l, v]) => (
            <div key={String(l)} style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, textAlign: "center" }}>
              <div style={{ color: "#999", fontSize: 12 }}>{l}</div>
              <div style={{ color: GOLD, fontSize: 20, fontWeight: 800 }}>{fmt(v as number)} 🪙</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {([["old", "القديم — المشاهدات والإعجابات"], ["tabs", "التابات"], ["ppo", "التوزيع PPO"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)}
            style={{ flex: 1, padding: 10, borderRadius: 10, cursor: "pointer", fontWeight: 700,
              border: `1px solid ${section === k ? GOLD : "#333"}`, background: section === k ? GOLD_A(0.133) : "#111", color: section === k ? GOLD : "#aaa" }}>
            {l}
          </button>
        ))}
      </div>
      {msg && <p style={{ color: "#fbbf24", marginBottom: 10 }}>{msg}</p>}

      {/* ── [القديم] rates + divisions ── */}
      {section === "old" && ov && (
        <>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 10 }}>نسب الريع الحالية (خدامة كما هي)</h2>
            {rates.map(r => (
              <div key={r.content_type} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#ccc", fontSize: 14 }}>
                <span>{r.content_type === "gs_upload" ? "🎬 مشاهدة عمل GlobalStar" : "📢 إعجاب منشور Pulse"}</span>
                <span style={{ color: GOLD }}>{fmt(r.rate)} / {r.unit}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #222", marginTop: 8, paddingTop: 8, color: "#ccc", fontSize: 14 }}>
              <div>🎬 إيراد الأعمال: <b style={{ color: GOLD }}>{fmt(ov.revenue.uploads)}</b></div>
              <div>📢 إيراد المنشورات: <b style={{ color: GOLD }}>{fmt(ov.revenue.posts)}</b></div>
            </div>
          </div>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 10 }}>تقسيم الأقسام (100%)</h2>
            {divisions.map(d => (
              <div key={d.division} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#ccc", fontSize: 14 }}>
                <span>{d.division}</span>
                <span><b style={{ color: GOLD }}>{d.sharePct}%</b> — {fmt(d.amount)} 🪙</span>
              </div>
            ))}
            <p style={{ color: "#777", fontSize: 12, marginTop: 8 }}>التعديل من صفحة الإدارة ديال GlobalStar (نفس قاعدة البيانات).</p>
          </div>
        </>
      )}

      {/* ── [التابات] room + clip tabs ── */}
      {section === "tabs" && ov && (
        <>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 4 }}>💬 تابات المحادثات</h2>
            <p style={{ color: "#777", fontSize: 12, marginBottom: 10 }}>كل محادثة عندها تاب وإيراد كيدخل فالمجموع العام. سجّل الإيراد يدويا هنا.</p>
            {ov.roomTabs.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #1e1e1e" }}>
                <span style={{ flex: 1, color: "#ccc", fontSize: 14 }}>{t.name || `محادثة #${t.id}`} <span style={{ color: "#666", fontSize: 11 }}>({t.type})</span></span>
                <input style={{ ...inp, width: 110 }} inputMode="decimal" value={tabDraft[t.id] ?? String(t.revenue)}
                  onChange={e => setTabDraft(d => ({ ...d, [t.id]: e.target.value }))} />
                <button style={btn} disabled={busy}
                  onClick={() => void call("PATCH", `/api/ppo/tabs/room/${t.id}`, { revenue: parseFloat(tabDraft[t.id] ?? String(t.revenue)) })}>
                  حفظ
                </button>
              </div>
            ))}
            {!ov.roomTabs.length && <p style={{ color: "#666" }}>ما كاينة حتى محادثة.</p>}
          </div>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 10 }}>🎬 تابات الكليبات والمنشورات (أعلى إيراد)</h2>
            {ov.clipTabs.map(c => (
              <div key={`${c.kind}-${c.id}`} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#ccc", fontSize: 14 }}>
                <span>{c.kind === "gs_upload" ? "🎬" : "📢"} {c.title || `#${c.id}`}</span>
                <span style={{ color: GOLD }}>{fmt(c.earnings)} 🪙</span>
              </div>
            ))}
            <p style={{ color: "#777", fontSize: 12, marginTop: 8 }}>هاد الإيراد كيتحسب أوتوماتيكيا من المشاهدات والإعجابات — النظام القديم باقي خدام.</p>
          </div>
        </>
      )}

      {/* ── [التوزيع] PPO ── */}
      {section === "ppo" && ov && (
        <>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 4 }}>المستفيدين — قاعدة 100%</h2>
            <p style={{ color: Math.abs(activeSum - 100) <= 0.01 ? "#4ade80" : "#f87171", fontSize: 13, marginBottom: 10 }}>
              مجموع الحصص النشطة: {activeSum.toFixed(2)}% {Math.abs(activeSum - 100) <= 0.01 ? "✅" : "— خاصو يكون 100% باش يخدم التوزيع"}
            </p>
            {ov.beneficiaries.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #1e1e1e", fontSize: 14 }}>
                <span style={{ flex: 1, color: "#ccc" }}>👤 {b.username} <span style={{ color: "#888" }}>({b.role})</span></span>
                <span style={{ color: GOLD, minWidth: 60 }}>{fmt(b.share_rate)}%</span>
                <span style={{ color: "#4ade80", minWidth: 90 }}>{fmt(b.total_earned)} 🪙</span>
                <button style={{ ...btn, background: b.status === "active" ? "#333" : GOLD, color: b.status === "active" ? "#ccc" : "#111" }} disabled={busy}
                  onClick={() => void call("PATCH", `/api/ppo/beneficiaries/${b.id}`, { status: b.status === "active" ? "paused" : "active" })}>
                  {b.status === "active" ? "إيقاف" : "تفعيل"}
                </button>
                <button style={{ ...btn, background: "#7f1d1d", color: "#fff" }} disabled={busy}
                  onClick={() => void call("DELETE", `/api/ppo/beneficiaries/${b.id}`)}>حذف</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <input style={{ ...inp, width: 100 }} placeholder="ID المواطن" inputMode="numeric" value={bUser} onChange={e => setBUser(e.target.value)} />
              <input style={{ ...inp, flex: 1, minWidth: 120 }} placeholder="الدور (مثلا: مؤسس)" value={bRole} onChange={e => setBRole(e.target.value)} />
              <input style={{ ...inp, width: 90 }} placeholder="%" inputMode="decimal" value={bShare} onChange={e => setBShare(e.target.value)} />
              <button style={btn} disabled={busy}
                onClick={() => void call("POST", "/api/ppo/beneficiaries", { userId: parseInt(bUser), role: bRole, shareRate: parseFloat(bShare) })
                  .then(r => { if (r) { setBUser(""); setBRole(""); setBShare(""); } })}>
                إضافة
              </button>
            </div>
          </div>
          <div style={card}>
            <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 10 }}>تشغيل توزيع جديد</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="الفترة (مثلا: غشت 2026)" value={period} onChange={e => setPeriod(e.target.value)} />
              <button style={btn} disabled={busy || !period.trim()}
                onClick={() => void call("POST", "/api/ppo/distribute", { period: period.trim() }).then(r => { if (r) setPeriod(""); })}>
                وزّع الربح ({fmt(ov.pool)} 🪙)
              </button>
            </div>
          </div>
          <div style={card}>
             <h2 style={{ color: "#eee", fontSize: 16, marginBottom: 4 }}>سجل التوزيعات</h2>
             <p style={{ color: "#777", fontSize: 12, marginBottom: 10 }}>
               كل توزيع جديد كيتسجّل فالسجل وكيتم إيداع نصيب كل مواطن مباشرة فالمحفظة ديالو.
             </p>
            {ov.distributions.map(d => (
              <div key={d.id} style={{ borderBottom: "1px solid #1e1e1e", padding: "8px 0", fontSize: 13 }}>
                 <div data-testid={`text-ppo-distribution-${d.id}`} style={{ color: GOLD, fontWeight: 700 }}>#{d.id} — {d.period} — {fmt(d.total_profit)} 🪙 <span style={{ color: "#666", fontWeight: 400 }}>{new Date(d.created_at).toLocaleString("fr-MA")}</span></div>
                {d.items.map((i, idx) => (
                   <div key={idx} data-testid={`status-ppo-credit-${d.id}-${i.userId}`} style={{ color: "#aaa", paddingRight: 12 }}>
                     👤 #{i.userId} ({i.role}) — {fmt(i.shareRate)}% = <b style={{ color: "#4ade80" }}>{fmt(i.amount)} 🪙</b>
                     <span style={{ color: i.credited ? "#4ade80" : "#fbbf24", marginRight: 8 }}>
                       {i.credited
                         ? `✅ تودّع فالمحفظة: ${fmt(i.walletAmount ?? Math.round(Number(i.amount)))} 🪙`
                         : "⏳ مازال ما تودّعش فالمحفظة"}
                     </span>
                   </div>
                ))}
              </div>
            ))}
            {!ov.distributions.length && <p style={{ color: "#666" }}>ما تدار حتى توزيع بعد.</p>}
          </div>
        </>
      )}
    </div>
  );
}
