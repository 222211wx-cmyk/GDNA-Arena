import { useCallback, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { safeClips, type Clip } from "@/components/clips/clip-feed-data";
export type { Clip } from "@/components/clips/clip-feed-data";

const PAGE_LIMIT = 5;
export const CLIPS_FEED_QUERY_KEY = ["clips", "feed"] as const;

interface FeedPage {
  clips: Clip[];
  hasMore: boolean;
  nextBefore: number | null;
}

const feedUrl = (before?: number) =>
  `${import.meta.env.BASE_URL}api/clips/feed?limit=${PAGE_LIMIT}${
    before === undefined ? "" : `&before=${before}`
  }`;

async function fetchFeedPage(before: number | undefined, signal: AbortSignal): Promise<FeedPage> {
  const response = await fetch(feedUrl(before), { credentials: "include", signal });
  if (!response.ok) throw new Error("Clips could not be loaded");
  const data = (await response.json()) ?? { clips: [], hasMore: false, nextBefore: null };
  // Reject malformed server responses so a bad page never crashes the feed.
  if (
    (data.clips != null && !Array.isArray(data.clips)) ||
    typeof data.hasMore !== "boolean" ||
    (data.hasMore && (!Number.isSafeInteger(data.nextBefore) || data.nextBefore <= 0))
  ) {
    throw new Error("Invalid clips response");
  }
  return {
    clips: safeClips(data.clips),
    hasMore: Boolean(data.hasMore),
    nextBefore: data.hasMore ? (data.nextBefore as number) : null,
  };
}

/**
 * Tanstack v5 useInfiniteQuery behind the stable return contract the page consumes.
 * Keeps clips/setClips/loading/loadingMore/hasMore/error/refresh/loadMore identical
 * so the existing page and future virtualized feed need no reshaping.
 */
export function useClipsFeed() {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery<FeedPage, Error, InfiniteData<FeedPage>, typeof CLIPS_FEED_QUERY_KEY, number | undefined>({
    queryKey: CLIPS_FEED_QUERY_KEY,
    queryFn: ({ pageParam, signal }) => fetchFeedPage(pageParam, signal),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextBefore ?? undefined : undefined),
    staleTime: 30_000,
  });

  // Flatten + de-dupe across pages; bad rows already filtered by safeClips.
  const clips = useMemo<Clip[]>(() => {
    const pages = query.data?.pages ?? [];
    const combined = pages.flatMap((page) => page.clips);
    return [...new Map(combined.map((clip) => [clip.id, clip])).values()];
  }, [query.data]);

  // Patch the infinite cache in place so title edits / deletes survive without refetch.
  const setClips = useCallback(
    (updater: (previous: Clip[]) => Clip[]) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(CLIPS_FEED_QUERY_KEY, (old) => {
        if (!old) return old;
        const flat = old.pages.flatMap((page) => page.clips);
        const next = updater([...new Map(flat.map((c) => [c.id, c])).values()]);
        const byId = new Map(next.map((c) => [c.id, c]));
        const keep = new Set(next.map((c) => c.id));
        const pages = old.pages.map((page) => ({
          ...page,
          clips: page.clips.filter((c) => keep.has(c.id)).map((c) => byId.get(c.id) ?? c),
        }));
        return { ...old, pages };
      });
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // Ref guard: two synchronous loadMore() calls must fire a single request.
  const inFlight = useRef(false);
  const loadMore = useCallback(async () => {
    if (inFlight.current || !query.hasNextPage || query.isFetchingNextPage) return;
    inFlight.current = true;
    try {
      await query.fetchNextPage();
    } finally {
      inFlight.current = false;
    }
  }, [query]);

  return {
    clips,
    setClips,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    error: query.isError,
    refresh,
    loadMore,
  };
}
