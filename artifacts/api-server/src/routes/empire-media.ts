import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
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
router.post("/gs/uploads", upload.single("file"), async (req, res): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const { title, category, uploaderName } = req.body;
    const type = req.file.mimetype.startsWith("video/") ? "video" : "audio";
    const { rows } = await pool.query(
      `INSERT INTO gs_uploads (uploader_name, title, type, category, file_path, file_name, file_size, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        uploaderName || "مواطن الإمبراطورية",
        title || req.file.originalname,
        type,
        category || "sport",
        req.file.path,
        req.file.filename,
        req.file.size,
        req.file.mimetype,
      ]
    );
    res.json({ upload: rows[0] });
  } catch (err) {
    console.error("[EMPIRE-MEDIA] Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── GET /gs/uploads ──────────────────────────────────────────────────────────
router.get("/gs/uploads", async (req, res): Promise<void> => {
  try {
    const { category, type, limit } = req.query;
    const params: (string | number)[] = [];
    let where = "WHERE 1=1";
    if (category) { params.push(category as string); where += ` AND category = $${params.length}`; }
    if (type)     { params.push(type as string);     where += ` AND type = $${params.length}`; }
    const lim = Math.min(Number(limit) || 50, 200);
    params.push(lim);
    const { rows } = await pool.query(
      `SELECT id, uploader_name, title, type, category, file_name, file_size, mime_type, views, earnings, created_at
       FROM gs_uploads ${where} ORDER BY views DESC, created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ uploads: rows });
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
    const name = req.query.name as string;
    if (!name) { res.status(400).json({ error: "name required" }); return; }

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

export default router;
