import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Harness = {
  background: (payload: { data: Record<string, string> }) => unknown;
  showNotification: ReturnType<typeof vi.fn>;
  getNotifications: ReturnType<typeof vi.fn>;
};

function workerHarness(): Harness {
  let background: Harness["background"] | undefined;
  const showNotification = vi.fn(async () => undefined);
  const getNotifications = vi.fn(async () => [{ close: vi.fn() }]);
  const config = encodeURIComponent(JSON.stringify({ apiKey: "public" }));
  const self = {
    location: { href: `https://arena.test/firebase-messaging-sw.js?firebaseConfig=${config}` },
    registration: {
      scope: "https://arena.test/",
      getNotifications,
      showNotification,
    },
    addEventListener: vi.fn(),
  };
  const sandbox = {
    self,
    URL,
    Promise,
    Date,
    setTimeout: vi.fn(),
    importScripts: vi.fn(),
    firebase: {
      initializeApp: vi.fn(),
      messaging: () => ({ onBackgroundMessage: (listener: Harness["background"]) => { background = listener; } }),
    },
  };
  const source = readFileSync(resolve(process.cwd(), "public/firebase-messaging-sw.js"), "utf8");
  runInNewContext(source, sandbox);
  if (!background) throw new Error("Firebase background listener was not registered");
  return { background, showNotification, getNotifications };
}

describe("firebase messaging service worker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an actionable incoming notification for an unexpired roomId", async () => {
    const worker = workerHarness();
    await worker.background({ data: {
      type: "INCOMING_CALL", roomId: "call-1", callerName: "ليلى",
      callerAvatar: "", expiresAt: new Date(Date.now() + 20_000).toISOString(),
    } });
    expect(worker.showNotification).toHaveBeenCalledWith(
      "مكالمة واردة من ليلى",
      expect.objectContaining({
        tag: "gdna-call-call-1",
        requireInteraction: true,
        actions: [{ action: "answer", title: "رد" }, { action: "decline", title: "رفض" }],
      }),
    );
  });

  it("does not display expired invitations and closes a terminal call's incoming tag", async () => {
    const worker = workerHarness();
    await worker.background({ data: {
      type: "INCOMING_CALL", roomId: "expired",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    } });
    await worker.background({ data: { type: "CALL_ENDED", roomId: "call-ended" } });
    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "gdna-call-expired" });
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "gdna-call-call-ended" });
  });

  it("replaces an incoming tag with a passive Arabic MISSED_CALL notification", async () => {
    const worker = workerHarness();
    await worker.background({ data: {
      type: "MISSED_CALL", roomId: "call-2", callerName: "عمر",
      title: "مكالمة فائتة من عمر", body: "لديك مكالمة فائتة",
    } });
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "gdna-call-call-2" });
    expect(worker.showNotification).toHaveBeenCalledWith(
      "مكالمة فائتة من عمر",
      expect.objectContaining({
        body: "لديك مكالمة فائتة",
        tag: "gdna-missed-call-call-2",
        requireInteraction: false,
        data: { callId: "call-2", kind: "missed" },
      }),
    );
    expect(worker.showNotification.mock.calls[0][1].actions).toBeUndefined();
  });
});