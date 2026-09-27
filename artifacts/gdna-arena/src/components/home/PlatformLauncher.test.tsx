import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlatformLauncher } from "./PlatformLauncher";

vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ lang: "en" }) }));

afterEach(() => {
  cleanup();
  delete window.umami;
});

describe("homepage module analytics", () => {
  it.each(["clips", "messages", "arena", "social"])("tracks only deliberate %s clicks", (module) => {
    const track = vi.fn();
    window.umami = { track };
    render(<PlatformLauncher />);
    expect(track).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`link-module-${module}`));
    expect(track).toHaveBeenCalledExactlyOnceWith("homepage_module_click", { module });
  });
});