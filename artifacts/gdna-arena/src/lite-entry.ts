/**
 * GDNA Lite entry. Vanilla DOM. Exported as default and named `mountLite`.
 *
 *   import mountLite, { mountLite as named } from "./lite-entry";
 *   const dispose = mountLite();            // mounts into #lite-root or <body>
 *   const dispose2 = mountLite(rootElement); // or an explicit element
 *
 * The infrastructure owner (Vite/index/SW/bootstrap) calls this. See
 * src/lite/README.md for the wiring contract.
 */
import "./lite/tokens.css";
import { el, mount, skeleton } from "./lite/dom";
import { networkBanner } from "./lite/components";
import { parseRoute, href, editionOf, type Route } from "./lite/router";
import { EDITION_LANGS, RTL_LANGS, stringsFor, type LiteLang, type Strings } from "./lite/i18n";
import { refreshSession, subscribeSession, getUser } from "./lite/session";
import { syncQueue } from "./lite/messaging";
import {
  homePage,
  profilePage,
  marketPage,
  clipsPage,
  hisnPage,
  messagesPage,
  settingsPage,
  loginPage,
} from "./lite/pages";

interface MountOptions {
  /** Override the initial language. Otherwise derived from the edition + storage. */
  lang?: LiteLang;
}

interface Ctx {
  s: Strings;
  lang: LiteLang;
  edition: "default" | "in" | "africa" | "brasil";
  navigate: (r: Route) => void;
  setLang: (l: LiteLang) => void;
}

const REF_SOURCES = new Set(["inwi", "orange", "itissalat", "star6"]);

