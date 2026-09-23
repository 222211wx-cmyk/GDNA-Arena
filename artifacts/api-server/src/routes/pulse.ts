import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, pulsePosts, pulseEvents, pulsePostLikes, usersTable, transactionsTable } from "@workspace/db";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { pushNotification } from "./notifications";
import { getRate } from "./rights";
import { multiplierForUserId } from "../lib/levels.js";
import { deletePulsePostForOwner } from "../lib/delete-pulse-post";

const router: IRouter = Router();

// ── GET /pulse/feed ────────────────────────────────────────────────────────────
router.get("/pulse/feed", async (req, res): Promise<void> => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
  const limit  = Math.min(parseInt(req.query.limit as string) || 30, 50);

  const rows = domain && domain !== "all"
    ? await db.select().from(pulsePosts).where(and(eq(pulsePosts.isVisible, true), eq(pulsePosts.domain, domain))).orderBy(desc(pulsePosts.createdAt)).limit(limit)
    : await db.select().from(pulsePosts).where(eq(pulsePosts.isVisible, true)).orderBy(desc(pulsePosts.createdAt)).limit(limit);

  res.json({ posts: rows });
});

// ── POST /pulse/post ──────────────────────────────────────────────────────────
router.post("/pulse/post", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const { content, domain = "general", type = "post" } = req.body as {
    content: string; domain?: string; type?: string;
  };

  if (!content?.trim() || content.length > 280) {
    res.status(400).json({ error: "Content required (max 280 chars)" }); return;
  }
  if (hasBlockedKeyword(content)) {
    res.status(400).json({ error: "Content contains prohibited content." }); return;
  }
  const mod = await moderateText(content);
  if (!mod.ok) { res.status(400).json({ error: `Blocked (${mod.reason}).` }); return; }

  let username = "Anonymous";
  if (userId) {
    const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) username = u.username;
    // +20 XP for posting
    await db.update(usersTable).set({ xp: sql`${usersTable.xp} + 20` }).where(eq(usersTable.id, userId));
    await db.insert(transactionsTable).values({ userId, amount: 20, type: "post", description: "Empire Pulse post — +20 XP" });
    void pushNotification({
      userId,
      type: "xp_earned",
      title: "📢 Voice Broadcast!",
      body: `+20 XP earned for posting to Empire Pulse.`,
      icon: "📢",
      linkPath: "/pulse",
    });
  }

  const [post] = await db.insert(pulsePosts).values({ userId, username, content: content.trim(), domain, type }).returning();
  res.status(201).json({ post, xpEarned: userId ? 20 : 0 });
});

// ── DELETE /pulse/post/:id ───────────────────────────────────────────────────
// Pulse and Social Hub expose the same pulse_posts identities, so both routes
// delegate to one owner-only transactional deletion implementation.
router.delete("/pulse/post/:id", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const postId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(postId) || postId < 1) {
    res.status(400).json({ error: "Invalid ID" }); return;
  }

  const result = await deletePulsePostForOwner(postId, userId);
  if (result === "not_found") { res.status(404).json({ error: "Post not found" }); return; }
  if (result === "forbidden") { res.status(403).json({ error: "Only the post owner can delete it" }); return; }
  res.json({ deleted: true, postId });
});

// ── POST /pulse/post/:id/like ─────────────────────────────────────────────────
router.post("/pulse/post/:id/like", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const sessionUserId = req.session?.userId ?? null;
  // Logged-in citizens are identified by account (can't be forged); anonymous
  // visitors fall back to IP.
  const voterIp = sessionUserId
    ? `user:${sessionUserId}`
    : ((req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? req.socket.remoteAddress ?? "unknown");

  const [post] = await db.select({ userId: pulsePosts.userId, isVisible: pulsePosts.isVisible })
    .from(pulsePosts).where(eq(pulsePosts.id, postId)).limit(1);
  if (!post || !post.isVisible) { res.status(404).json({ error: "Post not found" }); return; }

  // Atomic dedupe: unique index (post_id, voter_ip) — concurrent duplicates lose
  const insertResult = await db.execute(
    sql`INSERT INTO pulse_post_likes (post_id, voter_ip) VALUES (${postId}, ${voterIp})
        ON CONFLICT (post_id, voter_ip) DO NOTHING RETURNING id`);
  if (!(insertResult as any).rows?.length) { res.json({ alreadyLiked: true }); return; }

  // Each like earns the author royalty coins (rate is admin-configurable) —
  // except self-likes and anonymous likes, which never generate money.
  const selfLike = sessionUserId !== null && post.userId === sessionUserId;
  if (sessionUserId && !selfLike) {
    const rate = await getRate("pulse_post", 0.05);
    // Higher empire levels earn more per like (level multiplier of the AUTHOR)
    const mult = post.userId ? await multiplierForUserId(post.userId) : 1.0;
    const amount = Math.round(rate * mult * 10000) / 10000;
    await db.execute(sql`UPDATE pulse_posts SET earnings = COALESCE(earnings,0) + ${amount} WHERE id = ${postId}`);
  }
  const [updated] = await db.update(pulsePosts).set({ likes: sql`${pulsePosts.likes} + 1` })
    .where(eq(pulsePosts.id, postId)).returning({ likes: pulsePosts.likes, userId: pulsePosts.userId });

  // Notify the post author (if they are a logged-in citizen)
  if (updated?.userId) {
    void pushNotification({
      userId: updated.userId,
      type: "story_liked",
      title: "❤️ Someone liked your post!",
      body: `Your Empire Pulse post just received a like.`,
      icon: "❤️",
      linkPath: "/pulse",
    });
  }

  res.json({ likes: updated?.likes ?? 0 });
});

// ── GET /pulse/events ─────────────────────────────────────────────────────────
router.get("/pulse/events", async (_req, res): Promise<void> => {
  const events = await db.select().from(pulseEvents).orderBy(desc(pulseEvents.impactScore)).limit(30);
  res.json({ events });
});

// ── GET /pulse/stats ──────────────────────────────────────────────────────────
router.get("/pulse/stats", async (_req, res): Promise<void> => {
  const [userCount]   = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const [postCount]   = await db.select({ count: sql<number>`count(*)::int` }).from(pulsePosts);
  const [totalCoins]  = await db.select({ sum: sql<number>`coalesce(sum(balance),0)::int` }).from(usersTable);
  const [totalXp]     = await db.select({ sum: sql<number>`coalesce(sum(xp),0)::int` }).from(usersTable);
  const liveEvents    = await db.select().from(pulseEvents).where(eq(pulseEvents.isLive, true)).limit(5);

  res.json({
    users: userCount?.count ?? 0,
    posts: postCount?.count ?? 0,
    coinsCirculating: totalCoins?.sum ?? 0,
    totalXp: totalXp?.sum ?? 0,
    liveEvents,
    updatedAt: new Date().toISOString(),
  });
});

export default router;
