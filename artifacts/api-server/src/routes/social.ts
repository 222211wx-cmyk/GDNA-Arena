import { Router } from "express";
import { db, pulsePosts, usersTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

const router = Router();

// POST /api/social/react — add emoji reaction to a pulse post
router.post("/api/social/react", async (req, res) => {
  const { postId, reaction } = req.body as { postId: number; reaction: string };
  const ALLOWED = ["heart", "fire", "crown", "zap"];
  if (!postId || !ALLOWED.includes(reaction)) {
    return res.status(400).json({ error: "Invalid reaction" });
  }

  try {
    // Increment likes as a proxy for any reaction (no separate reactions table needed yet)
    await db.execute(sql`
      UPDATE pulse_posts SET likes = likes + 1 WHERE id = ${postId}
    `);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[social/react]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/social/feed — pulse posts feed (proxies pulse feed)
router.get("/api/social/feed", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  try {
    const posts = await db
      .select({
        id:        pulsePosts.id,
        username:  pulsePosts.username,
        content:   pulsePosts.content,
        domain:    pulsePosts.domain,
        type:      pulsePosts.type,
        likes:     pulsePosts.likes,
        createdAt: pulsePosts.createdAt,
      })
      .from(pulsePosts)
      .where(eq(pulsePosts.isVisible, true))
      .orderBy(desc(pulsePosts.createdAt))
      .limit(limit);

    return res.json({ posts });
  } catch (err) {
    console.error("[social/feed]", err);
    return res.status(500).json({ posts: [] });
  }
});

export default router;
