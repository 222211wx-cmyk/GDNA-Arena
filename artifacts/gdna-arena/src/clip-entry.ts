import { tokens } from "@workspace/gdna-ds/tokens";
import { mountLightweightBackButton } from "./lib/lightweight-back-button";
mountLightweightBackButton();
import { createLightweightCallBoundary } from "./lib/lightweight-call-boundary";
import {
  announceAccountChange,
  fetchSharedClipSession,
  subscribeAccountChanges,
  subscribeSessionWake,
} from "./lib/account-session-events";
import {
  uploadClip,
  type ClipUploadMetadata,
} from "./components/clips/clipUpload";
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
style.textContent = ` :root{color-scheme:dark;font-family:${tokens.fontFamily.sans.join(",")};background:${palette.background};color:${palette.foreground}} *{box-sizing:border-box}body{margin:0;background:${palette.background};color:${palette.foreground}} main{padding:calc(${space} * 4);margin:auto;max-width:48rem}header{display:flex;align-items:center;justify-content:space-between} section,form{display:grid;gap:calc(${space} * 3);padding:calc(${space} * 4);margin-block:calc(${space} * 4);background:${palette.card};border:1px solid ${palette.border};border-radius:${tokens.radius}} h1,h2,p{margin-block:calc(${space} * 2)}label{display:grid;gap:calc(${space} * 2)} input,select,button{font:inherit;color:inherit;background:${palette.secondary};border:1px solid ${palette.input};border-radius:${tokens.radius};padding:calc(${space} * 3)} input[type=checkbox],input[type=radio]{inline-size:auto}button{cursor:pointer;background:${palette.primary};color:${palette.primaryForeground};font-weight:700} button.secondary{background:${palette.secondary};color:${palette.secondaryForeground}}button:disabled{opacity:.55;cursor:not-allowed} fieldset{display:grid;gap:calc(${space} * 3);border:1px solid ${palette.border};border-radius:${tokens.radius}} fieldset label{display:flex;align-items:center;gap:calc(${space} * 2)} progress{inline-size:100%;accent-color:${palette.primary}}video,audio{inline-size:100%;max-block-size:60vh;background:${palette.background};display:block} .clip-media-frame{overflow:hidden;position:relative;border-radius:${tokens.radius}} ${clipOverlayCss(palette, space)} .comment-form,.title-edit{display:flex;gap:calc(${space} * 2)}.comment-form input,.title-edit input{min-inline-size:0;flex:1} .copy-link-fallback{inline-size:min(100%,28rem)} .clip-zoomed{transform:scale(1.35);transform-origin:center;position:relative;z-index:2}article{overflow:visible} a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important} ${reelsShellCss(palette as unknown as Record<string, string>, space)} #reels-root main{padding:0;margin:0;max-width:none} #reels-root main > header{display:none} .reels-css-fullscreen{background:${palette.background}} .reels-install-help{position:absolute;z-index:30;top:calc(${space} * 18);inset-inline:calc(${space} * 4);padding:calc(${space} * 3);background:${palette.card};color:${palette.cardForeground};border:1px solid ${palette.border};border-radius:${tokens.radius}} .reels-install-help button{margin-inline-start:calc(${space} * 2)} `;
document.head.appendChild(style);

