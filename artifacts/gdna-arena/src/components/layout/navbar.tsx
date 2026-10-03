import { Link, useLocation } from "wouter";
import { useState } from "react";
import { LayoutList, Search, Settings, Wrench, Download } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@workspace/gdna-ds/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { installText, requestSectionInstall, type InstallSection } from "@/lib/section-install";
import { SEARCH_ROUTE, SETTINGS_ROUTE, UI_TEXT } from "@/config/platform-directory";

/** Shared header: brand + horizontal utilities (directory, tools, settings, language). */
export function Navbar() {
  const [location, setLocation] = useLocation();
  const { lang } = useLang();
  const [installHelp, setInstallHelp] = useState<string | null>(null);
  const onHome = location === "/";

  const install = (section: InstallSection) => {
    setInstallHelp(null);
    void requestSectionInstall(section, lang).then(setInstallHelp);
  };

  return (
    <header dir={lang === "ar" ? "rtl" : "ltr"} className="sticky top-0 z-50 border-b border-border bg-background text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-2 px-3 py-2">
        <div className="text-center">
          <Link href="/" dir="ltr" data-testid="link-brand-home" aria-label={UI_TEXT.home[lang]}
            className="inline-block text-2xl font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
            Helixly.app
          </Link>
        </div>
        <nav aria-label={UI_TEXT.utilities[lang]} className="flex items-center justify-center gap-1">
          {!onHome && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/" data-testid="nav-directory" aria-label={UI_TEXT.sections[lang]}>
                <LayoutList aria-hidden="true" />
                <span className="hidden sm:inline">{UI_TEXT.sections[lang]}</span>
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="nav-tools" aria-label={UI_TEXT.tools[lang]}>
                <Wrench aria-hidden="true" />
                <span>{UI_TEXT.tools[lang]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="tool-search" onSelect={() => setLocation(SEARCH_ROUTE)}>
                <Search aria-hidden="true" /> {UI_TEXT.search[lang]}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(["messages", "clips"] as const).map(section => (
                <DropdownMenuItem key={section} data-testid={`install-${section}`} onSelect={() => install(section)}>
                  <Download aria-hidden="true" />
                  {installText(lang, section === "clips" ? "clipsButton" : "messagesButton")}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" asChild>
            <Link href={SETTINGS_ROUTE} data-testid="nav-settings" aria-label={UI_TEXT.settings[lang]}
              onClick={() => {
                if (location === "/dashboard") {
                  document.getElementById("account-settings")?.scrollIntoView({ block: "start" });
                }
              }}
              aria-current={location === "/dashboard" ? "page" : undefined}>
              <Settings aria-hidden="true" />
              <span>{UI_TEXT.settings[lang]}</span>
            </Link>
          </Button>
          <LanguageSwitcher />
        </nav>
      </div>
      {installHelp && (
        <div role="status" className="mx-auto flex max-w-7xl items-center gap-2 px-3 pb-2 text-sm">
          <span>{installHelp}</span>
          <Button variant="ghost" size="sm" onClick={() => setInstallHelp(null)}
            aria-label={installText(lang, "dismiss")}>×</Button>
        </div>
      )}
    </header>
  );
}
