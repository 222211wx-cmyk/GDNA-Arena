import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyClipVideo } from "./LazyClipVideo";

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

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", Observer);
  setVisibility("visible");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("lazy clip media", () => {
  it("attaches no source and downloads nothing when the parent grants no metadata", () => {
    const { container } = render(<LazyClipVideo src="/clip.mp4" poster="/thumb.jpg" preload="none" muted />);
    const video = container.querySelector("video")!;
    expect(video).not.toHaveAttribute("src");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/thumb.jpg");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video.muted).toBe(true);
  });

  it("attaches the source (and prefetches) as soon as the parent grants metadata", () => {
    const { container, rerender } = render(<LazyClipVideo src="/clip.mp4" preload="none" />);
    expect(container.querySelector("video")).not.toHaveAttribute("src");
    rerender(<LazyClipVideo src="/clip.mp4" preload="metadata" />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("src", "/clip.mp4");
  });

  it("plays the active card at >= 80% visibility and pauses it below that", () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    let paused = true;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => { paused = false; return play(); });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; pause(); });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => paused });

    const { container } = render(<LazyClipVideo src="/clip.mp4" active preload="metadata" />);
    const video = container.querySelector("video")!;
    // observers[0] is the visibility observer.
    act(() => observers[0].emit(video, true, 0.5)); // below threshold — no play
    expect(play).not.toHaveBeenCalled();
    act(() => observers[0].emit(video, true, 0.9)); // active + >= 0.8 — plays
    expect(play).toHaveBeenCalledTimes(1);
    act(() => observers[0].emit(video, true, 0.4)); // scrolled below — pauses
    expect(pause).toHaveBeenCalled();
  });

  it("does not play a non-active card even when fully visible", () => {
    const play = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => true });

    const { container } = render(<LazyClipVideo src="/clip.mp4" active={false} preload="metadata" />);
    const video = container.querySelector("video")!;
    act(() => observers[0].emit(video, true, 1));
    expect(play).not.toHaveBeenCalled();
  });

  it("rejects a manual native play on a non-active card, pausing it straight back", () => {
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });

    const onPlaybackStarted = vi.fn();
    const { container } = render(
      <LazyClipVideo src="/clip.mp4" active={false} preload="metadata" onPlaybackStarted={onPlaybackStarted} />,
    );
    const video = container.querySelector("video")!;
    act(() => { video.dispatchEvent(new Event("play")); });
    expect(pause).toHaveBeenCalled();
    // A rejected manual play must never count a view.
    expect(onPlaybackStarted).not.toHaveBeenCalled();
  });

  it("enforces a single player: a new play pauses the previous element", () => {
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      paused.set(this, false);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      paused.set(this, true);
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get(this: HTMLMediaElement) {
        return paused.get(this) ?? false;
      },
    });

    const first = render(<LazyClipVideo src="/a.mp4" active preload="metadata" />);
    const videoA = first.container.querySelector("video")!;
    act(() => observers[0].emit(videoA, true, 1)); // A becomes active+visible
    act(() => { videoA.dispatchEvent(new Event("play")); }); // A claims playback
    paused.set(videoA, false);

    const second = render(<LazyClipVideo src="/b.mp4" active preload="metadata" />);
    const videoB = second.container.querySelector("video")!;
    act(() => observers[observers.length - 1].emit(videoB, true, 1)); // B active+visible
    act(() => { videoB.dispatchEvent(new Event("play")); }); // B claims — pauses A
    expect(paused.get(videoA)).toBe(true);
  });

  it("pauses when the document becomes hidden", () => {
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });

    const { container } = render(<LazyClipVideo src="/clip.mp4" active preload="metadata" />);
    const video = container.querySelector("video")!;
    act(() => observers[0].emit(video, true, 1));
    pause.mockClear();
    act(() => setVisibility("hidden"));
    expect(pause).toHaveBeenCalled();
    void video;
  });

  it("pauses on unmount", () => {
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });

    const { unmount } = render(<LazyClipVideo src="/clip.mp4" active preload="metadata" />);
    pause.mockClear();
    unmount();
    expect(pause).toHaveBeenCalled();
  });

  it("reports the first real playback for a truthful view count, exactly once", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });
    const onPlaybackStarted = vi.fn();
    const { container } = render(<LazyClipVideo src="/clip.mp4" active preload="metadata" onPlaybackStarted={onPlaybackStarted} />);
    const video = container.querySelector("video")!;
    act(() => observers[0].emit(video, true, 1)); // active + visible so play is accepted
    act(() => { video.dispatchEvent(new Event("play")); });
    act(() => { video.dispatchEvent(new Event("play")); });
    expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
  });

  it("guards a late-resolving play promise, pausing if no longer active by then", async () => {
    let resolvePlay!: () => void;
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>((r) => { resolvePlay = r; }));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });

    const { container, rerender } = render(<LazyClipVideo src="/clip.mp4" active preload="metadata" />);
    const video = container.querySelector("video")!;
    act(() => observers[0].emit(video, true, 1)); // starts play() (pending)
    // The card is no longer active before the play promise resolves.
    rerender(<LazyClipVideo src="/clip.mp4" active={false} preload="metadata" />);
    pause.mockClear();
    await act(async () => { resolvePlay(); await Promise.resolve(); });
    expect(pause).toHaveBeenCalled();
  });
});
