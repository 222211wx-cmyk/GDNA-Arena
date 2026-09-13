import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function workerHarness() {
  const showNotification = vi.fn();
  const getNotifications = vi.fn().mockResolvedValue([]);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn();
  const initializeApp = vi.fn();
  const importScripts = vi.fn();
  let background: (payload: {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }) => unknown = () => {};
  let notificationClick: (event: {
    action?: string;
    notification: { data?: Record<string, unknown>; close: () => void };
    waitUntil: (promise: Promise<unknown>) => void;
  }) => void = () => {};
  runInNewContext(
    readFileSync(resolve(process.cwd(), "public/firebase-messaging-sw.js"), "utf8"),
    {
      importScripts,
      fetch,
      URL,
      setTimeout,
      clearTimeout,
      self: {
        addEventListener: (type: string, handler: typeof notificationClick) => {
          if (type === "notificationclick") notificationClick = handler;
        },
        registration: { scope: "https://example.test/", showNotification, getNotifications },
        clients: { openWindow, matchAll: vi.fn().mockResolvedValue([]) },
      },
      firebase: {
        initializeApp,
        messaging: () => ({ onBackgroundMessage: (handler: typeof background) => { background = handler; } }),
      },
    },
  );
  return {
    background,
    notificationClick,
    showNotification,
    getNotifications,
    openWindow,
    fetch,
    initializeApp,
    importScripts,
  };
}

async function flushWorkerPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
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

  it("renders canonical incoming calls with Arabic answer/decline actions", async () => {
    const worker = workerHarness();
    worker.background({
      data: {
        callId: "call_1",
        fromName: "ليلى",
        title: "مكالمة واردة",
        type: "INCOMING_CALL",
        expiresAt: String(Date.now() + 30_000),
      },
    });
    await flushWorkerPromises();
    const [, options] = worker.showNotification.mock.calls[0];
    expect(options).toMatchObject({
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: expect.objectContaining({ callId: "call_1", fromName: "ليلى", kind: "incoming" }),
    });
    expect(options.actions).toEqual([
      { action: "answer", title: "الرد" },
      { action: "decline", title: "رفض" },
    ]);
  });

  it("body-clicks an incoming call passively without auto-answering", async () => {
    const worker = workerHarness();
    worker.background({
      data: { callId: "call_2", type: "INCOMING_CALL", expiresAt: String(Date.now() + 30_000) },
    });
    await flushWorkerPromises();
    const [, options] = worker.showNotification.mock.calls[0];
    const close = vi.fn();
    let waited: Promise<unknown> | undefined;
    worker.notificationClick({
      notification: { data: options.data, close },
      waitUntil: promise => { waited = promise; },
    });
    await waited;
    expect(close).toHaveBeenCalled();
    expect(worker.openWindow).toHaveBeenCalledWith(
      "https://example.test/messages?callId=call_2",
    );
  });

  it("declines through the authenticated same-origin endpoint and falls back to an action URL", async () => {
    const worker = workerHarness();
    worker.fetch.mockResolvedValue({ ok: true });
    let waited: Promise<unknown> | undefined;
    worker.notificationClick({
      action: "decline",
      notification: {
        data: { callId: "call_3", kind: "incoming", type: "INCOMING_CALL" },
        close: vi.fn(),
      },
      waitUntil: promise => { waited = promise; },
    });
    await waited;
    expect(worker.fetch).toHaveBeenCalledWith(
      "https://example.test/api/call/decline?id=call_3",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(worker.openWindow).toHaveBeenCalledWith("https://example.test/messages?callId=call_3");

    const failed = workerHarness();
    failed.fetch.mockRejectedValue(new Error("offline"));
    let fallbackWaited: Promise<unknown> | undefined;
    failed.notificationClick({
      action: "decline",
      notification: {
        data: { callId: "call_4", kind: "incoming", type: "INCOMING_CALL" },
        close: vi.fn(),
      },
      waitUntil: promise => { fallbackWaited = promise; },
    });
    await fallbackWaited;
    expect(failed.openWindow).toHaveBeenCalledWith(
      "https://example.test/messages?callId=call_4&action=decline",
    );
  });

  it("rejects expired incoming calls and closes them when their timer expires", async () => {
    const expired = workerHarness();
    expired.background({
      data: { callId: "expired", type: "INCOMING_CALL", expiresAt: String(Date.now() - 1) },
    });
    expect(expired.showNotification).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const worker = workerHarness();
      const notification = { close: vi.fn() };
      worker.getNotifications.mockResolvedValue([notification]);
      const backgroundDone = worker.background({
        data: { callId: "timer", type: "INCOMING_CALL", expiresAt: String(Date.now() + 30_000) },
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await backgroundDone;
      expect(notification.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the missed-calls inbox without answer actions", async () => {
    const worker = workerHarness();
    worker.background({
      data: {
        roomId: "legacy_room",
        fromName: "Nour",
        type: "MISSED_CALL",
        title: "مكالمة فائتة من Nour",
      },
    });
    await flushWorkerPromises();
    const [, options] = worker.showNotification.mock.calls[0];
    expect(options.actions).toBeUndefined();
    let waited: Promise<unknown> | undefined;
    worker.notificationClick({
      action: "",
      notification: { data: options.data, close: vi.fn() },
      waitUntil: promise => { waited = promise; },
    });
    await waited;
    expect(worker.openWindow).toHaveBeenCalledWith("https://example.test/missed-calls");
  });

  it("closes the matching incoming card before showing a missed-call card", async () => {
    vi.useFakeTimers();
    try {
      const worker = workerHarness();
      const incoming = { close: vi.fn() };
      worker.getNotifications.mockResolvedValue([incoming]);
      worker.background({
        data: {
          callId: "call_5",
          type: "INCOMING_CALL",
          expiresAt: String(Date.now() + 30_000),
        },
      });
      await flushWorkerPromises();
      expect(worker.showNotification).toHaveBeenCalledTimes(1);

      worker.background({
        data: { callId: "call_5", type: "MISSED_CALL", title: "مكالمة فائتة" },
      });
      await flushWorkerPromises();
      expect(incoming.close).toHaveBeenCalled();
      expect(worker.showNotification).toHaveBeenCalledTimes(2);
      expect(worker.showNotification.mock.calls[1][1].actions).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the matching incoming card on a terminal call push", async () => {
    const worker = workerHarness();
    const incoming = { close: vi.fn() };
    worker.getNotifications.mockResolvedValue([incoming]);
    await worker.background({
      data: { callId: "call_6", type: "CALL_ENDED" },
    });
    expect(incoming.close).toHaveBeenCalled();
    expect(worker.showNotification).not.toHaveBeenCalled();
  });
});