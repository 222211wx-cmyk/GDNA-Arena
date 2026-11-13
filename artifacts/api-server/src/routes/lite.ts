import { Router } from "express";
import { pool } from "@workspace/db";
import { compactCitizen, litePage, LITE_CITIZEN_COLUMNS, LITE_VISIBILITY } from "../lib/lite-projection";
import { liteAvatar } from "../lib/lite-avatar";
import liteMediaRouter from "./lite-media";
import { LITE_VIDEO_FIELD, liteMediaMetadata } from "../lib/lite-media-policy";

const router = Router();
router.use("/lite", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
router.use(liteMediaRouter);

router.get("/lite/citizens", async (req, res) => {
  const page = litePage(req.query);
  if (!page) { res.status(400).json({ error: "Invalid pagination (limit 1–20)" }); return; }
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 80).replace(/[\\%_]/g, "\\$&") : "";
  const { rows } = await pool.query(`SELECT ${LITE_CITIZEN_COLUMNS}
    FROM users u LEFT JOIN citizen_profiles p ON p.user_id=u.id WHERE ${LITE_VISIBILITY}
    AND ($2::int IS NULL OR u.id<$2) AND u.username ILIKE $3
    ORDER BY u.id DESC LIMIT $4`, [req.session?.userId ?? null, page.before, `%${q}%`, page.limit + 1]);
  res.json({ citizens: rows.slice(0, page.limit).map(r => compactCitizen(r, req.session?.userId)),
    nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null });
});

router.get("/lite/profile/:username", async (req, res) => {
  const { rows } = await pool.query(`SELECT ${LITE_CITIZEN_COLUMNS}
    FROM users u LEFT JOIN citizen_profiles p ON p.user_id=u.id WHERE ${LITE_VISIBILITY}
    AND lower(u.username)=lower($2) LIMIT 1`, [req.session?.userId ?? null, req.params.username.slice(0, 80)]);
  const profile = rows[0] && compactCitizen(rows[0], req.session?.userId);
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json({ profile });
});

router.get("/lite/market", async (req, res) => {
  const page = litePage(req.query);
  if (!page) { res.status(400).json({ error: "Invalid pagination" }); return; }
  const { rows } = await pool.query(`SELECT ${LITE_CITIZEN_COLUMNS},
    l.id AS listing_id,l.type,left(l.title,120) AS title,left(l.description,240) AS description,l.price
    FROM citizen_listings l JOIN users u ON u.id=l.user_id LEFT JOIN citizen_profiles p ON p.user_id=u.id
    WHERE ${LITE_VISIBILITY} AND ($2::int IS NULL OR l.id<$2) ORDER BY l.id DESC LIMIT $3`,
    [req.session?.userId ?? null, page.before, page.limit + 1]);
  res.json({ listings: rows.slice(0, page.limit).map(r => ({ id: r.listing_id, type: r.type,
    title: r.title, description: r.description, price: Number(r.price), seller: compactCitizen(r, req.session?.userId) })),
    nextCursor: rows.length > page.limit ? rows[page.limit - 1].listing_id : null });
});

router.get("/lite/clips", async (req, res) => {
  const page = litePage(req.query);
  if (!page) { res.status(400).json({ error: "Invalid pagination" }); return; }
  const { rows } = await pool.query(`SELECT c.id,left(c.title,120) AS title,c.duration_sec AS "durationSec",left(u.username,80) AS username,
    l.state,l.size_bytes,l.mime,l.duration_sec,l.error
    FROM clips c JOIN users u ON u.id=c.user_id LEFT JOIN citizen_profiles p ON p.user_id=u.id
    LEFT JOIN clip_lite_media l ON l.clip_id=c.id AND l.kind='audio'
    WHERE ${LITE_VISIBILITY} AND c.is_frozen=FALSE AND c.object_name IS NOT NULL AND c.object_name<>''
    AND ${LITE_VIDEO_FIELD}
    AND ($2::int IS NULL OR c.id<$2) ORDER BY c.id DESC LIMIT $3`,
    [req.session?.userId ?? null, page.before, page.limit + 1]);
  res.json({ clips: rows.slice(0, page.limit).map(r => ({
    id: r.id, title: r.title, durationSec: r.durationSec, username: r.username, audio: liteMediaMetadata(r.state ? r : undefined, r.id),
  })),
    nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null });
});

router.get("/lite/avatar/:username", liteAvatar);
export default router;
