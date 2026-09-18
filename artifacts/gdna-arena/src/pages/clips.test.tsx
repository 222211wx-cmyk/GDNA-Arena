import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClipsPage from "./clips";
import { SimpleClipUpload } from "@/components/clips/SimpleClipUpload";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("wouter", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("minimal Clips page", () => {
  it.each([null, {}, { clips: null }, { clips: [null, {}, { id: 1, video_url: null }] }])(
    "opens safely with malformed feed %j", async body => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
      const { container } = render(<ClipsPage />);
      await act(async () => {});
      expect(screen.getByText("لا يوجد كليبز - كن أول من ينشر")).toBeTruthy();
      expect(container.querySelector("video")).toBeNull();
    },
  );
  it("keeps the empty page on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ClipsPage />);
    await act(async () => {});
    expect(screen.getByText("لا يوجد كليبز - كن أول من ينشر")).toBeTruthy();
  });
  it("renders five native video controls without autoplay or virtualization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clips: Array.from({ length: 8 }, (_, n) => ({ id: n + 1, video_url: `/api/clips/stream/${n + 1}` })),
    }) }));
    const { container } = render(<ClipsPage />);
    await waitFor(() => expect(container.querySelectorAll("video")).toHaveLength(5));
    const video = container.querySelector("video")!;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute("src")).toBe("/api/clips/stream/1");
  });
  it("renders audio controls and download links for both media types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clips: [
        { id: 1, video_url: "/api/clips/stream/1", content_type: "audio/mpeg", title: "الصوت" },
        { id: 2, video_url: "/api/clips/stream/2", content_type: "video/mp4", title: "الفيديو" },
      ],
    }) }));
    const { container } = render(<ClipsPage />);
    await waitFor(() => expect(container.querySelectorAll("audio")).toHaveLength(1));
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "تنزيل الصوت" }).getAttribute("href")).toBe("/api/clips/stream/1?download=1");
    expect(screen.getByRole("link", { name: "تنزيل الفيديو" }).getAttribute("href")).toBe("/api/clips/stream/2?download=1");
    fireEvent.error(container.querySelector("audio")!);
    expect(screen.getByRole("alert").textContent).toContain("يمكنك تنزيله");
  });
});

class UploadRequest {
  static latest: UploadRequest;
  upload = { onprogress: null as ((event: object) => void) | null, onload: null as (() => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = '{"ok":true,"url":"/api/clips/stream/1"}';
  timeout = 0;
  withCredentials = false;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  constructor() { UploadRequest.latest = this; }
}

describe("direct Clips upload", () => {
  it("rejects files over 20 MB before uploading", () => {
    const file = new File(["x"], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 });
    const { container } = render(<SimpleClipUpload onPublished={vi.fn()} />);
    fireEvent.change(container.querySelector("input")!, { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toBe("صغر الفيديو");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
  it("sends original multipart bytes, reports progress, and reaches 100 only after publication", () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const published = vi.fn();
    const file = new File(["original"], "small.mp4", { type: "video/mp4" });
    const { container } = render(<SimpleClipUpload onPublished={published} />);
    fireEvent.change(container.querySelector("input")!, { target: { files: [file] } });
    fireEvent.submit(container.querySelector("form")!);
    const xhr = UploadRequest.latest;
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/clip/upload");
    expect(xhr.timeout).toBe(300_000);
    expect((xhr.send.mock.calls[0][0] as FormData).get("file")).toBe(file);
    act(() => xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 }));
    expect(screen.getByRole("status").textContent).toContain("50%");
    act(() => { xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 }); xhr.upload.onload?.(); });
    expect(screen.getByRole("status").textContent).toContain("جارٍ حفظ الملف");
    expect(published).not.toHaveBeenCalled();
    act(() => xhr.onload?.());
    expect(screen.getByRole("status").textContent).toContain("100%");
    expect(published).toHaveBeenCalledOnce();
  });
  it("shows API errors without reporting success and permits retry", () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const published = vi.fn();
    const { container } = render(<SimpleClipUpload onPublished={published} />);
    fireEvent.change(container.querySelector("input")!, { target: { files: [new File(["x"], "small.mp4")] } });
    fireEvent.submit(container.querySelector("form")!);
    const xhr = UploadRequest.latest;
    xhr.status = 413;
    xhr.responseText = '{"error":"صغر الفيديو"}';
    act(() => xhr.onload?.());
    expect(screen.getByRole("alert").textContent).toBe("صغر الفيديو");
    expect(published).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
  it("uploads original audio without conversion", () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const file = new File(["audio"], "recording.mp3", { type: "audio/mpeg" });
    const { container } = render(<SimpleClipUpload onPublished={vi.fn()} />);
    fireEvent.change(container.querySelector("input")!, { target: { files: [file] } });
    fireEvent.submit(container.querySelector("form")!);
    expect((UploadRequest.latest.send.mock.calls[0][0] as FormData).get("file")).toBe(file);
    expect(container.querySelector("input")!.accept).toContain("audio/mpeg");
  });
});