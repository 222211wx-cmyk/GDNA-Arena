/**
 * ═══════════════════════════════════════════════════════════════
 *  SOVEREIGN MISSIONS API
 *  GET  /missions/today          — get today's AI missions
 *  POST /missions/:id/complete   — mark a mission complete (+XP)
 * ═══════════════════════════════════════════════════════════════
 */

import { Router, type IRouter } from "express";
import { pool } from "../lib/db";

const router: IRouter = Router();

// ── GET /missions/today ────────────────────────────────────────
router.get("/missions/today", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT id, title, title_ar, description, description_ar,
            category, xp_reward, completed, completed_at, mission_date
     FROM citizen_missions
     WHERE citizen_id = $1 AND mission_date = $2
     ORDER BY id ASC`,
    [userId, todayStr]
  );

  res.json({ missions: rows, date: todayStr });
});

// ── POST /missions/:id/complete ────────────────────────────────
router.post("/missions/:id/complete", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const missionId = parseInt(req.params.id, 10);
  if (isNaN(missionId)) {
    res.status(400).json({ error: "Invalid mission id" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [userId * 10000 + missionId]);

    // Verify ownership, today's date, and not already completed.
    // Restricting to today prevents farming XP by completing old uncompleted missions.
    const todayStr = new Date().toISOString().slice(0, 10);
    const { rows } = await client.query<{
      id: number; citizen_id: number; completed: boolean; xp_reward: number; mission_date: string;
    }>(
      `SELECT id, citizen_id, completed, xp_reward, mission_date
       FROM citizen_missions WHERE id = $1 LIMIT 1`,
      [missionId]
    );

    if (rows[0] && rows[0].mission_date !== todayStr) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Only today's missions can be completed" });
      return;
    }

    if (!rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Mission not found" });
      return;
    }

    if (rows[0].citizen_id !== userId) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Not your mission" });
      return;
    }

    if (rows[0].completed) {
      await client.query("ROLLBACK");
      // Return current XP so UI stays in sync
      const { rows: uRows } = await client.query<{ xp: number }>(
        `SELECT xp FROM users WHERE id = $1 LIMIT 1`, [userId]
      );
      res.json({ ok: true, alreadyCompleted: true, xpEarned: 0, newXp: uRows[0]?.xp ?? 0 });
      return;
    }

    // Mark complete
    await client.query(
      `UPDATE citizen_missions SET completed = true, completed_at = NOW() WHERE id = $1`,
      [missionId]
    );

    // Award XP atomically
    const xpReward = rows[0].xp_reward ?? 25;
    await client.query(
      `UPDATE users SET xp = xp + $1 WHERE id = $2`,
      [xpReward, userId]
    );

    await client.query("COMMIT");

    const { rows: uRows } = await pool.query<{ xp: number }>(
      `SELECT xp FROM users WHERE id = $1 LIMIT 1`, [userId]
    );

    res.json({ ok: true, alreadyCompleted: false, xpEarned: xpReward, newXp: uRows[0]?.xp ?? 0 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[MISSIONS] complete error:", err);
    res.status(500).json({ error: "Could not complete mission — please try again" });
  } finally {
    client.release();
  }
});

export default router;
