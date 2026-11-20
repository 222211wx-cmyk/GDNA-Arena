import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES, UPLOAD_CONCURRENCY, uploadClip, validateUploadFile } from "./clipUpload";

afterEach(() => vi.unstubAllGlobals());

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = () => reject(r.error); r.readAsArrayBuffer(this);
    });
  };
}
const PART = 5 * 1024 * 1024;
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

function setup(partCount: number, failPart?: number) {
  let inFlight = 0, maxInFlight = 0;
  const puts: string[] = [];
  const failed = new Set<number>();
  class MockXHR {
    status = 0; responseText = "{}"; url = "";
    onload: (() => void) | null = null; onerror: (() => void) | null = null; onloadend: (() => void) | null = null;
    upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader() {}
    abort() {}
    send(body: Blob) {
      const n = Number(this.url.split("/").pop());
      puts.push(this.url); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight--;
        if (n === failPart && !failed.has(n)) { failed.add(n); this.onerror?.(); return; }
        this.upload.onprogress?.({ loaded: body.size });
        this.status = 200; this.onload?.();
      }, 5);
    }
  }
  vi.stubGlobal("XMLHttpRequest", MockXHR);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.action === "initiate") return json({ sessionId: "s1", partSize: PART, partCount });
    if (body.action === "inspect") return json({ state: "active", parts: [] });
    return json({ ok: true, clip: { id: 1, code: "HELX-123456", title: "t" } });
  }));
  return { puts, max: () => maxInFlight };
}
const fileOf = (parts: number) => new File([new Uint8Array(PART * (parts - 1) + 10)], "v.mp4");

describe("parallel chunked upload", () => {
  it("sends parts 20 at a time and reports real bytes", async () => {
    const { puts, max } = setup(30);
    const progress = vi.fn();
    await uploadClip(fileOf(30), { title: "Mon clip", durationSec: 61 }, new AbortController().signal, progress);
    expect(UPLOAD_CONCURRENCY).toBe(20);
    expect(max()).toBe(20);
    expect(puts).toHaveLength(30);
    const last = progress.mock.calls.at(-1)!;
    expect(last[0]).toBe(100);
    expect(last[1]).toBe(last[2]);
  });
  it("retries only the failed part", async () => {
    const { puts } = setup(8, 3);
    await uploadClip(fileOf(8), { title: "Mon clip", durationSec: 61 }, new AbortController().signal, () => {});
    expect(puts).toHaveLength(9);
    expect(puts.filter(u => u.endsWith("/3"))).toHaveLength(2);
  });
  it("accepts only MP4 and ZIP up to 1 GB", () => {
    expect(validateUploadFile({ name: "a.mp4", size: 1 })).toBeNull();
    expect(validateUploadFile({ name: "a.zip", size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateUploadFile({ name: "a.mov", size: 1 })).not.toBeNull();
    expect(validateUploadFile({ name: "a.mp4", size: MAX_UPLOAD_BYTES + 1 })).not.toBeNull();
  });
});
