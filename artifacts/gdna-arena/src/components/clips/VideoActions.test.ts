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