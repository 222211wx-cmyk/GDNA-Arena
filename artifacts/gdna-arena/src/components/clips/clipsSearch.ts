/** Smart search for the Clips tab: one query resolves to one direct destination. */
export type ClipCategory = "A" | "B" | "C" | "D";
export type ClipType = "audio" | "video" | "image";

export const CATEGORY_LABELS: Record<ClipCategory, string> = {
  A: "Grands Producteurs / المنتجين الكبار",
  B: "Petits Producteurs / المنتجين الصغار",
  C: "Publicités / إشهارات",
  D: "Cartes, Guides, Géo, Histoire / خرائط، إرشادات، تاريخ",
};

export type SearchTarget =
  | { kind: "matricule"; category: ClipCategory; matricule: string; path: string }
  | { kind: "code"; path: string }
  | { kind: "library"; category: ClipCategory; path: string }
  | { kind: "filter"; category?: ClipCategory; type?: ClipType; text: string }
  | { kind: "text"; text: string };

const CATEGORY_WORDS: Array<[RegExp, ClipCategory]> = [
  [/(?:^|\s)(?:grands?|producteurs?|المنتجين الكبار|كبار)(?:\s|$)/i, "A"],
  [/(?:^|\s)(?:petits?|صغار|المنتجين الصغار)(?:\s|$)/i, "B"],
  [/(?:^|\s)(?:ads?|pubs?|publicit[ée]s?|إشهار(?:ات)?|اشهار(?:ات)?|إعلان(?:ات)?)(?:\s|$)/i, "C"],
  [/(?:^|\s)(?:cartes?|maps?|guides?|g[ée]o\w*|histoire|history|خريطة|خرائط|إرشادات?|ارشادات?|جيوغراف\w*|تاريخ)(?:\s|$)/i, "D"],
];
const TYPE_WORDS: Array<[RegExp, ClipType]> = [
  [/^(?:audio|صوت|أوديو|اوديو)$/i, "audio"],
  [/^(?:video|vidéo|فيديو)$/i, "video"],
  [/^(?:image|images|photo|صورة|صور)$/i, "image"],
];

export function normalizeMatricule(category: string, digits: string): string {
  return `GDNA-CLIPS-${category.toUpperCase()}-${digits.padStart(4, "0")}`;
}

/** Pure: decides where a query goes. Never touches the network, login or guide. */
export function searchClips(query: string): SearchTarget {
  const q = query.trim().replace(/\s+/g, " ");
  const matricule = /^(?:GDNA-?CLIPS-?)?([A-D])-?(\d{1,6})$/i.exec(q);
  if (matricule && (/GDNA/i.test(q) || /^[A-D]-\d+$/i.test(q))) {
    const category = matricule[1].toUpperCase() as ClipCategory;
    const id = normalizeMatricule(category, matricule[2]);
    return { kind: "matricule", category, matricule: id, path: `clips/${category}/${id}` };
  }
  const helx = /^HELX-?(\d{6})$/i.exec(q);
  if (helx) return { kind: "code", path: `clip/HELX-${helx[1]}` };
  if (/^[A-D]$/i.test(q)) {
    const category = q.toUpperCase() as ClipCategory;
    return { kind: "library", category, path: `clips/${category}` };
  }
  for (const [re, type] of TYPE_WORDS) if (re.test(q)) return { kind: "filter", type, text: "" };
  for (const [re, category] of CATEGORY_WORDS) {
    if (re.test(q)) return { kind: "library", category, path: `clips/${category}` };
  }
  return { kind: "text", text: q };
}

// ── Memory: "if the user always watches A, show A first" ─────────────────────
const PREFS_KEY = "gdna.clips.search.v1";
type Prefs = { last: { category?: ClipCategory; type?: ClipType }; counts: Record<string, number>; guideSeen?: boolean };
const empty = (): Prefs => ({ last: {}, counts: {} });

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    return raw && typeof raw === "object" ? { ...empty(), ...raw } : empty();
  } catch { return empty(); }
}
export function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}
export function recordChoice(key: ClipCategory | ClipType, prefs = loadPrefs()): Prefs {
  const next: Prefs = { ...prefs, counts: { ...prefs.counts, [key]: (prefs.counts[key] ?? 0) + 1 } };
  if ("ABCD".includes(key)) next.last = { ...next.last, category: key as ClipCategory };
  else next.last = { ...next.last, type: key as ClipType };
  savePrefs(next);
  return next;
}
/** Most-used categories first; ties keep A,B,C,D order. */
export function orderedCategories(prefs = loadPrefs()): ClipCategory[] {
  const all: ClipCategory[] = ["A", "B", "C", "D"];
  return all
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (prefs.counts[y.c] ?? 0) - (prefs.counts[x.c] ?? 0) || x.i - y.i)
    .map(x => x.c);
}
