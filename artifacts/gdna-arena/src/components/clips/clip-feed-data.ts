export interface Clip {
  id: number;
  user_id: number;
  title: string;
  username: string;
  content_type: string;
  duration_sec: number;
  views: number;
  created_at: string;
  thumb?: string | null;
}

/** Old/corrupt records must not take down the entire video page. */
export function safeClips(value: unknown): Clip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Clip[] => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.id) || row.id <= 0) return [];
    if ("video_url" in row && !row.video_url) return [];
    return [{
      id: row.id,
      user_id: Number.isSafeInteger(row.user_id) ? row.user_id : 0,
      title: typeof row.title === "string" ? row.title : "",
      username: typeof row.username === "string" ? row.username : "",
      content_type: typeof row.content_type === "string" ? row.content_type : "video/mp4",
      duration_sec: Number.isFinite(Number(row.duration_sec)) ? Math.max(0, Number(row.duration_sec)) : 0,
      views: Number.isFinite(Number(row.views)) ? Math.max(0, Number(row.views)) : 0,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      thumb: typeof row.thumb === "string" ? row.thumb : null,
    }];
  });
}