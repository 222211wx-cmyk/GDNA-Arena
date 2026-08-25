import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Search, Trophy, Music, Film, Newspaper, Landmark,
  Gamepad2, LogOut, Globe, LayoutDashboard, Wallet,
  Menu, X, Mic2, Bell, ChevronRight, BrainCircuit, MessageSquare, Mail, User, ShoppingBag
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";
import { Scale } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";

const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// ── Nav items ──────────────────────────────────────────────────────────────────
// جميع الأقسام ظاهرة فالتنقل الرئيسي
const NAV_ITEMS = [
  { name: "Home",     emoji: null,  icon: null,                     path: "/",                 highlight: false },
  { name: "الساحة",   emoji: "⚔️",  icon: <Gamepad2      size={15} />, path: "/games",    highlight: true  },
  { name: "المتجر",   emoji: "🛒",  icon: <ShoppingBag   size={15} />, path: "/shop",     highlight: true  },
  { name: "المهام",   emoji: "🎯",  icon: <BrainCircuit  size={15} />, path: "/growth",   highlight: true  },
  { name: "FORTRESS", emoji: "🏰",  icon: <BrainCircuit  size={15} />, path: "/fortress", highlight: true  },
  { name: "SPORT",    emoji: "⚽",  icon: <Trophy    size={15} />,  path: "/sport",            highlight: false },
  { name: "MUSIC",    emoji: "🎵",  icon: <Music     size={15} />,  path: "/music",            highlight: false },
  { name: "CINEMA",   emoji: "🎬",  icon: <Film      size={15} />,  path: "/cinema",           highlight: false },
  { name: "NEWS",     emoji: "📰",  icon: <Newspaper size={15} />,  path: "/news",             highlight: false },
  { name: "HERITAGE", emoji: "🏛️", icon: <Landmark  size={15} />,  path: "/chronicle",        highlight: false },
  { name: "CLIPS",    emoji: "🎬",  icon: <Film      size={15} />,  path: "/clips",            highlight: false },
  { name: "SOCIAL",   emoji: "💬",  icon: <MessageSquare size={15} />, path: "/social",   highlight: false },
  { name: "MESSAGES", emoji: "✉️",  icon: <Mail          size={15} />, path: "/messages", highlight: false },
  { name: "AMIS",     emoji: "👥",  icon: <User          size={15} />, path: "/friends",  highlight: false },
  { name: "SMART",    emoji: "🧠",  icon: <BrainCircuit  size={15} />, path: "/smart",    highlight: false },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [langOpen, setLangOpen]     = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadDMs, setUnreadDMs]   = useState(0);

  const langRef   = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();

  useEffect(() => {
    // Unread badges are identity-bound too. Clear synchronously and abort the
    // previous citizen's request before polling for the new account.
    setUnreadDMs(0);
    if (!user) return;
    const controller = new AbortController();
    const fetchUnread = async () => {
      try {
        const r = await fetch("/api/messages/unread-count", {
          credentials: "include",
          signal: controller.signal,
        });
        if (r.ok && !controller.signal.aborted) {
          const d = await r.json() as { count: number };
          if (!controller.signal.aborted) setUnreadDMs(d.count ?? 0);
        }
      } catch { /* aborted/network error — keep the safe zero state */ }
    };
    void fetchUnread();
    const t = setInterval(() => void fetchUnread(), 30_000);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [user?.id]);

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

        {/* Logo — IMPERIAL HELIX CROWN */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <svg width="38" height="38" viewBox="0 0 44 44" fill="none"
            className="transition-all duration-300 group-hover:drop-shadow-[0_0_10px_rgba(201,168,76,0.8)]">

            {/* Outer ring */}
            <circle cx="22" cy="22" r="20" stroke="#C9A84C" strokeWidth="0.75"
              strokeOpacity="0.35" strokeDasharray="4 2.5" fill="none"/>

            {/* Crown */}
            <line x1="14" y1="14" x2="30" y2="14" stroke="#FFD700" strokeWidth="1.5" strokeLinecap="round"/>
            <polyline points="14,14 14,7 17,10 22,5 27,10 30,7 30,14"
              stroke="#FFD700" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="none"/>
            <path d="M14 14 L14 7 L17 10 L22 5 L27 10 L30 7 L30 14 Z"
              fill="#C9A84C" fillOpacity="0.12"/>
            <circle cx="14" cy="14" r="1.5" fill="#FFD700"/>
            <circle cx="22" cy="5"  r="2"   fill="#FFD700"/>
            <circle cx="30" cy="14" r="1.5" fill="#FFD700"/>

            {/* DNA left strand — gold */}
            <path d="M14 14 C22 18 30 22 22 26 C14 30 22 34 22 39"
              stroke="#C9A84C" strokeWidth="2" strokeLinecap="round" fill="none"/>

            {/* DNA right strand — cyan */}
            <path d="M30 14 C22 18 14 22 22 26 C30 30 22 34 22 39"
              stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" fill="none"/>

            {/* Rungs */}
            <line x1="17" y1="18" x2="27" y2="18" stroke="#C9A84C" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round"/>
            <line x1="14.5" y1="22" x2="29.5" y2="22" stroke="#C9A84C" strokeWidth="1" strokeOpacity="0.7" strokeLinecap="round"/>
            <circle cx="22" cy="22" r="1.2" fill="#C9A84C"/>
            <line x1="17" y1="26" x2="27" y2="26" stroke="#C9A84C" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round"/>
            <circle cx="22" cy="39" r="2" fill="#C9A84C" fillOpacity="0.6"/>
          </svg>

          {/* Wordmark */}
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-black text-base tracking-[0.12em] uppercase"
              style={{ color: "#C9A84C", letterSpacing: "0.12em", fontFamily: "inherit" }}>
              GDNA
            </span>
            <span className="text-[9px] font-bold tracking-[0.35em] uppercase"
              style={{ color: "#ffffff40", letterSpacing: "0.35em" }}>
              ARENA
            </span>
          </div>
        </Link>

        {/* ── Desktop nav ── */}
        <nav className="hidden md:flex min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto scrollbar-hide xl:justify-center">
          {NAV_ITEMS.map((item) => {
            const active    = isActive(item.path);
            const featured  = item.highlight && !active;
            const isDM      = item.path === "/messages";
            return (
              <Link
                key={item.name}
                href={item.path}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  active
                    ? "text-yellow-400 bg-yellow-400/10 border-b-2 border-yellow-400"
                    : featured
                      ? "text-yellow-400 border-b-2 border-yellow-400/60 hover:bg-yellow-400/10"
                      : "text-gray-300 hover:text-white hover:bg-white/5"
                }`}
              >
                {item.emoji && <span className="text-base leading-none">{item.emoji}</span>}
                {item.name}
                {isDM && unreadDMs > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                    {unreadDMs > 9 ? "9+" : unreadDMs}
                  </span>
                )}
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

          {/* Legal Center link */}
          <Link
            href="/legal"
            title="Legal Center"
            className="hidden md:flex items-center gap-1 text-gray-500 hover:text-yellow-400 transition-colors text-xs border border-gray-800 hover:border-yellow-400/30 rounded-lg px-2 py-1"
          >
            <Scale size={12} />
            <span className="hidden lg:block">Legal</span>
          </Link>

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
              <button
                onClick={() => {
                  void logout().catch(error =>
                    window.alert(error instanceof Error ? error.message : "Logout failed"));
                }}
                title={t("logout")}
                className="text-gray-400 hover:text-red-400 transition-colors"
              >
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
      <div className="md:hidden flex w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain gap-1 px-3 py-2 border-t border-gray-800/60 scrollbar-hide">
        {NAV_ITEMS.map((item) => {
          const active   = isActive(item.path);
          const featured = item.highlight && !active;
          const isDM     = item.path === "/messages";
          return (
            <Link
              key={item.name}
              href={item.path}
              onClick={() => setMobileOpen(false)}
              className={`relative flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? "text-yellow-400 bg-yellow-400/10"
                  : featured
                    ? "text-yellow-400 border-b border-yellow-400/60"
                    : "text-gray-400 hover:text-white"
              }`}
            >
              {item.emoji && <span>{item.emoji}</span>}
              {item.name}
              {isDM && unreadDMs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                  {unreadDMs > 9 ? "9+" : unreadDMs}
                </span>
              )}
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
            const isDM     = item.path === "/messages";
            return (
              <Link
                key={item.name}
                href={item.path}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 px-3 py-3 rounded-xl text-base font-semibold transition-all ${
                  active
                    ? "text-yellow-400 bg-yellow-400/10"
                    : featured
                      ? "text-yellow-400"
                      : "text-gray-300 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-xl leading-none">{item.emoji ?? "›"}</span>
                {item.name}
                {isDM && unreadDMs > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                    {unreadDMs > 9 ? "9+" : unreadDMs}
                  </span>
                )}
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
              <button onClick={() => {
                setMobileOpen(false);
                void logout().catch(error =>
                  window.alert(error instanceof Error ? error.message : "Logout failed"));
              }}
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
