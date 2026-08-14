import { Router, type IRouter } from "express";
import crypto from "crypto";
import { pool } from "@workspace/db";

// ─── نظام الحقوق وتحقيق الدخل — Rights & Monetization ───────────────────────
// Every original work is fingerprinted at upload time (first owner wins).
// Earning rates are admin-configurable. Citizens can report pirated content;
// confirmed piracy hides the content / freezes its earnings.

const router: IRouter = Router();

export async function ensureRightsTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monetization_settings (
        content_type TEXT PRIMARY KEY,
        rate NUMERIC(10,4) NOT NULL,
        unit TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS content_fingerprints (
        id SERIAL PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL,
        content_id INTEGER NOT NULL,
        owner_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS piracy_reports (
        id SERIAL PRIMARY KEY,
        content_type TEXT NOT NULL CHECK (content_type IN ('gs_upload','pulse_post')),
        content_id INTEGER NOT NULL,
        reporter_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      ALTER TABLE pulse_posts ADD COLUMN IF NOT EXISTS earnings NUMERIC(10,4) NOT NULL DEFAULT 0;
      ALTER TABLE pulse_posts ADD COLUMN IF NOT EXISTS media_type TEXT;
      ALTER TABLE gs_uploads ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pulse_post_likes ON pulse_post_likes (post_id, voter_ip);
      CREATE TABLE IF NOT EXISTS revenue_divisions (
        division TEXT PRIMARY KEY,
        share_pct NUMERIC(5,2) NOT NULL CHECK (share_pct >= 0 AND share_pct <= 100),
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Seed the empire's revenue split (YouTube/Twitch-style profit share)
    await pool.query(`
      INSERT INTO revenue_divisions (division, share_pct, sort_order) VALUES
        ('GLOBALSTAR', 40, 1),
        ('GDNA TV', 30, 2),
        ('GDNA MUSIC', 20, 3),
        ('GDNA MERCH', 10, 4)
      ON CONFLICT (division) DO NOTHING;
    `);
    // Seed default rates (keeps existing 0.01/view for uploads)
    await pool.query(`
      INSERT INTO monetization_settings (content_type, rate, unit) VALUES
        ('gs_upload', 0.01, 'view'),
        ('pulse_post', 0.05, 'like')
      ON CONFLICT (content_type) DO NOTHING;
    `);
  } catch (err) {
    console.error("[RIGHTS] ensureRightsTables failed:", err);
  }
}

export async function getRate(contentType: string, fallback: number): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT rate FROM monetization_settings WHERE content_type=$1`, [contentType]);
    const r = parseFloat(rows[0]?.rate);
    return isNaN(r) ? fallback : r;
  } catch { return fallback; }
}

async function sessionUsername(req: { session?: { userId?: number } }): Promise<string | null> {
  const userId = req.session?.userId;
  if (!userId) return null;
  const { rows } = await pool.query<{ username: string }>(
    `SELECT username FROM users WHERE id=$1`, [userId]);
  return rows[0]?.username ?? null;
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

// ─── GET /rights/settings — public read of earning rates ─────────────────────
router.get("/rights/settings", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(`SELECT content_type, rate, unit FROM monetization_settings ORDER BY content_type`);
    res.json({ settings: rows });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── PATCH /rights/admin/settings — admin updates a rate ─────────────────────
router.patch("/rights/admin/settings", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const { contentType, rate } = req.body ?? {};
    const r = parseFloat(rate);
    if (!["gs_upload", "pulse_post"].includes(contentType) || isNaN(r) || r < 0 || r > 1000) {
      res.status(400).json({ error: "Invalid contentType or rate" }); return;
    }
    const { rows } = await pool.query(
      `UPDATE monetization_settings SET rate=$1, updated_at=NOW() WHERE content_type=$2 RETURNING *`,
      [r, contentType]);
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ setting: rows[0] });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── POST /rights/report — citizen reports pirated content ───────────────────
router.post("/rights/report", async (req, res): Promise<void> => {
  try {
    const name = await sessionUsername(req);
    if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً للتبليغ" }); return; }
    const { contentType, contentId, reason } = req.body ?? {};
    const id = parseInt(contentId, 10);
    const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    if (!["gs_upload", "pulse_post"].includes(contentType) || isNaN(id) || !why) {
      res.status(400).json({ error: "contentType و contentId و reason مطلوبين" }); return;
    }
    // Content must exist
    const table = contentType === "gs_upload" ? "gs_uploads" : "pulse_posts";
    const { rows: exists } = await pool.query(`SELECT id FROM ${table} WHERE id=$1`, [id]);
    if (!exists[0]) { res.status(404).json({ error: "المحتوى غير موجود" }); return; }
    // One open report per citizen per content
    const { rows: dup } = await pool.query(
      `SELECT id FROM piracy_reports WHERE content_type=$1 AND content_id=$2 AND reporter_name=$3 AND status='pending'`,
      [contentType, id, name]);
    if (dup[0]) { res.status(409).json({ error: "بلاغك قيد المراجعة بالفعل" }); return; }
    const { rows } = await pool.query(
      `INSERT INTO piracy_reports (content_type, content_id, reporter_name, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [contentType, id, name, why]);
    res.status(201).json({ report: rows[0] });
  } catch { res.status(500).json({ error: "Failed to report" }); }
});

