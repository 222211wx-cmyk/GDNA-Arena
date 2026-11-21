// Persistent bottom tab bar, icons only: Accueil, Reels, Amis, Boutique,
// Notifications (badge), Profil (avatar). Shared by the feed and /profil.

import { reelsIcons } from "./reelsIcons";

const BASE = import.meta.env.BASE_URL;

export type TabKey = "home" | "reels" | "friends" | "market" | "notif" | "profile";

function tab(tag: "a" | "button", key: TabKey, label: string, iconHtml: string, active: boolean) {
  const node = document.createElement(tag);
  node.className = "reels-nav-item reels-badge-host";
  node.dataset.nav = key;
  node.dataset.active = String(active);
  node.setAttribute("aria-label", label);
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  node.innerHTML = iconHtml;
  return node;
}

export function buildTabbar(
  active: TabKey | null,
  opts: { onNotif: () => void; avatarUrl?: string | null },
) {
  const nav = document.createElement("nav");
  nav.className = "reels-bottomnav";
  nav.setAttribute("aria-label", "Navigation principale");
  const link = (key: TabKey, label: string, href: string, icon: string) => {
    const a = tab("a", key, label, icon, active === key) as HTMLAnchorElement;
    a.href = href;
    return a;
  };
  const home = link("home", "Accueil", `${BASE}`, reelsIcons.navHome(active === "home"));
  const reels = link("reels", "Reels", `${BASE}cli`, reelsIcons.navReels(active === "reels"));
  const friends = link("friends", "Amis", `${BASE}friends`, reelsIcons.navFriends(active === "friends"));
  const market = link("market", "Boutique", `${BASE}shop`, reelsIcons.navShop(active === "market"));
  const notif = tab("button", "notif", "Notifications", reelsIcons.navBell(active === "notif"), active === "notif") as HTMLButtonElement;
  notif.addEventListener("click", opts.onNotif);
  const profile = link("profile", "Profil", `${BASE}profil`, reelsIcons.navUser(active === "profile"));
  if (opts.avatarUrl) {
    const img = document.createElement("img");
    img.className = "reels-nav-avatar";
    img.alt = "";
    img.src = opts.avatarUrl;
    profile.replaceChildren(img);
  }
  nav.append(home, reels, friends, market, notif, profile);
  return { nav, notif, profile };
}
