// /profil and /boite: same black chrome as the feed (title bar + tab bar).
// Reading the feed never needs an account; [Entrer] lives only on /profil.

import { resolveIdentity } from "./reelsApi";
import { buildTabbar } from "./reelsTabbar";

const BASE = import.meta.env.BASE_URL;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function mountPage(root: HTMLElement, kind: "profil" | "boite", onPublish: () => void) {
  const shell = node("div", "reels-shell");
  shell.dataset.testid = `${kind}-page`;
  const topbar = node("div", "reels-topbar");
  topbar.append(node("span"), node("h1", "reels-title", kind === "profil" ? "Profil" : "Boîte"), node("span"));
  const page = node("div", "reels-page");
  const { nav } = buildTabbar(kind === "profil" ? "profile" : "inbox", onPublish);
  shell.append(topbar, page, nav);
  root.replaceChildren(shell);

  void resolveIdentity().then(identity => {
    const signedIn = identity.status === "authenticated" && Boolean(identity.username);
    if (kind === "profil") {
      if (signedIn && identity.status === "authenticated") {
        const avatar = node("a", "reels-rail-avatar") as HTMLAnchorElement;
        avatar.href = `${BASE}u/${encodeURIComponent(identity.username!)}`;
        if (identity.avatarUrl) {
          const img = node("img") as HTMLImageElement;
          img.alt = "";
          img.src = identity.avatarUrl;
          avatar.append(img);
        } else avatar.textContent = identity.username!.slice(0, 2).toUpperCase();
        page.append(avatar, node("p", "reels-page-name", `@${identity.username}`));
      } else {
        page.append(node("p", "reels-page-name", "Visiteur"));
        const enter = node("a", "reels-page-btn", "Entrer") as HTMLAnchorElement;
        enter.href = `${BASE}login`;
        page.append(enter);
      }
    } else if (signedIn) {
      const open = node("a", "reels-page-btn", "Ouvrir mes messages") as HTMLAnchorElement;
      open.href = `${BASE}messages`;
      page.append(open);
    } else {
      page.append(node("p", "reels-page-muted", "Aucun message"));
    }
  });
}
