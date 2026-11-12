export const LITE_VIDEO_FIELD = `(u.id=$1 OR COALESCE(p.field_visibility->>'videos','everyone')='everyone'
  OR (p.field_visibility->>'videos'='friends'
    AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=u.id)
    AND EXISTS(SELECT 1 FROM user_follows f WHERE f.following_id=$1 AND f.follower_id=u.id)))`;

export function liteMediaMetadata(row: Record<string, any> | undefined, clipId: number, kind = "audio") {
  const ready = row?.state === "ready";
  return {
    status: row?.state ?? "unavailable",
    sizeBytes: ready ? row!.size_bytes : null,
    mime: ready ? row!.mime : null,
    durationSec: ready ? row!.duration_sec : null,
    url: ready ? `/api/lite/clips/${clipId}/${kind === "audio" ? "audio/play" : "poster"}` : null,
    requiresConsent: Boolean(ready && row!.size_bytes > 1024 * 1024),
    error: row?.error ?? null,
  };
}
