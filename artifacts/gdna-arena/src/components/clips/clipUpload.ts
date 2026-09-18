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
const fileSessionIds = new WeakMap<File, string>();
const resumableSessions = new Map<string, SavedUpload>();

function timeoutSignal(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
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

function responseHeaders(xhr: XMLHttpRequest) {
  const headers = new Headers();
  for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

function patchRequest(
  url: string,
  offset: number,
  body: Blob,
  signal: AbortSignal,
  onBytesSent: (bytesSent: number) => void,
) {
  return new Promise<Response>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      action();
    };
    const abort = () => {
      xhr.abort();
      finish(() => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError")));
    };

    xhr.open("PATCH", url);
    xhr.withCredentials = true;
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader("Tus-Resumable", "1.0.0");
    xhr.setRequestHeader("Upload-Offset", String(offset));
    xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
    xhr.upload.onprogress = event => onBytesSent(Math.min(body.size, Math.max(0, event.loaded)));
    xhr.onload = () => finish(() => {
      const responseBody = xhr.status === 204 || xhr.status === 205 ? null : xhr.responseText;
      resolve(new Response(responseBody, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders(xhr),
      }));
    });
    xhr.onerror = () => finish(() => reject(new TypeError("Network request failed")));
    xhr.ontimeout = () => finish(() => reject(new DOMException("Request timed out", "TimeoutError")));
    xhr.onabort = () => finish(() => reject(
      signal.aborted
        ? signal.reason ?? new DOMException("The operation was aborted", "AbortError")
        : new DOMException("The operation was aborted", "AbortError"),
    ));
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
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
  // Resume is intentionally limited to the exact File object selected in this
  // page. A similarly named replacement can never be stitched onto its upload,
  // and no unsafe cross-reload resume is claimed without a full-file identity.
  let sessionId = fileSessionIds.get(file);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    fileSessionIds.set(file, sessionId);
  }
  const metadataHash = await sha256(new Blob([JSON.stringify(metadata)]));
  return `${sessionId}:${metadataHash}`;
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
  onProgress: (percent: number, uploadedBytes?: number) => void,
) {
  const key = await sessionKey(file, metadata);
  let saved: SavedUpload | null = resumableSessions.get(key) ?? null;

  let offset: number | null = null;
  if (saved) {
    // A network failure must not discard a durable session. The next user retry
    // performs HEAD again; only an authoritative expired/not-found response recreates it.
    offset = await headOffset(saved.location, signal);
  }
  if (!saved || offset === null) {
    const groupId = crypto.randomUUID();
    saved = await create(file, metadata, groupId, signal);
    resumableSessions.set(key, saved);
    offset = 0;
  }

  while (offset < file.size) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
    let advanced = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES && !advanced; attempt++) {
      try {
        const chunk = file.slice(offset, end);
        const confirmedOffset = offset;
        const response = await patchRequest(saved.location, offset, chunk, signal, bytesSent => {
          const uploadedBytes = Math.min(file.size, confirmedOffset + bytesSent);
          onProgress(Math.min(99, uploadedBytes / file.size * 100), uploadedBytes);
        });
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
    onProgress(Math.min(99, offset / file.size * 100), offset);
  }

  const completion = await request(`${ROOT}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadIds: [saved.id], isOriginalFootage: metadata.isOriginalFootage }),
  }, signal);
  if (!completion.ok) throw new Error(await errorMessage(completion));
  const body = await completion.json();
  if (!body?.clip || !Number.isSafeInteger(body.clip.id)) throw new Error("لم يؤكد الخادم نشر الكليب");
  resumableSessions.delete(key);
  onProgress(100, file.size);
  return body.clip;
}