import { tokens } from "@workspace/gdna-ds/tokens";
import { createLightweightCallBoundary } from "./lib/lightweight-call-boundary";
import {
  uploadClip,
  validateUploadFile,
  isZipFile,
  waitForArchive,
  type ClipUploadMetadata,
} from "./components/clips/clipUpload";
import { markGuideSeen } from "./components/clips/guide";
import { mountPage } from "./components/clips/reelsPages";
import { mountClipsSearchBar, clipsSearchBarCss } from "./components/clips/clipsSearchBar";
import { readClipDuration } from "./components/clips/readClipDuration";
import { clipOverlayCss } from "./components/clips/clipOverlayStyles";
import { reelsShellCss } from "./components/clips/reelsStyles";
import { mountReels, type ReelsController } from "./components/clips/reelsFeed";

// ── شروط النشر ديال المواطن ──
const BASE = import.meta.env.BASE_URL;
const MIN_CLIP_DURATION_SEC = 30; // 30 ثانية و لفوق، بلا سقف
const MAX_CLIPS_PER_PUBLISH = 3; // 3 كليبات
const FEED_AD_EVERY = 3; // كل 3 كليبات = إشهار واحد
const CLIP_TERMS_VERSION = "v3";
const CLIP_BLACK_BOX_ENABLED = true;
const CLIP_ALLOW_SHARE = true;
const CLIP_ALLOW_ALL_FEATURES = true;

const root = document.getElementById("root");
if (!root) throw new Error("Clip root is missing");
const palette = tokens.color.dark;
const space = tokens.spacing;
const style = document.createElement("style");
style.textContent = ` :root{color-scheme:dark;font-family:${tokens.fontFamily.sans.join(",")};background:${palette.background};color:${palette.foreground}} *{box-sizing:border-box}body{margin:0;background:${palette.background};color:${palette.foreground}} main{padding:calc(${space} * 4);margin:auto;max-width:48rem}header{display:flex;align-items:center;justify-content:space-between} section,form{display:grid;gap:calc(${space} * 3);padding:calc(${space} * 4);margin-block:calc(${space} * 4);background:${palette.card};border:1px solid ${palette.border};border-radius:${tokens.radius}} h1,h2,p{margin-block:calc(${space} * 2)}label{display:grid;gap:calc(${space} * 2)} input,select,button{font:inherit;color:inherit;background:${palette.secondary};border:1px solid ${palette.input};border-radius:${tokens.radius};padding:calc(${space} * 3)} input[type=checkbox],input[type=radio]{inline-size:auto}button{cursor:pointer;background:${palette.primary};color:${palette.primaryForeground};font-weight:700} button.secondary{background:${palette.secondary};color:${palette.secondaryForeground}}button:disabled{opacity:.55;cursor:not-allowed} fieldset{display:grid;gap:calc(${space} * 3);border:1px solid ${palette.border};border-radius:${tokens.radius}} fieldset label{display:flex;align-items:center;gap:calc(${space} * 2)} progress{inline-size:100%;accent-color:${palette.primary}}video,audio{inline-size:100%;max-block-size:60vh;background:${palette.background};display:block} .clip-media-frame{overflow:hidden;position:relative;border-radius:${tokens.radius}} ${clipOverlayCss(palette, space)} .comment-form,.title-edit{display:flex;gap:calc(${space} * 2)}.comment-form input,.title-edit input{min-inline-size:0;flex:1} .copy-link-fallback{inline-size:min(100%,28rem)} .clip-zoomed{transform:scale(1.35);transform-origin:center;position:relative;z-index:2}article{overflow:visible} a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important} ${clipsSearchBarCss} ${reelsShellCss(palette as unknown as Record<string, string>, space)} #reels-root main{padding:0;margin:0;max-width:none} #reels-root main > header{display:none} .reels-css-fullscreen{background:${palette.background}} .reels-install-help{position:absolute;z-index:30;top:calc(${space} * 18);inset-inline:calc(${space} * 4);padding:calc(${space} * 3);background:${palette.card};color:${palette.cardForeground};border:1px solid ${palette.border};border-radius:${tokens.radius}} .reels-install-help button{margin-inline-start:calc(${space} * 2)} `;
document.head.appendChild(style);

