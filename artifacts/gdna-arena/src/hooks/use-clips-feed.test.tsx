import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClipsFeed } from "./use-clips-feed";

const page = (ids: number[], hasMore = false, nextBefore: number | null = null) => ({
  ok: true,
  json: async () => ({
    clips: ids.map(id => ({ id, user_id: 1, username: "creator", title: `Clip ${id}`,
      content_type: "video/mp4", duration_sec: 60, views: 0, created_at: "" })),
    hasMore, nextBefore,
  }),
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("six-at-a-time clips feed", () => {
  it("requests six initially and six more on demand, preventing duplicate requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([20, 19, 18, 17, 16, 15], true, 15));
    let finish!: (value: ReturnType<typeof page>) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed);
    await waitFor(() => expect(result.current.clips).toHaveLength(6));
    expect(fetch.mock.calls[0][0]).toBe("/api/clips/feed?limit=6");
    act(() => { void result.current.loadMore(); void result.current.loadMore(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/clips/feed?limit=6&before=15");
    expect(result.current.loadingMore).toBe(true);
    await act(async () => { finish(page([14, 13, 12, 11, 10, 9])); });
    expect(result.current.clips).toHaveLength(12);
    expect(result.current.hasMore).toBe(false);
  });

  it("retains the list and original cursor after an error or deletion, then allows retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(page([20, 19, 18, 17, 16, 15], true, 15))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(page([14, 13, 12, 11, 10, 9]));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed);
    await waitFor(() => expect(result.current.clips).toHaveLength(6));
    act(() => result.current.setClips(clips => clips.filter(clip => clip.id !== 15)));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.error).toBe(true);
    expect(result.current.clips).toHaveLength(5);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.error).toBe(false);
    expect(result.current.clips).toHaveLength(11);
    expect(fetch.mock.calls[2][0]).toContain("before=15");
  });

  it("ignores a stale pagination response after refreshing the feed", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    const fetch = vi.fn()
      .mockResolvedValueOnce(page([20, 19, 18, 17, 16, 15], true, 15))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(page([30, 29, 28, 27, 26, 25], true, 25));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useClipsFeed);
    await waitFor(() => expect(result.current.clips).toHaveLength(6));
    act(() => { void result.current.loadMore(); });
    await act(async () => { await result.current.refresh(); });
    await act(async () => { finish(page([14, 13, 12, 11, 10, 9])); });
    expect(result.current.clips.map(clip => clip.id)).toEqual([30, 29, 28, 27, 26, 25]);
    expect(result.current.hasMore).toBe(true);
  });
});