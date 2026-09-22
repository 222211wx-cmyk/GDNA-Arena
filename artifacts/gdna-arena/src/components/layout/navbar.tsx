import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@workspace/gdna-ds/components/ui/dropdown-menu";
import { cn } from "@workspace/gdna-ds/lib/utils";

const COPY = {
  ar: ["أرينا", "أنا", "حيوان", "المراسلات - MESSAGERI", "اجتماعي - جهات الاتصال", "Search", "مستشار"],
  en: ["ARENA", "Me", "Animals", "MESSAGERI", "Social - Contacts", "Search", "Advisor"],
  fr: ["ARENA", "Moi", "Animaux", "MESSAGERI", "Social - Contacts", "Search", "Conseiller"],
  es: ["ARENA", "Yo", "Animales", "MESSAGERI", "Social - Contactos", "Search", "Asesor"],
  de: ["ARENA", "Ich", "Tiere", "MESSAGERI", "Sozial - Kontakte", "Search", "Berater"],
} as const;

/** The owner's single, flat navigation. Existing sections retain their routes. */
export function Navbar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { lang, setLang } = useLang();
  const labels = COPY[lang as keyof typeof COPY] ?? COPY.en;
  // There is no standalone animal product: use the existing content search.
  const paths = ["/", user ? "/u/me" : "/login",
    `/search?q=${encodeURIComponent(labels[2])}`,
    "/messages", "/social", "/search", "/chat"];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background text-foreground">
      <nav aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
        className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-3 py-2 scrollbar-hide">
        {paths.map((href, index) => (
          <Button key={index} variant="ghost" size="sm" asChild
            className={cn("shrink-0 whitespace-nowrap",
              index === 0 && "font-bold",
              location === href && "bg-muted text-foreground")}>
            <Link href={href} aria-current={location === href ? "page" : undefined}
              data-testid={index === 3 ? "nav-module-messages" : index === 4 ? "nav-module-social" : `nav-primary-${index}`}>
              {labels[index]}
            </Link>
          </Button>
        ))}
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