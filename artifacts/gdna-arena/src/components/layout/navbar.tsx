import { Link, useLocation } from "wouter";
import { ACTIVE_ICONS } from "@/config/icons";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { cn } from "@workspace/gdna-ds/lib/utils";
import { useState } from "react";
import { installText, requestSectionInstall, type InstallSection } from "@/lib/section-install";

/** The owner's single, flat navigation. Existing sections retain their routes. */
export function Navbar() {
  const [location] = useLocation();
  const { lang } = useLang();
  const items = Object.values(ACTIVE_ICONS).filter(item => item.active);
  const [installHelp, setInstallHelp] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background text-foreground">
      <nav aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
        className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-3 py-2 scrollbar-hide">
        {items.map(item => {
          const selected = location === item.route ||
            (item.id === 6 && location === "/messages");
          return (
          <Button key={item.id} variant="ghost" size="sm" asChild
            className={cn("shrink-0 whitespace-nowrap",
              selected && "bg-muted text-foreground")}>
            <Link href={item.route} aria-current={selected ? "page" : undefined}
              data-testid={item.id === 6 ? "nav-module-messages" : "nav-module-clips"}>
              {item.label}
            </Link>
          </Button>
          );
        })}
        {(["clips", "messages"] as const).map((section: InstallSection) => (
          <Button key={section} variant="outline" size="sm" type="button"
            className="shrink-0 whitespace-nowrap"
            data-testid={`install-${section}`}
            onClick={() => {
              setInstallHelp(null);
              void requestSectionInstall(section, lang).then(setInstallHelp);
            }}>
            {installText(lang, section === "clips" ? "clipsButton" : "messagesButton")}
          </Button>
        ))}
        <LanguageSwitcher />
      </nav>
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