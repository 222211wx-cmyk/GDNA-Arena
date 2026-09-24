import { tokens } from "@workspace/gdna-ds/tokens";
import {
  MAX_CLIP_BYTES,
  uploadClip,
  runQueuedUpload,
  discardQueuedUpload,
  pauseQueuedUpload,
  markQueuedPaused,
  currentUploadOwner,
  type ClipUploadMetadata,
  type ClipUploadProgress,
} from "./components/clips/clipUpload";
import { readClipDuration } from "./components/clips/readClipDuration";
import { listQueue } from "./components/clips/uploadQueue";

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
  .reels-install-help{position:absolute;z-index:30;top:calc(${space} * 18);inset-inline:calc(${space} * 4);padding:calc(${space} * 3);background:${palette.card};color:${palette.cardForeground};border:1px solid ${palette.border};border-radius:${tokens.radius}}
  .reels-install-help button{margin-inline-start:calc(${space} * 2)}
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
     <p id="selection" class="muted" role="status" aria-live="polite">من دقيقة الفوق — الحد الأقصى للملف 10 GiB (10 737 418 240 octets)</p>
    <div id="progress-wrap" hidden>
      <p id="preparation-status" role="status" aria-live="polite"></p>
      <progress id="progress" data-testid="clip-progress" max="100" value="0"></progress>
      <p id="upload-status" data-testid="clip-status" role="status" aria-live="polite"></p>
    </div>
    <label id="display-name-row" for="display-name" hidden>
      <span>اسم الفيشي</span>
      <input id="display-name" data-testid="clip-display-name" type="text" dir="auto" autocomplete="off" aria-describedby="display-name-error">
      <span id="display-name-error" class="error" role="alert" aria-live="polite"></span>
    </label>
    <p id="duration-status" data-testid="clip-duration" class="muted" role="status" aria-live="polite"></p>
     <p class="muted" dir="ltr">Jusqu’à 10 GiB. Le quota local peut être inférieur : sans stockage local, transfert au premier plan uniquement, reprise après fermeture indisponible. Arrière-plan selon le navigateur, sans garantie après fermeture forcée du mobile. Après réception serveur, vous pouvez partir pendant le traitement.</p>
    <div id="pending-uploads" dir="ltr" aria-live="polite"></div>
    <div>
      <button id="submit" data-testid="clip-submit" type="submit" disabled>نشر</button>
      <button id="cancel" class="secondary" type="button" hidden>Pause</button>
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
const mutableControls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, #choose-file"));
let cachedFile: File | null = null;
let selectedDuration: number | null = null;
let durationController: AbortController | null = null;
let durationProbe: Promise<number | null> | null = null;
let uploadController: AbortController | null = null;
let selectedFileKey: string | null = null;
let submissionPending = false;
let uploadOwner: number | null = null;
let activeQueueId: string | null = null;
let selectedQueueId: string | null = null;
const pendingUploads = element<HTMLDivElement>("pending-uploads");
let pollingJobs = false;
let foregroundOnly = false;

async function pollPendingJobs() {
  if (pollingJobs || uploadOwner === null || document.visibilityState === "hidden") return;
  pollingJobs = true;
  const owner = uploadOwner;
  try {
    for (const record of await listQueue(owner)) {
      if (!record.serverOwned || record.status === "failed" || uploadController) continue;
      const published = await runQueuedUpload(record.id, owner, new AbortController().signal, () => {});
      if (uploadOwner !== owner) return;
      if (published) { finalizePublication(published, record.id); mountReelsFeed(); }
    }
    await refreshPendingUploads();
  } catch (error) {
    uploadError.textContent = error instanceof Error ? error.message : "Vérification du traitement indisponible";
    await refreshPendingUploads();
  } finally { pollingJobs = false; }
}
setInterval(() => { void pollPendingJobs(); }, 5_000);
window.addEventListener("pageshow", () => { void pollPendingJobs(); });
document.addEventListener("visibilitychange", () => { void pollPendingJobs(); });

