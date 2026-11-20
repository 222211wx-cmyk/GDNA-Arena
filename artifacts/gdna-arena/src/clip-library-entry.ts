import { tokens } from "@workspace/gdna-ds/tokens";
import { fetchFeed, type FeedClip } from "./components/clips/reelsApi";
import { mountClipsSearchBar, clipsSearchBarCss } from "./components/clips/clipsSearchBar";
import { CATEGORY_LABELS, recordChoice, type ClipCategory } from "./components/clips/clipsSearch";

// /clips/A            → Library A (all works, newest first)
// /clips/B/GDNA-CLIPS-B-0005 → producer page: that producer's works
const BASE = import.meta.env.BASE_URL;
const root = document.getElementById("root")!;
const palette = tokens.color.dark;
const path = window.location.pathname.slice(BASE.replace(/\/$/, "").length).replace(/\/+$/, "");
const match = /^\/clips\/([A-Da-d])(?:\/(GDNA-CLIPS-[A-Da-d]-\d{4,}))?$/i.exec(path);
const category = (match?.[1] ?? "B").toUpperCase() as ClipCategory;
const matricule = match?.[2]?.toUpperCase();
recordChoice(category);

const style = document.createElement("style");
style.textContent = `:root{color-scheme:dark;background:${palette.background};color:${palette.foreground};font-family:${tokens.fontFamily.sans.join(",")}}
body{margin:0}main{max-width:60rem;margin:auto;padding:16px;direction:rtl}
h1{margin:8px 0}.muted{opacity:.7}a{color:${palette.primary}}
.lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-block:12px}
.lib-card{display:grid;gap:4px;background:${palette.card};border:1px solid ${palette.border};border-radius:10px;overflow:hidden;color:inherit;text-decoration:none}
.lib-card.sel{outline:2px solid ${palette.primary}}
.lib-thumb{aspect-ratio:1;background:${palette.secondary};display:grid;place-items:center;object-fit:cover;inline-size:100%}
.lib-meta{padding:6px 8px;font-size:.8rem;display:grid;gap:2px}
button.more{font:inherit;color:inherit;background:${palette.secondary};border:1px solid ${palette.input};border-radius:8px;padding:8px 16px;cursor:pointer}
${clipsSearchBarCss}`;
document.head.append(style);
document.documentElement.lang = "ar";
document.documentElement.dir = "rtl";

root.replaceChildren();
const search = mountClipsSearchBar(root, { initialCategory: category });
const main = document.createElement("main");
main.dataset.testid = "clip-library";
root.append(search.spacer, main);

const title = document.createElement("h1");
title.dir = "ltr";
const sub = document.createElement("p");
sub.className = "muted";
const nav = document.createElement("p");
const back = document.createElement("a");
back.href = `${BASE}clips`;
back.textContent = "← Clips";
nav.append(back);
const grid = document.createElement("div");
grid.className = "lib-grid";
const status = document.createElement("p");
status.className = "muted";
status.setAttribute("role", "status");
const more = document.createElement("button");
more.className = "more";
more.type = "button";
more.textContent = "Plus / المزيد";
more.hidden = true;
main.append(nav, title, sub, grid, status, more);

const card = (clip: Pick<FeedClip, "id" | "title" | "code" | "thumb" | "matricule" | "media_type" | "category">, selected = false) => {
  const a = document.createElement("a");
  a.className = "lib-card" + (selected ? " sel" : "");
  a.href = `${BASE}clip/${clip.code}`;
  if (clip.thumb) {
    const img = document.createElement("img");
    img.className = "lib-thumb"; img.alt = ""; img.loading = "lazy";
    img.src = `${BASE.replace(/\/$/, "")}${clip.thumb}`;
    a.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "lib-thumb";
    ph.textContent = clip.media_type === "audio" ? "♪" : clip.media_type === "image" ? "▣" : "▶";
    a.append(ph);
  }
  const meta = document.createElement("div");
  meta.className = "lib-meta";
  const t = document.createElement("strong"); t.dir = "auto"; t.textContent = clip.title;
  const m = document.createElement("span"); m.className = "muted"; m.dir = "ltr";
  m.textContent = `${clip.matricule ?? clip.code} · ${clip.media_type ?? ""}`;
  meta.append(t, m);
  a.append(meta);
  return a;
};

async function loadProducer(id: string) {
  const response = await fetch(`${BASE}api/clips/library/${category}/${id}`, { credentials: "include" });
  if (response.status === 404) { status.textContent = "Matricule introuvable — المصفوفة غير موجودة"; title.textContent = id; return; }
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  title.textContent = `@${data.producer.username}`;
  sub.textContent = `${id} — ${CATEGORY_LABELS[category]}`;
  grid.replaceChildren(...data.works.map((w: FeedClip) => card(w, w.id === data.selectedId)));
  status.textContent = data.works.length ? "" : "Aucune œuvre.";
}

let cursor: number | null = null;
async function loadLibrary() {
  more.hidden = true;
  status.textContent = "…";
  const page = await fetchFeed({ before: cursor, category, limit: 6 });
  grid.append(...page.clips.map(c => card(c)));
  cursor = page.nextBefore;
  more.hidden = !page.hasMore;
  status.textContent = grid.childElementCount ? "" : "Aucune œuvre pour l'instant — لا أعمال بعد";
}

title.textContent = matricule ? matricule : `${category} — ${CATEGORY_LABELS[category]}`;
sub.textContent = matricule ? "" : CATEGORY_LABELS[category];
more.addEventListener("click", () => void loadLibrary().catch(() => { status.textContent = "Indisponible — réessayez."; }));
const start = matricule ? loadProducer(matricule) : loadLibrary();
start.catch(() => { status.textContent = "Indisponible — réessayez."; });
document.body.dataset.clipReady = "true";