root.innerHTML = `<div id="reels-root" data-testid="clip-shell"></div>
<div id="composer" class="pub-backdrop" hidden>
  <div class="pub-sheet" role="dialog" aria-modal="true" aria-label="Importer une vidéo">
    <h2>Importer une vidéo</h2>
    <input id="file" data-testid="clip-file-input" type="file" accept="video/*,.mp4,.zip,application/zip" hidden>
    <button id="choose-file" class="pub-choose" type="button">Choisir une vidéo</button>
    <p id="file-name" class="pub-filename"></p>
    <div class="pub-modes" role="group" aria-label="Qualité">
      <button type="button" class="pub-mode" dir="rtl" data-mode="powder" aria-pressed="true">⚡ بودرة - 480p / 500kbps</button>
      <button type="button" class="pub-mode" dir="rtl" data-mode="normal" aria-pressed="false">جودة عادية - 720p</button>
    </div>
    <input id="desc" class="pub-input" type="text" maxlength="120" placeholder="Description…" autocomplete="off">
    <input id="music" class="pub-input" type="text" maxlength="80" placeholder="Musique…" autocomplete="off">
    <label class="pub-toggle"><span>Public</span><input id="is-public" type="checkbox" checked></label>
    <label class="pub-toggle"><span>Commentaires</span><input id="comments-open" type="checkbox" checked></label>
    <progress id="progress" class="pub-progress" data-testid="clip-progress" max="100" value="0" hidden></progress>
    <p id="upload-status" class="pub-status" data-testid="clip-status" role="status" aria-live="polite"></p>
    <button id="publish" class="pub-publish" type="button" disabled>Publier</button>
    <button id="close-composer" class="pub-close" type="button">Fermer</button>
  </div>
</div></div>`;

const calls = createLightweightCallBoundary(root);
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = element<HTMLInputElement>("file");
const chooseFile = element<HTMLButtonElement>("choose-file");
const progress = element<HTMLProgressElement>("progress");
const status = element<HTMLParagraphElement>("upload-status");
const reelsRoot = element<HTMLDivElement>("reels-root");
const composer = element<HTMLDivElement>("composer");
const fileName = element<HTMLParagraphElement>("file-name");
const descInput = element<HTMLInputElement>("desc");
const publishBtn = element<HTMLButtonElement>("publish");
const closeBtn = element<HTMLButtonElement>("close-composer");
const modeButtons = Array.from(composer.querySelectorAll<HTMLButtonElement>(".pub-mode"));
const searchBar = mountClipsSearchBar(root);
let selectedFile: File | null = null;
let uploadController: AbortController | null = null;

if (window.isSecureContext && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE, updateViaCache: "none" })
    .catch(() => {});
}

function defaultTitle(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}
function setStatus(text: string, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}
function setBusy(busy: boolean) {
  chooseFile.disabled = busy;
  publishBtn.disabled = busy || !selectedFile;
  modeButtons.forEach(button => { button.disabled = busy; });
}
// Quality is informational: the server always transcodes to 480p.
modeButtons.forEach(button => button.addEventListener("click", () => {
  modeButtons.forEach(other => other.setAttribute("aria-pressed", String(other === button)));
}));

