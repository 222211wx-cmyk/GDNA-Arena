import { tokens } from "@workspace/gdna-ds/tokens";
import {
  MAX_CLIP_BYTES,
  uploadClip,
  type ClipUploadMetadata,
} from "./components/clips/clipUpload";
import { readClipDuration } from "./components/clips/readClipDuration";
import { mountVideoActions } from "./components/clips/VideoActions";

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
  progress{inline-size:100%;accent-color:${palette.primary}}video,audio{inline-size:100%;max-block-size:60vh;background:${palette.background}}
  .video-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(calc(${space} * 24),1fr));gap:calc(${space} * 2);padding-block:calc(${space} * 2)}
  .clip-action{display:grid;justify-items:center;gap:calc(${space} * 1);min-inline-size:0;white-space:nowrap;padding:calc(${space} * 2)}.clip-action.active{color:${palette.primary};border-color:${palette.primary}}
  .clip-action strong{font-size:.75rem}.clip-comments,.comment-list{display:grid;gap:calc(${space} * 2)}.comment-form,.title-edit{display:flex;gap:calc(${space} * 2)}.comment-form input,.title-edit input{min-inline-size:0;flex:1}
  .copy-link-fallback{inline-size:min(100%,28rem)}.clip-media-frame{overflow:hidden}
  .clip-zoomed{transform:scale(1.35);transform-origin:center;position:relative;z-index:2}article{overflow:visible}
  a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important}
`;
document.head.appendChild(style);

root.innerHTML = `
<main dir="rtl" data-testid="clip-shell">
  <header><h1>الكليبز</h1><a href="${BASE}">ARENA</a></header>
  <div id="auth" class="muted" aria-live="polite">جارٍ التحقق من تسجيل الدخول…</div>
  <form id="upload" data-testid="clip-upload" hidden>
    <h2>رفع صوت أو فيديو</h2>
    <input id="file" data-testid="clip-file-input" type="file" accept="video/*,audio/*" hidden>
    <button id="choose-file" class="secondary" type="button" aria-controls="file" aria-describedby="selection duration-status">Choisir un fichier — فيديو / أوديو</button>
    <p id="selection" class="muted" role="status" aria-live="polite">من دقيقة الفوق — الحد الأقصى للملف 2GB</p>
    <p id="duration-status" data-testid="clip-duration" class="muted" role="status" aria-live="polite"></p>
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
  <section aria-labelledby="feed-title">
    <h2 id="feed-title">أحدث الكليبز</h2>
    <div id="feed" aria-live="polite">جارٍ التحميل…</div>
  </section>
</main>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const auth = element<HTMLDivElement>("auth");
const form = element<HTMLFormElement>("upload");
const input = element<HTMLInputElement>("file");
const chooseFile = element<HTMLButtonElement>("choose-file");
const durationStatus = element<HTMLParagraphElement>("duration-status");
const receipt = element<HTMLDivElement>("receipt");
const submit = element<HTMLButtonElement>("submit");
const cancel = element<HTMLButtonElement>("cancel");
const selection = element<HTMLParagraphElement>("selection");
const progressWrap = element<HTMLDivElement>("progress-wrap");
const progress = element<HTMLProgressElement>("progress");
const status = element<HTMLParagraphElement>("upload-status");
const uploadError = element<HTMLParagraphElement>("upload-error");
const feed = element<HTMLDivElement>("feed");
const mutableControls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, #choose-file"));
let cachedFile: File | null = null;
let selectedDuration: number | null = null;
let durationController: AbortController | null = null;
let uploadController: AbortController | null = null;

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

chooseFile.addEventListener("click", () => input.click());

