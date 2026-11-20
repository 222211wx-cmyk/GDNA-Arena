import { tokens } from "@workspace/gdna-ds/tokens";
import { mountLightweightBackButton } from "./lib/lightweight-back-button";
mountLightweightBackButton();
import { createLightweightCallBoundary } from "./lib/lightweight-call-boundary";
import {
  uploadClip,
  type ClipUploadMetadata,
} from "./components/clips/clipUpload";
import { answerQuestion, guideHtml, guideSeen, markGuideSeen } from "./components/clips/guide";
import { mountClipsSearchBar, clipsSearchBarCss } from "./components/clips/clipsSearchBar";
import { readClipDuration } from "./components/clips/readClipDuration";
import { clipOverlayCss } from "./components/clips/clipOverlayStyles";
import { reelsShellCss } from "./components/clips/reelsStyles";
import { mountReels, type ReelsController } from "./components/clips/reelsFeed";
import { reelsIcons } from "./components/clips/reelsIcons";

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

root.innerHTML = ` <div id="reels-root" data-testid="clip-shell"></div> <div id="composer" class="reels-composer" role="dialog" aria-label="Publier un clip" aria-modal="true" hidden> <div class="reels-composer-head"> <button id="composer-close" type="button" class="reels-icon-btn" aria-label="Fermer">${reelsIcons.close()}</button> <h2>Publier un clip</h2> </div> <div class="reels-composer-body"> <main dir="rtl"> <form id="upload" data-testid="clip-upload"> <button id="guide-toggle" class="secondary" type="button" aria-controls="guide">؟ لماذا؟ كيف أنشر؟</button> <section id="guide" data-testid="clip-guide" hidden>${guideHtml}</section> <h2>رفع صوت أو فيديو</h2> <input id="file" data-testid="clip-file-input" type="file" accept="video/*,audio/*,image/*" hidden> <button id="choose-file" class="secondary" type="button" aria-controls="file" aria-describedby="selection duration-status">Choisir un fichier — فيديو / أوديو</button> <div class="cs-row" style="display:flex;gap:8px"> <label style="flex:1"><span>المكتبة / Bibliothèque</span><select id="clip-category" data-testid="clip-category"><option value="A">A — Grands Producteurs / المنتجين الكبار</option><option value="B" selected>B — Petits Producteurs / المنتجين الصغار</option><option value="C">C — Publicités / إشهارات</option><option value="D">D — Cartes, Guides, Géo, Histoire / خرائط، تاريخ</option></select></label> <label style="flex:1"><span>النوع / Type</span><select id="clip-type" data-testid="clip-type"><option value="video">Video</option><option value="audio">Audio</option><option value="image">Image</option></select></label> </div> <p id="selection" class="muted" role="status" aria-live="polite">اختر ملف صوت أو فيديو</p> <div id="progress-wrap" hidden> <progress id="progress" data-testid="clip-progress" max="100" value="0"></progress> <p id="upload-status" data-testid="clip-status" role="status" aria-live="polite"></p> </div> <label id="display-name-row" for="display-name" hidden> <span>اسم الفيشي</span> <input id="display-name" data-testid="clip-display-name" type="text" dir="auto" autocomplete="off" aria-describedby="display-name-error"> <span id="display-name-error" class="error" role="alert" aria-live="polite"></span> </label> <p id="duration-status" data-testid="clip-duration" class="muted" role="status" aria-live="polite"></p>

<div> <button id="submit" data-testid="clip-submit" type="submit" disabled>Publier</button> <button id="cancel" class="secondary" type="button" hidden>Annuler</button> </div> <p id="upload-error" data-testid="clip-error" class="error" role="alert" aria-live="assertive"></p> <div id="receipt" data-testid="clip-receipt" role="status" aria-live="polite" hidden></div> <p id="verdict" data-testid="clip-verdict" role="status" aria-live="polite" hidden></p> </form> </main> </div> </div>`;