root.innerHTML = ` <div id="reels-root" data-testid="clip-shell"></div> <div id="composer" class="reels-composer" role="dialog" aria-label="Publier un clip" aria-modal="true" hidden> <div class="reels-composer-head"> <button id="composer-close" type="button" class="reels-icon-btn" aria-label="Fermer">${reelsIcons.close()}</button> <h2>Publier un clip</h2> </div> <div class="reels-composer-body"> <main dir="rtl"> <div id="auth" class="muted" aria-live="polite">جارٍ التحقق من تسجيل الدخول…</div> <form id="upload" data-testid="clip-upload" hidden> <h2>رفع صوت أو فيديو</h2> <input id="file" data-testid="clip-file-input" type="file" accept="video/*,audio/*" hidden> <button id="choose-file" class="secondary" type="button" aria-controls="file" aria-describedby="selection duration-status">Choisir un fichier — فيديو / أوديو</button> <p id="selection" class="muted" role="status" aria-live="polite">اختر ملف صوت أو فيديو</p> <div id="progress-wrap" hidden> <progress id="progress" data-testid="clip-progress" max="100" value="0"></progress> <p id="upload-status" data-testid="clip-status" role="status" aria-live="polite"></p> </div> <label id="display-name-row" for="display-name" hidden> <span>اسم الفيشي</span> <input id="display-name" data-testid="clip-display-name" type="text" dir="auto" autocomplete="off" aria-describedby="display-name-error"> <span id="display-name-error" class="error" role="alert" aria-live="polite"></span> </label> <p id="duration-status" data-testid="clip-duration" class="muted" role="status" aria-live="polite"></p>

<label><span>شنو بغيتي تنشر؟</span><select id="clip-publish-type"><option value="clip">كليب</option><option value="ad-citizen">إشهار مواطن</option><option value="ad-product">إشهار منتوج</option></select></label>

<label style="display:flex;gap:8px;align-items:flex-start"><input id="clip-own" type="checkbox"><span>هاد المحتوى ديالي، ماشي ديال الغير</span></label>
<label style="display:flex;gap:8px;align-items:flex-start"><input id="clip-device" type="checkbox"><span>مسجل من جهازي أنا</span></label>
<label style="display:flex;gap:8px;align-items:flex-start"><input id="clip-info-correct" type="checkbox"><span>معلوماتي الشخصية صحيحة و بغيت ننشر</span></label>
<label style="display:flex;gap:8px;align-items:flex-start"><input id="clip-terms" type="checkbox"><span>أوافق على شروط النشر: محتوى ديالي، مسجل بجهازي، ماشي تافه، ماشي مسروق، فيه وقت و صورة، المدة 30 ثانية أو أكثر بلا سقف، 3 كليبات، مسموح أصوات / تعاليق / أغاني بشرط الوقت ما يعادلش الوقت الأصلي</span></label>
<label><span>الوقت الأصلي ديال الصوت / الأغنية (0 إلا ما كاينش)</span><input id="clip-original-duration" type="number" min="0" value="0"></label>

<p class="muted" style="font-size:0.85rem">🔒 العلبة السوداء: الاسم الحقيقي و الملف الأصلي ما كيبانوش. البرطاج و جميع الميزات محلولين. المواطن كيتفرج فكلشي، و بين الكليبات كيدوز إشهار.</p>
<div> <button id="submit" data-testid="clip-submit" type="submit" disabled>نشر</button> <button id="cancel" class="secondary" type="button" hidden>Annuler</button> </div> <p id="upload-error" data-testid="clip-error" class="error" role="alert" aria-live="assertive"></p> <div id="receipt" data-testid="clip-receipt" role="status" aria-live="polite" hidden></div> </form> </main> </div> </div>`;

const calls = createLightweightCallBoundary(root);
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const auth = element<HTMLDivElement>("auth");
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
let uploadOwner: number | null = null;
let accountReloading = false;
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
    accountReloading ||
    uploadOwner === null ||
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
  const probe = readClipDuration(selected, probing.signal)
    .then((duration) => {
      if (probing.signal.aborted || cachedFile !== selected) return null;
      selectedDuration = duration;
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
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = cachedFile;
  if (
    !file ||
    uploadOwner === null ||
    accountReloading ||
    uploadController ||
    submissionPending
  )
    return;
  submissionPending = true;
  uploadError.textContent = "";
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
  const owner = uploadOwner;
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

    // ── شروط النشر ديال المواطن ──
    const fail = (msg: string) => {
      uploadError.textContent = msg;
      submissionPending = false;
      uploadController = null;
      mutableControls.forEach((c) => (c.disabled = false));
      updateSubmitState();
      submit.textContent = "نشر";
    };

    // 1. المدة: 30 و لفوق
    if (duration !== null && duration < MIN_CLIP_DURATION_SEC) {
      fail(`الكليب خاصو يكون ${MIN_CLIP_DURATION_SEC} ثانية أو أكثر`);
      return;
    }

    // 2. ديالي ماشي ديال الغير
    const own = document.getElementById("clip-own") as HTMLInputElement | null;
    if (!own?.checked) {
      fail("خاص المحتوى يكون ديالك، ماشي ديال الغير");
      return;
    }

    // 3. مسجل من جهازي
    const device = document.getElementById(
      "clip-device",
    ) as HTMLInputElement | null;
    if (!device?.checked) {
      fail("خاص يكون مسجل من جهازك نتا");
      return;
    }

    // 4. معلومات شخصية صحيحة
    const infoCorrect = document.getElementById(
      "clip-info-correct",
    ) as HTMLInputElement | null;
    if (!infoCorrect?.checked) {
      fail("خاصك تأكد معلوماتك الشخصية صحيحة");
      return;
    }

    // 5. شروط النشر
    const terms = document.getElementById(
      "clip-terms",
    ) as HTMLInputElement | null;
    if (!terms?.checked) {
      fail("خاصك توافق على شروط النشر");
      return;
    }

    // 6. أصوات / تعاليق / أغاني: الوقت ما يعادلش الأصلي
    const originalDuration = Number(
      (document.getElementById("clip-original-duration") as HTMLInputElement)
        ?.value || 0,
    );
    if (
      originalDuration > 0 &&
      duration !== null &&
      Math.floor(duration) === Math.floor(originalDuration)
    ) {
      fail("الوقت كيعادل الوقت الأصلي - بدل الوقت شوية");
      return;
    }

    const publishType =
      (document.getElementById("clip-publish-type") as HTMLSelectElement)
        ?.value || "clip";
    const metadata: ClipUploadMetadata = {
      title,
      durationSec: duration,
      publishType,
      isAd: publishType !== "clip",
    } as any;

    const published = await uploadClip(
      file,
      metadata,
      operation.signal,
      reportUploadProgress,
      { expectedOwner: owner },
    );
    if (uploadOwner !== owner) return;
    finalizePublication({ ...published, name: title });
    reloadFeedAfterPublish();
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
    submit.textContent = "نشر";
    cancel.hidden = true;
  }
});

