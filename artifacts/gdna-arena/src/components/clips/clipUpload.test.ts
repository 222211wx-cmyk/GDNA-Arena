import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadClip, UPLOAD_CHUNK_BYTES } from "./clipUpload";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("resumable clip upload protocol", () => {
  it("sends 1 MiB chunks, resumes a lost PATCH acknowledgement, and commits the declaration", async () => {
    const file = new File([
      new Uint8Array(UPLOAD_CHUNK_BYTES),
      new Uint8Array(17),
    ], "camera.mp4", { type: "video/mp4", lastModified: 123 });
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([url, init]);
      if (init?.method === "POST" && String(url).endsWith("/uploads")) {
        return new Response(null, {
          status: 201,
          headers: { Location: "/api/clips/uploads/11111111-1111-4111-8111-111111111111", "Upload-Offset": "0" },
        });
      }
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Upload-Offset": String(UPLOAD_CHUNK_BYTES) } });
      }
      return new Response(JSON.stringify({ clip: { id: 9 } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const patches: TestXhr[] = [];
    class TestXhr {
      static attempts = 0;
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 0;
      statusText = "";
      responseText = "";
      timeout = 0;
      withCredentials = false;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      headers = new Headers();
      body?: Blob;

      constructor() { patches.push(this); }
      open(method: string, url: string) {
        expect(method).toBe("PATCH");
        expect(url).toContain("/api/clips/uploads/");
      }
      setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
      getAllResponseHeaders() {
        return this.status === 204 ? `Upload-Offset: ${file.size}\r\n` : "";
      }
      abort() { this.onabort?.(); }
      send(body: Blob) {
        this.body = body;
        const attempt = ++TestXhr.attempts;
        queueMicrotask(() => {
          this.upload.onprogress?.({ loaded: attempt === 1 ? body.size / 2 : body.size } as ProgressEvent);
          if (attempt === 1) {
            this.onerror?.();
          } else {
            this.status = 204;
            this.onload?.();
          }
        });
      }
    }
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", TestXhr);
    const progress: number[] = [];
    await uploadClip(file, {
      title: file.name,
      contentType: file.type,
      durationSec: 67,
      purpose: "story",
      isOriginalFootage: true,
    }, new AbortController().signal, value => progress.push(value));

    const creation = calls.find(([, init]) => init?.method === "POST" && !String(init.body ?? "").includes("uploadIds"))![1]!;
    expect(new Headers(creation.headers).get("Upload-Metadata")).toContain("isOriginalFootage ");
    expect(patches[0].body?.size).toBe(UPLOAD_CHUNK_BYTES);
    expect(patches[0].withCredentials).toBe(true);
    expect(patches[0].timeout).toBe(300_000);
    expect(patches[1].headers.get("Upload-Offset")).toBe(String(UPLOAD_CHUNK_BYTES));
    expect(progress.some(value => value > 0 && value < 50)).toBe(true);
    const completion = calls.at(-1)![1]!;
    expect(JSON.parse(String(completion.body))).toEqual({
      uploadIds: ["11111111-1111-4111-8111-111111111111"],
      isOriginalFootage: true,
    });
    expect(progress.at(-1)).toBe(100);
    expect(localStorage.length).toBe(0);
  });

  it("does not start an XMLHttpRequest when its abort signal is already aborted", async () => {
    const xhr = vi.fn();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      if (init?.signal?.aborted) reject(init.signal.reason);
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", xhr);
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(uploadClip(
      new File([new Uint8Array(4)], "cancelled.mp4", { type: "video/mp4" }),
      {
        title: "cancelled.mp4",
        contentType: "video/mp4",
        durationSec: 1,
        purpose: "story",
        isOriginalFootage: true,
      },
      controller.signal,
      vi.fn(),
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr).not.toHaveBeenCalled();
  });
});