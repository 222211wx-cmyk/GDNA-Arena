import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualClipsFeed } from "./VirtualClipsFeed";
import type { Clip } from "./clip-feed-data";

const ROW = 640; // matches the component's default row height

// IntersectionObserver stub (drives per-video visibility inside LazyClipVideo).
const observers: Observer[] = [];
class Observer {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    observers.push(this);
  }
  emit(target: Element, isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
    this.callback(
      [{ target, isIntersecting, intersectionRatio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

// ResizeObserver stub — the component measures the active row through it.
class RO {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly cb: ResizeObserverCallback) {}
}

const makeClips = (count: number): Clip[] =>
  Array.from({ length: count }, (_, i) => ({
    id: 100 - i, user_id: 1, username: "creator", title: `Clip ${100 - i}`,
    content_type: "video/mp4", duration_sec: 60, views: 0, created_at: "",
    thumb: `/api/clips/thumbnail/${100 - i}`,
  }));

const noop = () => {};
const slots = () => document.querySelectorAll("[data-testid^='clip-slot-']");

function scrollTo(px: number) {
  const feed = screen.getByTestId("clips-virtual-feed");
  Object.defineProperty(feed, "scrollTop", { configurable: true, value: px, writable: true });
  act(() => { fireEvent.scroll(feed); });
}

beforeEach(() => {
  observers.length = 0;
  // The feed sizes each row to the remaining visible viewport height
  // (window.innerHeight - container.top). In jsdom getBoundingClientRect().top is
  // 0, so pinning innerHeight to ROW makes the measured row height deterministic
  // and equal to the ROW constant the scroll math below relies on.
  Object.defineProperty(window, "innerHeight", { configurable: true, value: ROW, writable: true });
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", RO);
  // Run rAF synchronously so scroll-driven active-index updates settle in-test.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("virtualized clips feed", () => {
  it("renders at most three DOM slots (true virtualization, not just videos)", () => {
    render(
      <VirtualClipsFeed clips={makeClips(20)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    // At activeIndex 0 only slots 0 and 1 exist in the DOM; 18 others are not rendered.
    expect(slots()).toHaveLength(2);
    expect(document.querySelectorAll("video")).toHaveLength(2);
    // The unrendered rows are held by a bottom spacer, not by hidden cards.
    expect(screen.getByTestId("clips-spacer-bottom")).toBeInTheDocument();
    expect(screen.queryByTestId("clips-spacer-top")).not.toBeInTheDocument();
  });

  it("keeps the DOM window to three slots after a far jump, with both spacers", () => {
    render(
      <VirtualClipsFeed clips={makeClips(20)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    // Jump far down to row 10.
    scrollTo(ROW * 10);
    expect(slots()).toHaveLength(3);
    expect(document.querySelectorAll("video")).toHaveLength(3);
    expect(screen.getByTestId("clip-slot-10")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("clips-spacer-top")).toBeInTheDocument();
    expect(screen.getByTestId("clips-spacer-bottom")).toBeInTheDocument();
  });

  it("grants preload=metadata to the active and next-1 cards only", () => {
    render(
      <VirtualClipsFeed clips={makeClips(20)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    scrollTo(ROW * 5);
    const videos = Array.from(document.querySelectorAll("video"));
    // Window is [4,5,6]; active=5, next-1=6 get metadata; the prev card (4) does not.
    const bySlot = (i: number) =>
      screen.getByTestId(`clip-slot-${i}`).querySelector("video")!;
    expect(bySlot(4)).toHaveAttribute("preload", "none");
    expect(bySlot(5)).toHaveAttribute("preload", "metadata");
    expect(bySlot(6)).toHaveAttribute("preload", "metadata");
    // The previous card must not carry a source at all.
    expect(bySlot(4)).not.toHaveAttribute("src");
    expect(videos.length).toBeLessThanOrEqual(3);
  });

  it("marks exactly one card active — a manual native play cannot create two players", () => {
    render(
      <VirtualClipsFeed clips={makeClips(20)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    scrollTo(ROW * 5);
    const activeCount = () =>
      Array.from(document.querySelectorAll("[data-testid^='clip-slot-']"))
        .filter((s) => s.getAttribute("data-active") === "true").length;
    expect(activeCount()).toBe(1);

    // Manually play the previous (non-active) card: LazyClipVideo pauses it back.
    const prevVideo = screen.getByTestId("clip-slot-4").querySelector("video")!;
    const pauseSpy = vi.spyOn(prevVideo, "pause");
    act(() => { prevVideo.dispatchEvent(new Event("play")); });
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("pauses the active video when the document becomes hidden", () => {
    render(
      <VirtualClipsFeed clips={makeClips(6)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    const activeVideo = screen.getByTestId("clip-slot-0").querySelector("video")!;
    // Make it active + visible so it is the playing element.
    const visObserver = observers.find((o) => o.observe.mock.calls.some((c) => c[0] === activeVideo));
    act(() => visObserver?.emit(activeVideo, true, 1));
    const pauseSpy = vi.spyOn(activeVideo, "pause");
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(pauseSpy).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("clamps the active index when the tail clip is deleted", () => {
    const { rerender } = render(
      <VirtualClipsFeed clips={makeClips(6)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    scrollTo(ROW * 5); // active = last index 5
    expect(screen.getByTestId("clip-slot-5")).toHaveAttribute("data-active", "true");
    // Shrink the list (a delete): the active index clamps to the new last row.
    rerender(
      <VirtualClipsFeed clips={makeClips(4)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    expect(screen.queryByTestId("clip-slot-5")).not.toBeInTheDocument();
    expect(screen.getByTestId("clip-slot-3")).toHaveAttribute("data-active", "true");
    expect(slots().length).toBeLessThanOrEqual(3);
  });

  it("sizes each row to the remaining visible viewport height so the active card fits", () => {
    // Container top offset of 200 below a 640 viewport leaves 440 visible.
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640, writable: true });
    render(
      <VirtualClipsFeed clips={makeClips(6)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    const feed = screen.getByTestId("clips-virtual-feed");
    Object.defineProperty(feed, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 200, bottom: 640, left: 0, right: 0, width: 0, height: 440, x: 0, y: 200, toJSON() {} }),
    });
    act(() => { fireEvent(window, new Event("resize")); });
    // Row + feed collapse to the remaining 440px, not a hardcoded calc height.
    expect(screen.getByTestId("clip-slot-0")).toHaveStyle({ height: "440px" });
    expect(feed).toHaveStyle({ height: "440px" });
  });

  it("never shrinks a row below the usable minimum when the top offset eats the viewport", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300, writable: true });
    render(
      <VirtualClipsFeed clips={makeClips(3)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    const feed = screen.getByTestId("clips-virtual-feed");
    Object.defineProperty(feed, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 290, bottom: 300, left: 0, right: 0, width: 0, height: 10, x: 0, y: 290, toJSON() {} }),
    });
    act(() => { fireEvent(window, new Event("resize")); });
    // 300 - 290 = 10px would be unusable; the row is clamped to the 160px floor.
    expect(feed).toHaveStyle({ height: "160px" });
  });

  it("offers a native download anchor on rendered cards with a localized aria label", () => {
    render(
      <VirtualClipsFeed clips={makeClips(6)} currentUserId={1} hasMore={false}
        loadingMore={false} error={false} onLoadMore={noop} onUpdated={noop} onDeleted={noop} />,
    );
    const anchors = screen.getAllByTestId("clip-download");
    // Only the rendered window (current +/- 1) carries anchors — here 2 at index 0.
    expect(anchors).toHaveLength(2);
    const anchor = anchors[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute("download");
    expect(anchor).toHaveAttribute("href", "/api/clips/stream/100?download=1");
    // Default context language is Arabic.
    expect(anchor).toHaveAttribute("aria-label", "تنزيل الفيديو");
  });

  it("auto-fetches near the tail and shows a retry control on error", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <VirtualClipsFeed clips={makeClips(5)} currentUserId={1} hasMore
        loadingMore={false} error={false} onLoadMore={onLoadMore} onUpdated={noop} onDeleted={noop} />,
    );
    onLoadMore.mockClear();
    scrollTo(ROW * 3); // active index 3 of 5, margin 2 -> triggers
    expect(onLoadMore).toHaveBeenCalled();

    rerender(
      <VirtualClipsFeed clips={makeClips(5)} currentUserId={1} hasMore
        loadingMore={false} error onLoadMore={onLoadMore} onUpdated={noop} onDeleted={noop} />,
    );
    const retry = screen.getByTestId("clips-load-more");
    onLoadMore.mockClear();
    fireEvent.click(retry);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