// ─── GET /rights/admin/reports — admin lists piracy reports ──────────────────
router.get("/rights/admin/reports", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const { rows } = await pool.query(`
      SELECT r.*,
        CASE WHEN r.content_type='gs_upload'
          THEN (SELECT u.title FROM gs_uploads u WHERE u.id=r.content_id)
          ELSE (SELECT LEFT(p.content, 120) FROM pulse_posts p WHERE p.id=r.content_id)
        END AS content_preview,
        CASE WHEN r.content_type='gs_upload'
          THEN (SELECT u.uploader_name FROM gs_uploads u WHERE u.id=r.content_id)
          ELSE (SELECT p.username FROM pulse_posts p WHERE p.id=r.content_id)
        END AS accused_name
      FROM piracy_reports r
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT 200
    `);
    res.json({ reports: rows });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── PATCH /rights/admin/reports/:id — confirm/dismiss a report ──────────────
// Confirming piracy: pulse post is hidden; gs upload's earnings are frozen at 0
// (the pirate never gets paid for a stolen work).
router.patch("/rights/admin/reports/:id", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const id = parseInt(req.params.id, 10);
    const status = req.body?.status;
    if (isNaN(id) || !["confirmed", "dismissed"].includes(status)) {
      res.status(400).json({ error: "Invalid id or status" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE piracy_reports SET status=$1, resolved_at=NOW() WHERE id=$2 AND status='pending' RETURNING *`,
        [status, id]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "البلاغ غير موجود أو تمت معالجته من قبل" }); return;
      }
      if (status === "confirmed") {
        if (rows[0].content_type === "pulse_post") {
          await client.query(`UPDATE pulse_posts SET is_visible=false, earnings=0 WHERE id=$1`, [rows[0].content_id]);
        } else {
          // Freeze the upload so future views never restore the pirate's earnings
          await client.query(`UPDATE gs_uploads SET earnings=0, is_frozen=true WHERE id=$1`, [rows[0].content_id]);
        }
      }
      await client.query("COMMIT");
      res.json({ report: rows[0] });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { client.release(); }
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── GET /rights/my-earnings — citizen's full earnings picture ───────────────
router.get("/rights/my-earnings", async (req, res): Promise<void> => {
  try {
    const name = await sessionUsername(req);
    if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }
    const { rows: gs } = await pool.query(
      `SELECT COALESCE(SUM(earnings),0) AS total, COALESCE(SUM(views),0)::int AS views FROM gs_uploads WHERE uploader_name=$1`, [name]);
    const { rows: pulse } = await pool.query(
      `SELECT COALESCE(SUM(p.earnings),0) AS total, COALESCE(SUM(p.likes),0)::int AS likes
       FROM pulse_posts p JOIN users u ON p.user_id=u.id WHERE u.username=$1 AND p.is_visible=true`, [name]);
    const { rows: settings } = await pool.query(`SELECT content_type, rate, unit FROM monetization_settings`);
    res.json({
      uploaderName: name,
      globalstar: { earnings: parseFloat(gs[0].total), views: gs[0].views },
      pulse: { earnings: parseFloat(pulse[0].total), likes: pulse[0].likes },
      totalEarnings: parseFloat(gs[0].total) + parseFloat(pulse[0].total),
      rates: settings,
    });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── GET /rights/admin/finance — الإدارة المالية: revenue per division ────────
// Total platform revenue = all content earnings (GS views + Pulse likes),
// automatically split across the empire's divisions by their share_pct.
router.get("/rights/admin/finance", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const { rows: gs } = await pool.query(
      `SELECT COALESCE(SUM(earnings),0) AS total, COALESCE(SUM(views),0)::int AS views, COUNT(*)::int AS items FROM gs_uploads`);
    const { rows: pulse } = await pool.query(
      `SELECT COALESCE(SUM(earnings),0) AS total, COALESCE(SUM(likes),0)::int AS likes, COUNT(*)::int AS items FROM pulse_posts WHERE is_visible=true`);
    const { rows: withdrawals } = await pool.query(
      `SELECT COALESCE(SUM(amount_coins),0) AS total FROM gs_withdrawals WHERE status IN ('pending','approved','paid')`);
    const gsTotal = parseFloat(gs[0].total);
    const pulseTotal = parseFloat(pulse[0].total);
    const totalRevenue = Math.round((gsTotal + pulseTotal) * 10000) / 10000;
    const { rows: divisions } = await pool.query(
      `SELECT division, share_pct, sort_order FROM revenue_divisions ORDER BY sort_order`);
    res.json({
      totalRevenue,
      sources: {
        globalstar: { earnings: gsTotal, views: gs[0].views, items: gs[0].items },
        pulse: { earnings: pulseTotal, likes: pulse[0].likes, items: pulse[0].items },
      },
      withdrawalsCommitted: parseFloat(withdrawals[0].total),
      divisions: divisions.map((d: any) => ({
        division: d.division,
        sharePct: parseFloat(d.share_pct),
        amount: Math.round(totalRevenue * parseFloat(d.share_pct)) / 100,
      })),
    });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── PATCH /rights/admin/divisions — admin edits the split (must total 100) ───
router.patch("/rights/admin/divisions", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const shares = req.body?.shares;
    if (!Array.isArray(shares) || shares.length === 0) {
      res.status(400).json({ error: "shares مطلوبة" }); return;
    }
    const { rows: existing } = await pool.query(`SELECT division FROM revenue_divisions`);
    const known = new Set(existing.map((r: any) => r.division));
    let sum = 0;
    for (const s of shares) {
      const pct = parseFloat(s?.sharePct);
      if (!known.has(s?.division) || isNaN(pct) || pct < 0 || pct > 100) {
        res.status(400).json({ error: "قسم غير معروف أو نسبة غير صالحة" }); return;
      }
      sum += pct;
    }
    const submitted = new Set(shares.map((s: any) => s?.division));
    if (submitted.size !== shares.length || submitted.size !== known.size || Math.abs(sum - 100) > 0.01) {
      res.status(400).json({ error: "مجموع النسب خاصو يكون 100% ولجميع الأقسام" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of shares) {
        await client.query(
          `UPDATE revenue_divisions SET share_pct=$1, updated_at=NOW() WHERE division=$2`,
          [parseFloat(s.sharePct), s.division]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { client.release(); }
    const { rows } = await pool.query(`SELECT division, share_pct, sort_order FROM revenue_divisions ORDER BY sort_order`);
    res.json({ divisions: rows });
  } catch { res.status(500).json({ error: "Failed" }); }
});

export default router;
