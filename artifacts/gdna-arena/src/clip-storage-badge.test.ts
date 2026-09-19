import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/clips/clipUpload", () => ({
  uploadClip: vi.fn(),
  MAX_CLIP_BYTES: 2 * 1024 * 1024 * 1024,
}));
vi.mock("./components/clips/readClipDuration", () => ({ readClipDuration: vi.fn() }));
vi.mock("./components/clips/VideoActions", () => ({ mountVideoActions: vi.fn(async () => {}) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const badge = () => document.getElementById("storage-badge") as HTMLDivElement;
const text = () => document.getElementById("storage-text")!.textContent ?? "";
const bucket = () => document.getElementById("storage-bucket")!.textContent ?? "";
const form = () => document.getElementById("upload") as HTMLFormElement;

/**
 * Stub fetch so /api/auth/me is authenticated, the feed is empty, and
 * /api/r2/status returns the supplied body (or throws when body is an Error).
 */
function stub(r2: unknown | Error, authenticated = true) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/auth/me")) {
      return authenticated ? json({ id: 9, username: "u" }) : json({ error: "no" }, 401);
    }
    if (url.includes("/api/r2/status")) {
      if (r2 instanceof Error) throw r2;
      return json(r2);
    }
    return json({ clips: [] });
  }));
}

async function boot() {
  await import("./clip-entry");
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  document.head.querySelectorAll("style").forEach(s => s.remove());
  vi.unstubAllGlobals();
});

describe("R2 storage connection badge", () => {
  it("shows Connected + bucket only when connected is verified true", async () => {
    stub({ provider: "r2", configured: true, connected: true, bucket: "helixly-clips" });
    await boot();
    await vi.waitFor(() => expect(badge().dataset.state).toBe("connected"));
    expect(text()).toContain("Connected");
    expect(text()).toContain("Cloudflare R2");
    expect(bucket()).toBe("helixly-clips");
  });

  it("does not show a false green when reachable but not connected", async () => {
    stub({ provider: "r2", configured: true, connected: false, bucket: "helixly-clips" });
    await boot();
    await vi.waitFor(() => expect(badge().dataset.state).toBe("unknown"));
    expect(text()).not.toContain("Connected");
    expect(bucket()).toBe("");
  });

  it("reports not-configured distinctly (no green, no error color)", async () => {
    stub({ provider: "r2", configured: false, connected: false, bucket: null });
    await boot();
    await vi.waitFor(() => expect(badge().dataset.state).toBe("unknown"));
    expect(text()).toContain("غير مهيأ");
  });

  it("shows an error state on network/HTTP failure, never green", async () => {
    stub(new Error("network down"));
    await boot();
    await vi.waitFor(() => expect(badge().dataset.state).toBe("error"));
    expect(text()).not.toContain("Connected");
  });

  it("never probes storage (nor blocks the form) for an anonymous viewer", async () => {
    const spy = vi.fn(async () => json({ clips: [] }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return json({ error: "no" }, 401);
      if (url.includes("/api/r2/status")) return spy();
      return json({ clips: [] });
    }));
    await boot();
    // Anonymous keeps the form hidden and must not call the authenticated probe.
    await vi.waitFor(() => expect(document.getElementById("auth")!.innerHTML).toContain("login"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the upload form visible regardless of storage outcome", async () => {
    stub(new Error("boom"));
    await boot();
    await vi.waitFor(() => expect(form().hidden).toBe(false));
    await vi.waitFor(() => expect(badge().dataset.state).toBe("error"));
    expect(form().hidden).toBe(false);
  });
});
