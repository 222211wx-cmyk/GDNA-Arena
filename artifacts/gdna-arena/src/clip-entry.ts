import { tokens } from "@workspace/gdna-ds/tokens";
import {
  MAX_CLIP_BYTES,
  uploadClip,
  uploadPreparedClip,
  type ClipUploadMetadata,
} from "./components/clips/clipUpload";
import { readClipDuration } from "./components/clips/readClipDuration";

// The browser-compression graph (canvas/recorder) is heavy and optional, so it
// is only ever loaded on demand — the thin clip entry never imports it eagerly.
type ClipPreparationPhase = "loading" | "compressing" | "verifying";
type CompressionModule = typeof import("./components/clips/prepareVideo");
let compressionModulePromise: Promise<CompressionModule> | null = null;
function loadCompressionModule(): Promise<CompressionModule> {
  if (!compressionModulePromise) {
    compressionModulePromise = import("./components/clips/prepareVideo");
  }
  return compressionModulePromise;
}
import { clipOverlayCss } from "./components/clips/clipOverlayStyles";
import { reelsShellCss } from "./components/clips/reelsStyles";
import { mountReels, type ReelsController } from "./components/clips/reelsFeed";
import { reelsIcons } from "./components/clips/reelsIcons";

const BASE = import.meta.env.BASE_URL;
const FEED_TIMEOUT_MS = 12_000;
const root = document.getElementById("root");
if (!root) throw new Error("Clip root is missing");

const palette = tokens.color.dark;
const space = tokens.spacing;
const style = document.createElement("style");
style.textContent = `
  :root{color-scheme:dark;font-family:${tokens.fontFamily.sans.join(",")};background:${palette.background};color:${palette.foreground}}
  *{box-sizing:border-box}body{margin:0;background:${palette.background};color:${palette.foreground}}
  main{padding:calc(${space} * 4);margin:auto;max-width:48rem}header{display:flex;align-items:center;justify-content:space-between}
  section,form{display:grid;gap:calc(${space} * 3);padding:calc(${space} * 4);margin-block:calc(${space} * 4);background:${palette.card};border:1px solid ${palette.border};border-radius:${tokens.radius}}
  h1,h2,p{margin-block:calc(${space} * 2)}label{display:grid;gap:calc(${space} * 2)}
  input,select,button{font:inherit;color:inherit;background:${palette.secondary};border:1px solid ${palette.input};border-radius:${tokens.radius};padding:calc(${space} * 3)}
  input[type=checkbox],input[type=radio]{inline-size:auto}button{cursor:pointer;background:${palette.primary};color:${palette.primaryForeground};font-weight:700}
  button.secondary{background:${palette.secondary};color:${palette.secondaryForeground}}button:disabled{opacity:.55;cursor:not-allowed}
  fieldset{display:grid;gap:calc(${space} * 3);border:1px solid ${palette.border};border-radius:${tokens.radius}}
  fieldset label{display:flex;align-items:center;gap:calc(${space} * 2)}
  progress{inline-size:100%;accent-color:${palette.primary}}video,audio{inline-size:100%;max-block-size:60vh;background:${palette.background};display:block}
  .clip-media-frame{overflow:hidden;position:relative;border-radius:${tokens.radius}}
  ${clipOverlayCss(palette, space)}
  .comment-form,.title-edit{display:flex;gap:calc(${space} * 2)}.comment-form input,.title-edit input{min-inline-size:0;flex:1}
  .copy-link-fallback{inline-size:min(100%,28rem)}
  .clip-zoomed{transform:scale(1.35);transform-origin:center;position:relative;z-index:2}article{overflow:visible}
  a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important}
  .storage-badge{display:flex;align-items:center;gap:calc(${space} * 2);font-size:.8125rem;flex-wrap:wrap;margin:0}
  .storage-dot{inline-size:.5rem;block-size:.5rem;border-radius:9999px;background:${palette.mutedForeground};flex:none}
  .storage-text{font-weight:600;color:${palette.mutedForeground}}
  .storage-bucket{font-size:.75rem}
  .storage-badge[data-state=connected] .storage-dot{background:${palette.chart3}}
  .storage-badge[data-state=connected] .storage-text{color:${palette.chart3}}
  .storage-badge[data-state=error] .storage-dot{background:${palette.destructive}}
  .storage-badge[data-state=error] .storage-text{color:${palette.destructive}}
  ${reelsShellCss(palette as unknown as Record<string, string>, space)}
  /* The upload composer lives inside the reels shell; drop the standalone
     centered <main> layout so the form fills the composer sheet width. */
  #reels-root main{padding:0;margin:0;max-width:none}
  #reels-root main > header{display:none}
  .reels-css-fullscreen{background:${palette.background}}
`;
document.head.appendChild(style);

