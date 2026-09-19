import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload, duration } = vi.hoisted(() => ({ upload: vi.fn(), duration: vi.fn() }));
vi.mock("./components/clips/clipUpload", () => ({
  uploadClip: upload,
  MAX_CLIP_BYTES: 10 * 1024 * 1024 * 1024,
}));
vi.mock("./components/clips/readClipDuration", () => ({ readClipDuration: duration }));
const input = () => document.getElementById("file") as HTMLInputElement;
const submit = () => document.getElementById("submit") as HTMLButtonElement;
const chooser = () => document.getElementById("choose-file") as HTMLButtonElement;
const displayName = () => document.getElementById("display-name") as HTMLInputElement;
const form = () => document.getElementById("upload") as HTMLFormElement;
const text = (id: string) => document.getElementById(id)!.textContent;
function select(file?: File) {
  Object.defineProperty(input(), "files", { configurable: true, value: file ? [file] : [] });
  input().dispatchEvent(new Event("change", { bubbles: true }));
}
function media(name: string, type: string, size: number) {
  const file = new File(["media"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
const receipt = { id: 1, code: "HELX-123456", name: "voice", duration: 61, url: "/api/clips/stream/1" };

beforeEach(async () => {
  vi.resetModules();
  upload.mockReset();
  duration.mockReset().mockResolvedValue(61);
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ clips: [] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  })));
  await import("./clip-entry");
  await vi.waitFor(() => expect(form().hidden).toBe(false));
});
afterEach(() => {
  document.head.querySelectorAll("style").forEach(style => style.remove());
  vi.unstubAllGlobals();
});

