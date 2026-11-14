import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import {
  db, legendsTable, legendDebatesTable, legendWatchesTable,
  legendStoriesTable, legendArenaEventsTable,
  usersTable, transactionsTable,
} from "../lib/db";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { pushNotification } from "./notifications";

const router: IRouter = Router();

// ── GET /legends ──────────────────────────────────────────────────────────────
router.get("/legends", async (req, res): Promise<void> => {
  const domain = typeof req.query["domain"] === "string" && req.query["domain"] ? req.query["domain"] : null;
  const limitParam = parseInt((req.query["limit"] as string) ?? "50");
  const limit = isNaN(limitParam) || limitParam < 1 ? 50 : Math.min(limitParam, 200);

  const where = domain
    ? and(eq(legendsTable.isActive, true), eq(legendsTable.domain, domain))
    : eq(legendsTable.isActive, true);

  const legends = await db.select().from(legendsTable)
    .where(where).orderBy(legendsTable.rank).limit(limit);
  res.json({ legends, updatedAt: new Date().toISOString() });
});

// ── GET /legends/:id ──────────────────────────────────────────────────────────
router.get("/legends/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [legend] = await db.select().from(legendsTable)
    .where(eq(legendsTable.id, id)).limit(1);
  if (!legend) { res.status(404).json({ error: "Legend not found" }); return; }
  const debates = await db.select().from(legendDebatesTable)
    .where(eq(legendDebatesTable.legendId, id)).orderBy(desc(legendDebatesTable.createdAt)).limit(50);
  res.json({ legend, debates });
});

