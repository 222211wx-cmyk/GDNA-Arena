import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clapperboard, Gamepad2, ShoppingBag, Users } from "lucide-react";
import { useLang, type Lang } from "@/contexts/LangContext";
import { DIRECTORY, SEARCH_ROUTE } from "@/config/platform-directory";

type ApiResults = {
  clips: { id: number; title: string; username: string }[];
  games: { id: string; name: string; route: string }[];
  shop: { id: number; name: string; name_ar: string; price: number; emoji: string }[];
  citizens: { id: number; username: string }[];
};
type Hit = { key: string; label: string; hint: string; href: string; kind: "section" | "clip" | "game" | "shop" | "user" };

const COPY: Record<Lang, { placeholder: string; empty: string; searching: string; kinds: Record<Hit["kind"], string> }> = {
  en: { placeholder: "Search clips, games, shop and users", empty: "No results", searching: "Searching…", kinds: { section: "Section", clip: "Clip", game: "Game", shop: "Shop", user: "User" } },
  ar: { placeholder: "ابحث في الكليبس والألعاب والمتجر والمستخدمين", empty: "لا نتائج", searching: "جارٍ البحث…", kinds: { section: "قسم", clip: "كليب", game: "لعبة", shop: "متجر", user: "مستخدم" } },
  fr: { placeholder: "Rechercher clips, jeux, boutique et utilisateurs", empty: "Aucun résultat", searching: "Recherche…", kinds: { section: "Section", clip: "Clip", game: "Jeu", shop: "Boutique", user: "Utilisateur" } },
  es: { placeholder: "Buscar clips, juegos, tienda y usuarios", empty: "Sin resultados", searching: "Buscando…", kinds: { section: "Sección", clip: "Clip", game: "Juego", shop: "Tienda", user: "Usuario" } },
  de: { placeholder: "Clips, Spiele, Shop und Nutzer suchen", empty: "Keine Ergebnisse", searching: "Suche…", kinds: { section: "Bereich", clip: "Clip", game: "Spiel", shop: "Shop", user: "Nutzer" } },
};
const ICON = { section: Search, clip: Clapperboard, game: Gamepad2, shop: ShoppingBag, user: Users } as const;
const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f\u064b-\u065f]/g, "").toLowerCase().trim();
const cache = new Map<string, ApiResults>();

export function GlobalSearch() {
  const { lang } = useLang();
  const copy = COPY[lang] ?? COPY.en;
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<ApiResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  // Section matches are local, so they appear on the first keystroke.
  const local = useMemo<Hit[]>(() => {
    if (!q) return [];
    const n = norm(q);
    return DIRECTORY.filter(d => Object.values(d.names).some(name => norm(name).includes(n)) || d.route.includes(n))
      .slice(0, 5).map(d => ({ key: `s-${d.id}`, label: d.names[lang], hint: d.route, href: d.route, kind: "section" as const }));
  }, [q, lang]);

  useEffect(() => {
    if (q.length < 2) { setRemote(null); setLoading(false); return; }
    const hit = cache.get(q.toLowerCase());
    if (hit) { setRemote(hit); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`${BASE()}/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, credentials: "include" })
        .then(r => (r.ok ? r.json() : null))
        .then((data: ApiResults | null) => {
          if (data) { cache.set(q.toLowerCase(), data); setRemote(data); }
          setLoading(false);
        })
        .catch(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 120);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const hits: Hit[] = [
    ...local,
    ...(remote?.clips ?? []).map(c => ({ key: `c-${c.id}`, label: c.title, hint: `@${c.username}`, href: `/clips?q=${encodeURIComponent(c.title)}`, kind: "clip" as const })),
    ...(remote?.games ?? []).map(g => ({ key: `g-${g.id}`, label: g.name, hint: g.route, href: g.route, kind: "game" as const })),
    ...(remote?.shop ?? []).map(i => ({ key: `i-${i.id}`, label: `${i.emoji} ${lang === "ar" ? i.name_ar : i.name}`, hint: String(i.price), href: "/shop", kind: "shop" as const })),
    ...(remote?.citizens ?? []).map(u => ({ key: `u-${u.id}`, label: u.username, hint: `/u/${u.username}`, href: `/u/${encodeURIComponent(u.username)}`, kind: "user" as const })),
  ];

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-2xl px-4 pt-4" dir={lang === "ar" ? "rtl" : "ltr"}>
      <form role="search" onSubmit={e => { e.preventDefault(); if (q) setLocation(`${SEARCH_ROUTE}?q=${encodeURIComponent(q)}`); }}>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input type="search" value={query} autoComplete="off" data-testid="input-global-search"
            onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
            placeholder={copy.placeholder} aria-label={copy.placeholder}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
      </form>
      {open && q && (
        <ul role="listbox" data-testid="list-global-search"
          className="absolute inset-x-4 z-40 mt-2 max-h-96 overflow-auto rounded-xl border border-border bg-card shadow-lg">
          {hits.map(h => {
            const Icon = ICON[h.kind];
            return (
              <li key={h.key} role="option" aria-selected="false">
                <Link href={h.href} onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-card-foreground hover:bg-muted">
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{copy.kinds[h.kind]}</span>
                </Link>
              </li>
            );
          })}
          {hits.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{loading ? copy.searching : copy.empty}</li>}
          {hits.length > 0 && loading && <li className="px-4 py-2 text-xs text-muted-foreground">{copy.searching}</li>}
        </ul>
      )}
    </div>
  );
}
