import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pool } from "@workspace/db";

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
    const { rows } = await pool.query(
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
    // Store figure_tag if provided
    if (figureTag && rows[0]) {
      await pool.query(`UPDATE gs_uploads SET figure_tag=$1 WHERE id=$2`, [figureTag, rows[0].id]);
      rows[0].figure_tag = figureTag;
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
      const { rows } = await pool.query(
        `UPDATE gs_uploads SET views = views + 1, earnings = ROUND((views + 1) * 0.01, 4)
         WHERE id=$1 RETURNING views, earnings`,
        [id]
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

    const totalEarnings = rows.reduce((s, r) => s + parseFloat(r.earnings), 0);
    const totalViews    = rows.reduce((s, r) => s + r.views, 0);

    res.json({ uploads: rows, totalEarnings, totalViews, uploaderName: name });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// ─── POST /gs/withdrawals ─────────────────────────────────────────────────────
router.post("/gs/withdrawals", async (req, res): Promise<void> => {
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
      const { rows: wdRows } = await client.query(
        `SELECT COALESCE(SUM(amount_coins),0) as total FROM gs_withdrawals
         WHERE uploader_name=$1 AND status IN ('pending','approved','paid')`,
        [uploaderName]
      );
      const available = parseFloat(earnRows[0].total) - parseFloat(wdRows[0].total);
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
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;
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
    res.json({ gifs });
  } catch {
    res.status(500).json({ error: "GIF search failed" });
  }
});

// ─── Admin gate: ADMIN_SECRET header OR session is_admin ─────────────────────
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