describe("final simple Clip selection", () => {
  it("shows an older processing receipt without wiping an unrelated new selection", async () => {
    const file = media("second.mp4", "video/mp4", 1024);
    select(file);
    await vi.waitFor(() => expect(text("duration-status")).toContain(":"));
    displayName().value = "Second custom title";
    const beforeDuration = text("duration-status");
    const { finalizePublication } = await import("./clip-entry");
    expect(finalizePublication(receipt, "older-processing-job")).toBe(false);
    expect(text("receipt")).toContain(receipt.code);
    expect(displayName().value).toBe("Second custom title");
    expect(text("duration-status")).toBe(beforeDuration);
    expect(chooser().textContent).toContain("second.mp4");
    expect(input().files?.[0]).toBe(file);
    expect(submit().disabled).toBe(false);
    upload.mockRejectedValueOnce(new Error("Keep selection"));
    form().requestSubmit();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0][0]).toBe(file);
    expect(upload.mock.calls[0][1].title).toBe("Second custom title");
  });

  it("does not clear another queued job identity when an older job finishes", async () => {
    upload.mockImplementationOnce(async (_file, _metadata, _signal, _progress, options) => {
      options.onStored({ id: "second-queued-job" });
      throw new Error("Paused");
    });
    select(media("second.mp4", "video/mp4", 1024));
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("Paused"));
    const { finalizePublication } = await import("./clip-entry");
    expect(finalizePublication(receipt, "older-processing-job")).toBe(false);
    expect(displayName().disabled).toBe(true);
    expect(chooser().textContent).toContain("second.mp4");
    // Matching completion, unlike an unrelated manual resume/poll, owns the reset.
    expect(finalizePublication(receipt, "second-queued-job")).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(displayName().value).toBe("");
  });
  it.each([
    ["recording.mp3", "audio/mpeg", 1024, 60],
    ["video.mp4", "video/mp4", 500 * 1024 * 1024, 61],
    ["selfie.mov", "video/quicktime", 2 * 1024 ** 3, 24 * 3600],
  ])("retains %s up to 2GiB and accepts duration >=60 without an upper bound", async (name, type, size, seconds) => {
    duration.mockResolvedValueOnce(seconds);
    const file = media(name, type, size);
    select(file);
    expect(chooser().textContent).toContain(`${name} — ${(size / 1024 / 1024).toFixed(2)} MB`);
    expect(submit().disabled).toBe(false);
    await vi.waitFor(() => expect(text("duration-status")).toContain(":"));
    expect(input().files?.[0]).toBe(file);
    expect(text("duration-status")).toContain(":");
    expect(text("upload-error")).toBe("");
    // Only original bytes; no encoding declarations or quality toggles.
    expect(form().querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(form().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("retains but blocks a file over the explicit 10 GiB transport maximum", async () => {
    const file = media("too-large.mp4", "video/mp4", 10 * 1024 ** 3 + 1);
    select(file);
    expect(submit().disabled).toBe(false);
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toContain("10 GiB"));
    expect(input().files?.[0]).toBe(file);
    expect(submit().disabled).toBe(false);
    expect(duration).not.toHaveBeenCalled();
  });

  it.each(["audio/mpeg", "video/mp4"])("blocks a short %s with the exact requested message", async type => {
    duration.mockResolvedValueOnce(59.99);
    select(media("short", type, 100));
    await vi.waitFor(() => expect(text("duration-status")).toContain(":"));
    expect(submit().disabled).toBe(false);
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("خاص دقيقة الفوق"));
    expect(upload).not.toHaveBeenCalled();
  });

  it("opens the native picker without submitting", () => {
    const click = vi.spyOn(input(), "click").mockImplementation(() => {});
    chooser().click();
    expect(click).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows immediate zero progress and keeps publish available while metadata is pending", () => {
    duration.mockReturnValueOnce(new Promise(() => {}));
    select(media("critical.mp4", "video/mp4", 137 * 1024 * 1024));
    expect(submit().disabled).toBe(false);
    expect((document.getElementById("progress-wrap") as HTMLDivElement).hidden).toBe(false);
    expect((document.getElementById("progress") as HTMLProgressElement).value).toBe(0);
    expect(text("upload-status")).toContain("0% — 0 من");
    expect((document.getElementById("cancel") as HTMLButtonElement).hidden).toBe(false);
  });

  it("awaits a pending duration probe after click, then starts upload", async () => {
    let resolveDuration!: (seconds: number) => void;
    duration.mockReturnValueOnce(new Promise<number>(resolve => { resolveDuration = resolve; }));
    upload.mockResolvedValueOnce(receipt);
    select(media("pending.mp4", "video/mp4", 1024));
    form().requestSubmit();
    expect(upload).not.toHaveBeenCalled();
    expect(chooser().disabled).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Téléversement 0%…");
    expect(text("upload-status")).toContain("0% — 0 من");
    resolveDuration(61);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
  });

  it("cancels the whole publish while awaiting metadata and never transitions to upload", async () => {
    let resolveDuration!: (seconds: number) => void;
    duration.mockReturnValueOnce(new Promise<number>(resolve => { resolveDuration = resolve; }));
    const file = media("cancel-pending.mp4", "video/mp4", 1024);
    select(file);
    form().requestSubmit();

    const cancel = document.getElementById("cancel") as HTMLButtonElement;
    expect(cancel.hidden).toBe(false);
    expect(chooser().disabled).toBe(true);
    cancel.click();

    await vi.waitFor(() => expect(text("upload-status")).toBe("توقف الرفع"));
    expect(upload).not.toHaveBeenCalled();
    expect(chooser().disabled).toBe(false);
    expect(submit().disabled).toBe(false);
    expect(input().files?.[0]).toBe(file);

    // Even if an uncooperative browser probe resolves after cancellation, the
    // cancelled operation must not fall through into upload.
    resolveDuration(61);
    await Promise.resolve();
    await Promise.resolve();
    expect(upload).not.toHaveBeenCalled();
    expect(input().files?.[0]).toBe(file);
  });

  it("reports real bytes, speed and percent without encoding advice", async () => {
    upload.mockImplementationOnce(async (_file, _metadata, _signal, onProgress) => {
      onProgress(25, 256 * 1024, 100 * 1024, "uploading");
      return new Promise(() => {});
    });
    select(media("slow.mp4", "video/mp4", 1024 * 1024));
    await vi.waitFor(() => expect(text("duration-status")).toContain(":"));
    form().requestSubmit();
    await vi.waitFor(() => expect(submit().textContent).toBe("Téléversement 25%…"));
    expect(text("upload-status")).toContain("25%");
    expect(text("upload-status")).toContain("100.0 KB/s");
    expect(text("upload-status")).not.toContain("compression recommandée");
  });

  it("retains the previous selection after picker cancellation", async () => {
    select(media("selfie.mp4", "video/mp4", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    displayName().value = "سيلفي ديالي";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    select();
    expect(text("selection")).toBe("✓ Fichier sélectionné");
    expect(chooser().textContent).toContain("selfie.mp4");
    expect(displayName().value).toBe("سيلفي ديالي");
    expect(submit().disabled).toBe(false);
  });

  it("reveals a labelled name, strips only media extensions, and defaults anew for another file", async () => {
    const first = media("رحلة.الصيف.MP4", "video/mp4", 1024);
    select(first);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(document.querySelector('label[for="display-name"]')?.textContent).toContain("اسم الفيشي");
    expect(displayName().value).toBe("رحلة.الصيف");

    displayName().value = "عنوان مختار";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    select(first);
    expect(displayName().value).toBe("عنوان مختار");

    select(media("notes.final", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(displayName().value).toBe("notes.final");
  });

  it("validates the trimmed Unicode display name at 120 code points", async () => {
    select(media("voice.mp3", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));

    displayName().value = "   ";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    expect(submit().disabled).toBe(false);
    form().requestSubmit();
    expect(text("display-name-error")).toContain("مطلوب");

    displayName().value = "😀".repeat(120);
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    expect(submit().disabled).toBe(false);

    displayName().value += "😀";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    expect(submit().disabled).toBe(false);
    form().requestSubmit();
    expect(text("display-name-error")).toContain("120");
  });

  it("ignores metadata from an earlier replaced selection", async () => {
    let resolveOld!: (seconds: number) => void;
    duration.mockReturnValueOnce(new Promise<number>(resolve => { resolveOld = resolve; }));
    select(media("old.mp4", "video/mp4", 1024));
    duration.mockResolvedValueOnce(59);
    select(media("new.mp3", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(text("duration-status")).toContain(":"));
    resolveOld(65);
    await Promise.resolve();
    expect(submit().disabled).toBe(false);
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("خاص دقيقة الفوق"));
    expect(text("selection")).toBe("✓ Fichier sélectionné");
    expect(chooser().textContent).toContain("new.mp3");
  });

  it("allows server verification after metadata failure without erasing the filename", async () => {
    duration.mockRejectedValueOnce(new Error("Unsupported codec"));
    upload.mockResolvedValueOnce(receipt);
    select(media("camera.mov", "video/quicktime", 1024));
    await vi.waitFor(() => expect(text("duration-status")).toContain("vérification par le serveur"));
    expect(text("upload-error")).toBe("");
    expect(submit().disabled).toBe(false);
    expect(chooser().textContent).toContain("camera.mov");
    form().requestSubmit();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0][1].durationSec).toBeNull();
  });

  it("submits only file metadata and retains the selection on failure", async () => {
    const file = media("large.mp4", "video/mp4", 2 * 1024 ** 3);
    upload.mockRejectedValueOnce(new Error("Network interrupted"));
    select(file);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    displayName().value = "  عنوان كبير  ";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("Network interrupted"));
    expect(upload.mock.calls[0][0]).toBe(file);
    expect(upload.mock.calls[0][1]).toEqual({
      title: "عنوان كبير",
      originalFilename: "large.mp4",
      contentType: "video/mp4",
      durationSec: 61,
    });
    expect(chooser().textContent).toContain("large.mp4");
    expect(displayName().value).toBe("  عنوان كبير  ");
    expect(submit().disabled).toBe(false);
  });

  it("shows the name and server-generated code only after successful publication", async () => {
    let complete!: (value: typeof receipt) => void;
    upload.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    select(media("voice.mp3", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    form().requestSubmit();
    expect(chooser().disabled).toBe(true);
    complete(receipt);
    await vi.waitFor(() => expect(text("selection")).toBe("تم نشر الملف"));
    expect(text("receipt")).toContain("HELX-123456");
    expect(text("receipt")).toContain("voice");
    expect((document.querySelector("#receipt a") as HTMLAnchorElement).getAttribute("href")).toBe("/clip/HELX-123456");
    expect(submit().disabled).toBe(true);
    expect(chooser().disabled).toBe(false);
  });
});