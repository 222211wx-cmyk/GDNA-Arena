import { Link, useLocation } from "wouter";
import { ACTIVE_ICONS } from "@/config/icons";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@workspace/gdna-ds/components/ui/dropdown-menu";
import { cn } from "@workspace/gdna-ds/lib/utils";

/** The owner's single, flat navigation. Existing sections retain their routes. */
export function Navbar() {
  const [location] = useLocation();
  const { lang, setLang } = useLang();
  const items = Object.values(ACTIVE_ICONS).filter(item => item.active);

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0"
              aria-label={lang === "ar" ? "اللغة" : "Language"}>
              {lang === "ar" ? "SA" : lang.toUpperCase()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={lang} onValueChange={value => setLang(value as Lang)}>
              {LANGS.map(language => (
                <DropdownMenuRadioItem key={language.code} value={language.code}>
                  {language.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </header>
  );
}