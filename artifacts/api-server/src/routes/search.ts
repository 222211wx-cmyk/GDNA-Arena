import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/search?q=keyword
 * Returns top results per category: legends, citizens, posts, events
 */
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 2) {
      return res.json({ legends: [], citizens: [], posts: [], events: [] });
    }

    const term = `%${q.toLowerCase()}%`;
    const LIMIT = 6;

    const [legends, citizens, posts, events] = await Promise.all([
      // Legends: search by name, domain, nationality
      db.execute(sql`
        SELECT id, name, domain, nationality, rank, image_url
        FROM legends
        WHERE is_active = true
          AND (LOWER(name) LIKE ${term}
            OR LOWER(domain) LIKE ${term}
            OR LOWER(COALESCE(nationality,'')) LIKE ${term})
        ORDER BY rank ASC
        LIMIT ${LIMIT}
      `),

      // Citizens: search by username
      db.execute(sql`
        SELECT id, username, xp, balance
        FROM users
        WHERE LOWER(username) LIKE ${term}
        ORDER BY xp DESC
        LIMIT ${LIMIT}
      `),

      // Posts: search by content or username
      db.execute(sql`
        SELECT id, username, content, domain, type, likes, created_at
        FROM pulse_posts
        WHERE is_visible = true
          AND (LOWER(content) LIKE ${term}
            OR LOWER(COALESCE(username,'')) LIKE ${term})
        ORDER BY created_at DESC
        LIMIT ${LIMIT}
      `),

      // Events: search by title (EN or AR) or location
      db.execute(sql`
        SELECT id, title, title_ar, domain, location, event_date, is_live, icon
        FROM pulse_events
        WHERE LOWER(title) LIKE ${term}
          OR LOWER(COALESCE(title_ar,'')) LIKE ${term}
          OR LOWER(COALESCE(location,'')) LIKE ${term}
        ORDER BY is_live DESC, event_date DESC
        LIMIT ${LIMIT}
      `),
    ]);

    return res.json({
      legends: legends.rows ?? [],
      citizens: citizens.rows ?? [],
      posts: posts.rows ?? [],
      events: events.rows ?? [],
    });
  } catch (err) {
    console.error("[search] error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

export default router;
