import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("./components/clips/clipUpload", () => ({ uploadClip: upload }));

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

beforeEach(async () => {
  vi.resetModules();
  upload.mockReset();
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

describe("light Clip file selection", () => {
  it.each([
    ["recording.mp3", "audio/mpeg", 1024],
    ["video.mp4", "video/mp4", 25 * 1024 * 1024],
    ["selfie.mov", "video/quicktime", 80 * 1024 * 1024],
    ["large-audio.wav", "audio/wav", 26 * 1024 * 1024],
  ])("immediately retains %s and enables Publish at any size", (name, type, size) => {
    expect(submit().disabled).toBe(true);
    const file = media(name, type, size);
    select(file);
    expect(input().files?.[0]).toBe(file);
    expect(chooser().textContent).toContain(`${name} — ${(size / 1024 / 1024).toFixed(2)} MiB`);
    expect(text("selection")).toContain(name);
    expect(submit().disabled).toBe(false);
    expect(text("upload-error")).toBe("");
    expect(document.getElementById("size-warning")!.hidden).toBe(size <= 25 * 1024 * 1024);
    expect(upload).not.toHaveBeenCalled();
  });

  it("opens the native picker without submitting the form", () => {
    const click = vi.spyOn(input(), "click").mockImplementation(() => {});
    chooser().click();
    expect(click).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not erase the last selection when the picker is cancelled", () => {
    select(media("selfie.mp4", "video/mp4", 1024));
    select();
    expect(text("selection")).toContain("selfie.mp4");
    expect(submit().disabled).toBe(false);
  });

  it("submits a large file to the server and retains it after server rejection", async () => {
    const file = media("large.mp4", "video/mp4", 80 * 1024 * 1024);
    upload.mockRejectedValueOnce(new Error("Server size limit: 25 MiB"));
    select(file);
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toContain("Server size limit"));
    expect(upload.mock.calls[0][0]).toBe(file);
    expect(input().files?.[0]).toBe(file);
    expect(chooser().textContent).toContain("large.mp4");
    expect(submit().disabled).toBe(false);
    expect(chooser().disabled).toBe(false);
  });

  it("replaces large-file warnings and old errors when another file is selected", async () => {
    upload.mockRejectedValueOnce(new Error("Server rejection"));
    select(media("large.mp4", "video/mp4", 80 * 1024 * 1024));
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toBe("Server rejection"));
    select(media("voice.mp3", "audio/mpeg", 1024));
    expect(text("upload-error")).toBe("");
    expect(document.getElementById("size-warning")!.hidden).toBe(true);
    expect(text("size-warning")).toBe("");
    expect(chooser().textContent).toContain("voice.mp3");
    expect(submit().disabled).toBe(false);
  });

  it("clears the filename only after successful publication", async () => {
    let complete!: () => void;
    upload.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    select(media("voice.mp3", "audio/mpeg", 1024));
    form().requestSubmit();
    expect(chooser().textContent).toContain("voice.mp3");
    expect(submit().disabled).toBe(true);
    expect(chooser().disabled).toBe(true);
    complete();
    await vi.waitFor(() => expect(text("selection")).toBe("تم نشر الملف"));
    expect(chooser().textContent).toBe("اختيار ملف");
    expect(submit().disabled).toBe(true);
    expect(chooser().disabled).toBe(false);
  });
});