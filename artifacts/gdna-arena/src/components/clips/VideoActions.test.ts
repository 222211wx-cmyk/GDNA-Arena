import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/dom";
import { mountVideoActions, type VideoActionState } from "./VideoActions";

const state: VideoActionState = {
  id: 42,
  code: "HELX-123456",
  title: "Original title",
  author: { id: 7, username: "producer" },
  isOwner: true,
  liked: false,
  likeCount: 4,
  commentCount: 0,
};

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '<h1 id="title">Original title</h1><video></video><div id="actions"></div>';
});

describe("VideoActions", () => {
  it("persists a heart and reflects the returned count", async () => {
    const fetchMock = vi.fn(async () => Response.json({ liked: true, likeCount: 5 }));
    vi.stubGlobal("fetch", fetchMock);
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      initial: { ...state },
    });
    fireEvent.click(document.querySelector('[aria-label="Like"]')!);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Unlike"]')?.textContent).toContain("5"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/clips/42/like"), expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
  });

  it("persists a device-only save via the bookmark rail button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      accountId: 7,
      initial: { ...state },
    });
    const save = document.querySelector('[aria-label="Save on this device"]') as HTMLButtonElement;
    expect(save.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(save);
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Saved on this device"]')?.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(window.localStorage.getItem("gdna-arena.saved-clips.7")).toContain("42");
  });

  it("renders the author as a real profile link, plus title and audio label", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      contentType: "audio/mpeg",
      initial: { ...state },
    });
    const link = document.querySelector(".clip-meta-author-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("@producer");
    expect(link.getAttribute("href")).toContain("citizen/producer");
    expect(document.querySelector(".clip-meta-title")?.textContent).toBe("Original title");
    expect(document.querySelector(".clip-meta-audio")?.textContent).toBe("Original audio");
  });

  it("exposes secondary actions inside the three-dot menu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      accountId: 7,
      initial: { ...state },
    });
    const more = document.querySelector('[aria-label="More actions"]') as HTMLButtonElement;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="menu"]')?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[aria-label="Copy link"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Fullscreen"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Zoom"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Edit title"]')).not.toBeNull();
  });

  it("shows owner title editing and persists the returned title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ clip: { title: "Saved title" } })));
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      initial: { ...state },
    });
    fireEvent.click(document.querySelector('[aria-label="Edit title"]')!);
    const input = document.querySelector('[aria-label="Clip title"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Saved title" } });
    fireEvent.submit(input.closest("form")!);
    await vi.waitFor(() => expect(document.getElementById("title")?.textContent).toBe("Saved title"));
  });

  it("exposes a selectable URL when clipboard paths are blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new DOMException("Blocked", "NotAllowedError"); }) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    await mountVideoActions({
      host: document.getElementById("actions")!,
      media: document.querySelector("video")!,
      titleElement: document.getElementById("title")!,
      clipId: 42,
      initial: { ...state },
    });
    fireEvent.click(document.querySelector('[aria-label="Copy link"]')!);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Share link"]')).not.toBeNull());
    expect((document.querySelector('[aria-label="Share link"]') as HTMLInputElement).value).toContain("/clip/HELX-123456");
    expect(document.querySelector(".action-status")?.textContent).not.toContain("Link copied");
  });
});