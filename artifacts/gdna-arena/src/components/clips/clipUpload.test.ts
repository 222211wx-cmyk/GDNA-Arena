import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CLIP_BYTES,
  uploadClip,
  uploadPreparedClip,
  UPLOAD_CHUNK_BYTES,
} from "./clipUpload";

afterEach(() => vi.unstubAllGlobals());

function mockR2(receipt = {
  ok: true,
  clip: { id: 9, code: "HELX-123456", name: "camera", url: null },
}) {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push([url, init]);
    if (String(url).startsWith("https://r2.invalid/")) {
      const part = Number(new URL(String(url)).searchParams.get("part"));
      return new Response(null, { status: 200, headers: { ETag: `"etag-${part}"` } });
    }
    const body = JSON.parse(String(init?.body));
    const response = body.action === "initiate"
      ? { sessionId: "11111111-1111-4111-8111-111111111111", partSize: UPLOAD_CHUNK_BYTES, partCount: 2, state: "active" }
      : body.action === "inspect"
        ? { state: "active", parts: [] }
        : body.action === "part"
          ? { url: `https://r2.invalid/upload?part=${body.partNumber}`, partNumber: body.partNumber }
          : receipt;
    return Response.json(response);
  }));
  return calls;
}

describe("direct R2 multipart clip upload", () => {
  it("uses 5 MiB parts, sends no media through the API, and finalizes with name/code", async () => {
    const file = new File([new Uint8Array(17)], "camera.mp4", { type: "video/mp4", lastModified: 123 });
    Object.defineProperty(file, "size", { value: UPLOAD_CHUNK_BYTES + 17 });
    const calls = mockR2();
    const progress: number[] = [];

    const published = await uploadClip(file, {
      title: file.name,
      contentType: file.type,
      durationSec: 67,
    }, new AbortController().signal, value => progress.push(value));

    const apiBodies = calls
      .filter(([url]) => !String(url).startsWith("https://r2.invalid/"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(apiBodies[0]).toMatchObject({
      action: "initiate",
      filename: "camera.mp4",
      contentType: "video/mp4",
      durationSec: 67,
      size: UPLOAD_CHUNK_BYTES + 17,
      requestId: expect.any(String),
    });
    expect(apiBodies.filter(body => body.action === "part").map(body => body.partNumber).sort()).toEqual([1, 2]);
    expect(apiBodies.at(-1)).toMatchObject({
      action: "complete",
      sessionId: "11111111-1111-4111-8111-111111111111",
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ],
    });
    const puts = calls.filter(([url]) => String(url).startsWith("https://r2.invalid/"));
    expect(puts).toHaveLength(2);
    expect(puts.every(([, init]) => init?.method === "PUT")).toBe(true);
    expect(published.code).toBe("HELX-123456");
    expect(progress.at(-1)).toBe(100);
  });

  it("rejects over 2 GiB and pre-aborted calls before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads a prepared file while retaining the original filename metadata", async () => {
    const calls = mockR2({
      ok: true,
      clip: { id: 10, code: "HELX-654321", name: "camera", url: null },
    });
    const originalFile = new File(["original"], "camera-original.mov", { type: "video/quicktime" });
    const uploadFile = new File(["prepared"], "camera-original-480p.webm", { type: "video/webm" });

    await uploadPreparedClip({
      originalFile,
      uploadFile,
      outputDuration: 67.2,
    }, new AbortController().signal, vi.fn());

    const initiated = JSON.parse(String(calls[0][1]?.body));
    expect(initiated).toMatchObject({
      filename: "camera-original.mov",
      contentType: "video/webm",
      durationSec: 67.2,
      size: uploadFile.size,
    });
  });
});