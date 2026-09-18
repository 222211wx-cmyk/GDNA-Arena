import { tokens } from "@workspace/gdna-ds/tokens";
import { uploadClip, type ClipUploadMetadata } from "./components/clips/clipUpload";

const BASE = import.meta.env.BASE_URL;
const MAX_BYTES = 25 * 1024 * 1024;
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
  a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important}
`;
document.head.appendChild(style);

root.innerHTML = `
<main dir="rtl" data-testid="clip-shell">
  <header><h1>الكليبز</h1><a href="${BASE}">ARENA</a></header>
  <div id="auth" class="muted" aria-live="polite">جارٍ التحقق من تسجيل الدخول…</div>
  <form id="upload" data-testid="clip-upload" hidden>
    <h2>رفع صوت أو فيديو</h2>
    <label>الملف — 25 MiB كحد أقصى
      <input id="file" data-testid="clip-file-input" type="file" required
        accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac">
    </label>
    <p id="selection" class="muted">يرفع المتصفح الملف الأصلي مباشرة؛ لا يجري ضغطاً أو تحليلاً للوسائط.</p>
    <fieldset>
      <legend>نوع النشر</legend>
      <label><input type="radio" name="purpose" value="story" checked> ستوري / مقطع مواطن</label>
      <label><input type="radio" name="purpose" value="original"> إيداع أصل لديّ حقوقه</label>
    </fieldset>
    <label><input id="original-footage" name="is_original_footage" type="checkbox" checked> أصرّح أن هذا التسجيل مصوّر من هاتفي أو كاميرتي</label>
    <div id="rights" hidden>
      <label>اسم صاحب الحقوق أو المنتج المخوّل<input id="holder" maxlength="120"></label>
      <fieldset>
        <legend>صفة صاحب الحقوق</legend>
        <label><input type="radio" name="role" value="owner" checked> صاحب العمل</label>
        <label><input type="radio" name="role" value="producer"> منتج مخوّل</label>
      </fieldset>
      <label>مرجع تسجيل الأصل أو وثيقة الحقوق<input id="reference" maxlength="200"></label>
      <p class="muted">هذا تصريح وإيداع داخل المنصة، وليس تحققاً قانونياً من الملكية.</p>
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
const submit = element<HTMLButtonElement>("submit");
const cancel = element<HTMLButtonElement>("cancel");
const selection = element<HTMLParagraphElement>("selection");
const rights = element<HTMLDivElement>("rights");
const holder = element<HTMLInputElement>("holder");
const reference = element<HTMLInputElement>("reference");
const progressWrap = element<HTMLDivElement>("progress-wrap");
const progress = element<HTMLProgressElement>("progress");
const status = element<HTMLParagraphElement>("upload-status");
const uploadError = element<HTMLParagraphElement>("upload-error");
const feed = element<HTMLDivElement>("feed");
const mutableControls = Array.from(form.querySelectorAll<HTMLInputElement>("input"));
let cachedFile: File | null = null;
let uploadController: AbortController | null = null;

function formatBytes(bytes: number) {
  return new Intl.NumberFormat("ar").format(bytes) + " بايت";
}

function selectedValue(name: string) {
  return (form.elements.namedItem(name) as RadioNodeList).value;
}

form.addEventListener("change", event => {
  if ((event.target as HTMLInputElement).name === "purpose") {
    const original = selectedValue("purpose") === "original";
    rights.hidden = !original;
    holder.required = original;
    reference.required = original;
  }
});

input.addEventListener("change", () => {
  const selected = input.files?.[0] ?? null;
  uploadError.textContent = "";
  if (selected && selected.size > MAX_BYTES) {
    cachedFile = null;
    input.value = "";
    submit.disabled = true;
    selection.textContent = "لم يتم اختيار ملف";
    uploadError.textContent = "الفيديو كبير - صغر 720p";
    return;
  }
  cachedFile = selected;
  submit.disabled = !selected;
  selection.textContent = selected ? `${selected.name} — ${formatBytes(selected.size)}` : "لم يتم اختيار ملف";
});

cancel.addEventListener("click", () => uploadController?.abort(new DOMException("Cancelled", "AbortError")));

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = cachedFile;
  if (!file || uploadController) return;
  if (file.size > MAX_BYTES) {
    uploadError.textContent = "الفيديو كبير - صغر 720p";
    return;
  }
  const purpose = selectedValue("purpose") as "story" | "original";
  if (purpose === "original" && (holder.value.trim().length < 2 || reference.value.trim().length < 3)) {
    uploadError.textContent = "أدخل اسم صاحب الحقوق ومرجع تسجيل الأصل";
    return;
  }
  const metadata: ClipUploadMetadata = {
    title: file.name,
    contentType: file.type || "application/octet-stream",
    durationSec: 0,
    purpose,
    isOriginalFootage: element<HTMLInputElement>("original-footage").checked,
    ...(purpose === "original" ? {
      originalReference: reference.value.trim(),
      rightsHolderName: holder.value.trim(),
      rightsHolderRole: selectedValue("role") as "owner" | "producer",
    } : {}),
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
    await uploadClip(file, metadata, uploadController.signal, percent => {
      const uploaded = Math.min(file.size, Math.round(file.size * percent / 100));
      const displayPercent = Math.floor(percent);
      progress.value = percent;
      status.textContent = percent === 100
        ? `تم النشر — ${formatBytes(file.size)}`
        : `${formatBytes(uploaded)} من ${formatBytes(file.size)} — ${displayPercent}%`;
    });
    cachedFile = null;
    input.value = "";
    selection.textContent = "تم نشر الملف";
    await loadFeed();
  } catch (error) {
    const cancelled = uploadController.signal.aborted;
    uploadError.textContent = cancelled ? "تم إلغاء الرفع — يمكنك إعادة المحاولة" :
      error instanceof Error ? error.message : "تعذر الرفع — حاول مجدداً";
    status.textContent = cancelled ? "توقف الرفع" : "لم يكتمل الرفع";
  } finally {
    uploadController = null;
    mutableControls.forEach(control => { control.disabled = false; });
    submit.disabled = !cachedFile;
    cancel.hidden = true;
  }
});

type Clip = { id: number; video_url: string; content_type?: string; title?: string; rights_purpose?: string };

function renderClips(clips: Clip[]) {
  feed.replaceChildren();
  if (!clips.length) {
    feed.textContent = "لا يوجد كليبز - كن أول من ينشر";
    return;
  }
  for (const clip of clips.slice(0, 3)) {
    const article = document.createElement("article");
    const title = document.createElement("p");
    title.textContent = clip.title || (clip.content_type?.startsWith("audio/") ? "مقطع صوتي" : "فيديو");
    const media = document.createElement(clip.content_type?.startsWith("audio/") ? "audio" : "video");
    media.setAttribute("controls", "");
    media.setAttribute("preload", "none");
    if (media instanceof HTMLVideoElement) media.playsInline = true;
    media.src = clip.video_url;
    article.append(title, media);
    if (clip.rights_purpose === "original") {
      const deposit = document.createElement("p");
      deposit.className = "muted";
      deposit.textContent = "أصل مودَع — تصريح بالحقوق، غير محقّق قانونياً";
      article.append(deposit);
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