import { afterEach, describe, expect, it, vi } from "vitest";

const tus = vi.hoisted(() => ({ instances: [] as Array<{ options: any; url: string | null }> }));
vi.mock("tus-js-client", () => ({
  Upload: class {
    url: string | null;
    options: any;
    constructor(_file: File, options: any) {
      this.options = options;
      this.url = options.uploadUrl ?? null;
      tus.instances.push(this);
    }
    start() {
      const xhr = { withCredentials: false };
      this.options.onBeforeRequest?.({ getUnderlyingObject: () => xhr });
      expect(xhr.withCredentials).toBe(true);
      this.url = "/api/clips/uploads/11111111-1111-4111-8111-111111111111";
      this.options.onUploadUrlAvailable?.();
      queueMicrotask(() => {
        this.options.onProgress?.(2_621_440, 5_242_897);
        this.options.onProgress?.(5_242_897, 5_242_897);
        this.options.onSuccess?.({});
      });
    }
    abort() { return Promise.resolve(); }
  },
}));

import {
  MAX_CLIP_BYTES,
  uploadClip,
  uploadPreparedClip,
  UPLOAD_CHUNK_BYTES,
} from "./clipUpload";

afterEach(() => {
  tus.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("tus resumable clip upload", () => {
  it("uses 5 MiB chunks, page-scoped identity, credentials, and finalizes with name/code", async () => {
    const file = new File([new Uint8Array(17)], "camera.mp4", {
      type: "video/mp4",
      lastModified: 123,
    });
    Object.defineProperty(file, "size", { value: UPLOAD_CHUNK_BYTES + 17 });
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({
        ok: true,
        clip: { id: 9, code: "HELX-123456", name: "camera", url: null },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const progress: number[] = [];

    const published = await uploadClip(file, {
      title: file.name,
      contentType: file.type,
      durationSec: 67,
    }, new AbortController().signal, value => progress.push(value));

    expect(tus.instances).toHaveLength(1);
    expect(tus.instances[0].options.chunkSize).toBe(5 * 1024 * 1024);
    expect(tus.instances[0].options.storeFingerprintForResuming).toBe(false);
    expect(tus.instances[0].options.metadata).not.toHaveProperty("purpose");
    expect(calls[0][0]).toBe("/api/clip/upload-final");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      uploadIds: ["11111111-1111-4111-8111-111111111111"],
      groupId: expect.any(String),
    });
    expect(published.code).toBe("HELX-123456");
    expect(published.name).toBe("camera");
    expect(progress.at(-1)).toBe(100);
  });

  it("rejects over 2 GiB and pre-aborted calls before tus starts", async () => {
    const tooLarge = new File(["x"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(tooLarge, "size", { value: MAX_CLIP_BYTES + 1 });
    await expect(uploadClip(
      tooLarge,
      { title: tooLarge.name, contentType: tooLarge.type, durationSec: 61 },
      new AbortController().signal,
      vi.fn(),
    )).rejects.toThrow("2GB");

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(uploadClip(
      new File(["x"], "cancelled.mp4", { type: "video/mp4" }),
      { title: "cancelled.mp4", contentType: "video/mp4", durationSec: 61 },
      controller.signal,
      vi.fn(),
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(tus.instances).toHaveLength(0);
  });

  it("uploads a verified prepared file but keeps the original name as metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      clip: { id: 10, code: "HELX-654321", name: "camera", url: null },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const originalFile = new File(["original"], "camera-original.mov", { type: "video/quicktime" });
    const uploadFile = new File(["prepared"], "camera-original-480p.webm", { type: "video/webm" });

    await uploadPreparedClip({
      originalFile,
      uploadFile,
      outputDuration: 67.2,
    }, new AbortController().signal, vi.fn());

    expect(tus.instances[0].options.metadata).toMatchObject({
      title: "camera-original.mov",
      contentType: "video/webm",
      durationSec: "67.2",
      totalSize: String(uploadFile.size),
    });
  });
});