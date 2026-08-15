import { Router, type IRouter } from "express";
import crypto from "crypto";
import { pool } from "@workspace/db";

// ─── PPO — نظام توزيع الدخل الملكي الموحد ────────────────────────────────────
// Integrates with the existing rights/monetization system (gs_uploads views,
// pulse_posts likes) and adds:
//  • Revenue tabs: every conversation (dm_room) carries a revenue counter, and
//    every clip (gs_upload / pulse_post) is a tab via its existing earnings.
//  • PPO beneficiaries with % shares — active shares MUST sum to 100% before
//    a distribution can run.
//  • Distributions: take the undistributed profit pool (total revenue minus
//    everything already distributed) and split it transactionally; every
//    operation is recorded in the same database.

const router: IRouter = Router();
const PPO_LOCK_KEY = 927001; // advisory lock: one distribution at a time

export async function ensurePpoTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ppo_beneficiaries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        role TEXT NOT NULL,
        share_rate NUMERIC(6,2) NOT NULL CHECK (share_rate >= 0 AND share_rate <= 100),
        total_earned NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','removed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ppo_distributions (
        id SERIAL PRIMARY KEY,
        period TEXT NOT NULL,
        total_profit NUMERIC(14,2) NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ppo_distribution_items (
        id SERIAL PRIMARY KEY,
        distribution_id INTEGER NOT NULL REFERENCES ppo_distributions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        share_rate NUMERIC(6,2) NOT NULL,
        amount NUMERIC(14,2) NOT NULL
      );
      ALTER TABLE dm_rooms ADD COLUMN IF NOT EXISTS revenue NUMERIC(14,2) NOT NULL DEFAULT 0;
    `);
    console.log("[ppo] tables ready");
  } catch (e) {
    console.error("[ppo] table setup failed:", e);
  }
}

async function isAdminRequest(req: any): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers["x-admin-secret"];
  if (secret && typeof header === "string") {
    const a = Buffer.from(header), b = Buffer.from(secret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  const userId = (req.session as any)?.userId;
  if (!userId) return false;
  try {
    const { rows } = await pool.query(`SELECT is_admin FROM users WHERE id=$1`, [userId]);
    return rows[0]?.is_admin === true;
  } catch { return false; }
}

const num = (v: any) => Math.round(parseFloat(String(v)) * 100) / 100;
const toCents = (v: any) => Math.round(parseFloat(String(v)) * 100);

// Run fn inside a transaction that holds the PPO advisory lock, so beneficiary
// mutations can never interleave with a running distribution (and vice versa).
async function withPpoLock<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [PPO_LOCK_KEY]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

// Total revenue pool across all sources (clips + posts + chat tabs).
// Accepts the querying handle so a distribution reads through its own
// transaction (consistent snapshot), while read-only callers pass the pool.
async function totalRevenue(q: { query: (sql: string) => Promise<any> } = pool): Promise<{ uploads: number; posts: number; rooms: number; total: number }> {
  const { rows } = await q.query(`
    SELECT
      COALESCE((SELECT SUM(earnings) FROM gs_uploads), 0)  AS uploads,
      COALESCE((SELECT SUM(earnings) FROM pulse_posts), 0) AS posts,
      COALESCE((SELECT SUM(revenue) FROM dm_rooms), 0)     AS rooms`);
  const uploads = num(rows[0].uploads), posts = num(rows[0].posts), rooms = num(rows[0].rooms);
  return { uploads, posts, rooms, total: num(uploads + posts + rooms) };
}

// ─── GET /ppo/overview — everything the unified admin page needs ─────────────
router.get("/ppo/overview", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const [revenue, bens, tabs, clips, dists] = await Promise.all([
      totalRevenue(),
      pool.query(`SELECT b.*, u.username FROM ppo_beneficiaries b JOIN users u ON u.id=b.user_id WHERE b.status <> 'removed' ORDER BY b.share_rate DESC, b.id`),
      pool.query(`SELECT id, name, type, revenue FROM dm_rooms ORDER BY revenue DESC, id DESC LIMIT 50`),
      pool.query(`
        (SELECT 'gs_upload' AS kind, id, title, earnings FROM gs_uploads ORDER BY earnings DESC LIMIT 10)
        UNION ALL
        (SELECT 'pulse_post' AS kind, id, LEFT(content, 60) AS title, earnings FROM pulse_posts ORDER BY earnings DESC LIMIT 10)`),
      pool.query(`
        SELECT d.*, COALESCE(json_agg(json_build_object(
            'userId', i.user_id, 'role', i.role, 'shareRate', i.share_rate, 'amount', i.amount)
          ) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
        FROM ppo_distributions d
        LEFT JOIN ppo_distribution_items i ON i.distribution_id = d.id
        GROUP BY d.id ORDER BY d.id DESC LIMIT 20`),
    ]);
    const distributed = num((await pool.query(`SELECT COALESCE(SUM(total_profit),0) AS s FROM ppo_distributions`)).rows[0].s);
    res.json({
      revenue,
      distributed,
      pool: num(revenue.total - distributed),
      beneficiaries: bens.rows,
      roomTabs: tabs.rows,
      clipTabs: clips.rows,
      distributions: dists.rows,
    });
  } catch (e) { console.error("[ppo] overview:", e); res.status(500).json({ error: "Failed" }); }
});

// ─── POST /ppo/beneficiaries — register a beneficiary ────────────────────────
router.post("/ppo/beneficiaries", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const { userId, role, shareRate } = req.body ?? {};
    const uid = parseInt(userId), rate = num(shareRate);
    if (!Number.isInteger(uid) || !role || typeof role !== "string" || role.length > 60 || isNaN(rate) || rate < 0 || rate > 100) {
      res.status(400).json({ error: "بيانات غير صالحة (userId, role, shareRate 0-100)" }); return;
    }
    const u = await pool.query(`SELECT id FROM users WHERE id=$1`, [uid]);
    if (!u.rows[0]) { res.status(404).json({ error: "المواطن غير موجود" }); return; }
    const { rows } = await pool.query(
      `INSERT INTO ppo_beneficiaries (user_id, role, share_rate) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role, share_rate=EXCLUDED.share_rate, status='active'
       RETURNING *`, [uid, role.trim(), rate]);
    res.json({ beneficiary: rows[0] });
  } catch (e) { console.error("[ppo] add beneficiary:", e); res.status(500).json({ error: "Failed" }); }
});

// ─── PATCH /ppo/beneficiaries/:id — update share/status ──────────────────────
router.patch("/ppo/beneficiaries/:id", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const id = parseInt(req.params.id);
    const { shareRate, status } = req.body ?? {};
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const sets: string[] = []; const vals: any[] = [];
    if (shareRate !== undefined) {
      const r = num(shareRate);
      if (isNaN(r) || r < 0 || r > 100) { res.status(400).json({ error: "shareRate 0-100" }); return; }
      vals.push(r); sets.push(`share_rate=$${vals.length}`);
    }
    if (status !== undefined) {
      if (!["active", "paused"].includes(status)) { res.status(400).json({ error: "status active|paused" }); return; }
      vals.push(status); sets.push(`status=$${vals.length}`);
    }
    if (!sets.length) { res.status(400).json({ error: "Nothing to update" }); return; }
    vals.push(id);
    const { rows } = await pool.query(`UPDATE ppo_beneficiaries SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ beneficiary: rows[0] });
  } catch (e) { console.error("[ppo] patch beneficiary:", e); res.status(500).json({ error: "Failed" }); }
});

