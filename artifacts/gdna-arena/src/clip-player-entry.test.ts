import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.head.querySelectorAll("style").forEach(style => style.remove());
  vi.unstubAllGlobals();
});

describe("code-based clip player", () => {
  it("loads a direct URL and uses the correct native media element", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      clip: {
        id: 42,
        code: "HELX-123456",
        name: "My song",
        originalName: "song.mp3",
        duration: 61,
        size: 100,
        created_at: new Date().toISOString(),
        contentType: "audio/mpeg",
        processingStatus: "ready",
        url: "https://storage.example/song.mp3",
        author: { id: 7, username: "producer" },
        isOwner: false,
        liked: false,
        likeCount: 4,
        commentCount: 2,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { renderClipPlayer } = await import("./clip-player-entry");
    renderClipPlayer("HELX-123456");
    await vi.waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    expect((document.querySelector("audio") as HTMLAudioElement).src).toBe("https://storage.example/song.mp3");
    expect(document.getElementById("player-name")?.textContent).toBe("My song");
    expect(document.querySelector('[aria-label="Like"]')?.textContent).toContain("4");
    expect(document.querySelector('[aria-label="Comments"]')?.textContent).toContain("2");
    expect(document.querySelector('[aria-label="Message"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Fullscreen"]')).not.toBeNull();
    expect(document.body.dataset.clipReady).toBe("true");
  });

  it("shows an actionable retry when loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "الكليب غير موجود" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    )));
    const { renderClipPlayer } = await import("./clip-player-entry");
    renderClipPlayer("HELX-654321");
    await vi.waitFor(() => expect(document.getElementById("player-error")?.textContent).toBe("الكليب غير موجود"));
    expect((document.getElementById("player-retry") as HTMLButtonElement).hidden).toBe(false);
  });
});