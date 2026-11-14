import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { db, platformStories, storyLikes, usersTable, transactionsTable } from "../lib/db";
import { moderateText, hasBlockedKeyword, isDomainAllowed } from "../lib/moderate";

const router: IRouter = Router();

// ── GET /stories/feed ─────────────────────────────────────────────────────────
router.get("/stories/feed", async (req, res): Promise<void> => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
  const now    = new Date();

  const rows = domain && domain !== "all"
    ? await db.select().from(platformStories)
        .where(and(eq(platformStories.isVisible, true), eq(platformStories.domain, domain), gt(platformStories.expiresAt, now)))
        .orderBy(desc(platformStories.createdAt)).limit(40)
    : await db.select().from(platformStories)
        .where(and(eq(platformStories.isVisible, true), gt(platformStories.expiresAt, now)))
        .orderBy(desc(platformStories.createdAt)).limit(40);

  res.json({ stories: rows });
});

// ── POST /stories ─────────────────────────────────────────────────────────────
router.post("/stories", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const { content, audioUrl, imageUrl, type = "text", domain = "general" } = req.body as {
    content: string; audioUrl?: string; imageUrl?: string; type?: string; domain?: string;
  };

  if (!content?.trim() || content.length > 400) {
    res.status(400).json({ error: "Content required (max 400 chars)" }); return;
  }

  // Anti-trivial filter
  if (hasBlockedKeyword(content)) {
    res.status(400).json({ error: "Prohibited content detected." }); return;
  }
  const mod = await moderateText(content);
  if (!mod.ok) { res.status(400).json({ error: `Blocked: ${mod.reason}` }); return; }

  let username = "Anonymous";
  let coinsEarned = 0;
  if (userId) {
    const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) username = u.username;
    await db.update(usersTable).set({ balance: sql`${usersTable.balance} + 10` }).where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({ userId, amount: 10, type: "story", description: "Story post — +10 Coins" });
    coinsEarned = 10;
  }

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const [story] = await db.insert(platformStories)
    .values({ userId, username, content: content.trim(), audioUrl, imageUrl, type, domain, expiresAt })
    .returning();

  res.status(201).json({ story, coinsEarned });
});

// ── POST /stories/:id/like ─────────────────────────────────────────────────────
router.post("/stories/:id/like", async (req, res): Promise<void> => {
  const storyId = parseInt(req.params.id);
  if (isNaN(storyId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";

  const [existing] = await db.select().from(storyLikes)
    .where(and(eq(storyLikes.storyId, storyId), eq(storyLikes.voterIp, voterIp))).limit(1);
  if (existing) { res.json({ alreadyLiked: true }); return; }

  await db.insert(storyLikes).values({ storyId, voterIp });
  const [updated] = await db.update(platformStories)
    .set({ likes: sql`${platformStories.likes} + 1` })
    .where(eq(platformStories.id, storyId))
    .returning({ likes: platformStories.likes });

  res.json({ likes: updated?.likes ?? 0 });
});

// ── GET /stories/stats ────────────────────────────────────────────────────────
router.get("/stories/stats", async (_req, res): Promise<void> => {
  const now  = new Date();
  const [live] = await db.select({ cnt: sql<number>`count(*)::int` }).from(platformStories)
    .where(and(eq(platformStories.isVisible, true), gt(platformStories.expiresAt, now)));
  res.json({ activeStories: live?.cnt ?? 0 });
});

export default router;
