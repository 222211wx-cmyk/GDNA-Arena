import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pool } from "@workspace/db";
import { getRate } from "./rights";
import { getLevel, multiplierForUsername } from "../lib/levels.js";
import { moderateText } from "../lib/moderate";
import { FINANCE_SIMULATION_MODE } from "../lib/finance-simulation";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video and audio files are allowed"));
    }
  },
});

const router = Router();

// ─── POST /gs/uploads ─────────────────────────────────────────────────────────
// Resolve the logged-in citizen's username — identity comes from the session,
// never from the client body (anyone could claim anyone's name/earnings).
async function sessionUsername(req: { session?: { userId?: number } }): Promise<string | null> {
  const userId = req.session?.userId;
  if (!userId) return null;
  const { rows } = await pool.query<{ username: string }>(
    `SELECT username FROM users WHERE id=$1`, [userId]);
  return rows[0]?.username ?? null;
}

// Auth gate BEFORE multer parses the body — otherwise anonymous attackers
// could still write huge files to disk before getting their 401.
const requireSessionFirst = async (req: any, res: any, next: any) => {
  const name = await sessionUsername(req);
  if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً لرفع المحتوى" }); return; }
  req.uploaderName = name;
  next();
};

router.post("/gs/uploads", requireSessionFirst, upload.single("file"), async (req, res): Promise<void> => {
  try {
    const uploaderName = (req as any).uploaderName as string;
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const { title, category, figureTag } = req.body;
    const type = req.file.mimetype.startsWith("video/") ? "video" : "audio";

    // ── الموقع ضد التفاهة: عنوان العمل يمر عبر فلتر الجودة قبل النشر
    if (title && typeof title === "string" && title.trim()) {
      const mod = await moderateText(title.trim(), { allowTrivial: true });
      if (!mod.ok) {
        fs.unlink(req.file.path, () => {});
        res.status(400).json({ error: "⚖️ العنوان مرفوض — الإمبراطورية ضد التفاهة، اختر عنواناً يليق بعملك" });
        return;
      }
    }

    // ── Rights protection: fingerprint the file (sha256). First owner wins —
    // re-uploading someone else's work is rejected and earns nothing.
    const hash = crypto.createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(req.file!.path)
        .on("data", (d) => hash.update(d))
        .on("end", () => resolve())
        .on("error", reject);
    });
    const fingerprint = hash.digest("hex");
    // Transaction: the upload row only exists if THIS uploader wins the
    // fingerprint claim — two identical concurrent uploads can't both publish.
    const client = await pool.connect();
    let rows: any[];
    try {
      await client.query("BEGIN");
      const { rows: inserted } = await client.query(
        `INSERT INTO gs_uploads (uploader_name, title, type, category, file_path, file_name, file_size, mime_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          uploaderName,
          title || req.file.originalname,
          type,
          category || "sport",
          req.file.path,
          req.file.filename,
          req.file.size,
          req.file.mimetype,
        ]
      );
      const { rows: claim } = await client.query(
        `INSERT INTO content_fingerprints (fingerprint, content_type, content_id, owner_name)
         VALUES ($1,'gs_upload',$2,$3) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
        [fingerprint, inserted[0].id, uploaderName]
      );
      if (!claim[0]) {
        await client.query("ROLLBACK");
        const { rows: fp } = await pool.query(
          `SELECT owner_name FROM content_fingerprints WHERE fingerprint=$1`, [fingerprint]);
        fs.unlink(req.file.path, () => {});
        const owner = fp[0]?.owner_name;
        res.status(409).json({
          error: owner === uploaderName
            ? "سبق لك رفع هذا العمل من قبل"
             : req.file.mimetype.startsWith("audio/")
               ? `🛡️ الموسيقى الأصلية مسجّلة باسم "${owner ?? "مواطن آخر"}". استعمل 8 ثواني فقط أو موسيقى من مكتبة الإمبراطورية`
               : `⚖️ هذا العمل مسجّل باسم صاحبه الأصلي "${owner ?? "مواطن آخر"}" — حقوق الملكية محفوظة في الإمبراطورية`,
        });
        return;
      }
      if (figureTag) {
        await client.query(`UPDATE gs_uploads SET figure_tag=$1 WHERE id=$2`, [figureTag, inserted[0].id]);
        inserted[0].figure_tag = figureTag;
      }
      await client.query("COMMIT");
      rows = inserted;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ upload: rows[0] });
  } catch (err) {
    console.error("[EMPIRE-MEDIA] Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── GET /gs/uploads/tags ─────────────────────────────────────────────────────
router.get("/gs/uploads/tags", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(`
      SELECT figure_tag AS tag, COUNT(*)::integer AS count
      FROM gs_uploads
      WHERE figure_tag IS NOT NULL AND figure_tag <> ''
      GROUP BY figure_tag
      ORDER BY count DESC
    `);
    res.json({ tags: rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

// ─── GET /gs/uploads ──────────────────────────────────────────────────────────
router.get("/gs/uploads", async (req, res): Promise<void> => {
  try {
    const { category, type, limit, offset, figureTag } = req.query;
    const params: (string | number)[] = [];
    let where = "WHERE 1=1";
    if (category)  { params.push(category as string);  where += ` AND category = $${params.length}`; }
    if (type)      { params.push(type as string);      where += ` AND type = $${params.length}`; }
    if (figureTag) { params.push(figureTag as string); where += ` AND figure_tag = $${params.length}`; }
    const lim = Math.min(Number(limit) || 20, 200);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim);
    params.push(off);
    // Also fetch total count for this filter so the client knows if more pages exist
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM gs_uploads ${where}`,
      params.slice(0, params.length - 2)
    );
    const { rows } = await pool.query(
      `SELECT id, uploader_name, title, type, category, figure_tag, file_name, file_size, mime_type, views, earnings, created_at
       FROM gs_uploads ${where} ORDER BY views DESC, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ uploads: rows, total: countRows[0]?.total ?? 0 });
  } catch {
    res.status(500).json({ error: "Failed to fetch uploads" });
  }
});

// ─── POST /gs/uploads/:id/view ────────────────────────────────────────────────
router.post("/gs/uploads/:id/view", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const ip = ((req.headers["x-forwarded-for"] as string) || req.ip || "unknown")
      .split(",")[0].trim();

    const { rows: existing } = await pool.query(
      `SELECT id FROM gs_upload_views WHERE upload_id=$1 AND viewer_ip=$2
       AND viewed_at > NOW() - INTERVAL '24 hours'`,
      [id, ip]
    );

    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO gs_upload_views (upload_id, viewer_ip) VALUES ($1,$2)`,
        [id, ip]
      );
      const rate = await getRate("gs_upload", 0.01);
      // Higher empire levels earn more per view (level multiplier of the UPLOADER).
      // Incremental credit (not a recompute) so past earnings at old rates/levels stay honest.
      const { rows: up } = await pool.query(
        `SELECT uploader_name FROM gs_uploads WHERE id=$1`, [id]);
      const mult = up[0] ? await multiplierForUsername(up[0].uploader_name) : 1.0;
      const amount = Math.round(rate * mult * 10000) / 10000;
      // Frozen (confirmed pirated) uploads never earn again
      const { rows } = await pool.query(
        `UPDATE gs_uploads SET views = views + 1,
           earnings = CASE WHEN is_frozen THEN earnings ELSE ROUND(earnings + $2::numeric, 4) END
         WHERE id=$1 RETURNING views, earnings`,
        [id, amount]
      );
      res.json({ views: rows[0]?.views ?? 0, earnings: rows[0]?.earnings ?? 0, counted: true });
    } else {
      const { rows } = await pool.query("SELECT views, earnings FROM gs_uploads WHERE id=$1", [id]);
      res.json({ views: rows[0]?.views ?? 0, earnings: rows[0]?.earnings ?? 0, counted: false });
    }
  } catch {
    res.status(500).json({ error: "Failed to record view" });
  }
});

// ─── GET /gs/uploads/:id/stream ───────────────────────────────────────────────
router.get("/gs/uploads/:id/stream", async (req, res): Promise<void> => {
  try {
    const { rows } = await pool.query("SELECT * FROM gs_uploads WHERE id=$1", [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }

    const filePath = rows[0].file_path;
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found on disk" }); return; }

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": rows[0].mime_type,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": rows[0].mime_type,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch {
    res.status(500).json({ error: "Stream failed" });
  }
});

// ─── GET /gs/uploads/:id/download ─────────────────────────────────────────────
router.get("/gs/uploads/:id/download", async (req, res): Promise<void> => {
  try {
    const { rows } = await pool.query("SELECT * FROM gs_uploads WHERE id=$1", [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }

    const filePath = rows[0].file_path;
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found on disk" }); return; }

    res.download(filePath, rows[0].file_name);
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

// ─── GET /gs/honor-leaderboard ────────────────────────────────────────────────
router.get("/gs/honor-leaderboard", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(`
      SELECT
        uploader_name,
        category,
        SUM(views)::integer       AS total_views,
        SUM(earnings)::numeric    AS total_earnings,
        COUNT(*)::integer         AS upload_count
      FROM gs_uploads
      GROUP BY uploader_name, category
      ORDER BY total_views DESC
      LIMIT 100
    `);

    // Group by category
    const byCategory: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row);
    }

    res.json({ leaderboard: byCategory, all: rows });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// ─── GET /gs/earnings ─────────────────────────────────────────────────────────
router.get("/gs/earnings", async (req, res): Promise<void> => {
  try {
    const name = await sessionUsername(req);
    if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }

    const { rows } = await pool.query(
      `SELECT id, title, type, category, file_name, views, earnings, created_at
       FROM gs_uploads WHERE uploader_name = $1 ORDER BY created_at DESC`,
      [name]
    );

    const uploadEarnings = rows.reduce((s, r) => s + parseFloat(r.earnings), 0);
    const totalViews     = rows.reduce((s, r) => s + r.views, 0);
    const { rows: pulseRows } = await pool.query(
      `SELECT COALESCE(SUM(p.earnings),0) as total
       FROM pulse_posts p JOIN users u ON p.user_id=u.id
       WHERE u.username=$1 AND p.is_visible=true`, [name]);
    const pulseEarnings = parseFloat(pulseRows[0].total);

    res.json({ uploads: rows, totalEarnings: uploadEarnings + pulseEarnings, pulseEarnings, totalViews, uploaderName: name });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// ─── POST /gs/withdrawals ─────────────────────────────────────────────────────
router.post("/gs/withdrawals", async (req, res): Promise<void> => {
  res.status(409).json({ error: "Legacy coin withdrawal is not payable. Complete verified finance onboarding and use /finance/payouts." });
  return;
  try {
    const uploaderName = await sessionUsername(req);
    if (!uploaderName) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }
    const { amountCoins } = req.body;
    if (!amountCoins) {
      res.status(400).json({ error: "amountCoins required" }); return;
    }
    const coins = parseFloat(amountCoins);
    if (isNaN(coins) || coins <= 0) {
      res.status(400).json({ error: "Invalid amount" }); return;
    }
    // Transaction + per-citizen advisory lock: two simultaneous withdrawal
    // requests can never both pass the balance check (overspend race).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`gs_wd:${uploaderName}`]);
      const { rows: earnRows } = await client.query(
        `SELECT COALESCE(SUM(earnings),0) as total FROM gs_uploads WHERE uploader_name=$1`,
        [uploaderName]
      );
      // Pulse earnings are part of the same withdrawable pool
      const { rows: pulseRows } = await client.query(
        `SELECT COALESCE(SUM(p.earnings),0) as total
         FROM pulse_posts p JOIN users u ON p.user_id=u.id
         WHERE u.username=$1 AND p.is_visible=true`,
        [uploaderName]
      );
      const { rows: wdRows } = await client.query(
        `SELECT COALESCE(SUM(amount_coins),0) as total FROM gs_withdrawals
         WHERE uploader_name=$1 AND status IN ('pending','approved','paid')`,
        [uploaderName]
      );
      const available = parseFloat(earnRows[0].total) + parseFloat(pulseRows[0].total) - parseFloat(wdRows[0].total);
      if (coins > available) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Insufficient balance", available }); return;
      }
      const mad = Math.round(coins * 100) / 100; // 1 coin = 1 MAD
      const usd = Math.round(coins * 10) / 100;  // 1 MAD ≈ 0.10 USD
      const { rows } = await client.query(
        `INSERT INTO gs_withdrawals (uploader_name, amount_coins, amount_mad, amount_usd)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [uploaderName, coins, mad, usd]
      );
      await client.query("COMMIT");
      res.json({ withdrawal: rows[0] });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch {
    res.status(500).json({ error: "Failed to request withdrawal" });
  }
});

