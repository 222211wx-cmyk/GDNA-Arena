/**
 * Social Hub API — v2
 * Handles: feed posts, likes, comments, follow/unfollow, citizen search, global search
 */
import { Router, type IRouter } from "express";
import { eq, desc, sql, and, or, ilike, ne } from "drizzle-orm";
import {
  db, pulsePosts, pulsePostLikes, usersTable, postComments, userFollows,
  platformStories, postReactions,
} from "@workspace/db";
import { pool as _pool } from "@workspace/db";
import { validateContent } from "../lib/moderate";

const pool = _pool!;
const router: IRouter = Router();

// ── Rank helper (kept local to avoid cross-import) ────────────────────────────
function getRank(xp: number) {
  if (xp <   200) return { label: "Recruit",           icon: "🌱", color: "#6b7280" };
  if (xp <   500) return { label: "Foot Soldier I",    icon: "🪖", color: "#92400e" };
  if (xp <  1000) return { label: "Foot Soldier II",   icon: "🪖", color: "#b45309" };
  if (xp <  2000) return { label: "Knight I",          icon: "⚔️", color: "#9ca3af" };
  if (xp <  3500) return { label: "Knight II",         icon: "⚔️", color: "#d1d5db" };
  if (xp <  5000) return { label: "Commander I",       icon: "🛡️", color: "#C9A84C" };
  if (xp <  7500) return { label: "Commander II",      icon: "🛡️", color: "#f59e0b" };
  if (xp < 12000) return { label: "Imperial Champion", icon: "👑", color: "#00D4FF" };
  if (xp < 20000) return { label: "Grand Marshal",     icon: "🏛️", color: "#a78bfa" };
  return                 { label: "EMPEROR",            icon: "⚡", color: "#22c55e" };
}

// ────────────────────────────────────────────────────────────────────────────
// FEED
// ────────────────────────────────────────────────────────────────────────────

// GET /api/social/v2/feed
router.get("/social/v2/feed", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const domain = typeof req.query.domain === "string" && req.query.domain !== "all"
    ? req.query.domain : null;

  const posts = domain
    ? await db.select().from(pulsePosts)
        .where(and(eq(pulsePosts.isVisible, true), eq(pulsePosts.domain, domain)))
        .orderBy(desc(pulsePosts.createdAt)).limit(limit)
    : await db.select().from(pulsePosts)
        .where(eq(pulsePosts.isVisible, true))
        .orderBy(desc(pulsePosts.createdAt)).limit(limit);

  // Attach comment counts
  const enriched = await Promise.all(posts.map(async (p) => {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(postComments).where(eq(postComments.postId, p.id));
    return { ...p, commentCount: cnt ?? 0 };
  }));

  res.json({ posts: enriched });
});

// POST /api/social/v2/post — create post
router.post("/social/v2/post", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { content, domain = "general", type = "post" } = req.body as {
    content: string; domain?: string; type?: string;
  };

  if (!content?.trim() || content.length > 500) {
    res.status(400).json({ error: "Content required (max 500 chars)" }); return;
  }

  const check = await validateContent(content, { allowTrivial: false });
  if (!check.ok) { res.status(400).json({ error: check.reason }); return; }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  // +20 XP per post
  await db.update(usersTable)
    .set({ xp: sql`${usersTable.xp} + 20` })
    .where(eq(usersTable.id, userId));

  const [post] = await db.insert(pulsePosts).values({
    userId, username: me.username, content: content.trim(), domain, type,
  }).returning();

  res.status(201).json({ post: { ...post, commentCount: 0 } });
});

// POST /api/social/v2/post/:id/like
router.post("/social/v2/post/:id/like", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";

  const [existing] = await db.select().from(pulsePostLikes)
    .where(and(eq(pulsePostLikes.postId, postId), eq(pulsePostLikes.voterIp, voterIp))).limit(1);
  if (existing) { res.json({ alreadyLiked: true, likes: null }); return; }

  await db.insert(pulsePostLikes).values({ postId, voterIp });
  const [updated] = await db.update(pulsePosts)
    .set({ likes: sql`${pulsePosts.likes} + 1` })
    .where(eq(pulsePosts.id, postId))
    .returning({ likes: pulsePosts.likes });

  res.json({ likes: updated?.likes ?? 0 });
});

// GET /api/social/v2/post/:id/comments
router.get("/social/v2/post/:id/comments", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.id);
  const comments = await db.select().from(postComments)
    .where(eq(postComments.postId, postId))
    .orderBy(desc(postComments.createdAt)).limit(50);
  res.json({ comments: comments.reverse() });
});