root.innerHTML = `
<div id="reels-root" data-testid="clip-shell"></div>
<div id="composer" class="reels-composer" role="dialog" aria-label="Publier un clip" aria-modal="true" hidden>
<div class="reels-composer-head">
  <button id="composer-close" type="button" class="reels-icon-btn" aria-label="Fermer">${reelsIcons.close()}</button>
  <h2>Publier un clip</h2>
</div>
<div class="reels-composer-body">
<main dir="rtl">
  <div id="auth" class="muted" aria-live="polite">جارٍ التحقق من تسجيل الدخول…</div>
  <form id="upload" data-testid="clip-upload" hidden>
    <h2>رفع صوت أو فيديو</h2>
    <div id="storage-badge" data-testid="clip-storage-badge" class="storage-badge" role="status" aria-live="polite" dir="ltr">
      <span id="storage-dot" class="storage-dot" aria-hidden="true"></span>
      <span id="storage-text" class="storage-text"></span>
      <span id="storage-bucket" class="storage-bucket muted" dir="ltr"></span>
    </div>
    <input id="file" data-testid="clip-file-input" type="file" accept="video/*,audio/*" hidden>
    <button id="choose-file" class="secondary" type="button" aria-controls="file" aria-describedby="selection duration-status">Choisir un fichier — فيديو / أوديو</button>
    <p id="selection" class="muted" role="status" aria-live="polite">من دقيقة الفوق — الحد الأقصى للملف 2GB</p>
    <label id="display-name-row" for="display-name" hidden>
      <span>اسم الفيشي</span>
      <input id="display-name" data-testid="clip-display-name" type="text" dir="auto" autocomplete="off" aria-describedby="display-name-error">
      <span id="display-name-error" class="error" role="alert" aria-live="polite"></span>
    </label>
    <p id="duration-status" data-testid="clip-duration" class="muted" role="status" aria-live="polite"></p>
    <div id="compress-row" data-testid="clip-compress-row" hidden>
      <label id="compress-label" for="compress">
        <input id="compress" data-testid="clip-compress" type="checkbox" aria-describedby="compress-note">
        <span>ضغط الفيديو قبل الرفع (اختياري)</span>
      </label>
      <p id="compress-note" class="muted">الضغط يجري داخل المتصفح بالوقت الحقيقي (يستغرق مدة الفيديو تقريباً)، ويقلّل الحجم لكنه لا يضمن رفعاً أسرع. الملف الأصلي محفوظ ولن يُعدَّل.</p>
      <p id="compress-status" data-testid="clip-compress-status" class="muted" role="status" aria-live="polite"></p>
    </div>
    <div>
      <button id="submit" data-testid="clip-submit" type="submit" disabled>نشر</button>
      <button id="cancel" class="secondary" type="button" hidden>إلغاء</button>
    </div>
    <div id="progress-wrap" hidden>
      <progress id="progress" data-testid="clip-progress" max="100" value="0"></progress>
      <p id="upload-status" data-testid="clip-status" role="status" aria-live="polite"></p>
    </div>
    <p id="upload-error" data-testid="clip-error" class="error" role="alert" aria-live="assertive"></p>
    <div id="receipt" data-testid="clip-receipt" role="status" aria-live="polite" hidden></div>
  </form>
</main>
</div>
</div>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
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
const storageBadge = element<HTMLDivElement>("storage-badge");
const storageText = element<HTMLSpanElement>("storage-text");
const storageBucket = element<HTMLSpanElement>("storage-bucket");
const compressRow = element<HTMLDivElement>("compress-row");
const compress = element<HTMLInputElement>("compress");
const compressNote = element<HTMLParagraphElement>("compress-note");
const compressStatus = element<HTMLParagraphElement>("compress-status");
const mutableControls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, #choose-file"));
let cachedFile: File | null = null;
let selectedDuration: number | null = null;
let durationController: AbortController | null = null;
let uploadController: AbortController | null = null;
let selectedFileKey: string | null = null;

const MEDIA_EXTENSIONS = new Set([
  "3g2", "3gp", "aac", "aiff", "amr", "avi", "flac", "m4a", "m4v", "mkv",
  "mov", "mp3", "mp4", "mpeg", "mpg", "oga", "ogg", "ogv", "opus", "wav",
  "webm", "wma", "wmv",
]);

/** Strip only a recognized media suffix; dots in all other names are retained. */
export function defaultClipDisplayName(filename: string) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || !MEDIA_EXTENSIONS.has(filename.slice(dot + 1).toLocaleLowerCase())) {
    return filename;
  }
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
  const nameError = displayNameValidationError();
  displayNameError.textContent = nameError;
  displayName.setAttribute("aria-invalid", String(Boolean(nameError)));
  submit.disabled = Boolean(uploadController) || !cachedFile ||
    cachedFile.size > MAX_CLIP_BYTES || selectedDuration === null ||
    selectedDuration < 60 || Boolean(nameError);
}

function formatBytes(bytes: number) {
  return new Intl.NumberFormat("ar").format(bytes) + " بايت";
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "جارٍ حساب السرعة";
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

function formatDuration(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 3600).toString().padStart(2, "0")}:${Math.floor(whole / 60 % 60).toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

type PublishedClip = { name: string; code: string };

function finalizePublication(published: PublishedClip) {
  cachedFile = null;
  selectedDuration = null;
  input.value = "";
  displayName.value = "";
  displayNameRow.hidden = true;
  displayNameError.textContent = "";
  selectedFileKey = null;
  chooseFile.textContent = "Choisir un fichier — فيديو / أوديو";
  durationStatus.textContent = "";
  compressRow.hidden = true;
  compress.checked = false;
  compress.disabled = true;
  compressStatus.textContent = "";
  selection.textContent = "تم نشر الملف";
  receipt.replaceChildren();
  const name = document.createElement("p");
  name.textContent = published.name;
  const code = document.createElement("p");
  code.textContent = published.code;
  code.dir = "ltr";
  receipt.append(name, code);
  const link = document.createElement("a");
  link.href = `${BASE}clip/${published.code}`;
  link.textContent = "فتح الملف";
  receipt.append(link);
  receipt.hidden = false;
}

const COMPRESS_WARNING =
  "الضغط يجري داخل المتصفح بالوقت الحقيقي (يستغرق مدة الفيديو تقريباً)، ويقلّل الحجم لكنه لا يضمن رفعاً أسرع. الملف الأصلي محفوظ ولن يُعدَّل.";

const compressPhaseLabel: Record<ClipPreparationPhase, string> = {
  loading: "جارٍ تحضير الفيديو للضغط…",
  compressing: "جارٍ الضغط",
  verifying: "جارٍ التحقق من الفيديو المضغوط",
};

let compressAvailabilityToken = 0;

/**
 * Reflect browser-compression availability for the current selection. Video only
 * (audio always uploads uncompressed); supported source is <=512MiB and <=30min.
 * Unsupported reasons disable and uncheck the box without hiding it, so the user
 * makes an explicit choice — never a silent fallback. The capability probe lives
 * in the on-demand compression module, so this is async.
 */
async function refreshCompressAvailability(file: File | null, durationSeconds: number | null) {
  const token = ++compressAvailabilityToken;
  compressStatus.textContent = "";
  if (!file || !file.type.startsWith("video/")) {
    compressRow.hidden = true;
    compress.checked = false;
    compress.disabled = true;
    return;
  }
  compressRow.hidden = false;
  compress.disabled = true;
  compressNote.textContent = COMPRESS_WARNING;
  let reason: string | null = null;
  try {
    const module = await loadCompressionModule();
    reason = module.browserCompressionUnavailableReason(file, durationSeconds ?? undefined);
  } catch {
    reason = "تعذر تحميل أداة الضغط في هذا المتصفح. يمكنك رفع الملف الأصلي.";
  }
  // A newer selection has superseded this probe; leave its result in place.
  if (token !== compressAvailabilityToken || cachedFile !== file) return;
  if (reason) {
    compress.checked = false;
    compress.disabled = true;
    compressNote.textContent = reason;
    return;
  }
  compress.disabled = false;
  compressNote.textContent = COMPRESS_WARNING;
}

chooseFile.addEventListener("click", () => input.click());

input.addEventListener("change", async () => {
  const selected = input.files?.[0];
  // A dismissed picker must not discard the previous selection.
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
  selectedDuration = null;
  chooseFile.textContent = `${selected.name} — ${(selected.size / 1024 / 1024).toFixed(2)} MB`;
  selection.textContent = "✓ Fichier sélectionné";
  submit.disabled = true;
  updateSubmitState();
  uploadError.textContent = "";
  progressWrap.hidden = true;
  status.textContent = "";
  receipt.hidden = true;
  receipt.replaceChildren();
  void refreshCompressAvailability(selected, null);
  if (selected.size > MAX_CLIP_BYTES) {
    durationStatus.textContent = "";
    uploadError.textContent = "الحد الأقصى للملف هو 2GB";
    return;
  }
  durationStatus.textContent = "المدة: جارٍ القراءة…";
  try {
    const duration = await readClipDuration(selected, probing.signal);
    if (probing.signal.aborted || cachedFile !== selected) return;
    selectedDuration = duration;
    durationStatus.textContent = `المدة: ${formatDuration(duration)}`;
    void refreshCompressAvailability(selected, duration);
    if (duration < 60) uploadError.textContent = "خاص دقيقة الفوق";
    updateSubmitState();
  } catch (error) {
    if (probing.signal.aborted || cachedFile !== selected) return;
    durationStatus.textContent = "المدة غير متاحة";
    uploadError.textContent = error instanceof Error ? error.message : "تعذر قراءة مدة الملف";
  }
});

displayName.addEventListener("input", updateSubmitState);

cancel.addEventListener("click", () => uploadController?.abort(new DOMException("Cancelled", "AbortError")));

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = cachedFile;
  if (!file || uploadController) return;
  if (file.size > MAX_CLIP_BYTES) {
    uploadError.textContent = "الحد الأقصى للملف هو 2GB";
    return;
  }
  if (selectedDuration === null || selectedDuration < 60) {
    uploadError.textContent = "خاص دقيقة الفوق";
    return;
  }
  const title = normalizedDisplayName();
  const titleError = displayNameValidationError();
  if (titleError) {
    displayNameError.textContent = titleError;
    displayName.focus();
    updateSubmitState();
    return;
  }
  const metadata: ClipUploadMetadata = {
    title,
    originalFilename: file.name,
    contentType: file.type || "application/octet-stream",
    durationSec: selectedDuration,
  };
  const wantsCompression = compress.checked && !compress.disabled && file.type.startsWith("video/");
  uploadController = new AbortController();
  mutableControls.forEach(control => { control.disabled = true; });
  submit.disabled = true;
  cancel.hidden = false;
  cancel.disabled = false;
  progressWrap.hidden = false;
  progress.value = 0;
  status.textContent = wantsCompression ? "جارٍ التحضير للضغط…" : `0 من ${formatBytes(file.size)}`;
  compressStatus.textContent = "";
  uploadError.textContent = "";
  try {
    // Optional, explicit compression. On any failure we surface the error and
    // keep the checkbox + original selection so the user can uncheck and upload
    // the original — never a silent fallback.
    let prepared: { uploadFile: File; outputDuration: number } | null = null;
    if (wantsCompression) {
      try {
        const { prepareClipForUpload } = await loadCompressionModule();
        prepared = await prepareClipForUpload(file, uploadController.signal, phase => {
          progress.value = phase.percent;
          const label = compressPhaseLabel[phase.phase];
          compressStatus.textContent = phase.phase === "compressing"
            ? `${label} — ${Math.floor(phase.percent)}%`
            : label;
          status.textContent = "لا تُغلق الصفحة أثناء الضغط.";
        });
        compressStatus.textContent = `تم الضغط: ${formatBytes(file.size)} ← ${formatBytes(prepared.uploadFile.size)}`;
        progress.value = 0;
        status.textContent = `0 من ${formatBytes(prepared.uploadFile.size)}`;
      } catch (error) {
        if (uploadController.signal.aborted) throw error;
        const reason = error instanceof Error ? error.message : "تعذر ضغط الفيديو";
        uploadError.textContent = `${reason} — أزل خيار الضغط لرفع الملف الأصلي.`;
        compressStatus.textContent = "";
        status.textContent = "لم يبدأ الرفع";
        return;
      }
    }
    if (prepared) {
      const published = await uploadPreparedClip(
        {
          originalFile: file,
          uploadFile: prepared.uploadFile,
          outputDuration: prepared.outputDuration,
          title,
          originalFilename: file.name,
        },
        uploadController.signal,
        (percent, uploadedBytes, speedBytesPerSecond, uploadState) => {
          const total = prepared!.uploadFile.size;
          const uploaded = uploadedBytes ?? Math.min(total, Math.round(total * percent / 100));
          const displayPercent = Math.floor(percent);
          progress.value = percent;
          status.textContent = percent === 100
            ? `تم النشر — ${formatBytes(total)}`
            : uploadState === "offline"
              ? `${formatBytes(uploaded)} من ${formatBytes(total)} — متوقف مؤقتاً؛ يكمل الى تقطع عند رجوع الاتصال`
              : `${formatBytes(uploaded)} من ${formatBytes(total)} — ${displayPercent}% — ${formatSpeed(speedBytesPerSecond)} — يكمل الى تقطع`;
        },
      );
      finalizePublication({ ...published, name: title });
      reloadFeedAfterPublish();
      return;
    }
    const published = await uploadClip(file, metadata, uploadController.signal, (
      percent,
      uploadedBytes,
      speedBytesPerSecond,
      uploadState,
    ) => {
      const uploaded = uploadedBytes ?? Math.min(file.size, Math.round(file.size * percent / 100));
      const displayPercent = Math.floor(percent);
      progress.value = percent;
      status.textContent = percent === 100
        ? `تم النشر — ${formatBytes(file.size)}`
        : uploadState === "offline"
          ? `${formatBytes(uploaded)} من ${formatBytes(file.size)} — متوقف مؤقتاً؛ يكمل الى تقطع عند رجوع الاتصال`
          : `${formatBytes(uploaded)} من ${formatBytes(file.size)} — ${displayPercent}% — ${formatSpeed(speedBytesPerSecond)} — يكمل الى تقطع`;
    });
    finalizePublication({ ...published, name: title });
    reloadFeedAfterPublish();
  } catch (error) {
    const cancelled = uploadController.signal.aborted;
    uploadError.textContent = cancelled ? "تم إلغاء الرفع — يمكنك إعادة المحاولة" :
      error instanceof Error ? error.message : "تعذر الرفع — حاول مجدداً";
    status.textContent = cancelled ? "توقف الرفع" : "لم يكتمل الرفع";
  } finally {
    uploadController = null;
    mutableControls.forEach(control => { control.disabled = false; });
    // Re-evaluate compression availability for whatever selection remains (the
    // helper disables/hides the box when there is no eligible video).
    void refreshCompressAvailability(cachedFile, selectedDuration);
    updateSubmitState();
    cancel.hidden = true;
  }
});

// ── Reels feed + upload composer wiring ──────────────────────────────────────
// The fullscreen Reels feed is the primary surface. The camera button (and the
// empty-state "publish") open this composer, which hosts the existing upload
// form untouched, preserving every selector (#file #compress #submit #receipt
// #storage-badge) and the direct helixly-clips upload/compression pipeline.
let reels: ReelsController | null = null;
let lastFocusBeforeComposer: HTMLElement | null = null;

function openComposer() {
  lastFocusBeforeComposer = document.activeElement as HTMLElement;
  composer.hidden = false;
  (chooseFile ?? composerClose).focus();
}
function closeComposer() {
  composer.hidden = true;
  lastFocusBeforeComposer?.focus();
}
composerClose.addEventListener("click", closeComposer);
composer.addEventListener("keydown", event => { if (event.key === "Escape") closeComposer(); });

function mountReelsFeed() {
  reels?.destroy();
  reels = mountReels(reelsRoot, { onOpenComposer: openComposer });
}

/** After a successful publish, refresh the feed and return to it. */
function reloadFeedAfterPublish() {
  closeComposer();
  mountReelsFeed();
}

type R2Status = {
  provider: string;
  configured: boolean;
  connected: boolean;
  bucket: string | null;
  error?: string;
};

let storageController: AbortController | null = null;

/**
 * Show real app-storage (Cloudflare R2) connectivity to the uploader. Only a
 * verified connected=true renders the green "Connected" state; every other
 * outcome (checking, not configured, reachable-but-not-connected, timeout,
 * network/HTTP error) stays neutral or shows a plain error — never a false
 * green. User-facing copy is Arabic with the English provider name; technical
 * details are not surfaced. This never blocks the upload form or the feed.
 */
async function loadStorageStatus() {
  storageController?.abort();
  const controller = new AbortController();
  storageController = controller;
  const timer = window.setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  storageBadge.dataset.state = "checking";
  storageText.textContent = "جارٍ التحقق من التخزين — Cloudflare R2";
  storageBucket.textContent = "";
  try {
    const response = await fetch(`${BASE}api/r2/status`, {
      credentials: "include", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error();
    const data = (await response.json().catch(() => null)) as R2Status | null;
    if (!data || data.connected !== true) {
      // Reachable but not verified-connected, or unusable payload — no false green.
      storageBadge.dataset.state = "unknown";
      storageText.textContent = data && data.configured === false
        ? "التخزين غير مهيأ بعد — Cloudflare R2"
        : "تعذر تأكيد اتصال التخزين — Cloudflare R2";
      storageBucket.textContent = "";
      return;
    }
    storageBadge.dataset.state = "connected";
    storageText.textContent = "التخزين متصل — Cloudflare R2 — Connected";
    storageBucket.textContent = typeof data.bucket === "string" ? data.bucket : "";
  } catch {
    if (controller.signal.aborted && storageController !== controller) return;
    storageBadge.dataset.state = "error";
    storageText.textContent = "تعذر التحقق من التخزين — Cloudflare R2";
    storageBucket.textContent = "";
  } finally {
    clearTimeout(timer);
    if (storageController === controller) storageController = null;
  }
}

async function loadAuth() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}api/auth/me`, {
      credentials: "include", cache: "no-store", signal: controller.signal,
    });
    if (response.status === 401) {
      auth.innerHTML = `<a href="${BASE}login">سجل الدخول لرفع الصوت أو الفيديو</a>`;
      return;
    }
    if (!response.ok) throw new Error();
    const me = await response.json().catch(() => null);
    if (me && Number.isSafeInteger(me.id)) {
      // The R2 status endpoint is authenticated; only probe it once we know the
      // viewer is signed in. It never blocks the form (rendered right below).
      void loadStorageStatus();
    }
    auth.textContent = "يمكنك رفع ملفك الآن";
    form.hidden = false;
  } catch {
    auth.innerHTML = `تعذر التحقق من الجلسة. <a href="${BASE}login">تسجيل الدخول</a>`;
  } finally {
    clearTimeout(timer);
  }
}

document.body.dataset.clipReady = "true";
// Mount the fullscreen Reels feed immediately (it resolves its own viewer
// identity for engagement scoping). Resolve auth in parallel to enable the
// upload composer form.
mountReelsFeed();
void loadAuth();