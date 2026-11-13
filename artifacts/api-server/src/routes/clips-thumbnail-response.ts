/** Never expose private bucket/object names, or a URL that expires after publish. */
export function clipWithThumbnail<T extends {
  id: number; thumbnail_object_name?: string | null; title?: string;
  duration_sec?: number; processing_status?: string;
}>(
  row: T,
) {
  const { thumbnail_object_name, ...clip } = row;
  return {
    ...clip,
    id: row.id,
    ...(row.title !== undefined ? { name: row.title } : {}),
    ...(row.duration_sec !== undefined ? { duration: row.duration_sec } : {}),
    ...(row.processing_status !== undefined ? { processingStatus: row.processing_status } : {}),
    thumb: thumbnail_object_name ? `/api/clips/thumbnail/${row.id}` : null,
  };
}

export function finalClipReceipt(clip: Record<string, unknown>) {
  return {
    ok: true,
    code: clip.code,
    name: clip.name ?? clip.title,
    duration: clip.duration ?? clip.duration_sec,
    url: typeof clip.code === "string" ? `/clip/${clip.code}` : `/api/clips/stream/${clip.id}`,
    created_at: clip.created_at,
    processingStatus: clip.processingStatus ?? clip.processing_status ?? "ready",
    clip,
  };
}