// POST /api/social/v2/post/:id/comment
router.post("/social/v2/post/:id/comment", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const postId = parseInt(req.params.id);
  const { content } = req.body as { content: string };

  if (!content?.trim() || content.length > 300) {
    res.status(400).json({ error: "Comment content required (max 300 chars)" }); return;
  }

  const check = await validateContent(content, { allowTrivial: false });
  if (!check.ok) { res.status(400).json({ error: check.reason }); return; }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const [comment] = await db.insert(postComments).values({
    postId, userId, username: me.username, content: content.trim(),
  }).returning();

  res.status(201).json({ comment });
});

// ────────────────────────────────────────────────────────────────────────────
// FOLLOW SYSTEM
// ────────────────────────────────────────────────────────────────────────────

// GET /api/social/v2/my-following
router.get("/social/v2/my-following", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ following: [] }); return; }
  const rows = await db.select({ followingId: userFollows.followingId })
    .from(userFollows).where(eq(userFollows.followerId, userId));
  res.json({ following: rows.map(r => r.followingId) });
});

// POST /api/social/v2/follow/:username
router.post("/social/v2/follow/:username", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { username } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!target) { res.status(404).json({ error: "Citizen not found" }); return; }
  if (target.id === userId) { res.status(400).json({ error: "Cannot follow yourself" }); return; }

  try {
    await db.insert(userFollows).values({ followerId: userId, followingId: target.id });
    res.json({ following: true });
  } catch {
    res.json({ following: true, alreadyFollowing: true });
  }
});

// DELETE /api/social/v2/follow/:username
router.delete("/social/v2/follow/:username", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { username } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!target) { res.status(404).json({ error: "Citizen not found" }); return; }

  await db.delete(userFollows)
    .where(and(eq(userFollows.followerId, userId), eq(userFollows.followingId, target.id)));
  res.json({ following: false });
});

// ────────────────────────────────────────────────────────────────────────────
// CITIZENS SEARCH
// ────────────────────────────────────────────────────────────────────────────

// GET /api/social/v2/citizens?q=
router.get("/social/v2/citizens", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(Number(req.query.limit ?? 20), 50);

  const rows = q
    ? await db.select({
        id: usersTable.id, username: usersTable.username,
        xp: usersTable.xp, balance: usersTable.balance,
      }).from(usersTable)
        .where(ilike(usersTable.username, `%${q}%`))
        .orderBy(desc(usersTable.xp)).limit(limit)
    : await db.select({
        id: usersTable.id, username: usersTable.username,
        xp: usersTable.xp, balance: usersTable.balance,
      }).from(usersTable)
        .orderBy(desc(usersTable.xp)).limit(limit);

  const citizens = rows.map((u) => ({
    ...u,
    xp: Number(u.xp ?? 0),
    balance: Number(u.balance ?? 0),
    rank: getRank(Number(u.xp ?? 0)),
  }));

  res.json({ citizens });
});

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// REACTIONS
// ────────────────────────────────────────────────────────────────────────────

const VALID_REACTIONS = ["❤️", "😂", "😮", "😡", "👏"];

// POST /api/social/v2/post/:id/react
router.post("/social/v2/post/:id/react", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { reaction } = req.body as { reaction: string };
  if (!VALID_REACTIONS.includes(reaction)) { res.status(400).json({ error: "Invalid reaction" }); return; }

  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";
  const userId = req.session?.userId;
  let username = "Anonymous";
  if (userId) {
    const [me] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (me) username = me.username;
  }

  // Upsert: each IP can change their reaction but not double-react
  await pool.query(
    `INSERT INTO post_reactions (post_id, user_id, username, voter_ip, reaction)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (post_id, voter_ip) DO UPDATE SET reaction = $5, created_at = now()`,
    [postId, userId ?? null, username, voterIp, reaction]
  );

  const { rows } = await pool.query(
    `SELECT reaction, COUNT(*)::int as cnt FROM post_reactions WHERE post_id = $1 GROUP BY reaction`,
    [postId]
  );
  const counts: Record<string, number> = {};
  rows.forEach((r: any) => { counts[r.reaction] = r.cnt; });

  // Update likes counter to total reactions
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  await db.update(pulsePosts).set({ likes: total }).where(eq(pulsePosts.id, postId));

  res.json({ reactions: counts, yourReaction: reaction });
});

// GET /api/social/v2/post/:id/reactions
router.get("/social/v2/post/:id/reactions", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.id);
  const voterIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";
  const { rows } = await pool.query(
    `SELECT reaction, COUNT(*)::int as cnt FROM post_reactions WHERE post_id = $1 GROUP BY reaction`,
    [postId]
  );
  const counts: Record<string, number> = {};
  rows.forEach((r: any) => { counts[r.reaction] = r.cnt; });
  const [myRow] = await pool.query(
    `SELECT reaction FROM post_reactions WHERE post_id = $1 AND voter_ip = $2 LIMIT 1`,
    [postId, voterIp]
  ).then(r => r.rows);
  res.json({ reactions: counts, yourReaction: myRow?.reaction ?? null });
});

