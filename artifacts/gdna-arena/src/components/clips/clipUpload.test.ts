import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CLIP_BYTES,
  uploadForeground as uploadClip,
  UPLOAD_CHUNK_BYTES,
} from "./clipUpload";

afterEach(() => vi.unstubAllGlobals());

function mockR2(receipt = {
  ok: true,
  clip: { id: 9, code: "HELX-123456", name: "camera", url: null },
}, afterXhrProgress?: () => void) {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  class MockXHR {
    status = 0;
    timeout = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    private url = "";
    open(_method: string, url: string) { this.url = url; }
    send(body: Blob) {
      calls.push([this.url, { method: "PUT", body }]);
      this.status = 200;
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: Math.max(1, Math.floor(body.size / 2)),
        total: body.size,
      } as ProgressEvent);
      afterXhrProgress?.();
      queueMicrotask(() => this.onload?.());
    }
    abort() { this.onabort?.(); }
    getResponseHeader(name: string) {
      const part = Number(new URL(this.url).searchParams.get("part"));
      return name.toLowerCase() === "etag" ? `"etag-${part}"` : null;
    }
  }
  vi.stubGlobal("XMLHttpRequest", MockXHR);
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push([url, init]);
    const body = JSON.parse(String(init?.body));
    const response = body.action === "initiate"
      ? { sessionId: "11111111-1111-4111-8111-111111111111", partSize: UPLOAD_CHUNK_BYTES, partCount: 2, state: "active" }
      : body.action === "inspect"
        ? { state: "active", parts: [] }
        : body.action === "part"
          ? { url: `https://r2.invalid/upload?part=${body.partNumber}`, partNumber: body.partNumber }
          : String(url).endsWith("api/upload/complete")
            ? receipt
            : receipt;
    return Response.json(response);
  }));
  return calls;
}

describe("direct R2 multipart clip upload", () => {
  it("uses 5 MiB parts, sends no media through the API, and finalizes with name/code", async () => {
    const file = new File([new Uint8Array(17)], "camera.mp4", { type: "video/mp4", lastModified: 123 });
    Object.defineProperty(file, "size", { value: UPLOAD_CHUNK_BYTES + 17 });
    const progress: number[] = [];
    const calls = mockR2(undefined, () => {
      expect(progress.some(value => value > 0 && value < 99)).toBe(true);
    });

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
      sessionId: "11111111-1111-4111-8111-111111111111",
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ],
    });
    expect(String(calls.filter(([url]) => !String(url).startsWith("https://r2.invalid/")).at(-1)?.[0]))
      .toContain("api/upload/complete");
    const puts = calls.filter(([url]) => String(url).startsWith("https://r2.invalid/"));
    expect(puts).toHaveLength(2);
    expect(puts.every(([, init]) => init?.method === "PUT")).toBe(true);
    expect(published.code).toBe("HELX-123456");
    expect(progress.some(value => value > 0 && value < 99)).toBe(true);
    expect(progress.at(-1)).toBe(100);
  });

  it("rejects over 10 GiB and pre-aborted calls before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tooLarge = new File(["x"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(tooLarge, "size", { value: MAX_CLIP_BYTES + 1 });
    await expect(uploadClip(
      tooLarge,
      { title: tooLarge.name, contentType: tooLarge.type, durationSec: 61 },
      new AbortController().signal,
      vi.fn(),
    )).rejects.toThrow("10 GiB");

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

  it("does not resume a session when its display metadata changes", async () => {
    const file = new File(["media"], "source.mp4", { type: "video/mp4" });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.action === "initiate") {
        return Response.json({
          sessionId: crypto.randomUUID(),
          partSize: UPLOAD_CHUNK_BYTES,
        });
      }
      return Response.json({ error: "stop after initiation" }, { status: 400 });
    }));

    for (const title of ["العنوان الأول", "العنوان الثاني"]) {
      await expect(uploadClip(file, {
        title,
        originalFilename: file.name,
        contentType: file.type,
        durationSec: 61,
      }, new AbortController().signal, vi.fn())).rejects.toThrow("stop after initiation");
    }

    expect(bodies.filter(body => body.action === "initiate")).toMatchObject([
      { filename: "source.mp4", title: "العنوان الأول" },
      { filename: "source.mp4", title: "العنوان الثاني" },
    ]);
  });

  it("accepts unknown client duration and surfaces metadata-only finalization errors", async () => {
    const calls = mockR2();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push([url, init]);
      return Response.json({
        sessionId: "11111111-1111-4111-8111-111111111111",
        partSize: UPLOAD_CHUNK_BYTES,
      });
    });
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push([url, init]);
      return Response.json({ state: "active", parts: [] });
    });
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push([url, init]);
      const body = JSON.parse(String(init?.body));
      return Response.json({ url: `https://r2.invalid/upload?part=${body.partNumber}` });
    });
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push([url, init]);
      return Response.json({ error: "Server media duration is below 60 seconds" }, { status: 400 });
    });

    await expect(uploadClip(
      new File(["media"], "unknown.mp4", { type: "video/mp4" }),
      { contentType: "video/mp4", durationSec: null },
      new AbortController().signal,
      vi.fn(),
    )).rejects.toThrow("Server media duration is below 60 seconds");

    const initiated = JSON.parse(String(calls[0][1]?.body));
    expect(initiated.durationSec).toBeNull();
    expect(String(calls.at(-1)?.[0])).toContain("api/upload/complete");
  });
});