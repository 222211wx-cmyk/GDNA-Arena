import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { db, celebrations, celebrationEntries, celebrationLikes, usersTable, transactionsTable, notifications } from "@workspace/db";
import { validateContent } from "../lib/moderate";
import { pushNotification } from "./notifications";

const router: IRouter = Router();

// ── GET /celebrations ─────────────────────────────────────────────────────────
router.get("/celebrations", async (_req, res): Promise<void> => {
  const all = await db.select().from(celebrations)
    .orderBy(desc(celebrations.isLive), celebrations.date).limit(30);
  res.json({ celebrations: all });
});

// ── GET /celebrations/:id — detail + entries ──────────────────────────────────
router.get("/celebrations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [cel] = await db.select().from(celebrations).where(eq(celebrations.id, id)).limit(1);
  if (!cel) { res.status(404).json({ error: "Not found" }); return; }

  const entries = await db.select().from(celebrationEntries)
    .where(eq(celebrationEntries.celebrationId, id))
    .orderBy(desc(celebrationEntries.isWinner), desc(celebrationEntries.likes), desc(celebrationEntries.createdAt))
    .limit(50);

  res.json({ celebration: cel, entries });
});

// ── POST /celebrations/:id/submit — submit a contribution ────────────────────
router.post("/celebrations/:id/submit", async (req, res): Promise<void> => {
  const celebId = parseInt(req.params.id);
  const userId = req.session?.userId ?? null;
  const { content, mediaUrl, entryType = "text" } = req.body as {
    content: string; mediaUrl?: string; entryType?: string;
  };

  if (!content?.trim() || content.length > 600) {
    res.status(400).json({ error: "Content required (max 600 chars)" }); return;
  }

  const check = await validateContent(content);
  if (!check.ok) { res.status(400).json({ error: check.reason }); return; }

  const [cel] = await db.select().from(celebrations).where(eq(celebrations.id, celebId)).limit(1);
  if (!cel) { res.status(404).json({ error: "Celebration not found" }); return; }

  let username = "Anonymous";
  let coinsEarned = 0;

  if (userId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) username = u.username;
    await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} + ${cel.coinsReward}` })
      .where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({
      userId, amount: cel.coinsReward, type: "celebration",
      description: `Celebration contribution: ${cel.title} +${cel.coinsReward} Coins`,
    });
    coinsEarned = cel.coinsReward;

    await pushNotification({
      userId,
      type: "celebration_joined",
      title: "🎉 Celebration Entry Submitted!",
      body: `You joined "${cel.title}" — +${cel.coinsReward} Coins earned. Compete for the Imperial Laurel (+500 Coins)!`,
      icon: "🎉",
      linkPath: `/celebrations/${celebId}`,
    });
  }

  const [entry] = await db.insert(celebrationEntries).values({
    celebrationId: celebId, userId, username,
    content: content.trim(), mediaUrl: mediaUrl ?? null, entryType,
  }).returning();

  res.status(201).json({ entry, coinsEarned });
});

// ── POST /celebrations/:id/entries/:entryId/like ──────────────────────────────
router.post("/celebrations/:id/entries/:entryId/like", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId);
  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";

  const [ex] = await db.select().from(celebrationLikes)
    .where(and(eq(celebrationLikes.entryId, entryId), eq(celebrationLikes.voterIp, voterIp))).limit(1);
  if (ex) { res.json({ alreadyLiked: true }); return; }

  await db.insert(celebrationLikes).values({ entryId, voterIp });
  const [updated] = await db.update(celebrationEntries)
    .set({ likes: sql`${celebrationEntries.likes} + 1` })
    .where(eq(celebrationEntries.id, entryId))
    .returning({ likes: celebrationEntries.likes, userId: celebrationEntries.userId, username: celebrationEntries.username });

  // Notify entry author if they have userId
  if (updated?.userId) {
    await pushNotification({
      userId: updated.userId,
      type: "entry_liked",
      title: "👍 Your celebration entry was liked!",
      body: `Someone appreciated your contribution. Keep sharing!`,
      icon: "👍",
    });
  }

  res.json({ likes: updated?.likes ?? 0 });
});

// ── POST /celebrations/:id/entries/:entryId/crown — crown a winner (admin-style) ──
router.post("/celebrations/:id/entries/:entryId/crown", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId);
  const celebId  = parseInt(req.params.id);

  const [entry] = await db.select().from(celebrationEntries).where(eq(celebrationEntries.id, entryId)).limit(1);
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }

  const [cel] = await db.select().from(celebrations).where(eq(celebrations.id, celebId)).limit(1);
  const reward = cel?.topContributorCoins ?? 500;

  await db.update(celebrationEntries).set({ isWinner: true, hasImperialLaurel: true })
    .where(eq(celebrationEntries.id, entryId));

  if (entry.userId) {
    await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} + ${reward}` })
      .where(eq(usersTable.id, entry.userId));
    await db.insert(transactionsTable).values({
      userId: entry.userId, amount: reward, type: "imperial_laurel",
      description: `🏛️ Imperial Laurel — Champion of "${cel?.title ?? "Celebration"}" +${reward} Coins`,
    });
    await pushNotification({
      userId: entry.userId,
      type: "celebration_winner",
      title: "🏛️ IMPERIAL LAUREL AWARDED!",
      body: `You are the champion of "${cel?.title}"! +${reward} Coins added to your treasury.`,
      icon: "🏛️",
      linkPath: `/celebrations/${celebId}`,
    });
  }

  res.json({ ok: true, coinsAwarded: reward });
});

export default router;
