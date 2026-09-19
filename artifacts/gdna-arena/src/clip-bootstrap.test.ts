import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ultra-light clip bootstrap", () => {
  it("keeps the main entry route-aware and the clip graph free of the React app", () => {
    const main = source("./main.tsx");
    const clip = source("./clip-entry.ts");
    expect(main).not.toMatch(/from\s+["'].\/App["']/);
    expect(main).toContain('import("./clip-entry")');
    expect(main).toContain('import("./app-entry")');
    expect(main).not.toContain('isClipRoute ? import("./clip-entry")');
    expect(main).toContain('rawRoute.replace(/\\/+$/');
    expect(main).toContain('data-testid", "clip-startup-retry"');
    expect(main).toContain("window.location.reload()");
    expect(clip).not.toMatch(/from\s+["']react|from\s+["'].\/App|index\.css|AuthProvider/i);
    // The heavy compression graph must never be a static import; it is only ever
    // pulled in lazily via dynamic import() when the user opts into compression.
    expect(clip).not.toMatch(/from\s+["'][^"']*prepareVideo/);
    expect(clip).toMatch(/import\(\s*["']\.\/components\/clips\/prepareVideo["']\s*\)/);
  });

  it("registers the service worker even when the dynamic App entry arrives after load", () => {
    const appEntry = source("./app-entry.tsx");
    expect(appEntry).toContain('document.readyState === "complete"');
    expect(appEntry).toContain('addEventListener("load", registerServiceWorker, { once: true })');
  });

  it("has an immediate shell, lazy compression only, and no eager feed playback", () => {
    const html = source("../index.html");
    const clip = source("./clip-entry.ts");
    const feed = source("./components/clips/reelsFeed.ts");
    expect(html).toContain('data-testid="clip-shell"');
    expect(html).toContain("جارٍ تجهيز الرفع");
    expect(html).toContain('route === "/clip" || route === "/clips"');
    expect(html).not.toContain('endsWith("/clip")');
    // No recorder/ffmpeg/eager-playback code lives in the thin entry itself; the
    // recorder graph is confined to the lazily imported compression module.
    expect(clip).not.toMatch(/MediaRecorder|ffmpeg|autoplay/i);
    // The Reels feed loads playback URLs lazily: a <video> element is created
    // (and its src assigned) only when a slide is activated by the observer —
    // never eagerly for every clip, and never with a broad preload.
    expect(feed).toContain("function loadPlayback()");
    expect(feed).toContain("if (playbackRequested) return");
    expect(feed).toContain("IntersectionObserver");
    expect(feed).not.toMatch(/autoplay/i);
  });

  it("has only a minimum-duration gate with no size or publication-type UI", () => {
    const clip = source("./clip-entry.ts");
    expect(clip).not.toContain("25 * 1024 * 1024");
    expect(clip).not.toMatch(/size-warning|name="purpose"|original-footage|id="rights"/);
    expect(clip).toContain("خاص دقيقة الفوق");
    expect(clip).toContain("readClipDuration");
    expect(clip).toContain("MAX_CLIP_BYTES");
    for (const id of ["clip-file-input", "clip-submit", "clip-progress", "clip-status", "clip-error"]) {
      expect(clip).toContain(`data-testid="${id}"`);
    }
    expect(clip).toContain('dataset.clipReady = "true"');
  });

  it("uploads directly to R2 (presigned multipart), resumes only the same File, and locks metadata", () => {
    const transport = source("./components/clips/clipUpload.ts");
    const clip = source("./clip-entry.ts");
    // Direct-to-R2 invariant: presigned multipart PUTs, never a proxied/Tus path.
    expect(transport).toContain("api/r2/presign");
    expect(transport).toContain('method: "PUT"');
    expect(transport).not.toMatch(/tus-js-client|new tus\.Upload|storeFingerprintForResuming/i);
    // Resume is scoped to the exact same in-memory File object only — no
    // persisted fingerprint, content hash, or localStorage cross-session state.
    expect(transport).toContain("new WeakMap<File, string>()");
    expect(transport).not.toContain("localStorage");
    expect(transport).not.toContain("contentHash");
    // Fixed 5MiB parts and the explicit 2GiB transport ceiling.
    expect(transport).toContain("UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024");
    expect(transport).toContain("MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024");
    // Metadata controls stay locked for the duration of an upload.
    expect(clip).toContain("mutableControls.forEach(control => { control.disabled = true; })");
    expect(clip).toContain("mutableControls.forEach(control => { control.disabled = false; })");
  });
});