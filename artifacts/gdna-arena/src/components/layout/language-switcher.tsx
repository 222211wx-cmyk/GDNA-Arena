import { Globe } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@workspace/gdna-ds/components/ui/dropdown-menu";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";
import { authCopy } from "@/i18n/auth-v2-copy";

/** Globe language menu, used centred in the header and in the standalone messenger. Changing language only re-renders; it never touches the session. */
export function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" data-testid="language-switcher"
          aria-label={authCopy(lang).language} title={authCopy(lang).language}>
          <Globe className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup value={lang} onValueChange={value => setLang(value as Lang)}>
          {LANGS.map(language => (
            <DropdownMenuRadioItem key={language.code} value={language.code} data-testid={`lang-${language.code}`}>
              <span aria-hidden="true" className="me-2">{language.flag}</span>{language.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