async function refreshPendingUploads() {
  if (uploadOwner === null) return;
  try {
    const owner = await currentUploadOwner();
    if (owner !== uploadOwner) {
      uploadController?.abort();
      uploadOwner = owner;
      cachedFile = null; selectedQueueId = null; input.value = "";
      receipt.hidden = true; receipt.replaceChildren();
      progressWrap.hidden = true;
      updateSubmitState();
    }
    const records = await listQueue(owner);
    pendingUploads.replaceChildren();
    for (const record of records) {
      const row = document.createElement("div");
      const label = document.createElement("p");
      const labels = { pending: "En attente", uploading: "À reprendre / en transfert", paused: "En pause", processing: "100% transféré — Traitement serveur; vous pouvez quitter", published: "Publié", error: "À reprendre", failed: "Traitement échoué — supprimer le suivi puis resélectionner pour réessayer" };
      label.textContent = `${record.metadata.title ?? record.name} — ${labels[record.status]} — ${Math.floor(record.uploaded / record.size * 100)}%${record.error ? ` — ${record.error}` : ""}`;
      const resume = document.createElement("button");
      resume.type = "button"; resume.textContent = record.serverOwned ? "Vérifier le traitement" : "Reprendre";
      resume.dataset.testid = `resume-upload-${record.id}`;
      resume.disabled = Boolean(uploadController);
      resume.onclick = async () => {
        if (uploadController || uploadOwner === null) return;
        const controller = new AbortController();
        uploadController = controller; activeQueueId = record.id;
        cancel.hidden = false; progressWrap.hidden = false;
        status.textContent = "Vérification de la reprise — attente si un autre onglet transfère déjà ce fichier…";
        updateSubmitState();
        try {
          const published = await runQueuedUpload(record.id, uploadOwner, controller.signal,
            (percent, bytes, speed, state, message) => reportUploadProgress(record.size, percent, bytes, speed, state, message));
          if (published) {
            const clearedSelection = finalizePublication(published, record.id);
            if (clearedSelection) reloadFeedAfterPublish();
            else mountReelsFeed();
          }
        } catch (error) { uploadError.textContent = error instanceof Error ? error.message : "Transfert interrompu"; }
        finally {
          uploadController = null; activeQueueId = null; cancel.hidden = true;
          updateSubmitState(); void refreshPendingUploads();
        }
      };
      const pause = document.createElement("button");
      pause.type = "button"; pause.textContent = "Pause"; pause.className = "secondary";
      pause.hidden = Boolean(record.serverOwned);
      pause.dataset.testid = `pause-upload-${record.id}`;
      pause.onclick = () => {
        pauseQueuedUpload(record.id);
        navigator.serviceWorker?.controller?.postMessage({ type: "CLIP_UPLOAD_PAUSE", id: record.id });
        void markQueuedPaused(record.id, record.owner).then(refreshPendingUploads).catch(error => {
          uploadError.textContent = error instanceof Error ? error.message : "Pause impossible";
        });
      };
      const discard = document.createElement("button");
      discard.type = "button"; discard.textContent = record.serverOwned ? "Supprimer le suivi local" : "Abandonner"; discard.className = "secondary";
      discard.dataset.testid = `discard-upload-${record.id}`;
      discard.onclick = async () => {
        if (uploadOwner === null || !confirm(record.serverOwned ? "Supprimer le suivi local ? Le traitement serveur ne sera pas annulé." : "Abandonner et supprimer ce transfert ?")) return;
        discard.disabled = true;
      try {
        await discardQueuedUpload(record.id, uploadOwner);
        if (selectedQueueId === record.id) { selectedQueueId = null; displayName.disabled = false; }
        await refreshPendingUploads();
      }
        catch (error) { uploadError.textContent = error instanceof Error ? error.message : "Abandon impossible"; discard.disabled = false; }
      };
      row.append(label, resume, pause, discard); pendingUploads.append(row);
    }
  } catch (error) {
    receipt.hidden = true;
    pendingUploads.textContent = `Reprise locale indisponible : ${error instanceof Error ? error.message : "stockage inaccessible"}`;
  }
}

// Hand off only on departure. While this page is alive XHR gives real byte-level
// progress; the same Web Lock prevents the worker from racing it.
window.addEventListener("pagehide", () => {
  if (!activeQueueId || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "CLIP_UPLOAD_START", id: activeQueueId });
  void navigator.serviceWorker.getRegistration().then(registration => {
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync;
    return sync?.register("helixly-clips-upload");
  }).catch(() => { /* Stored queue remains available on reopening. */ });
});
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", event => {
  const data = event.data;
  if (data?.owner !== uploadOwner) return;
  if (data.type === "CLIP_UPLOAD_DONE") { void refreshPendingUploads(); mountReelsFeed(); }
  if (data.type === "CLIP_UPLOAD_ERROR") { uploadError.textContent = data.error; void refreshPendingUploads(); }
  if (data.type === "CLIP_UPLOAD_PROGRESS") {
    status.textContent = data.state === "processing" ? "Traitement serveur…" : `${Math.floor(data.percent)}% — ${data.state === "stalled" ? "En attente de R2" : "Arrière-plan : octets confirmés par R2"}`;
    progressWrap.hidden = false; progress.value = data.percent;
  }
});
if (window.isSecureContext && "serviceWorker" in navigator) {
  // Same URL and scope as app-entry: updates the canonical push/call worker.
  void navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE, updateViaCache: "none" }).catch(() => {
    pendingUploads.textContent = "Arrière-plan indisponible. Le transfert fonctionne dans cet onglet; les fichiers enregistrés restent reprenables.";
  });
}
const DURATION_CLICK_WAIT_MS = 8_000;

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
  // Selection is enough to make the action discoverable. Size, duration and
  // title errors are explained after a click instead of by a disabled button.
  submit.disabled = Boolean(uploadController) || !cachedFile;
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

