import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountReels, type ReelsController } from "./reelsFeed";

// Minimal touch-event shim: jsdom has no TouchEvent, and the gesture handler
// only reads event.touches[i].clientX/Y and event.changedTouches[i].clientX/Y.
function touch(type: string, x: number, y: number): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.defineProperties(ev, {
    touches: { value: type === "touchend" ? [] : [point] },
    changedTouches: { value: [point] },
  });
  return ev;
}

/** Simulate a single-finger horizontal swipe on an element. */
function swipe(target: EventTarget, fromX: number, toX: number, y = 300) {
  target.dispatchEvent(touch("touchstart", fromX, y));
  target.dispatchEvent(touch("touchmove", toX, y));
  target.dispatchEvent(touch("touchend", toX, y));
}

let controller: ReelsController;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, "", "/clips");
  // resolveIdentity + loadPage both hit fetch; return an empty, non-degraded feed.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/auth/me")) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ clips: [], hasMore: false, degraded: false });
  }));
});

describe("critical Clips navigation", () => {
  it("does not request private inbox counts for anonymous viewers", async () => {
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector('[data-nav="profile"]')?.getAttribute("href")).toBe("/login"));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/messages/unread-count"))).toBe(false);
  });

  it("shows the authenticated inbox count using the actual count contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/auth/me")) return Response.json({ id: 7, username: "citizen" });
      if (url.includes("/messages/unread-count")) return Response.json({ count: 3 });
      return Response.json({ clips: [], notifications: [], unreadCount: 0, hasMore: false });
    }));
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector('[data-nav="inbox"]')?.getAttribute("aria-label")).toBe("Inbox, 3 unread messages"));
  });

  it("keeps Home, Clips, Search, Inbox, Profile in the persistent bottom nav", () => {
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    const labels = [...document.querySelectorAll(".reels-bottomnav .reels-nav-item > span:last-child")]
      .map(node => node.textContent);
    expect(labels).toEqual(["Accueil", "Clips", "Recherche", "Inbox", "Profil"]);
    expect(document.querySelector('[data-nav="inbox"]')?.getAttribute("href")).toBe("/messages");
    expect(document.querySelector('.reels-topbar-left a[href="/"]')).not.toBeNull();
    expect(document.querySelector(".reels-title")?.textContent).toBe("GDNA Arena");
  });

  it("honors view=grid on boot even for an empty feed", async () => {
    window.history.replaceState(null, "", "/clips?view=grid");
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="reels-grid"]')).not.toBeNull());
  });
});

afterEach(() => {
  controller?.destroy();
  vi.unstubAllGlobals();
});

describe("Reels tools panel — close gesture from within the panel", () => {
  it("closes the open tools panel on a right-swipe that STARTS on the panel", async () => {
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    const shell = document.querySelector<HTMLElement>('[data-testid="reels-shell"]')!;
    const panel = document.querySelector<HTMLElement>(".reels-tools-panel")!;

    // Open the tools via the hamburger (setTools(true)).
    document.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click();
    expect(shell.dataset.tools).toBe("open");

    // A right-swipe originating on the PANEL (a sibling of the track) must reach
    // the shared handler and close it — the regression this fixes.
    swipe(panel, 60, 200);
    expect(shell.dataset.tools).toBe("closed");
  });

  it("does not close the panel from a swipe that starts on a text input (editing preserved)", async () => {
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    const shell = document.querySelector<HTMLElement>('[data-testid="reels-shell"]')!;
    const panel = document.querySelector<HTMLElement>(".reels-tools-panel")!;

    document.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click();
    expect(shell.dataset.tools).toBe("open");

    // Simulate a horizontal drag that begins inside a text field (e.g. the owner
    // title editor / caret selection): it must be ignored, not treated as close.
    const input = document.createElement("input");
    panel.appendChild(input);
    swipe(input, 60, 200);
    expect(shell.dataset.tools).toBe("open");
  });

  it("ignores a vertical drag on the panel (no feed navigation, panel scroll preserved)", async () => {
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    const shell = document.querySelector<HTMLElement>('[data-testid="reels-shell"]')!;
    const panel = document.querySelector<HTMLElement>(".reels-tools-panel")!;

    document.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click();
    expect(shell.dataset.tools).toBe("open");

    // A vertical drag must not close the panel nor navigate the feed.
    panel.dispatchEvent(touch("touchstart", 100, 100));
    panel.dispatchEvent(touch("touchmove", 100, 260));
    panel.dispatchEvent(touch("touchend", 100, 260));
    expect(shell.dataset.tools).toBe("open");
  });
});

