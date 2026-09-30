import { Link } from "wouter";
import { trackEvent } from "@/lib/analytics";
import { useLang, type Lang } from "@/contexts/LangContext";
import { Card, CardContent } from "@workspace/gdna-ds/components/ui/card";

type Module = { id: string; letter: string; route: string; names: Record<Lang, string> };

const MODULES: Module[] = [
  { id: "clips", letter: "Hc", route: "/clips",
    names: { ar: "كليبات", en: "Clips", fr: "Clips", es: "Clips", de: "Clips" } },
  { id: "messages", letter: "Hm", route: "/messages.call",
    names: { ar: "الرسائل", en: "Messages", fr: "Messages", es: "Mensajes", de: "Nachrichten" } },
  { id: "arena", letter: "Ha", route: "/games",
    names: { ar: "الساحة", en: "Arena", fr: "Arène", es: "Arena", de: "Arena" } },
  { id: "social", letter: "H", route: "/social",
    names: { ar: "تعارف", en: "تعارف", fr: "تعارف", es: "تعارف", de: "تعارف" } },
];

const LABEL: Record<Lang, string> = {
  ar: "وحدات المنصة", en: "Platform modules", fr: "Modules de la plateforme",
  es: "Módulos de la plataforma", de: "Plattformmodule",
};

export function PlatformLauncher() {
  const { lang } = useLang();
  return (
    <section aria-labelledby="launcher-title" className="mx-auto max-w-3xl px-4 py-10">
      <h1 id="launcher-title" dir="ltr" data-testid="text-launcher-title"
        className="mb-8 text-center text-3xl font-bold text-foreground md:text-4xl">
        Helixly.app
      </h1>
      <nav aria-label={LABEL[lang]}>
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {MODULES.map(m => (
            <li key={m.id}>
              <Link href={m.route} data-testid={`link-module-${m.id}`}
                onClick={() => trackEvent("homepage_module_click", { module: m.id })}
                className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full transition-colors hover:bg-muted">
                  <CardContent className="flex flex-col items-center gap-3 p-6">
                    <span aria-hidden="true" dir="ltr"
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                      {m.letter}
                    </span>
                    <span className="text-base font-semibold text-foreground">{m.names[lang]}</span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
