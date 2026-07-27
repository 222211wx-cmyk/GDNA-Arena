import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Gamepad2, Trophy, LogOut, Globe,
  ChevronDown, LayoutDashboard, Wallet,
  Vote, Newspaper, BrainCircuit, Crown,
  Clock, Scale, Radio, Brain
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";

// ── Dropdown groups ────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    key: "nav_group_platform",
    items: [
      { key: "hub_title",     path: "/hub",       icon: Radio,        color: "text-primary" },
      { key: "chrono_past",   path: "/chronicle", icon: Clock,        color: "text-yellow-400", labelKey: "nav_chronicle" },
      { key: "nlp_nav",       path: "/growth",    icon: Brain,        color: "text-purple-400", labelKey: "nlp_nav" },
      { key: "empire_title",  path: "/empire",    icon: Crown,        color: "text-yellow-400" },
      { key: "legal_title",   path: "/legal",     icon: Scale,        color: "text-blue-400" },
    ],
  },
  {
    key: "nav_group_play",
    items: [
      { key: "games",         path: "/games",     icon: Gamepad2,     color: "text-primary" },
      { key: "globalstar",    path: "/games/globalstar", icon: Vote,  color: "text-green-400" },
      { key: "leaderboard",   path: "/leaderboard", icon: Trophy,     color: "text-yellow-400" },
    ],
  },
  {
    key: "nav_group_discover",
    items: [
      { key: "news",          path: "/news",      icon: Newspaper,    color: "text-orange-400" },
      { key: "ai",            path: "/chat",      icon: BrainCircuit, color: "text-purple-400" },
    ],
  },
];

// single dropdown component
function NavDropdown({ group, location, t }: {
  group: typeof NAV_GROUPS[0];
  location: string;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = group.items.some(i => location === i.path || location.startsWith(i.path + "/"));

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-sm font-medium transition-colors hover:text-primary ${
          active ? "text-primary neon-text-glow" : "text-muted-foreground"
        }`}
      >
        {t(group.key)}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-52 bg-card/95 backdrop-blur border border-primary/20 rounded-xl shadow-2xl shadow-primary/10 z-50 overflow-hidden">
          <div className="p-1.5 space-y-0.5">
            {group.items.map((item) => {
              const isActive = location === item.path || location.startsWith(item.path + "/");
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all hover:bg-primary/10 hover:text-primary ${
                    isActive ? "bg-primary/15 text-primary font-bold" : "text-foreground/80"
                  }`}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${item.color}`} />
                  {t(item.labelKey ?? item.key)}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleLogout = async () => {
    await logout();
    setIsOpen(false);
  };

  const currentFlag = LANGS.find((l) => l.code === lang)?.flag ?? "🌐";

  // All items flat for mobile
  const allItems = NAV_GROUPS.flatMap(g => g.items);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-primary/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:neon-glow transition-all duration-300">
            <Gamepad2 className="w-6 h-6" />
          </div>
          <span className="font-bold text-xl tracking-tighter text-white neon-text-glow">GDNA Arena</span>
        </Link>

        {/* Desktop Nav — grouped dropdowns */}
        <div className="hidden md:flex items-center gap-6 flex-1 justify-center">
          {/* Home — always visible standalone */}
          <Link
            href="/"
            className={`text-sm font-medium transition-colors hover:text-primary ${
              location === "/" ? "text-primary neon-text-glow" : "text-muted-foreground"
            }`}
          >
            {t("home")}
          </Link>

          {NAV_GROUPS.map((g) => (
            <NavDropdown key={g.key} group={g} location={location} t={t} />
          ))}
        </div>

        {/* Right side: lang + user */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          {/* Language Switcher */}
          <div ref={langRef} className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-sm border border-primary/20 rounded-lg px-2 py-1 hover:border-primary/50"
              data-testid="button-lang-switcher"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{currentFlag}</span>
            </button>
            {langOpen && (
              <div className="absolute right-0 top-full mt-2 w-36 bg-card border border-primary/20 rounded-xl overflow-hidden shadow-xl z-50">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code as Lang); setLangOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-primary/10 transition-colors ${
                      lang === l.code ? "text-primary font-bold" : "text-muted-foreground"
                    }`}
                  >
                    <span>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User zone */}
          {user ? (
            <div className="flex items-center gap-2 pl-3 border-l border-primary/20">
              <Link href="/dashboard" className="text-xs text-primary font-bold uppercase tracking-widest flex items-center gap-1 hover:neon-text-glow transition-all">
                <Trophy className="w-3 h-3" />
                {user.balance.toLocaleString()}
              </Link>
              <Link href="/wallet" className="text-muted-foreground hover:text-primary transition-colors" title={t("wallet")}>
                <Wallet className="w-4 h-4" />
              </Link>
              <Link href="/dashboard" className="text-muted-foreground hover:text-primary transition-colors" title={t("dashboard")}>
                <LayoutDashboard className="w-4 h-4" />
              </Link>
              <button
                onClick={handleLogout}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title={t("logout")}
                data-testid="button-logout-nav"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-3 border-l border-primary/20">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
                {t("login")}
              </Link>
              <Link href="/register" className="text-sm font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/40 hover:bg-primary hover:text-black transition-all">
                {t("register")}
              </Link>
            </div>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-primary hover:text-white transition-colors" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="md:hidden border-b border-primary/20 bg-background/98 px-4 py-4 space-y-1">
          <Link href="/" onClick={() => setIsOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium transition-colors ${location === "/" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"}`}>
            <Gamepad2 className="w-4 h-4 text-primary" /> {t("home")}
          </Link>

          {NAV_GROUPS.map((g) => (
            <div key={g.key}>
              <p className="px-3 pt-3 pb-1 text-xs font-black uppercase tracking-widest text-primary/50">{t(g.key)}</p>
              {g.items.map((item) => (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium transition-colors ${
                    location === item.path ? "text-primary bg-primary/10 font-bold" : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  {t(item.labelKey ?? item.key)}
                </Link>
              ))}
            </div>
          ))}

          {/* User links mobile */}
          {user && (
            <div className="pt-3 border-t border-primary/10 space-y-1">
              <Link href="/dashboard" onClick={() => setIsOpen(false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-base text-muted-foreground hover:text-primary">
                <LayoutDashboard className="w-4 h-4 text-primary" /> {t("dashboard")}
              </Link>
              <Link href="/wallet" onClick={() => setIsOpen(false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-base text-muted-foreground hover:text-primary">
                <Wallet className="w-4 h-4 text-yellow-400" /> {t("wallet")}
              </Link>
              <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-base text-destructive w-full">
                <LogOut className="w-4 h-4" /> {t("logout")}
              </button>
            </div>
          )}

          {!user && (
            <div className="pt-3 border-t border-primary/10 flex gap-2">
              <Link href="/login" onClick={() => setIsOpen(false)} className="flex-1 text-center py-2.5 rounded-lg border border-primary/30 text-primary font-bold text-sm">{t("login")}</Link>
              <Link href="/register" onClick={() => setIsOpen(false)} className="flex-1 text-center py-2.5 rounded-lg bg-primary/15 border border-primary/50 text-primary font-bold text-sm">{t("register")}</Link>
            </div>
          )}

          {/* Language Switcher mobile */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-primary/10">
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code as Lang); setIsOpen(false); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  lang === l.code ? "border-primary text-primary bg-primary/10" : "border-primary/20 text-muted-foreground hover:border-primary/50"
                }`}>
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
