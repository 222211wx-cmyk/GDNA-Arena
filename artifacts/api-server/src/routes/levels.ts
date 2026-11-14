import { Router, type IRouter } from "express";
import { pool } from "../lib/db";
import { getLevel, allLevels } from "../lib/levels.js";

// ─── نظام المستويات — Levels API ─────────────────────────────────────────────

const router: IRouter = Router();

// GET /levels — public level table (thresholds + perks)
router.get("/levels", (_req, res): void => {
  res.json({ levels: allLevels() });
});

// GET /levels/me — the logged-in citizen's level + progress
router.get("/levels/me", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "سجّل الدخول أولاً" }); return; }
    const { rows } = await pool.query<{ xp: number; username: string }>(
      `SELECT xp, username FROM users WHERE id=$1`, [userId]);
    if (!rows[0]) { res.status(404).json({ error: "المواطن غير موجود" }); return; }
    const xp = rows[0].xp ?? 0;
    const lvl = getLevel(xp);
    const span = lvl.nextXp ? lvl.nextXp - lvl.minXp : null;
    res.json({
      username: rows[0].username,
      xp,
      level: lvl,
      progressPct: span ? Math.min(Math.round(((xp - lvl.minXp) / span) * 100), 100) : 100,
      xpToNext: lvl.nextXp ? Math.max(lvl.nextXp - xp, 0) : 0,
    });
  } catch { res.status(500).json({ error: "Failed" }); }
});

export default router;
