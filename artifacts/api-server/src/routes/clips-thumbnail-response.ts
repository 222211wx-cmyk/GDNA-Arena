/** Never expose private bucket/object names, or a URL that expires after publish. */
export function clipWithThumbnail<T extends { id: number; thumbnail_object_name?: string | null }>(
  row: T,
): Omit<T, "thumbnail_object_name"> & { id: number; thumb: string | null } {
  const { thumbnail_object_name, ...clip } = row;
  return {
    ...clip,
    id: row.id,
    thumb: thumbnail_object_name ? `/api/clips/thumbnail/${row.id}` : null,
  };
}