// ── POST /legends/:id/debate (+50 XP + +50 Coins) ────────────────────────────
router.post("/legends/:id/debate", async (req, res): Promise<void> => {
  const legendId = parseInt(req.params.id);
  if (isNaN(legendId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.session?.userId ?? null;
  const { message } = req.body as { message: string };

  if (!message?.trim() || message.length > 500) {
    res.status(400).json({ error: "Message required (max 500 chars)" }); return;
  }
  if (hasBlockedKeyword(message)) {
    res.status(400).json({ error: "Message contains prohibited content." }); return;
  }
  const mod = await moderateText(message);
  if (!mod.ok) { res.status(400).json({ error: `Blocked (${mod.reason}).` }); return; }

  let username = "Anonymous";
  if (userId) {
    const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) username = u.username;
    // +50 XP + +50 Coins for EMPIRE ETERNAL v2.0
    await db.update(usersTable)
      .set({ xp: sql`${usersTable.xp} + 50`, balance: sql`${usersTable.balance} + 50` })
      .where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({ userId, amount: 50, type: "debate", description: "Debate — +50 XP +50 Coins" });
    void pushNotification({
      userId,
      type: "xp_earned",
      title: "⚔️ Debate Recorded!",
      body: `+50 XP & +50 Coins earned for joining the legend debate.`,
      icon: "⚔️",
      linkPath: `/legends/${legendId}`,
    });
  }

  const [debate] = await db.insert(legendDebatesTable)
    .values({ legendId, userId, username, message: message.trim() }).returning();
  res.status(201).json({ debate, xpEarned: userId ? 50 : 0, coinsEarned: userId ? 50 : 0 });
});

// ── POST /legends/:id/watch (+20 XP) ─────────────────────────────────────────
router.post("/legends/:id/watch", async (req, res): Promise<void> => {
  const legendId = parseInt(req.params.id);
  if (isNaN(legendId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.session?.userId ?? null;
  const { videoId } = req.body as { videoId: string };
  if (!videoId) { res.status(400).json({ error: "videoId required" }); return; }

  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";
  await db.insert(legendWatchesTable).values({ legendId, userId, voterIp, videoId });

  let xpEarned = 0;
  if (userId) {
    await db.update(usersTable).set({ xp: sql`${usersTable.xp} + 20` }).where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({ userId, amount: 20, type: "watch", description: "Lecture watch — +20 XP" });
    xpEarned = 20;
    void pushNotification({
      userId,
      type: "xp_earned",
      title: "🎓 Lecture Watched!",
      body: `+20 XP earned for watching a legend lecture.`,
      icon: "🎓",
      linkPath: `/legends/${legendId}`,
    });
  }
  res.json({ xpEarned, message: userId ? "+20 XP earned!" : "Watch recorded" });
});

// ── POST /legends/:id/debate/:debateId/like ───────────────────────────────────
router.post("/legends/:id/debate/:debateId/like", async (req, res): Promise<void> => {
  const debateId = parseInt(req.params.debateId);
  if (isNaN(debateId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [updated] = await db.update(legendDebatesTable)
    .set({ likes: sql`${legendDebatesTable.likes} + 1` })
    .where(eq(legendDebatesTable.id, debateId))
    .returning({ likes: legendDebatesTable.likes, userId: legendDebatesTable.userId });

  // Notify the debate author
  if (updated?.userId) {
    void pushNotification({
      userId: updated.userId,
      type: "debate_liked",
      title: "👍 Your debate was liked!",
      body: `Your legend debate entry just received a like from the empire.`,
      icon: "👍",
      linkPath: `/legends/${req.params.id}`,
    });
  }

  res.json({ likes: updated?.likes ?? 0 });
});

// ── GET /legends/:id/stories (active only — not expired) ──────────────────────
router.get("/legends/:id/stories", async (req, res): Promise<void> => {
  const legendId = parseInt(req.params.id);
  if (isNaN(legendId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const now = new Date();
  const stories = await db.select().from(legendStoriesTable)
    .where(and(eq(legendStoriesTable.legendId, legendId), gt(legendStoriesTable.expiresAt, now)))
    .orderBy(desc(legendStoriesTable.createdAt)).limit(20);
  res.json({ stories });
});

// ── POST /legends/:id/story (+10 Coins) ──────────────────────────────────────
router.post("/legends/:id/story", async (req, res): Promise<void> => {
  const legendId = parseInt(req.params.id);
  if (isNaN(legendId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.session?.userId ?? null;
  const { content, mediaUrl, type = "text" } = req.body as { content: string; mediaUrl?: string; type?: string };

  if (!content?.trim() || content.length > 280) {
    res.status(400).json({ error: "Content required (max 280 chars)" }); return;
  }
  if (hasBlockedKeyword(content)) {
    res.status(400).json({ error: "Prohibited content." }); return;
  }
  const mod = await moderateText(content);
  if (!mod.ok) { res.status(400).json({ error: `Blocked (${mod.reason}).` }); return; }

  let username = "Anonymous";
  let coinsEarned = 0;
  if (userId) {
    const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) username = u.username;
    await db.update(usersTable).set({ balance: sql`${usersTable.balance} + 10` }).where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({ userId, amount: 10, type: "story", description: "Story post — +10 Coins" });
    coinsEarned = 10;
    void pushNotification({
      userId,
      type: "coins_earned",
      title: "💰 Story Posted!",
      body: `+10 Coins earned for sharing a legend story.`,
      icon: "💰",
      linkPath: `/legends/${legendId}`,
    });
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  const [story] = await db.insert(legendStoriesTable)
    .values({ legendId, userId, username, content: content.trim(), mediaUrl, type, expiresAt }).returning();

  res.status(201).json({ story, coinsEarned });
});

// ── GET /legends/:id/arena (events for this legend's domain) ──────────────────
router.get("/legends/:id/arena", async (req, res): Promise<void> => {
  const legendId = parseInt(req.params.id);
  if (isNaN(legendId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [legend] = await db.select({ domain: legendsTable.domain }).from(legendsTable)
    .where(eq(legendsTable.id, legendId)).limit(1);
  if (!legend) { res.status(404).json({ error: "Legend not found" }); return; }

  const events = await db.select().from(legendArenaEventsTable)
    .where(eq(legendArenaEventsTable.domain, legend.domain))
    .orderBy(desc(legendArenaEventsTable.isLive), legendArenaEventsTable.eventDate)
    .limit(12);

  res.json({ events, domain: legend.domain });
});

// ── POST /legends/:id/join-event (+50 Coins) ──────────────────────────────────
router.post("/legends/:id/join-event", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { eventId } = req.body as { eventId: number };
  if (!eventId) { res.status(400).json({ error: "eventId required" }); return; }

  await db.update(usersTable).set({ balance: sql`${usersTable.balance} + 50` }).where(eq(usersTable.id, userId));
  await db.insert(transactionsTable).values({ userId, amount: 50, type: "event", description: "Arena event joined — +50 Coins" });

  void pushNotification({
    userId,
    type: "coins_earned",
    title: "🏟️ Arena Event Joined!",
    body: `+50 Coins earned for joining a live arena event.`,
    icon: "🏟️",
    linkPath: `/legends/${req.params.id}`,
  });

  res.json({ coinsEarned: 50, message: "+50 Coins for joining the arena!" });
});

export default router;
