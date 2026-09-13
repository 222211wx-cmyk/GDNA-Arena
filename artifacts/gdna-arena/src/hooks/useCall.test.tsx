import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCall } from "./useCall";

const mocks = vi.hoisted(() => ({
  connectivity: {
    isOnline: true,
    setRealtimeConnecting: vi.fn(),
    setRealtimeConnected: vi.fn(),
  },
}));

vi.mock("agora-rtc-sdk-ng", () => ({ default: {} }));
vi.mock("@/contexts/ConnectivityContext", () => ({
  useConnectivity: () => mocks.connectivity,
}));
vi.mock("@/hooks/use-call-push", () => ({ useCallPush: () => ({}) }));
vi.mock("@/lib/network", () => ({
  apiPath: (path: string) => path,
  websocketUrl: () => "ws://arena.test/ws",
}));
vi.mock("@/lib/amis-e2ee", () => ({
  ensureDeviceIdentity: vi.fn().mockResolvedValue({ deviceId: "device", publicKey: "key" }),
  encryptCallSecret: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackCallDeviceOutcome: vi.fn() }));
vi.mock("@/lib/call-rtc-config", () => ({
  fetchCallRtcConfig: vi.fn(),
  preferOpus: vi.fn(),
}));
vi.mock("@/lib/call-ringtone", () => ({
  CallRingtone: class {
    enable = vi.fn().mockResolvedValue(true);
    start = vi.fn();
    stop = vi.fn();
    close = vi.fn();
  },
}));
vi.mock("@/lib/call-notification-action", () => ({
  canApplyNotificationCallAction: () => false,
  readNotificationCallAction: () => null,
  readNotificationCallResume: () => null,
  showForegroundCallNotification: vi.fn(),
  shouldClearTerminalCall: () => true,
}));

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void | Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    sockets.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: object) {
    void this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

let sockets: TestWebSocket[] = [];

function sentTypes(socket: TestWebSocket) {
  return socket.sent.map((frame) => JSON.parse(frame) as {
    type: string;
    callId?: string;
    deviceId?: string;
  });
}

describe("useCall signaling reconnect", () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a ringing recipient intact and resumes it after a signaling socket restart", async () => {
    const { result, unmount } = renderHook(() => useCall({ id: 7, username: "recipient" }));
    const firstSocket = sockets[0];

    await act(async () => {
      firstSocket.open();
      firstSocket.receive({ type: "registered", userId: 7 });
    });
    const firstDeviceId = sentTypes(firstSocket).find(frame => frame.type === "register")?.deviceId;
    expect(firstDeviceId).toMatch(/^calltab_[A-Za-z0-9_-]{16,128}$/);
    await act(async () => {
      firstSocket.receive({
        type: "call-incoming",
        signalId: "invitation-1",
        callId: "call-restart-safe",
        from: "caller",
        video: true,
        deferredMedia: false,
        transport: { provider: "webrtc", version: 1 },
        offer: { type: "offer", sdp: "v=0" },
      });
    });

    expect(result.current.callStatus).toBe("ringing");
    expect(result.current.incomingCall?.callId).toBe("call-restart-safe");
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      firstSocket.close();
      await vi.advanceTimersByTimeAsync(2_000);
    });

    // The browser's local invitation survives the transient signaling loss.
    expect(result.current.callStatus).toBe("ringing");
    expect(result.current.incomingCall?.callId).toBe("call-restart-safe");
    expect(getUserMedia).not.toHaveBeenCalled();

    const secondSocket = sockets[1];
    await act(async () => {
      secondSocket.open();
      secondSocket.receive({ type: "registered", userId: 7 });
    });

    expect(sentTypes(secondSocket)).toContainEqual({
      type: "call-resume",
      callId: "call-restart-safe",
    });
    expect(sentTypes(secondSocket).find(frame => frame.type === "register")?.deviceId).toBe(firstDeviceId);
    expect(result.current.callStatus).toBe("ringing");
    expect(getUserMedia).not.toHaveBeenCalled();
    unmount();
  });
});