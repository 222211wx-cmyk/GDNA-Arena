import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalCallAlerts } from "./GlobalCallAlerts";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "ar" | "fr" | "es" | "de" }));

vi.mock("@/contexts/LangContext", () => ({
  useLang: () => ({ lang: language.lang }),
}));

function callState(overrides: Record<string, unknown> = {}) {
  return {
    callStatus: "idle",
    soundBlocked: true,
    enableCallSound: vi.fn().mockResolvedValue(true),
    notificationPermission: "default",
    enableCallNotifications: vi.fn().mockResolvedValue("granted"),
    pushEnabled: true,
    pushReason: null,
    firebaseStatus: "ready",
    secureCallRegistrationStatus: "ready",
    secureCallRegistrationError: null,
    retrySecureCallRegistration: vi.fn(),
    ...overrides,
  } as never;
}

describe("GlobalCallAlerts", () => {
  beforeEach(() => {
    language.lang = "en";
  });

  it("enables sound and requests notifications only from the explicit button", async () => {
    const call = callState();
    render(<GlobalCallAlerts call={call} />);

    expect(call.enableCallNotifications).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable call alerts" }));

    await waitFor(() => {
      expect(call.enableCallSound).toHaveBeenCalledOnce();
      expect(call.enableCallNotifications).toHaveBeenCalledOnce();
    });
  });

  it("honestly explains denied and unsupported notification states", () => {
    const { rerender } = render(
      <GlobalCallAlerts call={callState({ soundBlocked: false, notificationPermission: "denied" })} />,
    );
    expect(screen.getByText(/notifications are blocked/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable call alerts" })).toBeNull();

    rerender(
      <GlobalCallAlerts call={callState({ soundBlocked: false, notificationPermission: "unsupported" })} />,
    );
    expect(screen.getByText(/does not support call notifications/i)).toBeTruthy();
  });

  it("keeps secure registration failure globally actionable and localized", () => {
    language.lang = "de";
    const retry = vi.fn();
    render(
      <GlobalCallAlerts
        call={callState({
          soundBlocked: false,
          notificationPermission: "granted",
          secureCallRegistrationStatus: "error",
          secureCallRegistrationError: "HTTP 503",
          retrySecureCallRegistration: retry,
        })}
      />,
    );

    expect(screen.getByText(/nicht bereit.*HTTP 503/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});