// ─── DELETE /ppo/beneficiaries/:id ───────────────────────────────────────────
router.delete("/ppo/beneficiaries/:id", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await pool.query(`DELETE FROM ppo_beneficiaries WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── PATCH /ppo/tabs/room/:id — record a conversation tab's revenue ──────────
router.patch("/ppo/tabs/room/:id", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const id = parseInt(req.params.id);
    const revenue = num(req.body?.revenue);
    if (!Number.isInteger(id) || isNaN(revenue) || revenue < 0 || revenue > 100000000) {
      res.status(400).json({ error: "revenue غير صالح" }); return;
    }
    const { rows } = await pool.query(`UPDATE dm_rooms SET revenue=$1 WHERE id=$2 RETURNING id, name, type, revenue`, [revenue, id]);
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ room: rows[0] });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── POST /ppo/distribute — run a distribution (100% rule enforced) ──────────
router.post("/ppo/distribute", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const period = String(req.body?.period ?? "").trim();
    if (!period || period.length > 40) { res.status(400).json({ error: "period مطلوب" }); return; }

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [PPO_LOCK_KEY]);

    const { rows: bens } = await client.query(`SELECT * FROM ppo_beneficiaries WHERE status='active' ORDER BY id FOR UPDATE`);
    const sum = bens.reduce((s, b) => s + parseFloat(b.share_rate), 0);
    if (!bens.length || Math.abs(sum - 100) > 0.01) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `قاعدة 100%: مجموع الحصص النشطة ${sum.toFixed(2)}% — خاصو يكون 100% بالضبط` });
      return;
    }

    const rev = await totalRevenue();
    const distributed = num((await client.query(`SELECT COALESCE(SUM(total_profit),0) AS s FROM ppo_distributions`)).rows[0].s);
    const profitPool = num(rev.total - distributed);
    if (profitPool <= 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "ما كاين حتى ربح جديد للتوزيع — كلشي تقسم من قبل" });
      return;
    }

    const { rows: dRows } = await client.query(
      `INSERT INTO ppo_distributions (period, total_profit, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [period, profitPool, (req.session as any)?.userId ?? null]);
    const dist = dRows[0];
    const items = [];
    for (const b of bens) {
      const amount = num((profitPool * parseFloat(b.share_rate)) / 100);
      await client.query(
        `INSERT INTO ppo_distribution_items (distribution_id, user_id, role, share_rate, amount) VALUES ($1,$2,$3,$4,$5)`,
        [dist.id, b.user_id, b.role, b.share_rate, amount]);
      await client.query(`UPDATE ppo_beneficiaries SET total_earned = total_earned + $1 WHERE id=$2`, [amount, b.id]);
      items.push({ userId: b.user_id, role: b.role, shareRate: parseFloat(b.share_rate), amount });
    }
    await client.query("COMMIT");
    res.json({ report: { id: dist.id, period, totalProfit: profitPool, distributions: items, timestamp: dist.created_at } });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    console.error("[ppo] distribute:", e);
    res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
});

// ─── GET /ppo/balance/:userId — a beneficiary's total earned ─────────────────
router.get("/ppo/balance/:userId", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const uid = parseInt(req.params.userId);
    if (!Number.isInteger(uid)) { res.status(400).json({ error: "Invalid userId" }); return; }
    const { rows } = await pool.query(`SELECT total_earned FROM ppo_beneficiaries WHERE user_id=$1`, [uid]);
    res.json({ balance: num(rows[0]?.total_earned ?? 0) });
  } catch { res.status(500).json({ error: "Failed" }); }
});

export default router;
