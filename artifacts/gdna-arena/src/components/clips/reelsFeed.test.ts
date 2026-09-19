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
  // resolveIdentity + loadPage both hit fetch; return an empty, non-degraded feed.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/auth/me")) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ clips: [], hasMore: false, degraded: false });
  }));
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
