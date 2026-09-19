import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload, duration } = vi.hoisted(() => ({ upload: vi.fn(), duration: vi.fn() }));
vi.mock("./components/clips/clipUpload", () => ({
  uploadClip: upload,
  uploadPreparedClip: vi.fn(),
  MAX_CLIP_BYTES: 2 * 1024 * 1024 * 1024,
}));
vi.mock("./components/clips/readClipDuration", () => ({ readClipDuration: duration }));
// Deterministically model browser-compression support in jsdom: video <=512MiB
// and <=30min is compressible; everything else reports an explicit reason.
vi.mock("./components/clips/prepareVideo", () => ({
  prepareClipForUpload: vi.fn(),
  VideoPreparationUnsupportedError: class extends Error {},
  browserCompressionUnavailableReason: (file: File, durationSeconds?: number) => {
    if (!file.type.startsWith("video/")) return "ضغط المتصفح متاح للفيديو فقط";
    if (file.size > 512 * 1024 * 1024) return "كبير جداً للضغط";
    if (durationSeconds !== undefined && durationSeconds > 30 * 60) return "طويل جداً للضغط";
    return null;
  },
}));
const input = () => document.getElementById("file") as HTMLInputElement;
const submit = () => document.getElementById("submit") as HTMLButtonElement;
const chooser = () => document.getElementById("choose-file") as HTMLButtonElement;
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
  it.each([
    ["recording.mp3", "audio/mpeg", 1024, 60],
    ["video.mp4", "video/mp4", 500 * 1024 * 1024, 61],
    ["selfie.mov", "video/quicktime", 2 * 1024 ** 3, 24 * 3600],
  ])("retains %s up to 2GiB and accepts duration >=60 without an upper bound", async (name, type, size, seconds) => {
    duration.mockResolvedValueOnce(seconds);
    const file = media(name, type, size);
    select(file);
    expect(chooser().textContent).toContain(`${name} — ${(size / 1024 / 1024).toFixed(2)} MB`);
    expect(submit().disabled).toBe(true);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(input().files?.[0]).toBe(file);
    expect(text("duration-status")).toContain(":");
    expect(text("upload-error")).toBe("");
    // Compression is the only optional control and it is always OFF by default;
    // there are no radios and no legacy quality toggles.
    expect(form().querySelectorAll('input[type="radio"]')).toHaveLength(0);
    const checkbox = document.getElementById("compress") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const isVideo = type.startsWith("video/");
    const compressibleVideo = isVideo && size <= 512 * 1024 * 1024;
    // Audio hides the row; oversized/long video keeps it visible but disabled.
    expect((document.getElementById("compress-row") as HTMLDivElement).hidden).toBe(!isVideo);
    expect(checkbox.disabled).toBe(!compressibleVideo);
    expect(upload).not.toHaveBeenCalled();
  });

  it("retains but blocks a file over the explicit 2GB transport maximum", async () => {
    const file = media("too-large.mp4", "video/mp4", 2 * 1024 ** 3 + 1);
    select(file);
    await vi.waitFor(() => expect(text("upload-error")).toContain("2GB"));
    expect(input().files?.[0]).toBe(file);
    expect(submit().disabled).toBe(true);
    expect(duration).not.toHaveBeenCalled();
  });

  it.each(["audio/mpeg", "video/mp4"])("blocks a short %s with the exact requested message", async type => {
    duration.mockResolvedValueOnce(59.99);
    select(media("short", type, 100));
    await vi.waitFor(() => expect(text("upload-error")).toBe("خاص دقيقة الفوق"));
    expect(submit().disabled).toBe(true);
    form().requestSubmit();
    expect(upload).not.toHaveBeenCalled();
  });

  it("opens the native picker without submitting", () => {
    const click = vi.spyOn(input(), "click").mockImplementation(() => {});
    chooser().click();
    expect(click).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("retains the previous selection after picker cancellation", async () => {
    select(media("selfie.mp4", "video/mp4", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    select();
    expect(text("selection")).toBe("✓ Fichier sélectionné");
    expect(chooser().textContent).toContain("selfie.mp4");
    expect(submit().disabled).toBe(false);
  });

  it("ignores metadata from an earlier replaced selection", async () => {
    let resolveOld!: (seconds: number) => void;
    duration.mockReturnValueOnce(new Promise<number>(resolve => { resolveOld = resolve; }));
    select(media("old.mp4", "video/mp4", 1024));
    duration.mockResolvedValueOnce(59);
    select(media("new.mp3", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(text("upload-error")).toBe("خاص دقيقة الفوق"));
    resolveOld(65);
    await Promise.resolve();
    expect(submit().disabled).toBe(true);
    expect(text("selection")).toBe("✓ Fichier sélectionné");
    expect(chooser().textContent).toContain("new.mp3");
  });

  it("shows metadata failure explicitly without erasing the filename", async () => {
    duration.mockRejectedValueOnce(new Error("Unsupported codec"));
    select(media("camera.mov", "video/quicktime", 1024));
    await vi.waitFor(() => expect(text("upload-error")).toBe("Unsupported codec"));
    expect(submit().disabled).toBe(true);
    expect(chooser().textContent).toContain("camera.mov");
  });

  it("submits only file metadata and retains the selection on failure", async () => {
    const file = media("large.mp4", "video/mp4", 2 * 1024 ** 3);
    upload.mockRejectedValueOnce(new Error("Network interrupted"));
    select(file);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("Network interrupted"));
    expect(upload.mock.calls[0][0]).toBe(file);
    expect(upload.mock.calls[0][1]).toEqual({ title: "large.mp4", contentType: "video/mp4", durationSec: 61 });
    expect(chooser().textContent).toContain("large.mp4");
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