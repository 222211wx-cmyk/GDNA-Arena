import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { LITE_VISIBILITY } from "../lib/lite-projection";
import { LITE_VIDEO_FIELD, liteMediaMetadata } from "../lib/lite-media-policy";
import { readVerifiedMedia } from "../lib/lite-media-storage";
import { recordAudioDelivery } from "../lib/operator-store";

const router = Router();
const allowed: RequestHandler = async (req, res, next) => {
  const viewer = req.session?.userId;
  if (!viewer) { res.status(401).json({ error: "Login required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) { res.status(404).json({ error: "Clip not found" }); return; }
  const { rows } = await pool.query(`SELECT c.id,c.thumbnail_object_name FROM clips c
    JOIN users u ON u.id=c.user_id LEFT JOIN citizen_profiles p ON p.user_id=u.id
    WHERE ${LITE_VISIBILITY} AND ${LITE_VIDEO_FIELD} AND c.id=$2 AND NOT c.is_frozen
    AND c.object_name IS NOT NULL AND c.object_name<>''`, [viewer, id]);
  if (!rows[0]) { res.status(404).json({ error: "Clip not found" }); return; }
  res.locals.clip = rows[0];
  next();
};
async function status(id: number) {
  const { rows } = await pool.query("SELECT kind,state,size_bytes,mime,duration_sec,error FROM clip_lite_media WHERE clip_id=$1", [id]);
  return { audio: liteMediaMetadata(rows.find(r => r.kind === "audio"), id),
    poster: liteMediaMetadata(rows.find(r => r.kind === "poster"), id, "poster") };
}

router.get("/lite/clips/:id/audio", allowed, async (_req, res) => res.json(await status(res.locals.clip.id)));
router.post("/lite/clips/:id/audio",
  rateLimit({ windowMs: 60000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }), allowed,
  async (_req, res) => {
    const clip = res.locals.clip;
    await pool.query(`INSERT INTO clip_lite_media(clip_id,kind)
      SELECT $1,kind FROM unnest($2::text[]) kind ON CONFLICT(clip_id,kind) DO NOTHING`,
      [clip.id, clip.thumbnail_object_name ? ["audio", "poster"] : ["audio"]]);
    res.status(202).json(await status(clip.id));
  });

let activePlayback = 0;
const playback: RequestHandler = async (req, res) => {
  const kind = req.path.endsWith("/poster") ? "poster" : "audio";
  const row = (await pool.query("SELECT * FROM clip_lite_media WHERE clip_id=$1 AND kind=$2", [res.locals.clip.id, kind])).rows[0];
  if (!row || row.state !== "ready") { res.status(409).json({ ...liteMediaMetadata(row, res.locals.clip.id, kind), error: "Derivative not ready" }); return; }
  if (row.size_bytes > 1024 * 1024 && req.query.consent !== "1") {
    res.status(413).json({ ...liteMediaMetadata(row, res.locals.clip.id, kind), error: "Explicit download permission required" }); return;
  }
  if (activePlayback >= 8) { res.status(503).json({ error: "Media delivery busy; retry later" }); return; }
  activePlayback++;
  try {
    const bytes = await readVerifiedMedia(row);
    res.setHeader("Content-Type", row.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN;
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
        res.setHeader("Content-Range", `bytes */${bytes.length}`);
        res.status(416).end(); return;
      }
      res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
      res.status(206).send(bytes.subarray(start, end + 1)); return;
    }
    if (kind === "audio") {
      res.once("finish", () => {
        if (res.statusCode === 200) {
          void recordAudioDelivery(req.sessionID, res.locals.clip.id, row.source_object, bytes.length)
            .catch(() => req.log?.warn("Audio science receipt unavailable; no savings will be claimed"));
        }
      });
    }
    res.send(bytes);
  } catch { res.status(503).json({ error: "Audio/poster storage unavailable; no verified readable copy" }); }
  finally { activePlayback--; }
};
router.get("/lite/clips/:id/audio/play", allowed, playback);
router.get("/lite/clips/:id/poster", allowed, playback);
export default router;