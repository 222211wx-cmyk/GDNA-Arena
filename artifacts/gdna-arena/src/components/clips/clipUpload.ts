import { trackEvent } from "@/lib/analytics";

const PRESIGN_API = () => `${import.meta.env.BASE_URL}api/clips/presign`;
const CONFIRM_API = () => `${import.meta.env.BASE_URL}api/clips/confirm`;

/** Single-PUT ceiling. Never shown to citizens as a number. */
export const MAX_CLIP_BYTES = 5 * 1024 * 1024 * 1024;
export const FILE_TOO_LARGE_MESSAGE = "هذا الملف كبير بزاف — اختر ملفاً أصغر";

export type ClipUploadMetadata = {
  /** Citizen-facing publication title. */
  title: string;
  /** Untrusted hint only. Null means the browser could not read media metadata. */
  durationSec: number | null;
};

/** Real byte progress of the single PUT of the original File. */
export type ClipUploadProgress = (percent: number, uploadedBytes: number, totalBytes: number) => void;

export type PublishedClip = {
  code: string;
  name: string;
  [key: string]: unknown;
};

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Cancelled", "AbortError");
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Fall through to the status message.
  }
  return `تعذر الرفع (${response.status})`;
}

async function postJson(url: string, body: Record<string, unknown>, signal: AbortSignal) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw Object.assign(new Error(await errorMessage(response)), { status: response.status });
  return response.json();
}

/** One XHR PUT of the untouched File. Cancel aborts the request; no retries. */
export function putFile(url: string, file: File, contentType: string, signal: AbortSignal, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortReason(signal)); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    // The signed object is immutable: the URL only accepts a create, never an overwrite.
    xhr.setRequestHeader("If-None-Match", "*");
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(file.size, event.loaded));
    };
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(Object.assign(new Error(`تعذر الرفع (${xhr.status})`), { status: xhr.status }));
        return;
      }
      onProgress(file.size);
      resolve();
    };
    xhr.onerror = () => { done(); reject(new Error("تعذر الرفع — تحقق من الاتصال وحاول مجدداً")); };
    xhr.onabort = () => { done(); reject(abortReason(signal)); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}

export async function currentUploadOwner(signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Reconnectez-vous pour publier");
  if (!response.ok) throw new Error(`Vérification de session indisponible (${response.status}) — réessayez`);
  const me = await response.json();
  if (!Number.isSafeInteger(me?.id) || me.id <= 0 || typeof me.username !== "string") throw new Error("Compte non vérifié — réessayez");
  return me.id;
}

/** presign → PUT original File → confirm. Returns the server's final receipt. */
export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
  options: { expectedOwner: number },
): Promise<PublishedClip> {
  signal.throwIfAborted();
  if (file.size > MAX_CLIP_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);
  const owner = await currentUploadOwner(signal);
  if (owner !== options.expectedOwner) {
    throw new Error("Le compte a changé — ce fichier ne sera pas publié avec un autre compte");
  }
  const contentType = file.type || "application/octet-stream";
  const signed = await postJson(PRESIGN_API(), {
    filename: file.name,
    title: metadata.title,
    contentType,
    size: file.size,
    durationSec: metadata.durationSec,
    expectedOwnerId: owner,
  }, signal);
  if (typeof signed?.url !== "string" || typeof signed?.key !== "string") {
    throw new Error("تعذر بدء الرفع — حاول مجدداً");
  }
  onProgress(0, 0, file.size);
  await putFile(signed.url, file, contentType, signal, loaded => {
    onProgress(file.size ? loaded / file.size * 100 : 100, loaded, file.size);
  });
  signal.throwIfAborted();
  const body = await postJson(CONFIRM_API(), { key: signed.key, expectedOwnerId: owner }, signal);
  const clip = body?.clip && typeof body.clip === "object" ? body.clip : null;
  const code = body?.code ?? clip?.code;
  if (body?.ok === false || !clip || typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("لم يؤكد الخادم نشر الكليب");
  }
  trackEvent("clip_upload_success", { outcome: "published" });
  return { ...clip, code, name: clip.title ?? body.name ?? clip.name ?? metadata.title };
}
