// Persistent bottom tab bar: [Accueil] [Clips] [+] [Boîte] [Profil].
// Shared by the Reels feed and the /profil and /boite pages.

import { reelsIcons } from "./reelsIcons";

const BASE = import.meta.env.BASE_URL;

export type TabKey = "home" | "clips" | "inbox" | "profile";

function tab(tag: "a" | "button", key: string, label: string, iconHtml: string, active: boolean) {
  const node = document.createElement(tag);
  node.className = "reels-nav-item";
  node.dataset.nav = key;
  node.dataset.active = String(active);
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  node.innerHTML = iconHtml;
  const text = document.createElement("span");
  text.textContent = label;
  node.append(text);
  return node;
}

export function buildTabbar(active: TabKey | null, onPublish: () => void) {
  const nav = document.createElement("nav");
  nav.className = "reels-bottomnav";
  nav.setAttribute("aria-label", "Navigation principale");
  const home = tab("a", "home", "Accueil", reelsIcons.navHome(active === "home"), active === "home");
  (home as HTMLAnchorElement).href = `${BASE}cli`;
  const clips = tab("a", "clips", "Clips", reelsIcons.navReels(active === "clips"), active === "clips");
  (clips as HTMLAnchorElement).href = `${BASE}cli?view=grid`;
  const publish = document.createElement("button");
  publish.type = "button";
  publish.className = "reels-nav-plus";
  publish.dataset.nav = "publish";
  publish.setAttribute("aria-label", "Publier");
  publish.innerHTML = reelsIcons.plus();
  publish.addEventListener("click", onPublish);
  const inbox = tab("a", "inbox", "Boîte", reelsIcons.navInbox(active === "inbox"), active === "inbox");
  (inbox as HTMLAnchorElement).href = `${BASE}boite`;
  inbox.setAttribute("aria-label", "Boîte");
  inbox.style.position = "relative";
  const profile = tab("a", "profile", "Profil", reelsIcons.navUser(active === "profile"), active === "profile");
  (profile as HTMLAnchorElement).href = `${BASE}profil`;
  nav.append(home, clips, publish, inbox, profile);
  return { nav, inbox };
}
