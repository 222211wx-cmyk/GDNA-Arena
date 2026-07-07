import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Gamepad2, Trophy, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const baseLinks = [
    { name: "Home", path: "/" },
    { name: "Games", path: "/games" },
    { name: "News", path: "/news" },
    { name: "Leaderboard", path: "/leaderboard" },
    { name: "GDN-AI", path: "/chat" },
  ];

  const authLinks = user
    ? [{ name: "Dashboard", path: "/dashboard" }]
    : [
        { name: "Login", path: "/login" },
        { name: "Register", path: "/register" },
      ];

  const navLinks = [...baseLinks, ...authLinks];

  const handleLogout = async () => {
    await logout();
    setIsOpen(false);
  };

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
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              href={link.path}
              className={`text-sm font-medium transition-colors hover:text-primary hover:neon-text-glow ${
                location === link.path ? "text-primary neon-text-glow" : "text-muted-foreground"
              }`}
            >
              {link.name}
            </Link>
          ))}
          {user && (
            <div className="flex items-center gap-3 ml-2 pl-4 border-l border-primary/20">
              <span className="text-xs text-primary font-bold uppercase tracking-widest flex items-center gap-1">
                <Trophy className="w-3 h-3" />
                {user.balance.toLocaleString()} coins
              </span>
              <button
                onClick={handleLogout}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Logout"
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
              className={`block text-lg font-medium transition-colors hover:text-primary hover:neon-text-glow ${
                location === link.path ? "text-primary neon-text-glow" : "text-muted-foreground"
              }`}
              onClick={() => setIsOpen(false)}
            >
              {link.name}
            </Link>
          ))}
          {user && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-lg font-medium text-destructive hover:text-destructive/80 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
