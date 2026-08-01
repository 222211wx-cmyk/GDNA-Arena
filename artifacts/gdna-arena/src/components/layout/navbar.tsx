import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Search, Trophy, Music, Film, Newspaper, Landmark,
  Gamepad2, LogOut, Globe, LayoutDashboard, Wallet,
  Menu, X, Mic2, Bell, ChevronRight, BrainCircuit
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";
import { NotificationBell } from "@/components/NotificationBell";

const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// ── Nav items ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { name: "Home",     emoji: null,  icon: null,                     path: "/",                 highlight: false },
  { name: "SPORT",    emoji: "⚽",  icon: <Trophy    size={15} />,  path: "/sport",            highlight: true  },
  { name: "MUSIC",    emoji: "🎵",  icon: <Music     size={15} />,  path: "/pulse",            highlight: false },
  { name: "CINEMA",   emoji: "🎬",  icon: <Film      size={15} />,  path: "/legends",          highlight: false },
  { name: "NEWS",     emoji: "📰",  icon: <Newspaper size={15} />,  path: "/news",             highlight: false },
  { name: "HERITAGE", emoji: "🏛️", icon: <Landmark  size={15} />,  path: "/chronicle",        highlight: false },
  { name: "PLAY",     emoji: "🎮",  icon: <Gamepad2  size={15} />,  path: "/games",            highlight: false },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [langOpen, setLangOpen]     = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const langRef   = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();

  // Close dropdowns on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (langRef.current   && !langRef.current.contains(e.target as Node))   setLangOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const isActive = (path: string) =>
    path === "/" ? location === "/" : location === path || location.startsWith(path + "/");

  const currentFlag = LANGS.find((l) => l.code === lang)?.flag ?? "🌐";

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `${BASE()}/search?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <header className="w-full sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-yellow-500/20">

      {/* ── Main bar ── */}
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">

        {/* Logo — CORE SOCKET */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <svg width="36" height="36" viewBox="0 0 40 40" fill="none" className="group-hover:drop-shadow-[0_0_8px_rgba(255,215,0,0.7)] transition-all">
            <circle cx="20" cy="20" r="18" stroke="#FFD700" strokeWidth="2"/>
            <path d="M20 5 L20 12 M20 28 L20 35 M5 20 L12 20 M28 20 L35 20" stroke="#FFD700" strokeWidth="2" strokeLinecap="round"/>
            <path d="M15 15 Q20 10 25 15 Q30 20 25 25 Q20 30 15 25 Q10 20 15 15" stroke="#FFD700" strokeWidth="1.5" fill="none"/>
            <circle cx="20" cy="20" r="3" fill="#FFD700"/>
          </svg>
          <span className="font-bold text-lg tracking-tight text-yellow-400 hidden sm:block">
            GDNA Arena
          </span>
        </Link>

        {/* ── Desktop nav ── */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_ITEMS.map((item) => {
            const active    = isActive(item.path);
            const featured  = item.highlight && !active;   // SPORT بدون active
            return (
              <Link
                key={item.name}
                href={item.path}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  active
                    ? "text-yellow-400 bg-yellow-400/10 border-b-2 border-yellow-400"
                    : featured
                      ? "text-yellow-400 border-b-2 border-yellow-400/60 hover:bg-yellow-400/10"
                      : "text-gray-300 hover:text-white hover:bg-white/5"
                }`}
              >
                {item.emoji && <span className="text-base leading-none">{item.emoji}</span>}
                {item.name}
              </Link>
            );
          })}

          {/* PRESS — gold special tab */}
          <Link
            href="/press"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-black tracking-wider transition-all ml-1 ${
              isActive("/press")
                ? "bg-yellow-400 text-black shadow-[0_0_16px_rgba(255,215,0,0.4)]"
                : "border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10"
            }`}
          >
            <Mic2 size={14} />
            PRESS
          </Link>
        </nav>

        {/* ── Right controls ── */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Search — desktop */}
          <div ref={searchRef} className="hidden lg:block relative">
            <form onSubmit={handleSearch}>
              <div className="flex items-center bg-gray-800/80 border border-gray-700/50 rounded-full px-3 py-1.5 gap-2 focus-within:border-yellow-400/50 focus-within:bg-gray-800 transition-all">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input
                  type="text"
                  placeholder="CR7, Messi, Coupe du Monde..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent outline-none text-white text-sm w-44 placeholder:text-gray-500"
                />
              </div>
            </form>
          </div>

          {/* Search icon — tablet */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="lg:hidden text-gray-400 hover:text-yellow-400 transition-colors p-1.5"
          >
            <Search size={18} />
          </button>

          {/* Notification */}
          <NotificationBell />

          {/* Language */}
          <div ref={langRef} className="relative hidden md:block">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1 text-gray-400 hover:text-yellow-400 transition-colors text-sm border border-gray-700/50 rounded-lg px-2 py-1 hover:border-yellow-400/30"
            >
              <Globe size={13} />
              <span>{currentFlag}</span>
            </button>
            {langOpen && (
              <div className="absolute right-0 top-full mt-2 w-36 bg-gray-900 border border-yellow-400/20 rounded-xl overflow-hidden shadow-2xl z-50">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code as Lang); setLangOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-yellow-400/10 transition-colors ${
                      lang === l.code ? "text-yellow-400 font-bold" : "text-gray-400"
                    }`}
                  >
                    <span>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User controls */}
          {user ? (
            <div className="hidden md:flex items-center gap-2 pl-2 border-l border-gray-700/50">
              <Link
                href="/dashboard"
                className="flex items-center gap-1 text-xs text-yellow-400 font-black uppercase tracking-widest hover:text-yellow-300 transition-colors"
              >
                <Trophy size={12} />
                {user.balance.toLocaleString()}
              </Link>
              <Link href="/wallet"    title={t("wallet")}    className="text-gray-400 hover:text-yellow-400 transition-colors"><Wallet         size={16} /></Link>
              <Link href="/dashboard" title={t("dashboard")} className="text-gray-400 hover:text-yellow-400 transition-colors"><LayoutDashboard size={16} /></Link>
              <button onClick={logout} title={t("logout")} className="text-gray-400 hover:text-red-400 transition-colors">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2 pl-2 border-l border-gray-700/50">
              <Link href="/login"    className="text-sm text-gray-400 hover:text-white transition-colors font-medium">{t("login")}</Link>
              <Link href="/register" className="text-sm font-bold px-3 py-1.5 rounded-lg bg-yellow-400/10 text-yellow-400 border border-yellow-400/40 hover:bg-yellow-400 hover:text-black transition-all">
                {t("register")}
              </Link>
            </div>
          )}

          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-gray-400 hover:text-yellow-400 transition-colors p-1"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* ── Tablet search bar (below main bar) ── */}
      {searchOpen && (
        <div className="lg:hidden border-t border-gray-800/60 px-4 py-2">
          <form onSubmit={handleSearch}>
            <div className="flex items-center bg-gray-800 rounded-full px-4 py-2 gap-2 border border-gray-700/50 focus-within:border-yellow-400/50 transition-all">
              <Search size={15} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="CR7, Messi, Coupe du Monde..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent outline-none text-white text-sm flex-1 placeholder:text-gray-500"
              />
            </div>
          </form>
        </div>
      )}

      {/* ── Mobile horizontal nav strip ── */}
      <div className="md:hidden flex overflow-x-auto gap-1 px-3 py-2 border-t border-gray-800/60 scrollbar-hide">
        {NAV_ITEMS.map((item) => {
          const active   = isActive(item.path);
          const featured = item.highlight && !active;
          return (
            <Link
              key={item.name}
              href={item.path}
              onClick={() => setMobileOpen(false)}
              className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? "text-yellow-400 bg-yellow-400/10"
                  : featured
                    ? "text-yellow-400 border-b border-yellow-400/60"
                    : "text-gray-400 hover:text-white"
              }`}
            >
              {item.emoji && <span>{item.emoji}</span>}
              {item.name}
            </Link>
          );
        })}
        <Link
          href="/press"
          onClick={() => setMobileOpen(false)}
          className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${
            isActive("/press")
              ? "bg-yellow-400 text-black border-yellow-400"
              : "border-yellow-400/40 text-yellow-400"
          }`}
        >
          <Mic2 size={12} />
          PRESS
        </Link>
      </div>

      {/* ── Mobile full menu ── */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-800 bg-black/98 px-4 py-4 space-y-1">

          {/* Nav links */}
          {[...NAV_ITEMS, { name: "PRESS", emoji: "📡", icon: <Mic2 size={16} />, path: "/press", highlight: false }].map((item) => {
            const active   = isActive(item.path);
            const featured = item.highlight && !active;
            return (
              <Link
                key={item.name}
                href={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-base font-semibold transition-all ${
                  active
                    ? "text-yellow-400 bg-yellow-400/10"
                    : featured
                      ? "text-yellow-400"
                      : "text-gray-300 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-xl leading-none">{item.emoji ?? "›"}</span>
                {item.name}
              </Link>
            );
          })}

          {/* Growth / AI */}
          <div className="pt-2 border-t border-gray-800">
            <Link href="/growth" onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-base font-semibold text-purple-400 hover:bg-purple-400/10 transition-all">
              <BrainCircuit size={16} />
              ARCHON SYSTEM
            </Link>
          </div>

          {/* User */}
          {user ? (
            <div className="pt-2 border-t border-gray-800 space-y-1">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-base text-gray-300 hover:text-white transition-all">
                <LayoutDashboard size={16} className="text-yellow-400" /> {t("dashboard")}
              </Link>
              <Link href="/wallet" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-base text-gray-300 hover:text-white transition-all">
                <Wallet size={16} className="text-yellow-400" /> {t("wallet")}
              </Link>
              <button onClick={() => { logout(); setMobileOpen(false); }}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-base text-red-400 w-full hover:bg-red-400/10 transition-all">
                <LogOut size={16} /> {t("logout")}
              </button>
            </div>
          ) : (
            <div className="pt-2 border-t border-gray-800 flex gap-2">
              <Link href="/login"    onClick={() => setMobileOpen(false)} className="flex-1 text-center py-3 rounded-xl border border-yellow-400/30 text-yellow-400 font-bold text-sm">{t("login")}</Link>
              <Link href="/register" onClick={() => setMobileOpen(false)} className="flex-1 text-center py-3 rounded-xl bg-yellow-400/10 border border-yellow-400/40 text-yellow-400 font-bold text-sm">{t("register")}</Link>
            </div>
          )}

          {/* Language */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-800">
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code as Lang); setMobileOpen(false); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  lang === l.code ? "border-yellow-400 text-yellow-400 bg-yellow-400/10" : "border-gray-700 text-gray-400 hover:border-yellow-400/40"
                }`}>
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
