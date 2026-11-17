import { ShieldCheck, Gauge, Globe2, Zap, Layers, Server, Lock, Languages } from "lucide-react";
import { useLang, type Lang } from "@/contexts/LangContext";

type Copy = {
  fastTitle: string; fastItems: [string, string][];
  trustTitle: string; trustNote: string; badges: [string, string][];
};
const COPY: Record<Lang, Copy> = {
  en: {
    fastTitle: "Why GDNA Arena is Fast",
    fastItems: [["200 ms", "Response-time target for API calls"], ["Global edge", "Served through Railway's edge network"], ["Optimized build", "Code-split, minified, cached assets"], ["Lazy media", "Clips and thumbnails load as you scroll"]],
    trustTitle: "Trusted by Design",
    trustNote: "What we actually run in production.",
    badges: [["Security", "HTTPS everywhere, hardened headers, rate-limited API"], ["Performance", "Optimized build, cached search, lazy-loaded clips"], ["Global Availability", "Worldwide edge delivery in 5 languages"]],
  },
  ar: {
    fastTitle: "لماذا GDNA Arena سريع",
    fastItems: [["200 مللي ثانية", "هدف زمن استجابة واجهة البرمجة"], ["حافة عالمية", "يُقدَّم عبر شبكة Railway العالمية"], ["بناء محسَّن", "ملفات مقسّمة ومضغوطة ومخزَّنة مؤقتًا"], ["تحميل كسول", "الكليبس والصور المصغّرة تُحمَّل أثناء التمرير"]],
    trustTitle: "موثوق بالتصميم",
    trustNote: "ما نشغّله فعليًا في الإنتاج.",
    badges: [["الأمان", "HTTPS في كل مكان، ترويسات حماية، وتحديد معدل الطلبات"], ["الأداء", "بناء محسَّن، بحث مخزَّن مؤقتًا، وكليبس بتحميل كسول"], ["التوفر العالمي", "تسليم عالمي بخمس لغات"]],
  },
  fr: {
    fastTitle: "Pourquoi GDNA Arena est rapide",
    fastItems: [["200 ms", "Objectif de temps de réponse de l'API"], ["Edge mondial", "Servi via le réseau edge de Railway"], ["Build optimisé", "Code découpé, minifié, assets en cache"], ["Médias différés", "Clips et vignettes chargés au défilement"]],
    trustTitle: "Fiable par conception",
    trustNote: "Ce que nous exécutons réellement en production.",
    badges: [["Sécurité", "HTTPS partout, en-têtes renforcés, API limitée en débit"], ["Performance", "Build optimisé, recherche en cache, clips différés"], ["Disponibilité mondiale", "Diffusion mondiale en 5 langues"]],
  },
  es: {
    fastTitle: "Por qué GDNA Arena es rápida",
    fastItems: [["200 ms", "Objetivo de tiempo de respuesta de la API"], ["Edge global", "Servido por la red edge de Railway"], ["Build optimizado", "Código dividido, minificado y con caché"], ["Medios diferidos", "Clips y miniaturas se cargan al desplazarse"]],
    trustTitle: "Confiable por diseño",
    trustNote: "Lo que realmente ejecutamos en producción.",
    badges: [["Seguridad", "HTTPS en todo, cabeceras reforzadas, API con límite de tasa"], ["Rendimiento", "Build optimizado, búsqueda en caché, clips diferidos"], ["Disponibilidad global", "Entrega mundial en 5 idiomas"]],
  },
  de: {
    fastTitle: "Warum GDNA Arena schnell ist",
    fastItems: [["200 ms", "Antwortzeit-Ziel der API"], ["Globaler Edge", "Ausgeliefert über Railways Edge-Netzwerk"], ["Optimierter Build", "Code-Splitting, Minifizierung, Caching"], ["Lazy-Medien", "Clips und Vorschaubilder laden beim Scrollen"]],
    trustTitle: "Vertrauenswürdig durch Design",
    trustNote: "Was wir tatsächlich in Produktion betreiben.",
    badges: [["Sicherheit", "HTTPS überall, gehärtete Header, ratenbegrenzte API"], ["Performance", "Optimierter Build, gecachte Suche, Lazy-Clips"], ["Globale Verfügbarkeit", "Weltweite Auslieferung in 5 Sprachen"]],
  },
};
const FAST_ICONS = [Gauge, Globe2, Layers, Zap];
const BADGE_ICONS = [ShieldCheck, Gauge, Globe2];

export function TrustSections() {
  const { lang } = useLang();
  const c = COPY[lang] ?? COPY.en;
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="mx-auto w-full max-w-5xl space-y-12 px-4 py-12">
      <section aria-labelledby="fast-title" data-testid="section-why-fast">
        <h2 id="fast-title" className="mb-6 text-center text-2xl font-bold text-foreground">{c.fastTitle}</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.fastItems.map(([title, body], i) => {
            const Icon = FAST_ICONS[i];
            return (
              <li key={title} className="rounded-xl border border-border bg-card p-5 text-card-foreground">
                <Icon aria-hidden="true" className="mb-3 h-6 w-6 text-primary" />
                <p className="text-xl font-bold">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="trust-title" data-testid="section-trust">
        <h2 id="trust-title" className="text-center text-2xl font-bold text-foreground">{c.trustTitle}</h2>
        <p className="mb-6 mt-1 text-center text-sm text-muted-foreground">{c.trustNote}</p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {c.badges.map(([title, body], i) => {
            const Icon = BADGE_ICONS[i];
            return (
              <li key={title} className="flex flex-col items-center rounded-xl border border-primary/40 bg-card p-6 text-center text-card-foreground">
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground"><Icon aria-hidden="true" className="h-7 w-7" /></span>
                <p className="text-lg font-bold">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
