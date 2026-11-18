import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Register from "./register";

vi.mock("@/contexts/AuthContext", () => ({
  AuthApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  useAuth: () => ({ user: null, authV2: vi.fn() }),
}));
vi.mock("wouter", () => ({
  Redirect: () => null,
  useLocation: () => ["/register", vi.fn()],
  useSearch: () => "",
}));

afterEach(() => { cleanup(); localStorage.clear(); });

describe("Register (new sign-up flow)", () => {
  it("offers Google first, then email sign-up with Day/Month/Year dropdowns and no date input", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ googleClientId: null, googleMock: false, sms: true, smsReal: false })));
    render(<Register />);
    expect(screen.getByTestId("google-button")).toBeVisible();
    fireEvent.click(screen.getByTestId("continue-email"));
    expect(screen.getByTestId("dob-day")).toBeVisible();
    expect(screen.getByTestId("dob-month")).toBeVisible();
    expect(screen.getByTestId("dob-year")).toBeVisible();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    // the date placeholders are fixed Latin tokens, never translated or reversed
    expect(screen.getByTestId("dob-day").closest("div")).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("dob-day")).toHaveTextContent("DD");
    expect(screen.getByTestId("dob-month")).toHaveTextContent("MM");
    expect(screen.getByTestId("dob-year")).toHaveTextContent("YYYY");
    // phone is a +212 country selector plus number, always LTR
    expect(screen.getByTestId("auth-phone-dial")).toHaveValue("+212");
    expect(screen.getByTestId("auth-phone-number")).toHaveAttribute("dir", "ltr");
  });
});
