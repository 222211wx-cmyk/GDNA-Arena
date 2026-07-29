import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// ── GET /press/feed ─────────────────────────────────────────────────────────
router.get("/press/feed", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const type  = typeof req.query.type === "string" && req.query.type !== "all" ? req.query.type : null;

    const q = type
      ? `SELECT p.*, COALESCE(c.cnt,0)::int as comment_count
         FROM press_posts p
         LEFT JOIN (SELECT post_id, COUNT(*) cnt FROM press_comments GROUP BY post_id) c ON c.post_id=p.id
         WHERE p.is_visible=true AND p.type=$1
         ORDER BY p.created_at DESC LIMIT $2`
      : `SELECT p.*, COALESCE(c.cnt,0)::int as comment_count
         FROM press_posts p
         LEFT JOIN (SELECT post_id, COUNT(*) cnt FROM press_comments GROUP BY post_id) c ON c.post_id=p.id
         WHERE p.is_visible=true
         ORDER BY p.created_at DESC LIMIT $1`;

    const { rows } = type
      ? await pool!.query(q, [type, limit])
      : await pool!.query(q, [limit]);

    res.json({ posts: rows });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── POST /press/post ────────────────────────────────────────────────────────
router.post("/press/post", async (req, res): Promise<void> => {
  try {
    const {
      type,        // 'video' | 'story' | 'article'
      title,
      content,
      video_url,   // YouTube ID or URL
      image_url,
      author,
    } = req.body as {
      type: string; title?: string; content?: string;
      video_url?: string; image_url?: string; author?: string;
    };

    if (!type || !["video","story","article"].includes(type)) {
      res.status(400).json({ error: "Invalid type" }); return;
    }
    if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }

    const authorName = author?.trim() || "صحفي مجهول";
    const titleText  = title?.trim()  || null;

    const { rows } = await pool!.query(
      `INSERT INTO press_posts (type, title, content, video_url, image_url, author, likes, is_visible)
       VALUES ($1,$2,$3,$4,$5,$6,0,true) RETURNING *`,
      [type, titleText, content.trim(), video_url ?? null, image_url ?? null, authorName]
    );

    res.status(201).json({ post: rows[0] });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── POST /press/post/:id/like ────────────────────────────────────────────────
router.post("/press/post/:id/like", async (req, res): Promise<void> => {
  try {
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress ?? "unknown";

    const { rows: existing } = await pool!.query(
      `SELECT id FROM press_post_likes WHERE post_id=$1 AND voter_ip=$2`, [postId, ip]
    );
    if (existing.length > 0) { res.json({ alreadyLiked: true }); return; }

    await pool!.query(`INSERT INTO press_post_likes (post_id, voter_ip) VALUES ($1,$2)`, [postId, ip]);
    const { rows } = await pool!.query(
      `UPDATE press_posts SET likes=likes+1 WHERE id=$1 RETURNING likes`, [postId]
    );
    res.json({ likes: rows[0]?.likes ?? 0 });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /press/post/:id/comments ────────────────────────────────────────────
router.get("/press/post/:id/comments", async (req, res): Promise<void> => {
  try {
    const postId = parseInt(req.params.id);
    const { rows } = await pool!.query(
      `SELECT * FROM press_comments WHERE post_id=$1 ORDER BY created_at DESC LIMIT 30`, [postId]
    );
    res.json({ comments: rows });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── POST /press/post/:id/comment ─────────────────────────────────────────────
router.post("/press/post/:id/comment", async (req, res): Promise<void> => {
  try {
    const postId = parseInt(req.params.id);
    const { author, content } = req.body as { author?: string; content: string };

    if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }

    const { rows } = await pool!.query(
      `INSERT INTO press_comments (post_id, author, content) VALUES ($1,$2,$3) RETURNING *`,
      [postId, author?.trim() || "مواطن مجهول", content.trim().slice(0, 500)]
    );
    res.status(201).json({ comment: rows[0] });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /press/polls ─────────────────────────────────────────────────────────
router.get("/press/polls", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool!.query(
      `SELECT * FROM press_polls ORDER BY created_at DESC LIMIT 10`
    );
    res.json({ polls: rows });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── POST /press/polls/:id/vote ───────────────────────────────────────────────
router.post("/press/polls/:id/vote", async (req, res): Promise<void> => {
  try {
    const pollId = parseInt(req.params.id);
    const { option } = req.body as { option: "a" | "b" | "c" | "d" };

    if (!["a","b","c","d"].includes(option)) {
      res.status(400).json({ error: "Invalid option" }); return;
    }

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress ?? "unknown";

    const { rows: existing } = await pool!.query(
      `SELECT id FROM press_poll_votes WHERE poll_id=$1 AND voter_ip=$2`, [pollId, ip]
    );
    if (existing.length > 0) { res.json({ alreadyVoted: true }); return; }

    await pool!.query(`INSERT INTO press_poll_votes (poll_id, option_chosen, voter_ip) VALUES ($1,$2,$3)`, [pollId, option, ip]);
    const col = `votes_${option}`;
    await pool!.query(`UPDATE press_polls SET ${col}=${col}+1 WHERE id=$1`, [pollId]);

    const { rows } = await pool!.query(`SELECT * FROM press_polls WHERE id=$1`, [pollId]);
    res.json({ poll: rows[0] });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /press/sponsors ──────────────────────────────────────────────────────
router.get("/press/sponsors", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool!.query(`SELECT * FROM press_sponsors ORDER BY sort_order ASC`);
    res.json({ sponsors: rows });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

export default router;
