import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = {
  data?: { json: () => unknown };
  action?: string;
  notification?: { data?: Record<string, unknown>; close: () => void };
  waitUntil: (promise: Promise<unknown>) => void;
};

function workerHarness() {
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const getNotifications = vi.fn().mockResolvedValue([{ close }]);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  const postMessage = vi.fn();
  const navigate = vi.fn().mockResolvedValue(undefined);
  let push: (event: WorkerEvent) => void = () => {};
  let click: (event: WorkerEvent) => void = () => {};

  runInNewContext(
    readFileSync(resolve(process.cwd(), "src/service-worker.js"), "utf8"),
    {
      URL,
      Date,
      fetch,
      setTimeout: vi.fn(),
      self: {
        location: { origin: "https://example.test" },
        addEventListener: (type: string, handler: (event: WorkerEvent) => void) => {
          if (type === "push") push = handler;
          if (type === "notificationclick") click = handler;
        },
        registration: {
          scope: "https://example.test/",
          showNotification,
          getNotifications,
        },
        clients: {
          openWindow,
          matchAll: vi.fn().mockResolvedValue([{
            url: "https://example.test/messages",
            postMessage,
            navigate,
            focus: vi.fn().mockResolvedValue(undefined),
          }]),
        },
      },
    },
  );

  const dispatch = async (handler: (event: WorkerEvent) => void, event: Omit<WorkerEvent, "waitUntil">) => {
    let work: Promise<unknown> = Promise.resolve();
    handler({ ...event, waitUntil: promise => { work = promise; } });
    await work;
  };
  return { push, click, dispatch, showNotification, getNotifications, close, openWindow, fetch, postMessage, navigate };
}

describe("standard call push worker", () => {
  it("shows a canonical incoming notification and resumes foreground clients", async () => {
    const worker = workerHarness();
    await worker.dispatch(worker.push, {
      data: { json: () => ({
        type: "INCOMING_CALL",
        callId: "call_123",
        fromName: "Caller",
        expiresAt: Date.now() + 20_000,
      }) },
    });

    expect(worker.showNotification).toHaveBeenCalledWith(
      "مكالمة واردة من Caller",
      expect.objectContaining({
        tag: "gdna-incoming-call-call_123",
        requireInteraction: true,
        silent: false,
        actions: [{ action: "answer", title: "الرد" }, { action: "decline", title: "رفض" }],
      }),
    );
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "GDNA_CALL_INVITATION", callId: "call_123" });
  });

  it("ignores expired invitations and closes any stale matching card", async () => {
    const worker = workerHarness();
    await worker.dispatch(worker.push, {
      data: { json: () => ({ type: "INCOMING_CALL", callId: "expired", expiresAt: Date.now() - 1 }) },
    });
    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "gdna-incoming-call-expired" });
    expect(worker.close).toHaveBeenCalled();
  });

  it("uses the validated answer URL while a body click stays passive", async () => {
    const answer = workerHarness();
    await answer.dispatch(answer.click, {
      action: "answer",
      notification: {
        data: { kind: "incoming", callId: "answer_me", expiresAt: Date.now() + 20_000 },
        close: vi.fn(),
      },
    });
    expect(answer.fetch).not.toHaveBeenCalled();
    expect(answer.navigate).toHaveBeenCalledWith(
      "https://example.test/messages?callId=answer_me&action=answer",
    );
    expect(answer.openWindow).not.toHaveBeenCalled();

    const passive = workerHarness();
    await passive.dispatch(passive.click, {
      action: "",
      notification: {
        data: { kind: "incoming", callId: "answer_me", expiresAt: Date.now() + 20_000 },
        close: vi.fn(),
      },
    });
    expect(passive.fetch).not.toHaveBeenCalled();
    expect(passive.navigate).toHaveBeenCalledWith(
      "https://example.test/messages?callId=answer_me",
    );
    expect(passive.openWindow).not.toHaveBeenCalled();
  });

  it("closes a ringing card when a terminal push arrives", async () => {
    const worker = workerHarness();
    await worker.dispatch(worker.push, {
      data: { json: () => ({ type: "CALL_ENDED", callId: "done_123" }) },
    });
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "gdna-incoming-call-done_123" });
    expect(worker.close).toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "GDNA_CALL_TERMINAL",
      callId: "done_123",
      status: "ended",
    });
  });
});