export function finalizePublication(published: PublishedClip, finishedQueueId?: string) {
  // A server job can finish while the composer holds a different file or paused
  // upload. Its receipt must not reset that independent selection or its identity.
  const clearSelection = finishedQueueId === undefined ||
    selectedQueueId === finishedQueueId || (!cachedFile && !selectedQueueId);
  if (clearSelection) {
    progress.value = 100;
    status.textContent = "تم نشر الملف — publication confirmée";
    selectedQueueId = null;
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
  }
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
  return clearSelection;
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
  selectedQueueId = null;
  displayName.disabled = false;
  selectedDuration = null;
  chooseFile.textContent = `${selected.name} — ${(selected.size / 1024 / 1024).toFixed(2)} MB`;
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
  if (selected.size > MAX_CLIP_BYTES) {
    durationStatus.textContent = "";
    cancel.hidden = true;
    return;
  }
  durationStatus.textContent = "المدة: جارٍ القراءة…";
  cancel.hidden = false;
  const probe = readClipDuration(selected, probing.signal).then(duration => {
    if (probing.signal.aborted || cachedFile !== selected) return null;
    selectedDuration = duration;
    durationStatus.textContent = `المدة: ${formatDuration(duration)}`;
    return duration;
  }).catch(() => {
    if (!probing.signal.aborted && cachedFile === selected) {
      durationStatus.textContent = "Durée inconnue — vérification par le serveur";
    }
    return null;
  }).finally(() => {
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
    // A publication waiting on the selection probe owns that wait too. Abort
    // both so cancellation cannot later fall through into transfer.
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
  let timer = 0;
  let rejectAborted: ((reason: unknown) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted?.(
    signal.reason ?? new DOMException("Cancelled", "AbortError"),
  );
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const duration = await Promise.race([
      pending,
      new Promise<null>(resolve => {
        timer = window.setTimeout(() => resolve(null), DURATION_CLICK_WAIT_MS);
      }),
      aborted,
    ]);
    signal.throwIfAborted();
    return duration;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function reportUploadProgress(
  total: number,
  percent: number,
  uploadedBytes: number | undefined,
  speedBytesPerSecond: number,
  uploadState: Parameters<ClipUploadProgress>[3],
  message?: string,
) {
  if (uploadState === "preparing") {
    element<HTMLParagraphElement>("preparation-status").textContent = message ?? "Préparation de la vidéo…";
    progress.value = percent;
    status.textContent = "Préparation avant transfert — Pause pour interrompre. Aucune garantie d’envoi en une minute : débit réseau et durée du média déterminent le temps total.";
    submit.textContent = `Préparation ${Math.floor(percent)}%…`;
    return;
  }
  // The transfer may be much smaller than the source after preparation.
  if (uploadedBytes && percent > 0) total = Math.round(uploadedBytes * 100 / percent);
  const uploaded = uploadedBytes ?? Math.min(total, Math.round(total * percent / 100));
  const displayPercent = Math.floor(percent);
  progress.value = percent;
  submit.textContent = `Téléversement ${displayPercent}%…`;
  if (uploadState === "processing") {
    status.textContent = "100% transféré — vérification et traitement serveur… Vous pouvez quitter après réception serveur; la publication reste à confirmer.";
    submit.textContent = "Traitement serveur…";
    cancel.hidden = true;
    return;
  }
  status.textContent = uploadState === "offline"
    ? `${formatBytes(uploaded)} من ${formatBytes(total)} — متوقف مؤقتاً؛ يكمل الى تقطع عند رجوع الاتصال`
    : `${formatBytes(uploaded)} من ${formatBytes(total)} — ${displayPercent}% — ${uploadState === "stalled" ? "En attente du réseau / accusé R2" : formatSpeed(speedBytesPerSecond)}`;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = cachedFile;
  if (!file || uploadController || submissionPending) return;
  submissionPending = true;
  foregroundOnly = false;
  uploadError.textContent = "";
  displayNameError.textContent = "";
  displayName.setAttribute("aria-invalid", "false");
  if (file.size > MAX_CLIP_BYTES) {
    uploadError.textContent = "الحد الأقصى للملف هو 10 GiB (10 737 418 240 octets)";
    submissionPending = false;
    return;
  }
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
  mutableControls.forEach(control => { control.disabled = true; });
  submit.disabled = true;
  submit.textContent = "Téléversement 0%…";
  cancel.hidden = false;
  cancel.disabled = false;
  progressWrap.hidden = false;
  progress.value = 0;
  status.textContent = `0% — 0 من ${formatBytes(file.size)} — جارٍ التحقق من المدة…`;
  uploadError.textContent = "";
  try {
    const duration = selectedDuration ?? await awaitPendingDurationProbe(operation.signal);
    operation.signal.throwIfAborted();
    if (cachedFile !== file) return;
    if (duration !== null && duration < 60) {
      uploadError.textContent = "خاص دقيقة الفوق";
      status.textContent = "لم يبدأ الرفع";
      return;
    }
    const metadata: ClipUploadMetadata = {
      title,
      originalFilename: file.name,
      contentType: file.type || "application/octet-stream",
      // No guessed duration: the server probes media if browser metadata is unavailable.
      durationSec: duration,
    };
    status.textContent = `Enregistrement local du fichier — ${formatBytes(file.size)}`;
    const onProgress: ClipUploadProgress = (
      percent,
      uploadedBytes,
      speedBytesPerSecond,
      uploadState,
      message,
    ): void => {
      reportUploadProgress(file.size, percent, uploadedBytes, speedBytesPerSecond, uploadState, message);
    };
    if (selectedQueueId) activeQueueId = selectedQueueId;
    const published = selectedQueueId && uploadOwner !== null
      ? await runQueuedUpload(selectedQueueId, uploadOwner, operation.signal, onProgress)
      : await uploadClip(file, metadata, operation.signal, onProgress, {
      onStored: record => { activeQueueId = record.id; selectedQueueId = record.id; void refreshPendingUploads(); },
      onForegroundOnly: message => { foregroundOnly = true; uploadError.textContent = message; },
    });
    if (!published) {
      cachedFile = null; input.value = ""; selectedQueueId = null;
      status.textContent = "100% reçu par le serveur — traitement en cours. Vous pouvez quitter; le suivi reprend au retour.";
      return;
    }
    finalizePublication({ ...published, name: title });
    reloadFeedAfterPublish();
  } catch (error) {
    const cancelled = operation.signal.aborted;
    uploadError.textContent = cancelled ? (foregroundOnly ? "Transfert interrompu — non enregistré localement; reprise après fermeture indisponible." : "En pause — Reprendre pour continuer") :
      error instanceof Error ? error.message : "تعذر الرفع — حاول مجدداً";
    status.textContent = cancelled ? "توقف الرفع" : "لم يكتمل الرفع";
  } finally {
    submissionPending = false;
    uploadController = null;
    activeQueueId = null;
    void refreshPendingUploads();
    mutableControls.forEach(control => { control.disabled = false; });
    displayName.disabled = Boolean(selectedQueueId);
    updateSubmitState();
    submit.textContent = "نشر";
    cancel.hidden = true;
  }
});

// ── Reels feed + upload composer wiring ──────────────────────────────────────
// The fullscreen Reels feed is the primary surface. The camera button (and the
// empty-state "publish") open this composer, which hosts the existing upload
// form and direct helixly-clips upload pipeline.
let reels: ReelsController | null = null;
let lastFocusBeforeComposer: HTMLElement | null = null;

function openComposer() {
  lastFocusBeforeComposer = document.activeElement as HTMLElement;
  reels?.pause();
  composer.hidden = false;
  (chooseFile ?? composerClose).focus();
}
function closeComposer() {
  composer.hidden = true;
  reels?.resume();
  lastFocusBeforeComposer?.focus();
}
composerClose.addEventListener("click", closeComposer);
composer.addEventListener("keydown", event => { if (event.key === "Escape") closeComposer(); });

function mountReelsFeed() {
  reels?.destroy();
  try {
    reels = mountReels(reelsRoot, { onOpenComposer: openComposer });
  } catch (error) {
    console.error("Clips feed mount failed", error);
    reelsRoot.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = "Impossible d’ouvrir Clips. Réessayez ou revenez à l’accueil.";
    const retry = document.createElement("button");
    retry.textContent = "Réessayer";
    retry.onclick = mountReelsFeed;
    const home = document.createElement("a");
    home.href = BASE; home.textContent = "Accueil";
    reelsRoot.append(message, retry, home);
  }
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
      uploadOwner = me.id;
      void refreshPendingUploads();
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