const feedClip = (id: number) => ({
  id,
  user_id: 7,
  username: "producer",
  title: `Clip ${id}`,
  video_url: `https://storage.example/${id}.mp4`,
  thumb: null,
  author: { id: 7, username: "producer", avatarUrl: null },
  saveCount: 0,
  shareCount: 0,
  saved: false,
});

describe("Reels natural-end progression", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(async () => {}),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("advances once to the next ordered post and never enables looping", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return Response.json({}, { status: 401 });
      if (url.includes("/api/clips/feed")) {
        return Response.json({ clips: [feedClip(2), feedClip(1)], hasMore: false, nextBefore: null });
      }
      return Response.json({ engagement: {
        liked: false, likeCount: 0, commentCount: 0, saved: false, saveCount: 0, shareCount: 0,
      } });
    }));
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelectorAll("video")).toHaveLength(1));
    const first = document.querySelector("video") as HTMLVideoElement;
    expect(first.loop).toBe(false);
    first.dispatchEvent(new Event("play"));
    expect(document.querySelector(".reels-play")?.getAttribute("aria-label")).toBe("Pause");

    first.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(document.querySelectorAll("video")).toHaveLength(2));
    const secondSlide = document.querySelector<HTMLElement>('[data-clip-id="1"]')!;
    expect(secondSlide.scrollIntoView).toHaveBeenCalledOnce();
    expect((secondSlide.querySelector("video") as HTMLVideoElement).loop).toBe(false);

    // A stale duplicate ended notification cannot skip or advance twice.
    first.dispatchEvent(new Event("ended"));
    expect(secondSlide.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("leaves the genuine final item stopped and keeps play/pause visible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return Response.json({}, { status: 401 });
      if (url.includes("/api/clips/feed")) {
        return Response.json({ clips: [feedClip(9)], hasMore: false, nextBefore: null });
      }
      return Response.json({ engagement: {
        liked: false, likeCount: 0, commentCount: 0, saved: false, saveCount: 0, shareCount: 0,
      } });
    }));
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    document.querySelector("video")!.dispatchEvent(new Event("ended"));
    await Promise.resolve();

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    const control = document.querySelector<HTMLButtonElement>(".reels-play")!;
    expect(control.getAttribute("aria-label")).toBe("Lecture");
    expect(control.isConnected).toBe(true);
  });

  it("does not advance after pagination if the citizen pauses the feed while waiting", async () => {
    let releasePage!: () => void;
    const pageGate = new Promise<void>(resolve => { releasePage = resolve; });
    let feedCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return Response.json({}, { status: 401 });
      if (url.includes("/api/clips/feed")) {
        feedCalls++;
        if (feedCalls === 1) {
          return Response.json({ clips: [feedClip(2)], hasMore: true, nextBefore: 2 });
        }
        await pageGate;
        return Response.json({ clips: [feedClip(1)], hasMore: false, nextBefore: null });
      }
      return Response.json({ engagement: {
        liked: false, likeCount: 0, commentCount: 0, saved: false, saveCount: 0, shareCount: 0,
      } });
    }));
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const first = document.querySelector("video")!;
    first.dispatchEvent(new Event("ended"));
    first.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(feedCalls).toBe(2));
    controller.pause();
    releasePage();
    await vi.waitFor(() => expect(document.querySelectorAll("video")).toHaveLength(1));

    expect(feedCalls).toBe(2);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores a late page when search covers the feed during the end race", async () => {
    let releasePage!: () => void;
    const pageGate = new Promise<void>(resolve => { releasePage = resolve; });
    let feedCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return Response.json({}, { status: 401 });
      if (url.includes("/api/clips/feed")) {
        feedCalls++;
        if (feedCalls === 1) {
          return Response.json({ clips: [feedClip(2)], hasMore: true, nextBefore: 2 });
        }
        await pageGate;
        return Response.json({ clips: [feedClip(1)], hasMore: false, nextBefore: null });
      }
      return Response.json({ engagement: {
        liked: false, likeCount: 0, commentCount: 0, saved: false, saveCount: 0, shareCount: 0,
      } });
    }));
    controller = mountReels(document.getElementById("root")!, { onOpenComposer: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    document.querySelector("video")!.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(feedCalls).toBe(2));
    document.querySelector<HTMLButtonElement>('[aria-label="Rechercher"]')!.click();
    releasePage();
    await vi.waitFor(() => expect(document.querySelectorAll("video")).toHaveLength(1));

    expect(document.querySelector('[data-testid="reels-search"]')).not.toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
