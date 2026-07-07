import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  const navLinks = [
    { name: "Home", path: "/" },
    { name: "Games", path: "/games" },
    { name: "News", path: "/news" },
    { name: "Dashboard", path: "/dashboard" },
    { name: "Login", path: "/login" },
  ];

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
        </div>
      )}
    </nav>
  );
}
