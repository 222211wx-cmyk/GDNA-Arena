import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyClipVideo } from "./LazyClipVideo";

const observers: Observer[] = [];
class Observer {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    observers.push(this);
  }
  emit(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("lazy clip media", () => {
  it("does not attach a source before approaching the viewport, then attaches it once", () => {
    const { container, unmount } = render(<LazyClipVideo src="/clip.mp4" poster="/thumb.jpg" muted />);
    const video = container.querySelector("video")!;
    expect(video).not.toHaveAttribute("src");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/thumb.jpg");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video.muted).toBe(true);
    expect(observers[0].options?.rootMargin).toBe("200px");
    act(() => observers[0].emit(video, false));
    expect(video).not.toHaveAttribute("src");
    act(() => observers[0].emit(video, true));
    expect(video).toHaveAttribute("src", "/clip.mp4");
    expect(observers[0].unobserve).toHaveBeenCalledWith(video);
    unmount();
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("observes a replacement source without reusing the previous video URL", () => {
    const { container, rerender } = render(<LazyClipVideo src="/first.mp4" />);
    const video = container.querySelector("video")!;
    act(() => observers[0].emit(video, true));
    rerender(<LazyClipVideo src="/second.mp4" />);
    expect(video).not.toHaveAttribute("src");
    act(() => observers[2].emit(video, true));
    expect(video).toHaveAttribute("src", "/second.mp4");
  });

  it("keeps playback available without IntersectionObserver and still disables preloading", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<LazyClipVideo src="/fallback.mp4" />);
    expect(container.querySelector("video")).toHaveAttribute("src", "/fallback.mp4");
    expect(container.querySelector("video")).toHaveAttribute("preload", "none");
  });
});