chooseFile.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  const selected = input.files?.[0];
  input.value = "";
  if (!selected || uploadController) return;
  selectedFile = selected;
  fileName.textContent = selected.name;
  publishBtn.disabled = false;
  setStatus("");
});
closeBtn.addEventListener("click", () => closeComposer());
publishBtn.addEventListener("click", async () => {
  const selected = selectedFile;
  if (!selected || uploadController) return;
  const operation = new AbortController();
  uploadController = operation;
  const { signal } = operation;
  setBusy(true);
  progress.hidden = false;
  progress.value = 0;
  try {
    let duration: number | null = null;
    if (!isZipFile(selected)) {
      setStatus("…");
      duration = await readClipDuration(selected, signal).catch(() => null);
      if (duration !== null && duration < MIN_CLIP_DURATION_SEC) {
        setStatus("الكليب قصير بزاف - خاصو 30 ثانية أو أكثر", true);
        progress.hidden = true;
        return;
      }
    }
    const invalid = validateUploadFile(selected);
    if (invalid) throw new Error(invalid);
    setStatus("Téléversement 0%");
    const metadata: ClipUploadMetadata = {
      title: descInput.value.trim() || defaultTitle(selected.name),
      durationSec: duration,
      category: "B",
    };
    const published = await uploadClip(selected, metadata, signal, percent => {
      progress.value = percent;
      setStatus(`Téléversement ${Math.floor(percent)}%`);
    });
    markGuideSeen();
    if (published.kind === "zip") {
      setStatus("ZIP: extraction en cours…");
      const archive = await waitForArchive(String(published.libraryUrl), signal);
      if (archive.state === "failed") throw new Error(archive.error ?? "تعذر استخراج الملف");
      progress.value = 100;
      setStatus(`ZIP: ${archive.files.length} fichiers extraits`);
    } else if (published.status === "refusé") {
      setStatus(`غير مقبول ❌ / Refusé — ${String(published.reason ?? "")}`, true);
      return;
    } else {
      progress.value = 100;
      setStatus("تم النشر");
    }
    selectedFile = null;
    setTimeout(reloadFeedAfterPublish, 2000);
  } catch (error) {
    setStatus(signal.aborted ? "Annulé"
      : error instanceof Error ? error.message : "تعذر الرفع — حاول مجدداً", !signal.aborted);
  } finally {
    uploadController = null;
    setBusy(false);
  }
});

let reels: ReelsController | null = null;
let lastFocusBeforeComposer: HTMLElement | null = null;
function openComposer() {
  lastFocusBeforeComposer = document.activeElement as HTMLElement;
  reels?.pause();
  composer.hidden = false;
  searchBar.element.hidden = true;
  setStatus("");
  progress.hidden = true;
  chooseFile.focus();
}
function closeComposer() {
  uploadController?.abort(new DOMException("Cancelled", "AbortError"));
  if (/\/publi(er|sh)$/.test(window.location.pathname.replace(/\/$/, ""))) {
    window.location.assign(`${BASE}cli`);
    return;
  }
  composer.hidden = true;
  searchBar.element.hidden = false;
  reels?.resume();
  lastFocusBeforeComposer?.focus();
}
composer.addEventListener("click", event => { if (event.target === composer) closeComposer(); });
composer.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeComposer();
});
function mountReelsFeed() {
  reels?.destroy();
  try {
    reels = mountReels(reelsRoot, { onOpenComposer: openComposer });
  } catch (error) {
    console.error("Clips feed mount failed", error);
    reelsRoot.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent =
      "Impossible d’ouvrir Clips. Réessayez ou revenez à l’accueil.";
    const retry = document.createElement("button");
    retry.textContent = "Réessayer";
    retry.onclick = mountReelsFeed;
    const home = document.createElement("a");
    home.href = BASE;
    home.textContent = "Accueil";
    reelsRoot.append(message, retry, home);
  }
}
function reloadFeedAfterPublish() {
  closeComposer();
  mountReelsFeed();
}
document.body.dataset.clipReady = "true";
const path = window.location.pathname.replace(/\/$/, "");
if (path.endsWith("/profil") || path.endsWith("/boite")) {
  mountPage(reelsRoot, path.endsWith("/profil") ? "profil" : "boite", openComposer);
} else {
  mountReelsFeed();
}
if (/\/publi(er|sh)$/.test(path)) openComposer();