const calls = createLightweightCallBoundary(root);
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const verdict = element<HTMLParagraphElement>("verdict");
const guide = element<HTMLElement>("guide");
const guideToggle = element<HTMLButtonElement>("guide-toggle");
const form = element<HTMLFormElement>("upload");
const input = element<HTMLInputElement>("file");
const chooseFile = element<HTMLButtonElement>("choose-file");
const displayNameRow = element<HTMLLabelElement>("display-name-row");
const displayName = element<HTMLInputElement>("display-name");
const displayNameError = element<HTMLSpanElement>("display-name-error");
const durationStatus = element<HTMLParagraphElement>("duration-status");
const receipt = element<HTMLDivElement>("receipt");
const submit = element<HTMLButtonElement>("submit");
const cancel = element<HTMLButtonElement>("cancel");
const selection = element<HTMLParagraphElement>("selection");
const progressWrap = element<HTMLDivElement>("progress-wrap");
const progress = element<HTMLProgressElement>("progress");
const status = element<HTMLParagraphElement>("upload-status");
const uploadError = element<HTMLParagraphElement>("upload-error");
const reelsRoot = element<HTMLDivElement>("reels-root");
const composer = element<HTMLDivElement>("composer");
const composerClose = element<HTMLButtonElement>("composer-close");
const categorySelect = element<HTMLSelectElement>("clip-category");
const typeSelect = element<HTMLSelectElement>("clip-type");
const searchBar = mountClipsSearchBar(root);
const ACCEPT_BY_TYPE: Record<string, string> = { video: "video/*", audio: "audio/*", image: "image/*" };
const isImageFile = (file: File) => file.type.startsWith("image/");
typeSelect.addEventListener("change", () => {
  input.accept = ACCEPT_BY_TYPE[typeSelect.value] ?? "video/*,audio/*,image/*";
});
const mutableControls = Array.from(
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "input, #choose-file",
  ),
);
let cachedFile: File | null = null;
let selectedDuration: number | null = null;
let durationController: AbortController | null = null;
let durationProbe: Promise<number | null> | null = null;
let uploadController: AbortController | null = null;
let selectedFileKey: string | null = null;
let submissionPending = false;
if (window.isSecureContext && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE, updateViaCache: "none" })
    .catch(() => {});
}
const MEDIA_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "aac",
  "aiff",
  "amr",
  "avi",
  "flac",
  "m4a",
  "m4v",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "oga",
  "ogg",
  "ogv",
  "opus",
  "wav",
  "webm",
  "wma",
  "wmv",
]);
export function defaultClipDisplayName(filename: string) {
  const dot = filename.lastIndexOf(".");
  if (
    dot <= 0 ||
    !MEDIA_EXTENSIONS.has(filename.slice(dot + 1).toLocaleLowerCase())
  )
    return filename;
  return filename.slice(0, dot);
}
function fileSelectionKey(file: File) {
  return JSON.stringify([file.name, file.size, file.type, file.lastModified]);
}
function normalizedDisplayName() {
  return displayName.value.trim();
}
function displayNameValidationError() {
  const value = normalizedDisplayName();
  if (!value) return "اسم الفيشي مطلوب";
  if ([...value].length > 120) return "اسم الفيشي خاصو يكون 120 حرف أو أقل";
  return "";
}
function updateSubmitState() {
  submit.disabled =
    Boolean(uploadController) ||
    !cachedFile;
}
function formatBytes(bytes: number) {
  return new Intl.NumberFormat("ar").format(bytes) + " بايت";
}
function formatDuration(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((whole / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}
function isClipDurationValid(duration: number | null) {
  if (duration === null) return true;
  return duration >= MIN_CLIP_DURATION_SEC;
}
type PublishedClip = { name: string; code: string };
export function finalizePublication(published: PublishedClip) {
  progress.value = 100;
  status.textContent = "تم نشر الملف — publication confirmée";
  cachedFile = null;
  selectedDuration = null;
  input.value = "";
  displayName.value = "";
  displayNameRow.hidden = true;
  displayNameError.textContent = "";
  selectedFileKey = null;
  chooseFile.textContent = "Choisir un fichier — فيديو / أوديو";
  durationStatus.textContent = "";
  selection.textContent = "تم نشر الملف";
  updateSubmitState();
  receipt.replaceChildren();
  const name = document.createElement("p");
  name.textContent = published.name;
  const code = document.createElement("p");
  if (CLIP_BLACK_BOX_ENABLED) {
    code.textContent = "تم النشر بنجاح";
  } else {
    code.textContent = published.code;
  }
  code.dir = "ltr";
  receipt.append(name, code);
  const link = document.createElement("a");
  link.href = `${BASE}clip/${published.code}`;
  link.textContent = "فتح الملف";
  receipt.append(link);
  receipt.hidden = false;
}

// ── الفيد: المواطن كيتفرج فكلشي، بين الكليبات إشهار ──
function interleaveAdsWithClips(clips: any[], ads: any[]) {
  const feed: any[] = [];
  let adIndex = 0;
  clips.forEach((clip, i) => {
    feed.push({ type: "clip", data: clip });
    if ((i + 1) % FEED_AD_EVERY === 0 && ads.length > 0) {
      const ad = ads[adIndex % ads.length];
      feed.push({ type: ad.kind, data: ad });
      adIndex++;
    }
  });
  return feed;
}

chooseFile.addEventListener("click", () => input.click());
input.addEventListener("change", async () => {
  const selected = input.files?.[0];
  if (!selected) return;
  durationController?.abort();
  const probing = new AbortController();
  durationController = probing;
  const nextFileKey = fileSelectionKey(selected);
  if (nextFileKey !== selectedFileKey) {
    displayName.value = defaultClipDisplayName(selected.name);
  }
  selectedFileKey = nextFileKey;
  displayNameRow.hidden = false;
  cachedFile = selected;
  displayName.disabled = false;
  chooseFile.textContent = selected.name;
  selection.textContent = "✓ Fichier sélectionné";
  updateSubmitState();
  uploadError.textContent = "";
  displayNameError.textContent = "";
  displayName.setAttribute("aria-invalid", "false");
  progressWrap.hidden = false;
  progress.value = 0;
  status.textContent = `0% — 0 من ${formatBytes(selected.size)}`;
  receipt.hidden = true;
  receipt.replaceChildren();
  durationStatus.textContent = "المدة: جارٍ القراءة…";
  cancel.hidden = false;
  const kind = selected.type.split("/")[0];
  if (["video", "audio", "image"].includes(kind)) typeSelect.value = kind;
  const probe = (isImageFile(selected) ? Promise.resolve(null as number | null) : readClipDuration(selected, probing.signal))
    .then((duration) => {
      if (probing.signal.aborted || cachedFile !== selected) return null;
      selectedDuration = duration;
      if (duration === null) {
        durationStatus.textContent = "";
        return null;
      }
      if (!isClipDurationValid(duration)) {
        durationStatus.textContent = `المدة: ${formatDuration(duration)} - قصير بزاف، خاصو ${MIN_CLIP_DURATION_SEC} ثانية أو أكثر`;
        uploadError.textContent = "الكليب قصير بزاف - خاصو 30 ثانية أو أكثر";
      } else {
        durationStatus.textContent = `المدة: ${formatDuration(duration)}`;
      }
      return duration;
    })
    .catch(() => {
      if (!probing.signal.aborted && cachedFile === selected) {
        durationStatus.textContent =
          "Durée inconnue — vérification par le serveur";
      }
      return null;
    })
    .finally(() => {
      if (durationProbe === probe) durationProbe = null;
      if (!uploadController && cachedFile === selected) cancel.hidden = true;
    });
  durationProbe = probe;
  await probe;
});
displayName.addEventListener("input", () => {
  if (!displayNameValidationError()) {
    displayNameError.textContent = "";
    displayName.setAttribute("aria-invalid", "false");
  }
  updateSubmitState();
});
cancel.addEventListener("click", () => {
  const reason = new DOMException("Cancelled", "AbortError");
  if (uploadController) {
    uploadController.abort(reason);
    if (durationProbe) durationController?.abort(reason);
  } else if (durationController) {
    durationController.abort(reason);
    durationStatus.textContent = "تم إلغاء قراءة المدة";
    cancel.hidden = true;
  }
});
async function awaitPendingDurationProbe(signal: AbortSignal) {
  signal.throwIfAborted();
  const pending = durationProbe;
  if (!pending) return selectedDuration;
  return await pending;
}
function reportUploadProgress(
  percent: number,
  uploaded: number,
  total: number,
) {
  const displayPercent = Math.floor(percent);
  progress.value = percent;
  submit.textContent = `Téléversement ${displayPercent}%…`;
  status.textContent = `${formatBytes(uploaded)} من ${formatBytes(total)} — ${displayPercent}%`;
}
function showVerdict(kind: "accepté" | "refusé", reason: string) {
  verdict.hidden = false;
  verdict.className = kind === "accepté" ? "" : "error";
  verdict.textContent =
    kind === "accepté"
      ? "مقبول ✅ / Accepté"
      : `غير مقبول ❌ / Refusé — ${reason}`;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = cachedFile;
  if (
    !file ||
    uploadController ||
    submissionPending
  )
    return;
  submissionPending = true;
  uploadError.textContent = "";
  verdict.hidden = true;
  displayNameError.textContent = "";
  displayName.setAttribute("aria-invalid", "false");
  const title = normalizedDisplayName();
  const titleError = displayNameValidationError();
  if (titleError) {
    displayNameError.textContent = titleError;
    displayName.setAttribute("aria-invalid", "true");
    displayName.focus();
    submissionPending = false;
    return;
  }
  const operation = new AbortController();
  uploadController = operation;
  mutableControls.forEach((control) => {
    control.disabled = true;
  });
  submit.disabled = true;
  submit.textContent = "Téléversement 0%…";
  cancel.hidden = false;
  cancel.disabled = false;
  progressWrap.hidden = false;
  progress.value = 0;
  status.textContent = `0% — 0 من ${formatBytes(file.size)} — جارٍ التحقق من المدة…`;
  try {
    const duration =
      selectedDuration ?? (await awaitPendingDurationProbe(operation.signal));
    operation.signal.throwIfAborted();
    if (cachedFile !== file) return;

    const metadata: ClipUploadMetadata = {
      title,
      durationSec: duration,
      category: categorySelect.value,
    };

    const published = await uploadClip(
      file,
      metadata,
      operation.signal,
      reportUploadProgress,
    );
    markGuideSeen();
    if (published.status === "refusé") {
      showVerdict("refusé", String(published.reason ?? ""));
      status.textContent = "";
      return;
    }
    finalizePublication({ ...published, name: title });
    showVerdict("accepté", "");
    setTimeout(reloadFeedAfterPublish, 1800);
  } catch (error) {
    const cancelled = operation.signal.aborted;
    uploadError.textContent = cancelled
      ? "تم إلغاء الرفع — Annulé"
      : error instanceof Error
        ? error.message
        : "تعذر الرفع — حاول مجدداً";
    status.textContent = cancelled ? "توقف الرفع" : "لم يكتمل الرفع";
  } finally {
    submissionPending = false;
    uploadController = null;
    mutableControls.forEach((control) => {
      control.disabled = false;
    });
    updateSubmitState();
    submit.textContent = "Publier";
    cancel.hidden = true;
  }
});

let reels: ReelsController | null = null;
let lastFocusBeforeComposer: HTMLElement | null = null;
function openComposer() {
  lastFocusBeforeComposer = document.activeElement as HTMLElement;
  reels?.pause();
  composer.hidden = false;
  searchBar.element.hidden = true;
  if (!guideSeen()) setGuide(true); // first visit only; never repeated
  (chooseFile ?? composerClose).focus();
}
function closeComposer() {
  if (window.location.pathname.replace(/\/$/, "").endsWith("/publish")) {
    window.location.assign(`${BASE}clips`);
    return;
  }
  composer.hidden = true;
  searchBar.element.hidden = false;
  reels?.resume();
  lastFocusBeforeComposer?.focus();
}
composerClose.addEventListener("click", closeComposer);
composerClose.textContent = "Retour";
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
function setGuide(open: boolean) {
  guide.hidden = !open;
  if (open) markGuideSeen();
}
guideToggle.addEventListener("click", () => setGuide(guide.hidden));
document.getElementById("guide-ask")?.addEventListener("click", () => {
  const q = (document.getElementById("guide-question") as HTMLInputElement).value;
  (document.getElementById("guide-answer") as HTMLElement).textContent = answerQuestion(q);
});
document.body.dataset.clipReady = "true";
mountReelsFeed();
if (window.location.pathname.replace(/\/$/, "").endsWith("/publish"))
  openComposer();
