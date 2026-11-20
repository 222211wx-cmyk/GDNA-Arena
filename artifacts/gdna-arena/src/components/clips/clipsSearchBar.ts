import { fetchFeed, type FeedClip } from "./reelsApi";
import {
  CATEGORY_LABELS, loadPrefs, orderedCategories, recordChoice, searchClips,
  type ClipCategory, type ClipType,
} from "./clipsSearch";

const BASE = import.meta.env.BASE_URL;
const go = (path: string) => window.location.assign(`${BASE}${path}`);
const TYPES: Array<[ClipType, string]> = [["audio", "Audio"], ["video", "Video"], ["image", "Image"]];

export const clipsSearchBarCss = `
.cs-bar{position:fixed;inset-block-start:0;inset-inline:0;z-index:60;padding:8px 10px;background:rgba(10,10,14,.92);backdrop-filter:blur(8px);display:grid;gap:6px;direction:rtl}
.cs-bar form.cs-row{display:flex;gap:6px;align-items:center;padding:0;margin:0;border:0;background:none}
.cs-bar input[type=search]{flex:1;min-inline-size:0;font:inherit;color:inherit;background:#1d1d26;border:1px solid #3a3a4a;border-radius:10px;padding:9px 12px}
.cs-chips{display:flex;gap:6px;overflow-x:auto;direction:ltr}
.cs-chip,.cs-help{font:inherit;font-size:.85rem;color:inherit;background:#1d1d26;border:1px solid #3a3a4a;border-radius:999px;padding:4px 12px;cursor:pointer;white-space:nowrap}
.cs-chip[aria-pressed=true]{background:#e8b64a;color:#111;border-color:#e8b64a;font-weight:700}
.cs-panel{max-block-size:60vh;overflow:auto;background:#14141b;border:1px solid #3a3a4a;border-radius:10px;padding:8px;display:grid;gap:6px;font-size:.9rem}
.cs-panel a,.cs-panel .cs-item{color:inherit;text-decoration:none;display:flex;gap:8px;align-items:center;padding:6px;border-radius:8px;background:#1d1d26}
.cs-panel img{inline-size:40px;block-size:40px;object-fit:cover;border-radius:6px}
.cs-muted{opacity:.7}
[hidden]{display:none!important}
.cs-spacer{block-size:84px}
`;

