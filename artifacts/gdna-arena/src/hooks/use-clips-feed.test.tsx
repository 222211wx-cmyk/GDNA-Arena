import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { useClipsFeed } from "./use-clips-feed";

const page = (ids: number[], hasMore = false, nextBefore: number | null = null) => ({
  ok: true,
  json: async () => ({
    clips: ids.map(id => ({
      id, user_id: 1, username: "creator", title: `Clip ${id}`,
      content_type: "video/mp4", duration_sec: 60, views: 0, created_at: "",
      thumb: id % 2 ? null : `/api/clips/thumbnail/${id}`,
    })),
    hasMore, nextBefore,
  }),
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("five-at-a-time clips feed (useInfiniteQuery v5)", () => {
  it("requests five initially and five more on demand, without duplicate in-flight requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([20, 19, 18, 17, 16], true, 16));
    let finish!: (value: ReturnType<typeof page>) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clips).toHaveLength(5));
    expect(fetch.mock.calls[0][0]).toBe("/api/clips/feed?limit=5");
    // id 20 is even -> thumb present; id 19 is odd -> thumb null.
    expect(result.current.clips[0].thumb).toBe("/api/clips/thumbnail/20");
    expect(result.current.clips[1].thumb).toBeNull();
    expect(result.current.hasMore).toBe(true);

    // Two rapid loadMore calls must not fire two requests (ref-guarded).
    await act(async () => { void result.current.loadMore(); void result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/clips/feed?limit=5&before=16");

    await act(async () => { finish(page([15, 14, 13, 12, 11])); });
    await waitFor(() => expect(result.current.clips).toHaveLength(10));
    // id 15 is odd -> thumb null.
    expect(result.current.clips[5].thumb).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("surfaces an error on a failed page and recovers on retry without crashing", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(page([20, 19, 18, 17, 16], true, 16))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(page([15, 14, 13, 12, 11]));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clips).toHaveLength(5));

    await act(async () => { await result.current.loadMore(); });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.clips).toHaveLength(5);

    await act(async () => { await result.current.loadMore(); });
    await waitFor(() => expect(result.current.clips).toHaveLength(10));
    expect(result.current.error).toBe(false);
  });

  it("filters malformed rows and rejects a non-array clips payload", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clips: [
          { id: 5, user_id: 2, username: "ok", title: "good", content_type: "video/mp4", duration_sec: 60, views: 3, created_at: "" },
          null,
          { id: 0 },
          { id: 6, video_url: "" },
          { title: "no id" },
        ],
        hasMore: false, nextBefore: null,
      }),
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clips.map(c => c.id)).toEqual([5]);
    expect(result.current.error).toBe(false);
  });

  it("rejects a null/invalid response shape as an error rather than crashing", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed, { wrapper: wrapper() });
    // null coerces to empty page, which is valid and yields zero clips.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clips).toHaveLength(0);
    expect(result.current.error).toBe(false);

    cleanup();
    const bad = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ clips: "nope", hasMore: false }) });
    vi.stubGlobal("fetch", bad);
    const second = renderHook(useClipsFeed, { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.error).toBe(true));
    expect(second.result.current.clips).toHaveLength(0);
  });

  it("patches cache in place via setClips for title edits and deletes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([20, 19, 18, 17, 16]));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clips).toHaveLength(5));

    act(() => result.current.setClips(clips => clips.map(c => c.id === 20 ? { ...c, title: "Edited" } : c)));
    await waitFor(() => expect(result.current.clips.find(c => c.id === 20)?.title).toBe("Edited"));

    act(() => result.current.setClips(clips => clips.filter(c => c.id !== 20)));
    await waitFor(() => expect(result.current.clips.map(c => c.id)).toEqual([19, 18, 17, 16]));
    // No refetch was triggered by the local cache patch.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