let reels: ReelsController | null = null;
let lastFocusBeforeComposer: HTMLElement | null = null;
function openComposer() {
  lastFocusBeforeComposer = document.activeElement as HTMLElement;
  reels?.pause();
  composer.hidden = false;
  (chooseFile ?? composerClose).focus();
}
function closeComposer() {
  if (window.location.pathname.replace(/\/$/, "").endsWith("/publish")) {
    window.location.assign(`${BASE}clips`);
    return;
  }
  composer.hidden = true;
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
let authFlight: Promise<void> | null = null;
let authGeneration = 0;
let verifiedAccount: number | null | undefined;
function reloadForAccountChange() {
  if (accountReloading) return;
  accountReloading = true;
  ++authGeneration;
  uploadController?.abort();
  durationController?.abort();
  uploadOwner = null;
  form.hidden = true;
  calls.setAccount(null);
  reels?.destroy();
  window.location.reload();
}
function acceptAccount(id: number | null): boolean {
  if (verifiedAccount !== undefined && verifiedAccount !== id) {
    announceAccountChange(id);
    reloadForAccountChange();
    return false;
  }
  verifiedAccount = id;
  return true;
}
function clearComposerIdentity() {
  uploadController?.abort();
  durationController?.abort();
  uploadOwner = null;
  cachedFile = null;
  selectedDuration = null;
  selectedFileKey = null;
  input.value = "";
  displayName.value = "";
  receipt.replaceChildren();
  receipt.hidden = true;
  form.hidden = true;
  calls.setAccount(null);
  updateSubmitState();
}
async function verifyAuth() {
  const generation = authGeneration;
  try {
    const response = await fetchSharedClipSession();
    if (accountReloading || generation !== authGeneration) return;
    if (response.status === 401) {
      // التفراج عام: المواطن كيتفرج بلا دخول، النشر كيحتاج دخول + معلومات صحيحة
      uploadOwner = null;
      verifiedAccount = null;
      auth.innerHTML = `<span>كتفرج كضيف - </span><a href="${BASE}login">سجل الدخول باش تنشر</a>`;
      form.hidden = true;
      updateSubmitState();
      return;
    }
    if (!response.ok)
      throw new Error(
        `Session verification unavailable (${response.status}) — Réessayer`,
      );
    const me = await response.json();
    if (accountReloading || generation !== authGeneration) return;
    if (
      !me ||
      !Number.isSafeInteger(me.id) ||
      me.id <= 0 ||
      typeof me.username !== "string"
    ) {
      throw new Error("Réponse de session invalide — Réessayer");
    }
    if (!acceptAccount(me.id)) return;
    {
      calls.setAccount(me.id);
      uploadOwner = me.id;
    }
    auth.textContent = "يمكنك رفع ملفك الآن";
    form.hidden = false;
  } catch (error) {
    if (accountReloading || generation !== authGeneration) return;
    auth.replaceChildren();
    const message = document.createElement("span");
    message.textContent =
      error instanceof Error
        ? error.message
        : "تعذر التحقق من الجلسة — حاول مجدداً";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Réessayer — إعادة المحاولة";
    retry.onclick = () => void loadAuth();
    auth.append(message, retry);
  }
}
function loadAuth(): Promise<void> {
  if (authFlight) return authFlight;
  const flight = verifyAuth().finally(() => {
    if (authFlight === flight) authFlight = null;
  });
  authFlight = flight;
  return flight;
}
const stopAccountEvents = subscribeAccountChanges(reloadForAccountChange);
const stopSessionWake = subscribeSessionWake(() => void loadAuth());
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    stopAccountEvents();
    stopSessionWake();
  }
});
document.body.dataset.clipReady = "true";
mountReelsFeed();
if (window.location.pathname.replace(/\/$/, "").endsWith("/publish"))
  openComposer();
void loadAuth();
