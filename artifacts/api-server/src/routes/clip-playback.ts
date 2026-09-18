import { Router, type IRouter } from "express";

export interface PlaybackClip {
  id: number; code: string; title: string; original_name: string | null;
  duration_sec: number; size_bytes: string | number; created_at: Date | string;
  content_type: string; processing_status: string; object_name: string;
  user_id: number; username: string; like_count: string | number;
  comment_count: string | number; liked_by_viewer: boolean;
}

/** Public clips only; the lookup dependency must exclude frozen/deleted rows. */
export function createClipPlaybackRouter(deps: {
  find(code: string, viewerId: number | null): Promise<PlaybackClip | null>;
  sign(filename: string): Promise<{ url: string; urlExpiresAt: string }>;
  log(error: unknown): void;
}): IRouter {
  const router = Router();
  router.get("/clip/by-code/:code", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const code = String(req.params.code);
    if (!/^HELX-\d{6}$/.test(code)) { res.status(404).json({ error: "Clip not found" }); return; }
    try {
      const viewerId = (req.session as { userId?: number } | undefined)?.userId ?? null;
      const row = await deps.find(code, viewerId);
      if (!row) { res.status(404).json({ error: "Clip not found" }); return; }
      const ready = row.processing_status === "ready" || row.processing_status === "unchanged";
      const playback = ready ? await deps.sign(row.object_name) : null;
      res.json({
        clip: {
          id: row.id, code: row.code, name: row.title, originalName: row.original_name,
          duration: Number(row.duration_sec), size: Number(row.size_bytes),
          created_at: row.created_at, contentType: row.content_type,
          processingStatus: row.processing_status,
          author: { id: row.user_id, username: row.username },
          isOwner: viewerId === row.user_id,
          liked: row.liked_by_viewer,
          likeCount: Number(row.like_count),
          commentCount: Number(row.comment_count),
          url: playback?.url ?? null, urlExpiresAt: playback?.urlExpiresAt ?? null,
        },
      });
    } catch (error) {
      deps.log(error);
      res.set("Retry-After", "2").status(503).json({ error: "Clip playback is temporarily unavailable" });
    }
  });
  return router;
}