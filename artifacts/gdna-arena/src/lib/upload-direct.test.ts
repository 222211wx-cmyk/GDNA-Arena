import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDirect, PARALLEL_PARTS } from "./upload-direct";

afterEach(() => vi.unstubAllGlobals());

const MB = 1024 * 1024;
const fakeFile = (size: number) => ({
  name: "big.mp4", size, type: "video/mp4", lastModified: 1,
  slice: (a: number, b: number) => ({ size: b - a }),
}) as unknown as File;
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

function server(opts: { dropAfter?: number } = {}) {
  const calls: string[] = [];
  const putParts: number[] = [];
  let inflight = 0, maxInflight = 0, puts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://r2/")) {
      const n = Number(url.split("/").pop());
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 1));
      inflight--;
      if (opts.dropAfter !== undefined && puts >= opts.dropAfter) throw new TypeError("network down");
      puts++; putParts.push(n);
      return new Response(null, { status: 200, headers: { ETag: `"${String(n).padStart(32, "0")}"` } });
    }
    const path = url.split("/api/upload/")[1];
    calls.push(path);
    const body = JSON.parse(String(init?.body));
    if (path === "init") return json({ uploadId: "U1", key: "clips/original/7/a.mp4", partSize: 10 * MB, totalParts: Math.ceil(body.fileSize / (10 * MB)) }, 201);
    if (path === "sign-part") return json({ signedUrl: `https://r2/${body.partNumber}` });
    if (path === "complete") return json({ ok: true, code: "HELX-000001", parts: body.parts.length });
    return new Response("{}", { status: 404 });
  }));
  return { calls, putParts, max: () => maxInflight };
}

describe("uploadDirect", () => {
  it("uploads 500 MB as 50 parts, 5 at a time, then completes", async () => {
    const s = server(); const store = memory(); const seen: number[] = [];
    const r = await uploadDirect(fakeFile(500 * MB), { storage: store, sleep: async () => {}, onProgress: (_p, up) => seen.push(up) });
    expect(r.parts).toBe(50);
    expect(s.putParts).toHaveLength(50);
    expect(s.max()).toBeLessThanOrEqual(PARALLEL_PARTS);
    expect(s.max()).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(500 * MB);
    expect(store.m.size).toBe(0);
  });

  it("resumes after the network drops: only missing parts upload, init runs once", async () => {
    const store = memory();
    const first = server({ dropAfter: 12 });
    await expect(uploadDirect(fakeFile(500 * MB), { storage: store, sleep: async () => {} })).rejects.toThrow();
    const saved = JSON.parse([...store.m.values()][0]);
    const done = Object.keys(saved.doneParts).length;
    expect(done).toBe(12);
    expect(first.calls.filter(c => c === "init")).toHaveLength(1);

    const second = server();
    await uploadDirect(fakeFile(500 * MB), { storage: store, sleep: async () => {} });
    expect(second.calls).not.toContain("init");
    expect(second.putParts).toHaveLength(50 - done);
    expect(second.putParts.some(n => Object.keys(saved.doneParts).includes(String(n)))).toBe(false);
    expect(store.m.size).toBe(0);
  });
});
