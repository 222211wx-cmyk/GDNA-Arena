import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function workerHarness() {
  const showNotification = vi.fn();
  const initializeApp = vi.fn();
  const importScripts = vi.fn();
  let background: (payload: { notification?: { title?: string; body?: string } }) => void = () => {};
  runInNewContext(
    readFileSync(resolve(process.cwd(), "public/firebase-messaging-sw.js"), "utf8"),
    {
      importScripts,
      self: { registration: { showNotification } },
      firebase: {
        initializeApp,
        messaging: () => ({ onBackgroundMessage: (handler: typeof background) => { background = handler; } }),
      },
    },
  );
  return { background, showNotification, initializeApp, importScripts };
}

describe("requested Firebase background worker", () => {
  it("initializes the specified project with compat 10.7.0", () => {
    const worker = workerHarness();
    expect(worker.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "helixly-b7653" }));
    expect(worker.importScripts).toHaveBeenCalledWith("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");
  });

  it("shows supplied notification content", () => {
    const worker = workerHarness();
    worker.background({ notification: { title: "Incoming call", body: "A caller is ringing" } });
    expect(worker.showNotification).toHaveBeenCalledWith("Incoming call", {
      body: "A caller is ringing", icon: "/icon.png",
    });
  });

  it("uses the exact Arabic defaults for data-only messages", () => {
    const worker = workerHarness();
    worker.background({});
    expect(worker.showNotification).toHaveBeenCalledWith("مكالمة جديدة", {
      body: "مكالمة فيديو فائتة", icon: "/icon.png",
    });
  });
});