input.addEventListener("change", async () => {
  const selected = input.files?.[0];
  // A dismissed picker must not discard the previous selection.
  if (!selected) return;
  durationController?.abort();
  const probing = new AbortController();
  durationController = probing;
  cachedFile = selected;
  selectedDuration = null;
  chooseFile.textContent = `${selected.name} — ${(selected.size / 1024 / 1024).toFixed(2)} MB`;
  selection.textContent = "✓ Fichier sélectionné";
  submit.disabled = true;
  uploadError.textContent = "";
  progressWrap.hidden = true;
  status.textContent = "";
  receipt.hidden = true;
  receipt.replaceChildren();
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
    if (duration < 60) uploadError.textContent = "خاص دقيقة الفوق";
    else submit.disabled = false;
  } catch (error) {
    if (probing.signal.aborted || cachedFile !== selected) return;
    durationStatus.textContent = "المدة غير متاحة";
    uploadError.textContent = error instanceof Error ? error.message : "تعذر قراءة مدة الملف";
  }
});

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
  const metadata: ClipUploadMetadata = {
    title: file.name,
    contentType: file.type || "application/octet-stream",
    durationSec: selectedDuration,
  };
  uploadController = new AbortController();
  mutableControls.forEach(control => { control.disabled = true; });
  submit.disabled = true;
  cancel.hidden = false;
  cancel.disabled = false;
  progressWrap.hidden = false;
  progress.value = 0;
  status.textContent = `0 من ${formatBytes(file.size)}`;
  uploadError.textContent = "";
  try {
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
    cachedFile = null;
    selectedDuration = null;
    input.value = "";
    chooseFile.textContent = "Choisir un fichier — فيديو / أوديو";
    durationStatus.textContent = "";
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
    await loadFeed();
  } catch (error) {
    const cancelled = uploadController.signal.aborted;
    uploadError.textContent = cancelled ? "تم إلغاء الرفع — يمكنك إعادة المحاولة" :
      error instanceof Error ? error.message : "تعذر الرفع — حاول مجدداً";
    status.textContent = cancelled ? "توقف الرفع" : "لم يكتمل الرفع";
  } finally {
    uploadController = null;
    mutableControls.forEach(control => { control.disabled = false; });
    submit.disabled = !cachedFile || cachedFile.size > MAX_CLIP_BYTES ||
      selectedDuration === null || selectedDuration < 60;
    cancel.hidden = true;
  }
});

type Clip = { id: number; video_url: string; content_type?: string; title?: string; name?: string; code?: string };

function renderClips(clips: Clip[]) {
  feed.replaceChildren();
  if (!clips.length) {
    feed.textContent = "لا يوجد كليبز - كن أول من ينشر";
    return;
  }
  for (const clip of clips.slice(0, 3)) {
    const article = document.createElement("article");
    article.id = `clip-${clip.id}`;
    const title = document.createElement("h3");
    title.textContent = clip.name || clip.title || (clip.content_type?.startsWith("audio/") ? "مقطع صوتي" : "فيديو");
    const media = document.createElement(clip.content_type?.startsWith("audio/") ? "audio" : "video");
    media.setAttribute("controls", "");
    media.setAttribute("preload", "none");
    if (media instanceof HTMLVideoElement) media.playsInline = true;
    media.src = clip.video_url;
    const mediaFrame = document.createElement("div");
    mediaFrame.className = "clip-media-frame";
    mediaFrame.append(media);
    const actions = document.createElement("div");
    article.append(title, mediaFrame, actions);
    void mountVideoActions({
      host: actions,
      media,
      titleElement: title,
      clipId: clip.id,
      code: clip.code,
    });
    if (clip.code) {
      const code = document.createElement("p");
      const link = document.createElement("a");
      link.href = `${BASE}clip/${clip.code}`;
      link.textContent = clip.code;
      code.append(link);
      code.dir = "ltr";
      article.append(code);
    }
    feed.append(article);
  }
}

async function loadFeed() {
  feed.textContent = "جارٍ التحميل…";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}api/clips/feed?limit=3`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error();
    const data: unknown = await response.json();
    const candidate = data as { clips?: unknown[]; degraded?: boolean };
    if (candidate.degraded || !Array.isArray(candidate.clips)) throw new Error();
    const clips = candidate.clips.filter((value): value is Clip => {
      const clip = value as Partial<Clip>;
      return Number.isSafeInteger(clip?.id) && typeof clip?.video_url === "string";
    });
    if (clips.length !== candidate.clips.length) throw new Error();
    renderClips(clips);
  } catch {
    feed.innerHTML = `<p class="error">الكليبز غير متاحة حالياً أو الاتصال بطيء.</p><button class="secondary" type="button">إعادة المحاولة</button>`;
    feed.querySelector("button")?.addEventListener("click", () => void loadFeed());
  } finally {
    clearTimeout(timer);
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
    auth.textContent = "يمكنك رفع ملفك الآن";
    form.hidden = false;
  } catch {
    auth.innerHTML = `تعذر التحقق من الجلسة. <a href="${BASE}login">تسجيل الدخول</a>`;
  } finally {
    clearTimeout(timer);
  }
}

document.body.dataset.clipReady = "true";
void loadAuth();
void loadFeed();