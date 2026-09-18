import { useCallback, useEffect, useRef, useState } from "react";

export interface Clip {
  id: number; user_id: number; username: string; title: string;
  content_type: string; duration_sec: number; views: number; created_at: string;
  thumb?: string;
}

export function useClipsFeed() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const cursor = useRef<number | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (before?: number) => {
    if (before !== undefined && active.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError(false);
    if (before === undefined) {
      setLoading(true);
      setClips([]);
      setHasMore(false);
      cursor.current = null;
    } else setLoadingMore(true);
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}api/clips/feed?limit=6${before === undefined ? "" : `&before=${before}`}`,
        { credentials: "include", signal: controller.signal },
      );
      if (!response.ok) throw new Error("Clips could not be loaded");
      const data = await response.json();
      if (!Array.isArray(data.clips) || typeof data.hasMore !== "boolean" ||
          (data.hasMore && (!Number.isSafeInteger(data.nextBefore) || data.nextBefore <= 0))) {
        throw new Error("Invalid clips response");
      }
      if (active.current !== controller) return;
      setClips(previous => {
        const combined: Clip[] = before === undefined ? data.clips : [...previous, ...data.clips];
        return [...new Map(combined.map(clip => [clip.id, clip])).values()];
      });
      cursor.current = data.hasMore ? data.nextBefore : null;
      setHasMore(data.hasMore);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const refresh = useCallback(() => load(), [load]);
  const loadMore = useCallback(() => {
    return cursor.current === null ? Promise.resolve() : load(cursor.current);
  }, [load]);
  useEffect(() => {
    void refresh();
    return () => { active.current?.abort(); active.current = null; };
  }, [refresh]);

  return { clips, setClips, loading, loadingMore, hasMore, error, refresh, loadMore };
}