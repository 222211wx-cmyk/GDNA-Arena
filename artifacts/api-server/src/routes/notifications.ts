import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, notifications } from "@workspace/db";
import { broadcastToUser } from "../lib/signaling";

const router: IRouter = Router();

// ── GET /notifications ────────────────────────────────────────────────────────
router.get("/notifications", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ notifications: [], unreadCount: 0 }); return; }

  const list = await db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt)).limit(20);

  const [unread] = await db.select({ cnt: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.userId, userId));

  const unreadCount = list.filter(n => !n.isRead).length;

  res.json({ notifications: list, unreadCount });
});

// ── POST /notifications/read-all ──────────────────────────────────────────────
router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
  res.json({ ok: true });
});

// ── POST /notifications/:id/read ─────────────────────────────────────────────
router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const id = parseInt(req.params.id);
  await db.update(notifications).set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  res.json({ ok: true });
});

export default router;

// ── HELPER: push a notification to a user ─────────────────────────────────────
export async function pushNotification(params: {
  userId: number;
  type: string;
  title: string;
  body: string;
  icon?: string;
  linkPath?: string;
  sourceRef?: string;
}) {
  try {
    const [row] = await db.insert(notifications).values({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      icon: params.icon ?? "⚡",
      linkPath: params.linkPath ?? null,
      sourceRef: params.sourceRef ?? null,
    }).returning();
    // Real-time push to connected WebSocket client
    if (row) {
      broadcastToUser(params.userId, { type: "notification", notification: row });
    }
  } catch { /* non-fatal */ }
}
