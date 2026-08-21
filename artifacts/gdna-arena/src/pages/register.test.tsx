import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import Register from "./register";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    register: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/register", vi.fn()],
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

describe("Register", () => {
  it("shows the bilingual account-recovery limit before citizens create an account", () => {
    render(<Register />);

    const notice = screen.getByTestId("notice-password-recovery");
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(
      "لا يمكن استعادتها عبر البريد الإلكتروني",
    );
    expect(notice).toHaveTextContent(
      "لا يمكن تغييرها إلا من الإعدادات أثناء تسجيل الدخول",
    );
    expect(notice).toHaveTextContent(
      "il ne peut pas être récupéré par e-mail",
    );
    expect(notice).toHaveTextContent(
      "ne peut être modifié que depuis les paramètres, une fois connecté",
    );
  });
});