/** Search bar pinned at the top of the Clips tab. Direct jump, no login, no forced guide. */
export function mountClipsSearchBar(host: HTMLElement, opts: { initialCategory?: ClipCategory } = {}) {
  let prefs = loadPrefs();
  let category: ClipCategory | undefined = opts.initialCategory ?? prefs.last.category;
  let type: ClipType | undefined = prefs.last.type;
  let controller: AbortController | null = null;
  let debounce: number | undefined;

  const bar = document.createElement("div");
  bar.className = "cs-bar";
  bar.dataset.testid = "clips-search";
  bar.innerHTML = `
    <form class="cs-row" role="search">
      <input type="search" dir="auto" autocomplete="off" aria-label="Recherche"
        placeholder="بحث / Rechercher: منتج، ماتريكيلاسيون، A/B/C/D...">
      <button class="cs-help" type="button" aria-expanded="false">؟ كيف أبحث؟ / Comment chercher ?</button>
    </form>
    <div class="cs-chips" role="group" aria-label="Filtres"></div>
    <div class="cs-panel" data-testid="clips-search-guide" hidden></div>
    <div class="cs-panel" data-testid="clips-search-results" hidden></div>`;
  const form = bar.querySelector("form")!;
  const input = bar.querySelector("input")!;
  const help = bar.querySelector<HTMLButtonElement>(".cs-help")!;
  const chips = bar.querySelector<HTMLElement>(".cs-chips")!;
  const guide = bar.querySelector<HTMLElement>('[data-testid="clips-search-guide"]')!;
  const results = bar.querySelector<HTMLElement>('[data-testid="clips-search-results"]')!;

  guide.innerHTML = `<div>اكتب ماتريكيلاسيون <b>GDNA-CLIPS-B-0005</b> ← الصفحة مباشرة.<br>Tapez la matricule : ouverture directe.</div>
    <div>A / B / C / D ← المكتبة. «Ads» ← C، «خريطة» ← D. / Une lettre ouvre la bibliothèque.</div>
    <div>Audio · Video · Image: فلتر النوع. / Filtre par type.</div>`;
  help.addEventListener("click", () => {
    guide.hidden = !guide.hidden;
    help.setAttribute("aria-expanded", String(!guide.hidden));
  });

  function renderChips() {
    chips.replaceChildren();
    const make = (label: string, pressed: boolean, onClick: () => void, title?: string) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cs-chip"; b.textContent = label;
      b.setAttribute("aria-pressed", String(pressed));
      if (title) b.title = title;
      b.addEventListener("click", onClick);
      chips.append(b);
    };
    for (const c of orderedCategories(prefs)) {
      make(c, category === c, () => {
        category = category === c ? undefined : c;
        if (category) prefs = recordChoice(c, prefs);
        renderChips(); void run();
      }, CATEGORY_LABELS[c]);
    }
    for (const [t, label] of TYPES) {
      make(label, type === t, () => {
        type = type === t ? undefined : t;
        if (type) prefs = recordChoice(t, prefs);
        renderChips(); void run();
      });
    }
  }

  const row = (clip: FeedClip) => {
    const a = document.createElement("a");
    const cat = clip.category ?? "B";
    a.href = clip.matricule ? `${BASE}clips/${cat}/${clip.matricule}` : `${BASE}clip/${clip.code}`;
    if (clip.thumb) {
      const img = document.createElement("img");
      img.alt = ""; img.loading = "lazy"; img.src = `${BASE.replace(/\/$/, "")}${clip.thumb}`;
      a.append(img);
    }
    const text = document.createElement("span");
    text.dir = "auto";
    text.textContent = `${clip.title} — ${clip.matricule ?? clip.code ?? ""} · ${cat} · ${clip.media_type ?? ""}`;
    a.append(text);
    return a;
  };

  async function run(): Promise<FeedClip[] | null> {
    controller?.abort();
    const mine = (controller = new AbortController());
    const q = input.value.trim();
    const target = q ? searchClips(q) : null;
    let text = q, cat = category, typ = type;
    if (target?.kind === "filter") { typ = target.type; text = target.text; }
    if (!q && !cat && !typ) { results.hidden = true; return null; }
    results.hidden = false;
    results.replaceChildren(Object.assign(document.createElement("div"), { className: "cs-muted", textContent: "Recherche…" }));
    try {
      const page = await fetchFeed({ q: text, category: cat, type: typ, limit: 6 }, mine.signal);
      if (mine.signal.aborted) return null;
      results.replaceChildren();
      if (cat) {
        const open = document.createElement("a");
        open.href = `${BASE}clips/${cat}`;
        open.textContent = `→ ${CATEGORY_LABELS[cat]}`;
        results.append(open);
      }
      if (!page.clips.length) {
        results.append(Object.assign(document.createElement("div"), { className: "cs-muted", textContent: "Aucun résultat — لا نتيجة" }));
      }
      page.clips.forEach(c => results.append(row(c)));
      return page.clips;
    } catch {
      if (mine.signal.aborted) return null;
      results.replaceChildren(Object.assign(document.createElement("div"), { className: "cs-muted", textContent: "Recherche indisponible." }));
      return null;
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void run(), 250);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const q = input.value.trim();
    if (!q) { void run(); return; }
    const target = searchClips(q);
    if (target.kind === "matricule" || target.kind === "code" || target.kind === "library") {
      if (target.kind === "library") prefs = recordChoice(target.category, prefs);
      go(target.path); // 1 search = 1 direct page
      return;
    }
    if (target.kind === "filter" && target.type) { type = target.type; prefs = recordChoice(target.type, prefs); renderChips(); }
    const found = await run();
    if (found?.length === 1 && found[0].matricule) go(`clips/${found[0].category ?? "B"}/${found[0].matricule}`);
  });

  renderChips();
  host.append(bar);
  const spacer = document.createElement("div");
  spacer.className = "cs-spacer";
  return { element: bar, spacer, input, destroy: () => { controller?.abort(); bar.remove(); } };
}