// ─── GET /gs/withdrawals ──────────────────────────────────────────────────────
router.get("/gs/withdrawals", async (req, res): Promise<void> => {
  try {
    const name = await sessionUsername(req);
    if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }
    const { rows } = await pool.query(
      `SELECT * FROM gs_withdrawals WHERE uploader_name=$1 ORDER BY requested_at DESC`,
      [name]
    );
    res.json({ withdrawals: rows });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// ─── GET /gifs/search — Giphy proxy (key stays server-side) ──────────────────
router.get("/gifs/search", async (req, res): Promise<void> => {
  try {
    const name = await sessionUsername(req);
    if (!name) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }
    const key = process.env.GIPHY_API_KEY;
    if (!key) { res.status(503).json({ error: "خدمة GIF غير مفعّلة بعد — المفتاح غير موجود" }); return; }
    // Level perks: higher levels get more GIFs; expert+ unlock exclusive stickers
    const { rows: lvlRows } = await pool.query(`SELECT xp FROM users WHERE username=$1`, [name]);
    const lvl = getLevel(lvlRows[0]?.xp ?? 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const wantStickers = req.query.type === "stickers" && lvl.gifExclusive;
    const endpoint = wantStickers ? "stickers" : "gifs";
    const url = q
      ? `https://api.giphy.com/v1/${endpoint}/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=${lvl.gifLimit}&rating=pg-13`
      : `https://api.giphy.com/v1/${endpoint}/trending?api_key=${key}&limit=${lvl.gifLimit}&rating=pg-13`;
    const r = await fetch(url);
    if (r.status === 401 || r.status === 403) {
      res.status(503).json({ error: "مفتاح GIPHY غير صالح — خاص مفتاح جديد من developers.giphy.com" }); return;
    }
    if (!r.ok) { res.status(502).json({ error: "Giphy error" }); return; }
    const j = await r.json() as any;
    const gifs = (j.data ?? []).map((g: any) => ({
      id: g.id,
      url: g.images?.original?.url,
      preview: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url,
      title: g.title ?? "",
    })).filter((g: any) => g.url && g.preview);
    res.json({ gifs, level: { level: lvl.level, name: lvl.name, icon: lvl.icon, gifLimit: lvl.gifLimit, exclusiveUnlocked: lvl.gifExclusive } });
  } catch {
    res.status(500).json({ error: "GIF search failed" });
  }
});

// ─── Admin gate: ADMIN_SECRET header OR session is_admin ─────────────────────
async function isAdminRequest(req: any): Promise<boolean> {
  const userId = (req.session as any)?.userId;
  if (!userId) return false;
  try {
    const { rows } = await pool.query(`SELECT is_admin FROM users WHERE id=$1`, [userId]);
    return rows[0]?.is_admin === true;
  } catch { return false; }
}

// ─── GET /gs/admin/withdrawals — list ALL withdrawal requests ────────────────
router.get("/gs/admin/withdrawals", async (req, res): Promise<void> => {
  try {
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const { rows } = await pool.query(
      `SELECT * FROM gs_withdrawals ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         requested_at DESC`
    );
    res.json({ withdrawals: rows });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// ─── PATCH /gs/admin/withdrawals/:id — update status ─────────────────────────
router.patch("/gs/admin/withdrawals/:id", async (req, res): Promise<void> => {
  try {
    if (FINANCE_SIMULATION_MODE) { res.status(409).json({ error: "Legacy payout status changes are disabled in finance simulation mode" }); return; }
    if (!(await isAdminRequest(req))) { res.status(403).json({ error: "بوابة الإدارة — الدخول مرفوض" }); return; }
    const id = parseInt(req.params.id, 10);
    const status = req.body?.status;
    // State machine: pending → approved|rejected, approved → paid. Nothing else.
    const ALLOWED_FROM: Record<string, string[]> = {
      approved: ["pending"],
      rejected: ["pending"],
      paid: ["approved"],
    };
    const from = ALLOWED_FROM[status];
    if (isNaN(id) || !from) {
      res.status(400).json({ error: "Invalid id or status" }); return;
    }
    const { rows } = await pool.query(
      `UPDATE gs_withdrawals SET status=$1 WHERE id=$2 AND status = ANY($3) RETURNING *`,
      [status, id, from]
    );
    if (!rows[0]) {
      const { rows: exists } = await pool.query(`SELECT status FROM gs_withdrawals WHERE id=$1`, [id]);
      if (!exists[0]) { res.status(404).json({ error: "Not found" }); return; }
      res.status(409).json({ error: `لا يمكن الانتقال من '${exists[0].status}' إلى '${status}'` }); return;
    }
    res.json({ withdrawal: rows[0] });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
