import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload, uploadPrepared, prepare, duration } = vi.hoisted(() => ({
  upload: vi.fn(),
  uploadPrepared: vi.fn(),
  prepare: vi.fn(),
  duration: vi.fn(),
}));

vi.mock("./components/clips/clipUpload", () => ({
  uploadClip: upload,
  uploadPreparedClip: uploadPrepared,
  MAX_CLIP_BYTES: 2 * 1024 * 1024 * 1024,
}));
vi.mock("./components/clips/readClipDuration", () => ({ readClipDuration: duration }));
vi.mock("./components/clips/prepareVideo", () => ({
  prepareClipForUpload: prepare,
  VideoPreparationUnsupportedError: class extends Error {},
  browserCompressionUnavailableReason: (file: File) =>
    file.type.startsWith("video/") && file.size <= 512 * 1024 * 1024 ? null : "غير مدعوم",
}));

const input = () => document.getElementById("file") as HTMLInputElement;
const submit = () => document.getElementById("submit") as HTMLButtonElement;
const compress = () => document.getElementById("compress") as HTMLInputElement;
const displayName = () => document.getElementById("display-name") as HTMLInputElement;
const form = () => document.getElementById("upload") as HTMLFormElement;
const text = (id: string) => document.getElementById(id)!.textContent;

function media(name: string, type: string, size: number) {
  const file = new File(["media"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
function select(file: File) {
  Object.defineProperty(input(), "files", { configurable: true, value: [file] });
  input().dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(async () => {
  vi.resetModules();
  upload.mockReset();
  uploadPrepared.mockReset();
  prepare.mockReset();
  duration.mockReset().mockResolvedValue(120);
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

describe("optional compress-before-upload", () => {
  it("describes compression as optional ffmpeg.wasm work, not realtime", () => {
    expect(text("compress-note")).toContain("ffmpeg.wasm");
    expect(text("compress-note")).toContain("اختياري");
    expect(text("compress-note")).not.toContain("بالوقت الحقيقي");
  });

  it("defaults OFF and uploads the original file when unchecked", async () => {
    upload.mockResolvedValueOnce({ name: "clip", code: "HELX-000001" });
    const file = media("v.mp4", "video/mp4", 10 * 1024 * 1024);
    select(file);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(compress().checked).toBe(false);
    await vi.waitFor(() => expect(compress().disabled).toBe(false));
    form().requestSubmit();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0][0]).toBe(file);
    expect(prepare).not.toHaveBeenCalled();
    expect(uploadPrepared).not.toHaveBeenCalled();
  });

  it("compresses then uploads the prepared file when checked", async () => {
    const prepared = { originalFile: null, uploadFile: media("v-480p.webm", "video/webm", 2 * 1024 * 1024), compressed: true, sourceDuration: 120, outputDuration: 120, width: 480, height: 270 };
    prepare.mockResolvedValueOnce(prepared);
    uploadPrepared.mockResolvedValueOnce({ name: "clip", code: "HELX-000002" });
    const file = media("v.mp4", "video/mp4", 10 * 1024 * 1024);
    select(file);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    await vi.waitFor(() => expect(compress().disabled).toBe(false));
    displayName().value = "فيديو مضغوط";
    displayName().dispatchEvent(new Event("input", { bubbles: true }));
    compress().checked = true;
    form().requestSubmit();
    await vi.waitFor(() => expect(uploadPrepared).toHaveBeenCalledOnce());
    expect(prepare.mock.calls[0][0]).toBe(file);
    expect(uploadPrepared.mock.calls[0][0]).toMatchObject({
      uploadFile: prepared.uploadFile,
      outputDuration: 120,
      title: "فيديو مضغوط",
      originalFilename: "v.mp4",
    });
    expect(upload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(text("receipt")).toContain("HELX-000002"));
  });

  it("surfaces a compression failure and never silently uploads the original", async () => {
    prepare.mockRejectedValueOnce(new Error("codec unsupported"));
    const file = media("v.mp4", "video/mp4", 10 * 1024 * 1024);
    select(file);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    await vi.waitFor(() => expect(compress().disabled).toBe(false));
    compress().checked = true;
    form().requestSubmit();
    await vi.waitFor(() => expect(text("upload-error")).toContain("codec unsupported"));
    expect(text("upload-error")).toContain("أزل خيار الضغط");
    expect(upload).not.toHaveBeenCalled();
    expect(uploadPrepared).not.toHaveBeenCalled();
    // Selection + checkbox preserved so the user can uncheck and upload original.
    expect(input().files?.[0]).toBe(file);
    expect(compress().checked).toBe(true);
    await vi.waitFor(() => expect(compress().disabled).toBe(false));
  });

  it("hides the compress control for audio (always uncompressed)", async () => {
    duration.mockResolvedValueOnce(120);
    select(media("a.mp3", "audio/mpeg", 1024));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect((document.getElementById("compress-row") as HTMLDivElement).hidden).toBe(true);
    expect(compress().disabled).toBe(true);
  });
});
