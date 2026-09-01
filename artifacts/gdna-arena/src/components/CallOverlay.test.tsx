import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import CallOverlay from "./CallOverlay";

vi.mock("@/contexts/LangContext", () => ({
  useLang: () => ({ lang: "en" }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => {
      const { initial: _initial, animate: _animate, exit: _exit, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
}));

const baseProps = {
  peer: "citizen",
  localStream: null,
  remoteStream: null,
  incomingCall: null,
  onAnswer: vi.fn(),
  onReject: vi.fn(),
  onEnd: vi.fn(),
};

describe("CallOverlay media recovery", () => {
  it("shows active-call recovery messages and only offers screen sharing when active", () => {
    const onScreenShare = vi.fn();
    const { rerender } = render(
      <CallOverlay
        {...baseProps}
        status="calling"
        callError="Camera permission denied — retry"
        onScreenShare={onScreenShare}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Camera permission denied");
    expect(screen.queryByTitle("Share screen")).not.toBeInTheDocument();

    rerender(
      <CallOverlay
        {...baseProps}
        status="active"
        callError="Camera permission denied — retry"
        onScreenShare={onScreenShare}
      />,
    );

    expect(screen.getByTitle("Share screen")).toBeVisible();
  });

  it("offers a user-gesture retry when remote playback is blocked", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockResolvedValue(undefined);
    const remoteStream = {} as MediaStream;

    render(
      <CallOverlay
        {...baseProps}
        status="active"
        remoteStream={remoteStream}
      />,
    );

    const retry = await screen.findByRole("button", { name: "اضغط لتشغيل صوت المكالمة" });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "اضغط لتشغيل صوت المكالمة" })).not.toBeInTheDocument();
    });
    expect(play).toHaveBeenCalledTimes(2);
  });
});