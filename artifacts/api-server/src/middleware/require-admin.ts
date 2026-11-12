import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";

/**
 * Guards admin-only endpoints: caller must be logged in AND flagged
 * is_admin in the users table. Everything else gets 403 — these routes
 * were previously open to the whole internet.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req.session as { userId?: number } | undefined)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const { rows } = await pool!.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]?.is_admin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: "Auth check failed" });
  }
}
