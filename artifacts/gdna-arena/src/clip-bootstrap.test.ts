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
    expect(clip).not.toMatch(/from\s+["']react|from\s+["'].\/App|index\.css|AuthProvider|prepareVideo/i);
  });

  it("registers the service worker even when the dynamic App entry arrives after load", () => {
    const appEntry = source("./app-entry.tsx");
    expect(appEntry).toContain('document.readyState === "complete"');
    expect(appEntry).toContain('addEventListener("load", registerServiceWorker, { once: true })');
  });

  it("has an immediate clip shell and never eagerly decodes or compresses media", () => {
    const html = source("../index.html");
    const clip = source("./clip-entry.ts");
    expect(html).toContain('data-testid="clip-shell"');
    expect(html).toContain("جارٍ تجهيز الرفع");
    expect(html).toContain('route === "/clip" || route === "/clips"');
    expect(html).not.toContain('endsWith("/clip")');
    expect(clip).not.toMatch(/MediaRecorder|ffmpeg|preload\s*=\s*["']metadata|autoplay/i);
    expect(clip).toContain('setAttribute("preload", "none")');
  });

  it("enforces 25 MiB before upload and exposes stable automation hooks", () => {
    const clip = source("./clip-entry.ts");
    expect(clip).toContain("25 * 1024 * 1024");
    expect(clip).toContain("الفيديو كبير - صغر 720p");
    for (const id of ["clip-file-input", "clip-submit", "clip-progress", "clip-status", "clip-error"]) {
      expect(clip).toContain(`data-testid="${id}"`);
    }
    expect(clip).toContain('dataset.clipReady = "true"');
  });

  it("resumes only the same selected File object and locks metadata while uploading", () => {
    const transport = source("./components/clips/clipUpload.ts");
    const clip = source("./clip-entry.ts");
    expect(transport).toContain("new WeakMap<File, string>()");
    expect(transport).not.toContain("localStorage");
    expect(transport).not.toContain("contentHash");
    expect(clip).toContain("mutableControls.forEach(control => { control.disabled = true; })");
    expect(clip).toContain("mutableControls.forEach(control => { control.disabled = false; })");
  });
});