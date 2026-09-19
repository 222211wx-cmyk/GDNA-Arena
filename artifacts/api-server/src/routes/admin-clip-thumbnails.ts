import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import {
  GetExhaustedClipThumbnailsQueryParams,
  GetExhaustedClipThumbnailsResponse,
  RequeueClipThumbnailParams,
  RequeueClipThumbnailResponse,
} from "@workspace/api-zod";
const CLIP_THUMBNAIL_LOCK_KEY = 1;
const CLIP_THUMBNAIL_LOCK_NAMESPACE = 19183721;
const CLIP_THUMBNAIL_MAX_ATTEMPTS = 8;
import { requireAdmin } from "../middleware/require-admin.js";

const router: IRouter = Router();

function adminKey(req: Request): string {
  return String((req.session as { userId: number }).userId);
}

const inspectLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: adminKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Admin thumbnail inspection rate limit exceeded" },
});

const requeueLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: adminKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Admin thumbnail requeue rate limit exceeded" },
});

router.get(
  "/admin/clips/thumbnails/exhausted",
  requireAdmin,
  inspectLimiter,
  async (req, res): Promise<void> => {
    const parsed = GetExhaustedClipThumbnailsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid limit or before cursor" });
      return;
    }

    const { limit, before } = parsed.data;
    const { rows } = await pool.query<{
      id: number;
      title: string;
      username: string;
      createdAt: Date;
      thumbnailRetryAttempts: number;
      thumbnailRetryAt: Date;
      isFrozen: boolean;
    }>(
      `SELECT id, title, username,
              created_at AS "createdAt",
              thumbnail_retry_attempts AS "thumbnailRetryAttempts",
              thumbnail_retry_at AS "thumbnailRetryAt",
              is_frozen AS "isFrozen"
       FROM clips
       WHERE thumbnail_object_name IS NULL
         AND content_type LIKE 'video/%'
         AND thumbnail_retry_attempts >= $1
         AND ($2::integer IS NULL OR id < $2)
       ORDER BY id DESC
       LIMIT $3`,
      [CLIP_THUMBNAIL_MAX_ATTEMPTS, before ?? null, limit + 1],
    );
    const hasMore = rows.length > limit;
    const clips = rows.slice(0, limit);
    res.json(GetExhaustedClipThumbnailsResponse.parse({
      clips,
      nextBefore: hasMore ? clips.at(-1)!.id : null,
      maxAttempts: CLIP_THUMBNAIL_MAX_ATTEMPTS,
    }));
  },
);

router.post(
  "/admin/clips/thumbnails/:id/requeue",
  requireAdmin,
  requeueLimiter,
  async (req, res): Promise<void> => {
    const parsed = RequeueClipThumbnailParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid clip ID" });
      return;
    }

    const actorId = (req.session as { userId: number }).userId;
    const clipId = parsed.data.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
        [CLIP_THUMBNAIL_LOCK_NAMESPACE, CLIP_THUMBNAIL_LOCK_KEY],
      );
      if (lock.rows[0]?.acquired !== true) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Thumbnail retry worker is active" });
        return;
      }

      const update = await client.query<{
        id: number;
        thumbnailRetryAttempts: number;
        thumbnailRetryAt: Date;
      }>(
        `UPDATE clips
         SET thumbnail_retry_attempts = 0, thumbnail_retry_at = NOW()
         WHERE id = $1
           AND thumbnail_object_name IS NULL
           AND content_type LIKE 'video/%'
           AND is_frozen = FALSE
           AND thumbnail_retry_attempts >= $2
         RETURNING id,
                   thumbnail_retry_attempts AS "thumbnailRetryAttempts",
                   thumbnail_retry_at AS "thumbnailRetryAt"`,
        [clipId, CLIP_THUMBNAIL_MAX_ATTEMPTS],
      );
      const clip = update.rows[0];
      if (!clip) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Clip is stale or ineligible for requeue" });
        return;
      }
      await client.query("COMMIT");
      req.log.info({ actorId, clipId }, "[clips] exhausted thumbnail requeued");
      res.json(RequeueClipThumbnailResponse.parse(clip));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
);

export default router;