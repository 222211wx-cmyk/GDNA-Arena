import { Router, type IRouter } from "express";

export interface PlaybackClip {
  id: number; code: string; title: string; original_name: string | null;
  duration_sec: number; size_bytes: string | number; created_at: Date | string;
  content_type: string; processing_status: string; object_name: string;
}

/** Public clips only; the lookup dependency must exclude frozen/deleted rows. */
export function createClipPlaybackRouter(deps: {
  find(code: string): Promise<PlaybackClip | null>;
  sign(filename: string): Promise<{ url: string; urlExpiresAt: string }>;
  log(error: unknown): void;
}): IRouter {
  const router = Router();
  router.get("/clip/by-code/:code", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const code = String(req.params.code);
    if (!/^HELX-\d{6}$/.test(code)) { res.status(404).json({ error: "Clip not found" }); return; }
    try {
      const row = await deps.find(code);
      if (!row) { res.status(404).json({ error: "Clip not found" }); return; }
      const ready = row.processing_status === "ready" || row.processing_status === "unchanged";
      const playback = ready ? await deps.sign(row.object_name) : null;
      res.json({
        clip: {
          id: row.id, code: row.code, name: row.title, originalName: row.original_name,
          duration: Number(row.duration_sec), size: Number(row.size_bytes),
          created_at: row.created_at, contentType: row.content_type,
          processingStatus: row.processing_status,
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