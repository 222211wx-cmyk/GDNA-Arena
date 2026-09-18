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
      if (init?.method === "PATCH" && calls.filter(([, request]) => request?.method === "PATCH").length === 1) {
        throw new TypeError("lost response");
      }
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Upload-Offset": String(UPLOAD_CHUNK_BYTES) } });
      }
      if (init?.method === "PATCH") {
        return new Response(null, { status: 204, headers: { "Upload-Offset": String(file.size) } });
      }
      return new Response(JSON.stringify({ clip: { id: 9 } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
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
    const patches = calls.filter(([, init]) => init?.method === "PATCH");
    expect((patches[0][1]!.body as Blob).size).toBe(UPLOAD_CHUNK_BYTES);
    expect(new Headers(patches[1][1]!.headers).get("Upload-Offset")).toBe(String(UPLOAD_CHUNK_BYTES));
    const completion = calls.at(-1)![1]!;
    expect(JSON.parse(String(completion.body))).toEqual({
      uploadIds: ["11111111-1111-4111-8111-111111111111"],
      isOriginalFootage: true,
    });
    expect(progress.at(-1)).toBe(100);
    expect(localStorage.length).toBe(0);
  });
});