// ────────────────────────────────────────────────────────────────────────────
// TRENDING
// ────────────────────────────────────────────────────────────────────────────

// GET /api/social/v2/trending
router.get("/social/v2/trending", async (req, res): Promise<void> => {
  const topPosts = await db.select({
    id: pulsePosts.id, username: pulsePosts.username, content: pulsePosts.content,
    likes: pulsePosts.likes, domain: pulsePosts.domain, createdAt: pulsePosts.createdAt,
  }).from(pulsePosts)
    .where(and(eq(pulsePosts.isVisible, true), sql`${pulsePosts.createdAt} > now() - interval '72 hours'`))
    .orderBy(desc(pulsePosts.likes))
    .limit(5);

  const recentContent = await db.select({ content: pulsePosts.content })
    .from(pulsePosts).where(eq(pulsePosts.isVisible, true))
    .orderBy(desc(pulsePosts.createdAt)).limit(100);

  const tagMap: Record<string, number> = {};
  recentContent.forEach(p => {
    (p.content.match(/#\w+/g) ?? []).forEach(tag => { tagMap[tag] = (tagMap[tag] ?? 0) + 1; });
  });
  const hashtags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  res.json({ topPosts, hashtags });
});

// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────────────────────

// GET /api/social/v2/notifications
router.get("/social/v2/notifications", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ notifications: [] }); return; }

  const myPosts = await db.select({ id: pulsePosts.id, content: pulsePosts.content })
    .from(pulsePosts).where(eq(pulsePosts.userId, userId)).limit(50);
  const myPostIds = myPosts.map(p => p.id);

  const notifs: { type: string; username: string; content: string; postSnippet?: string; createdAt: string }[] = [];

  if (myPostIds.length > 0) {
    const comments = await pool.query(
      `SELECT username, content, post_id, created_at FROM post_comments WHERE post_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 15`,
      [myPostIds]
    );
    comments.rows.forEach((c: any) => {
      const post = myPosts.find(p => p.id === c.post_id);
      notifs.push({ type: "comment", username: c.username, content: c.content, postSnippet: post?.content?.slice(0, 50), createdAt: c.created_at });
    });

    const reactions = await pool.query(
      `SELECT username, reaction, post_id, created_at FROM post_reactions WHERE post_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 15`,
      [myPostIds]
    );
    reactions.rows.forEach((r: any) => {
      const post = myPosts.find(p => p.id === r.post_id);
      notifs.push({ type: "reaction", username: r.username, content: r.reaction, postSnippet: post?.content?.slice(0, 50), createdAt: r.created_at });
    });
  }

  const follows = await pool.query(
    `SELECT uf.follower_id, uf.created_at, u.username FROM user_follows uf
     JOIN users u ON u.id = uf.follower_id
     WHERE uf.following_id = $1 ORDER BY uf.created_at DESC LIMIT 15`,
    [userId]
  );
  follows.rows.forEach((f: any) => {
    notifs.push({ type: "follow", username: f.username, content: "started following you", createdAt: f.created_at });
  });

  notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ notifications: notifs.slice(0, 30) });
});

// GET /api/social/v2/search?q=
router.get("/social/v2/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) { res.json({ posts: [], citizens: [], stories: [] }); return; }

  const [posts, citizens, stories] = await Promise.all([
    db.select({ id: pulsePosts.id, username: pulsePosts.username, content: pulsePosts.content, createdAt: pulsePosts.createdAt })
      .from(pulsePosts)
      .where(and(eq(pulsePosts.isVisible, true), ilike(pulsePosts.content, `%${q}%`)))
      .orderBy(desc(pulsePosts.createdAt)).limit(10),

    db.select({ id: usersTable.id, username: usersTable.username, xp: usersTable.xp })
      .from(usersTable)
      .where(ilike(usersTable.username, `%${q}%`))
      .orderBy(desc(usersTable.xp)).limit(8),

    db.select({ id: platformStories.id, username: platformStories.username, content: platformStories.content, createdAt: platformStories.createdAt })
      .from(platformStories)
      .where(and(eq(platformStories.isVisible, true), ilike(platformStories.content, `%${q}%`)))
      .orderBy(desc(platformStories.createdAt)).limit(5),
  ]);

  res.json({ posts, citizens: citizens.map(c => ({ ...c, rank: getRank(Number(c.xp ?? 0)) })), stories });
});

export default router;
