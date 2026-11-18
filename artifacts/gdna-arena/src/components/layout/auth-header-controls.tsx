import { useLocation } from "wouter";
import { LogOut, LayoutDashboard } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@workspace/gdna-ds/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { authCopy } from "@/i18n/auth-v2-copy";
import { useAuthModal } from "@/components/auth/AuthModal";

/** Right end of the header (left in Arabic): Log in + Sign up, or avatar + name once signed in. */
export function AuthHeaderControls() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  const copy = authCopy(lang);
  const modal = useAuthModal();
  const [, setLocation] = useLocation();

  if (!user) {
    return (
      <div className="flex items-center gap-2" data-testid="auth-buttons">
        <Button type="button" size="sm" data-testid="header-login" className="bg-white text-black hover:bg-white/90"
          onClick={() => modal.open("login")}>{copy.login}</Button>
        <Button type="button" size="sm" data-testid="header-signup" className="bg-orange-500 text-white hover:bg-orange-600"
          onClick={() => modal.open("signup")}>{copy.signup}</Button>
      </div>
    );
  }
  const name = user.displayName ?? user.username;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-2 px-1" data-testid="header-user" aria-label={`${copy.account}: ${name}`}>
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
            : <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{name.slice(0, 1).toUpperCase()}</span>}
          <span className="hidden max-w-[8rem] truncate text-sm font-medium sm:inline" data-testid="header-username">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setLocation("/dashboard")}><LayoutDashboard aria-hidden="true" /> {copy.dashboard}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="header-logout" onSelect={() => { void logout().then(() => setLocation("/")); }}><LogOut aria-hidden="true" /> {copy.logout}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
