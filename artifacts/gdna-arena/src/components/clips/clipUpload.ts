const ROOT = `${import.meta.env.BASE_URL}api/clips/uploads`;
export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

export type ClipUploadMetadata = {
  title: string;
  contentType: string;
  durationSec: number;
  purpose: "story" | "original";
  originalReference?: string;
  rightsHolderName?: string;
  rightsHolderRole?: "owner" | "producer";
  isOriginalFootage: boolean;
};

type SavedUpload = { location: string; id: string; groupId: string };
class NonRetryableUploadError extends Error {}

function timeoutSignal(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
  } };
}

async function request(url: string, init: RequestInit, parent: AbortSignal) {
  const timed = timeoutSignal(parent);
  try {
    return await fetch(url, { ...init, credentials: "include", cache: "no-store", signal: timed.signal });
  } finally {
    timed.dispose();
  }
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch { /* The status message below remains actionable. */ }
  return `تعذر الرفع (${response.status})`;
}

function encode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function metadataHeader(metadata: Record<string, string | number | boolean>) {
  return Object.entries(metadata).map(([key, value]) => `${key} ${encode(String(value))}`).join(",");
}

async function sha256(blob: Blob) {
  if (!crypto.subtle) throw new Error("هذا المتصفح لا يدعم حفظ جلسة رفع آمنة");
  const bytes = typeof (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function"
    ? await (blob as Blob & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function sessionKey(file: File, metadata: ClipUploadMetadata) {
  const contentHash = await sha256(file);
  const metadataHash = await sha256(new Blob([JSON.stringify(metadata)]));
  return `gdna:clip-upload:v1:${contentHash}:${metadataHash}:${file.size}:${file.lastModified}`;
}

async function headOffset(location: string, signal: AbortSignal): Promise<number | null> {
  const response = await request(location, {
    method: "HEAD", headers: { "Tus-Resumable": "1.0.0" },
  }, signal);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(await errorMessage(response));
  const offset = Number(response.headers.get("Upload-Offset"));
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

async function create(file: File, metadata: ClipUploadMetadata, groupId: string, signal: AbortSignal): Promise<SavedUpload> {
  const response = await request(ROOT, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(file.size),
      "Upload-Metadata": metadataHeader({
        groupId, partIndex: 0, partCount: 1, totalSize: file.size,
        ...metadata,
      }),
    },
  }, signal);
  if (response.status !== 201) throw new Error(await errorMessage(response));
  const rawLocation = response.headers.get("Location");
  if (!rawLocation) throw new Error("لم يعرض الخادم موقع جلسة الرفع");
  const location = new URL(rawLocation, window.location.href).pathname;
  const id = location.split("/").filter(Boolean).at(-1);
  if (!id) throw new Error("جلسة الرفع غير صالحة");
  return { location, id, groupId };
}

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
) {
  const key = await sessionKey(file, metadata);
  let saved: SavedUpload | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) saved = JSON.parse(raw) as SavedUpload;
  } catch { localStorage.removeItem(key); }

  let offset: number | null = null;
  if (saved) {
    // A network failure must not discard a durable session. The next user retry
    // performs HEAD again; only an authoritative expired/not-found response recreates it.
    offset = await headOffset(saved.location, signal);
  }
  if (!saved || offset === null) {
    const groupId = crypto.randomUUID();
    saved = await create(file, metadata, groupId, signal);
    localStorage.setItem(key, JSON.stringify(saved));
    offset = 0;
  }

  while (offset < file.size) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
    let advanced = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES && !advanced; attempt++) {
      try {
        const response = await request(saved.location, {
          method: "PATCH",
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: file.slice(offset, end),
        }, signal);
        if (response.status === 204) {
          const acknowledged = Number(response.headers.get("Upload-Offset"));
          offset = Number.isSafeInteger(acknowledged) && acknowledged > offset ? acknowledged : end;
          advanced = true;
        } else if (response.status >= 400 && response.status < 500 && response.status !== 409) {
          throw new NonRetryableUploadError(await errorMessage(response));
        }
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof NonRetryableUploadError) throw error;
        lastError = error;
      }
      if (!advanced) {
        const authoritative = await headOffset(saved.location, signal).catch(() => offset);
        if (authoritative !== null && authoritative > offset) {
          offset = authoritative;
          advanced = true;
        } else if (attempt + 1 < MAX_RETRIES) {
          await delay(500 * 2 ** attempt, signal);
        }
      }
    }
    if (!advanced) {
      throw lastError instanceof Error && lastError.message
        ? lastError
        : new Error("تعذر متابعة الرفع بعد عدة محاولات");
    }
    onProgress(Math.min(99, Math.floor(offset / file.size * 100)));
  }

  const completion = await request(`${ROOT}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadIds: [saved.id], isOriginalFootage: metadata.isOriginalFootage }),
  }, signal);
  if (!completion.ok) throw new Error(await errorMessage(completion));
  const body = await completion.json();
  if (!body?.clip || !Number.isSafeInteger(body.clip.id)) throw new Error("لم يؤكد الخادم نشر الكليب");
  localStorage.removeItem(key);
  onProgress(100);
  return body.clip;
}