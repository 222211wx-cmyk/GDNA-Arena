import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LangProvider, useLang } from "@/contexts/LangContext";
import { Navbar } from "@/components/layout/navbar";
import { authCopy } from "@/i18n/auth-v2-copy";

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown>, logout: vi.fn(), calls: 0 }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => { auth.calls++; return { user: auth.user, logout: auth.logout }; },
}));
vi.mock("@/components/auth/AuthModal", () => ({ useAuthModal: () => ({ open: vi.fn() }) }));

let setLang!: (l: "ar" | "en" | "fr") => void;
function Harness() { setLang = useLang().setLang as typeof setLang; return <Navbar />; }
const mount = () => render(<LangProvider><Harness /></LangProvider>);
afterEach(() => { cleanup(); localStorage.clear(); auth.user = null; auth.logout.mockClear(); });

describe("language switching never touches the session and flips the header", () => {
  it("signed in: name stays, no Log in button, header dir and copy follow ar <-> en <-> fr", () => {
    auth.user = { id: 1, username: "qaisy", displayName: "El Qaisy", avatarUrl: null };
    mount();
    for (const lang of ["ar", "en", "fr", "en", "ar"] as const) {
      act(() => setLang(lang));
      expect(screen.getByTestId("header-username")).toHaveTextContent("El Qaisy");
      expect(screen.queryByTestId("header-login")).toBeNull();
      expect(screen.queryByTestId("auth-buttons")).toBeNull();
      expect(auth.logout).not.toHaveBeenCalled();
      expect(screen.getByRole("banner")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      expect(document.body.textContent).not.toContain("\uFFFD");
    }
  });

  it("signed out: top row is logo, language, auth in DOM order; labels come from one language", () => {
    mount();
    for (const lang of ["ar", "en", "fr"] as const) {
      act(() => setLang(lang));
      const row = screen.getByTestId("header-top-row");
      const kids = [...row.children].map(c => c.querySelector("[data-testid]")?.getAttribute("data-testid") ?? c.getAttribute("data-testid"));
      expect(kids).toEqual(["link-brand-home", "language-switcher", "auth-buttons"]);
      // RTL mirrors by the header's dir; the DOM order is the same, so Arabic puts the logo right.
      expect(screen.getByTestId("header-login")).toHaveTextContent(authCopy(lang).login);
      expect(screen.getByTestId("header-signup")).toHaveTextContent(authCopy(lang).signup);
      const text = `${screen.getByTestId("header-login").textContent}${screen.getByTestId("header-signup").textContent}`;
      const hasArabic = /[\u0600-\u06FF]/.test(text), hasLatin = /[A-Za-z]/.test(text);
      expect(hasArabic && hasLatin).toBe(false);
    }
    expect(screen.getByTestId("header-login").className).toContain("bg-white");
    expect(screen.getByTestId("header-signup").className).toContain("bg-orange-500");
  });

  it("every language has every error code the server can return", () => {
    const codes = Object.keys(authCopy("en").errors);
    for (const lang of ["ar", "en", "fr", "es", "de"] as const) {
      expect(Object.keys(authCopy(lang).errors).sort()).toEqual([...codes].sort());
      for (const raw of Object.values(authCopy(lang).errors)) {
        const text = raw.replace(/Google/g, "");
        const mixed = /[\u0600-\u06FF]/.test(text) && /[A-Za-z]{3,}/.test(text);
        expect(mixed).toBe(false);
      }
    }
  });
});