/** Read a valid `?ref=` referral source from the URL, else null. */
function referralFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(location.search).get("ref");
    const v = raw?.toLowerCase().trim();
    return v && REF_SOURCES.has(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Record affiliate attribution once per referral value. This ONLY records
 * attribution — it never verifies, discounts, or provisions a pack, and creates
 * no commission (there is no signed partnership). Contract: strict
 * `{source, eventId:UUID}`; the server returns `{accepted, duplicate}` and the
 * first source per session wins. Best-effort; failures are swallowed so a
 * referral never blocks the portal.
 */
function recordReferralOnce(source: string): void {
  const key = `gdna-lite:ref:${source}`;
  try {
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* ignore — still attempt to record */
  }
  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const eventId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    void fetch(`${apiBase}/api/operators/referral`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, eventId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

function storedLang(): LiteLang | null {
  try {
    return (localStorage.getItem("gdna-lite:lang") as LiteLang) || null;
  } catch {
    return null;
  }
}
function storeLang(l: LiteLang): void {
  try {
    localStorage.setItem("gdna-lite:lang", l);
  } catch {
    /* ignore */
  }
}

function defaultLangFor(edition: string, override?: LiteLang): LiteLang {
  const menu = EDITION_LANGS[edition] ?? EDITION_LANGS.default;
  const stored = override ?? storedLang();
  if (stored && menu.includes(stored)) return stored;
  return menu[0];
}

export function mountLite(root?: Element | null, options: MountOptions = {}): () => void {
  const host =
    root ?? document.getElementById("lite-root") ?? document.body;
  if (!host) throw new Error("mountLite: no mount target found.");

  const app = el("div", { class: "l-app" });
  const bannerHost = el("div", {});
  const refHost = el("div", {});
  const nav = el("nav", { class: "l-nav" });
  const outlet = el("div", {});
  app.appendChild(bannerHost);
  app.appendChild(refHost);
  app.appendChild(nav);
  app.appendChild(outlet);
  mount(host, app);

  let route = parseRoute(location.pathname);
  let lang = defaultLangFor(editionOf(route), options.lang);

  const net = networkBanner(stringsFor(lang));
  mount(bannerHost, net.node);

  // Referral attribution: record once, then show a banner that makes clear this
  // is attribution only (no verification, discount, or pack provisioning).
  const referral = referralFromUrl();
  if (referral) {
    recordReferralOnce(referral);
    void import("./lite/pages-operators").then(({ referralBanner }) => {
      mount(refHost, referralBanner(stringsFor(lang), referral));
    });
  }

  function ctx(): Ctx {
    const edition = editionOf(route);
    return {
      s: stringsFor(lang),
      lang,
      edition,
      navigate: (r) => go(href(r)),
      setLang: (l) => {
        lang = l;
        storeLang(l);
        render();
      },
    };
  }

  function applyDir(): void {
    const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
  }

  function renderNav(): void {
    const c = ctx();
    const items: Array<{ label: string; r: Route }> = [
      { label: c.s.nav_home, r: { kind: "home", edition: c.edition } },
      { label: c.s.nav_market, r: { kind: "market" } },
      { label: c.s.nav_clips, r: { kind: "clips" } },
      { label: c.s.nav_hisn, r: { kind: "hisn" } },
      { label: c.s.nav_messages, r: { kind: "messages" } },
      { label: c.s.nav_operators, r: { kind: "operators" } },
      { label: c.s.nav_data, r: { kind: "data" } },
      { label: c.s.nav_settings, r: { kind: "settings" } },
    ];
    const links = items.map(({ label, r }) => {
      const active = r.kind === route.kind;
      return el("a", {
        href: href(r),
        class: active ? "is-active" : "",
        onClick: (e: Event) => {
          e.preventDefault();
          go(href(r));
        },
      }, [label]);
    });
    const user = getUser();
    links.push(
      el("a", {
        href: href({ kind: "login" }),
        class: route.kind === "login" ? "is-active" : "",
        style: "margin-inline-start:auto",
        onClick: (e: Event) => {
          e.preventDefault();
          go(href({ kind: "login" }));
        },
      }, [user ? `@${user.username}` : c.s.login]),
    );
    mount(nav, ...links);
  }

  function renderOutlet(): void {
    const c = ctx();
    let page: HTMLElement;
    switch (route.kind) {
      case "home":
        page = homePage(c);
        break;
      case "profile":
        page = profilePage(c, route.username);
        break;
      case "market":
        page = marketPage(c);
        break;
      case "clips":
        page = clipsPage(c);
        break;
      case "hisn":
        page = hisnPage(c);
        break;
      case "messages":
        page = messagesPage(c, route.roomId);
        break;
      case "settings":
        page = settingsPage(c);
        break;
      case "operators":
      case "data": {
        // Dynamically imported so the operator programme never grows the Lite
        // core first-load. Show a bounded skeleton while the module arrives.
        const kind = route.kind;
        page = el("div", { class: "l-stack" }, [skeleton(5)]);
        const target = page;
        void import("./lite/pages-operators")
          .then((mod) => {
            // Ignore if the user navigated away before the module resolved.
            if (route.kind !== kind || !target.isConnected) return;
            const node = kind === "operators" ? mod.operatorsPage(c) : mod.dataPage(c);
            mount(target, node);
          })
          .catch(() => {
            if (route.kind !== kind || !target.isConnected) return;
            mount(
              target,
              el("div", { class: "l-card l-stack" }, [
                el("div", { class: "l-err", text: c.s.section_error }),
                el("button", { class: "l-btn l-btn-sm", text: c.s.retry, onClick: () => render() }),
              ]),
            );
          });
        break;
      }
      case "partners-operators":
      case "partners-dashboard": {
        // Partner surfaces served through the Lite shell at their exact root
        // URLs, dynamically imported so they never enter the Lite core graph.
        const kind = route.kind;
        page = el("div", { class: "l-stack" }, [skeleton(6)]);
        const target = page;
        void import("./lite/pages-partners")
          .then((mod) => {
            if (route.kind !== kind || !target.isConnected) return;
            const node =
              kind === "partners-operators"
                ? mod.partnersOperatorsPage(c)
                : mod.partnersDashboardPage(c);
            mount(target, node);
          })
          .catch(() => {
            if (route.kind !== kind || !target.isConnected) return;
            mount(
              target,
              el("div", { class: "l-card l-stack" }, [
                el("div", { class: "l-err", text: c.s.section_error }),
                el("button", { class: "l-btn l-btn-sm", text: c.s.retry, onClick: () => render() }),
              ]),
            );
          });
        break;
      }
      case "login":
        page = loginPage(c);
        break;
    }
    mount(outlet, page);
  }

  function render(): void {
    applyDir();
    renderNav();
    renderOutlet();
  }

  function go(url: string): void {
    if (url !== location.pathname) history.pushState({}, "", url);
    route = parseRoute(location.pathname);
    // Re-derive language when the edition changes and current lang isn't offered.
    const menu = EDITION_LANGS[editionOf(route)] ?? EDITION_LANGS.default;
    if (!menu.includes(lang)) lang = defaultLangFor(editionOf(route));
    render();
    window.scrollTo(0, 0);
  }

  const onPop = () => {
    route = parseRoute(location.pathname);
    render();
  };
  window.addEventListener("popstate", onPop);

  // Session: reflect login state in the nav; drain the offline queue on login.
  // Re-render the whole view on account change so a logout/switch cannot leave one
  // account's snapshots or conversation on screen under another session.
  let lastNavId: number | null = getUser()?.id ?? null;
  const unsubSession = subscribeSession((u) => {
    const id = u?.id ?? null;
    if (id !== lastNavId) {
      lastNavId = id;
      render();
    } else {
      renderNav();
    }
  });
  // Bounded UI drainer. Caps consecutive UI-initiated passes at 3 and refuses to
  // immediately re-drain right after a worker "sync" notification when the last pass
  // stopped for auth or was left pending — the worker owns retry/backoff, so a UI
  // redraw storm cannot hammer the send endpoint or the shared queue.
  let uiDrainPasses = 0;
  let draining = false;
  let lastPassStopped = false; // auth-stop or retry-due on the previous pass
  const drainCoolDownMs = 4000;
  let lastDrainAt = 0;

  const drain = async (source: "online" | "session" | "sw"): Promise<void> => {
    const user = getUser();
    if (!user || !navigator.onLine || draining) return;
    // After a worker notification, skip if the previous pass stopped and we are
    // still inside the cool-down window.
    if (source === "sw" && lastPassStopped && Date.now() - lastDrainAt < drainCoolDownMs) return;
    if (uiDrainPasses >= 3 && source !== "online") return; // reset only on reconnect
    draining = true;
    lastDrainAt = Date.now();
    uiDrainPasses++;
    try {
      const res = await syncQueue(user, () => getUser()?.id ?? null);
      lastPassStopped = res.retry || res.needsReview > 0;
      if (!lastPassStopped) uiDrainPasses = 0; // fully drained — clear the cap
    } catch {
      lastPassStopped = true;
    } finally {
      draining = false;
    }
  };

  void refreshSession().then(() => void drain("session"));

  const onOnline = () => {
    uiDrainPasses = 0; // reconnect resets the UI retry budget
    lastPassStopped = false;
    void drain("online");
  };
  window.addEventListener("online", onOnline);
  const onSwMessage = (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type === "gdna-lite-sync") void drain("sw");
  };
  navigator.serviceWorker?.addEventListener?.("message", onSwMessage);

  render();

  return () => {
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("online", onOnline);
    navigator.serviceWorker?.removeEventListener?.("message", onSwMessage);
    unsubSession();
    net.dispose();
    mount(host);
  };
}

export default mountLite;
