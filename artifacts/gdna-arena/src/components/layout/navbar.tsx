import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Gamepad2, Trophy, LogOut, Globe } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, LANGS, type Lang } from "@/contexts/LangContext";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();

  const baseLinks = [
    { key: "home", path: "/" },
    { key: "games", path: "/games" },
    { key: "news", path: "/news" },
    { key: "leaderboard", path: "/leaderboard" },
    { key: "ai", path: "/chat" },
  ];

  const authLinks = user
    ? [{ key: "dashboard", path: "/dashboard" }]
    : [
        { key: "login", path: "/login" },
        { key: "register", path: "/register" },
      ];

  const navLinks = [...baseLinks, ...authLinks];

  const handleLogout = async () => {
    await logout();
    setIsOpen(false);
  };

  const currentFlag = LANGS.find((l) => l.code === lang)?.flag ?? "🌐";

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-primary/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:neon-glow transition-all duration-300">
            <Gamepad2 className="w-6 h-6" />
          </div>
          <span className="font-bold text-xl tracking-tighter text-white neon-text-glow">GDNA Arena</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-5">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              href={link.path}
              className={`text-sm font-medium transition-colors hover:text-primary hover:neon-text-glow ${
                location === link.path ? "text-primary neon-text-glow" : "text-muted-foreground"
              }`}
            >
              {t(link.key)}
            </Link>
          ))}

          {/* Language Switcher */}
          <div className="relative">
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

          {user && (
            <div className="flex items-center gap-3 pl-4 border-l border-primary/20">
              <span className="text-xs text-primary font-bold uppercase tracking-widest flex items-center gap-1">
                <Trophy className="w-3 h-3" />
                {user.balance.toLocaleString()} {t("coins")}
              </span>
              <button
                onClick={handleLogout}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title={t("logout")}
                data-testid="button-logout-nav"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden text-primary hover:text-white transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="md:hidden border-b border-primary/20 bg-background px-4 py-4 space-y-4">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              href={link.path}
              className={`block text-lg font-medium transition-colors hover:text-primary ${
                location === link.path ? "text-primary neon-text-glow" : "text-muted-foreground"
              }`}
              onClick={() => setIsOpen(false)}
            >
              {t(link.key)}
            </Link>
          ))}

          {/* Mobile Language Switcher */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-primary/10">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code as Lang); setIsOpen(false); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  lang === l.code
                    ? "border-primary text-primary bg-primary/10"
                    : "border-primary/20 text-muted-foreground hover:border-primary/50"
                }`}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>

          {user && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-lg font-medium text-destructive hover:text-destructive/80 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t("logout")}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
