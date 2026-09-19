import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.head.querySelectorAll("style").forEach(style => style.remove());
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const clipBody = () => ({
  clip: {
    id: 42, code: "HELX-123456", name: "My song", originalName: "song.mp3",
    duration: 61, size: 100, created_at: new Date().toISOString(),
    contentType: "audio/mpeg", processingStatus: "ready",
    url: "https://storage.example/song.mp3",
    author: { id: 7, username: "producer" },
    isOwner: false, liked: false, likeCount: 4, commentCount: 2,
  },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("clip player identity + bookmark scope", () => {
  it("scopes the save to the account only after a delayed identity resolves", async () => {
    let releaseIdentity!: () => void;
    const gate = new Promise<void>(resolve => { releaseIdentity = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        await gate; // identity settles AFTER the clip renders
        return json({ id: 7, username: "producer" });
      }
      return json(clipBody());
    }));
    const { renderClipPlayer } = await import("./clip-player-entry");
    renderClipPlayer("HELX-123456");
    // Media can render immediately; actions must wait for identity.
    await vi.waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    expect(document.querySelector('[aria-label^="Save"]')).toBeNull();
    releaseIdentity();
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Save on this device"]')).not.toBeNull());
    (document.querySelector('[aria-label="Save on this device"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(window.localStorage.getItem("gdna-arena.saved-clips.7")).toContain("42"));
    // Never written to the anonymous bucket.
    expect(window.localStorage.getItem("gdna-arena.saved-clips.anon")).toBeNull();
  });

  it("disables bookmark (no anonymous write) when identity lookup fails with a non-401", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return json({ error: "boom" }, 500);
      return json(clipBody());
    }));
    const { renderClipPlayer } = await import("./clip-player-entry");
    renderClipPlayer("HELX-123456");
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Saving unavailable — sign-in status unknown"]')).not.toBeNull());
    const button = document.querySelector('[aria-label="Saving unavailable — sign-in status unknown"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(window.localStorage.getItem("gdna-arena.saved-clips.anon")).toBeNull();
  });

  it("scopes to the anonymous bucket only when identity is a confirmed 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return json({ error: "unauthorized" }, 401);
      return json(clipBody());
    }));
    const { renderClipPlayer } = await import("./clip-player-entry");
    renderClipPlayer("HELX-123456");
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Save on this device"]')).not.toBeNull());
    (document.querySelector('[aria-label="Save on this device"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(window.localStorage.getItem("gdna-arena.saved-clips.anon")).toContain("42"));
  });
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