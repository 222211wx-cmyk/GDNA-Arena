import { trackEvent } from "@/lib/analytics";

const CONTROL_API = () => `${import.meta.env.BASE_URL}api/upload/presign`;

export type ClipUploadMetadata = {
  /** Citizen-facing publication title. */
  title: string;
  /** Untrusted hint only. Null means the browser could not read media metadata. */
  durationSec: number | null;
  /** Library A | B | C | D (default B). */
  category?: string;
};

/** Progress counts only storage-acknowledged bytes. */
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


export async function currentUploadOwner(signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Reconnectez-vous pour publier");
  if (!response.ok) throw new Error(`Vérification de session indisponible (${response.status}) — réessayez`);
  const me = await response.json();
  if (!Number.isSafeInteger(me?.id) || me.id <= 0 || typeof me.username !== "string") throw new Error("Compte non vérifié — réessayez");
  return me.id;
}

// Network drops retry without limit (resume). A server that keeps answering with
// an error (e.g. 503 storage down) fails visibly after 6 tries instead of
// sitting at 0% forever.
async function retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let delay = 1000;
  let serverFailures = 0;
  for (;;) {
    signal.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      signal.throwIfAborted();
      const status = (error as { status?: number }).status;
      if (status && status < 500 && status !== 408 && status !== 429) throw error;
      if (status && ++serverFailures >= 6) throw error;
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(abortReason(signal)); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, delay);
        signal.addEventListener("abort", stop, { once: true });
      });
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

// Resume identity: size + mtime + hash of the first and last 1 MiB. Instant for
// any file size (no full read before the first byte is sent).
async function fileIdentity(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  const edge = 1024 * 1024;
  const head = await file.slice(0, edge).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - edge)).arrayBuffer();
  const meta = new TextEncoder().encode(`${file.size}:${file.lastModified}:`);
  const all = new Uint8Array(meta.length + head.byteLength + tail.byteLength);
  all.set(meta); all.set(new Uint8Array(head), meta.length); all.set(new Uint8Array(tail), meta.length + head.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all)), x => x.toString(16).padStart(2, "0")).join("");
}

/** PUT one chunk with byte-level progress (fetch cannot report upload progress). */
function putChunk(url: string, body: Blob, signal: AbortSignal, onBytes: (n: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => onBytes(e.loaded);
    xhr.onload = () => {
      let parsed: any = null;
      try { parsed = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
      else reject(Object.assign(new Error(typeof parsed?.error === "string" ? parsed.error : `تعذر الرفع (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error("انقطع الاتصال — Connexion interrompue"));
    const stop = () => { xhr.abort(); reject(abortReason(signal)); };
    signal.addEventListener("abort", stop, { once: true });
    xhr.onloadend = () => signal.removeEventListener("abort", stop);
    xhr.send(body);
  });
}

/** Upload policy mirrored from the server (which enforces it). */
export const MAX_UPLOAD_BYTES = 1_000_000_000;
export const UPLOAD_CONCURRENCY = 20;
export const FILE_TOO_LARGE_MESSAGE = "الملف كبير بزاف — Fichier trop volumineux (max 1 Go / 1000 Mo)";
export const UNSUPPORTED_FILE_MESSAGE = "MP4 أو ZIP فقط — Seuls les fichiers MP4 et ZIP sont acceptés";
export const isZipFile = (file: { name: string }) => /\.zip$/i.test(file.name);
export function validateUploadFile(file: { name: string; size: number }): string | null {
  if (!/\.(mp4|zip)$/i.test(file.name)) return UNSUPPORTED_FILE_MESSAGE;
  if (file.size > MAX_UPLOAD_BYTES) return FILE_TOO_LARGE_MESSAGE;
  return null;
}

type Part = { partNumber: number; etag: string; size: number };

/**
 * Sends every missing part with up to UPLOAD_CONCURRENCY requests in flight.
 * A failed part retries on its own (after checking the server did not already
 * store it); finished parts are never sent again. Progress is real bytes:
 * confirmed parts plus the bytes the browser has handed over for in-flight ones.
 */
async function uploadParts(
  file: File,
  session: { sessionId: string; partSize: number; partCount: number },
  parts: Map<number, Part>,
  control: (body: Record<string, unknown>) => Promise<any>,
  outer: AbortSignal,
  onProgress: ClipUploadProgress,
) {
  const stop = new AbortController();
  const relay = () => stop.abort(abortReason(outer));
  outer.addEventListener("abort", relay, { once: true });
  const signal = stop.signal;
  const rangeOf = (n: number) => {
    const start = (n - 1) * session.partSize;
    return [start, Math.min(file.size, start + session.partSize)] as const;
  };
  let confirmed = 0;
  const inFlight = new Map<number, number>();
  const report = () => {
    let sent = confirmed;
    for (const bytes of inFlight.values()) sent += bytes;
    sent = Math.min(file.size, sent);
    onProgress(file.size ? sent / file.size * 100 : 100, sent, file.size);
  };
  const queue: number[] = [];
  for (let n = 1; n <= session.partCount; n++) {
    if (parts.has(n)) { const [s, e] = rangeOf(n); confirmed += e - s; } else queue.push(n);
  }
  report();
  const sendPart = async (partNumber: number) => {
    const [start, end] = rangeOf(partNumber);
    let attempted = false;
    const part = await retry(async () => {
      if (attempted) {
        inFlight.set(partNumber, 0); report();
        const check = await control({ action: "inspect", sessionId: session.sessionId });
        const stored = check.parts?.find((p: Part) => p.partNumber === partNumber && p.size === end - start);
        if (stored) return stored;
      }
      attempted = true;
      return putChunk(`${import.meta.env.BASE_URL}api/upload/chunk/${session.sessionId}/${partNumber}`,
        file.slice(start, end), signal,
        loaded => { inFlight.set(partNumber, Math.min(loaded, end - start)); report(); });
    }, signal);
    inFlight.delete(partNumber);
    confirmed += end - start;
    parts.set(partNumber, part);
    report();
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      signal.throwIfAborted();
      await sendPart(queue[cursor++]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));
  } catch (error) {
    stop.abort(error);
    throw error;
  } finally {
    outer.removeEventListener("abort", relay);
  }
}

/** Poll the server while it extracts an uploaded ZIP into the library. */
export async function waitForArchive(
  libraryUrl: string,
  signal: AbortSignal,
  onUpdate?: (archive: { state: string; files: { name: string; size: number; kind: string; code?: string; error?: string }[] }) => void,
) {
  for (;;) {
    signal.throwIfAborted();
    const response = await fetch(`${import.meta.env.BASE_URL}${libraryUrl.replace(/^\//, "")}`,
      { credentials: "include", cache: "no-store", signal });
    if (response.ok) {
      const archive = await response.json();
      onUpdate?.(archive);
      if (archive.state === "ready" || archive.state === "failed") return archive;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/** browser chunks → authenticated server → storage; resume confirmed parts. */
export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
  _options?: unknown,
): Promise<PublishedClip> {
  signal.throwIfAborted();
  const invalid = validateUploadFile(file);
  if (invalid) throw new Error(invalid);
  // No registration: the server opens an anonymous session on first publish.
  const owner = "guest";
  const contentType = isZipFile(file) ? "application/zip" : "video/mp4";
  const identity = await fileIdentity(file, signal);
  const savedKey = `clips-server-upload:${owner}:${identity}:${encodeURIComponent(metadata.title)}:${encodeURIComponent(file.name)}`;
  let requestId = localStorage.getItem(savedKey);
  if (!requestId) { requestId = crypto.randomUUID(); localStorage.setItem(savedKey, requestId); }
  const control = (body: Record<string, unknown>) =>
    retry(() => postJson(CONTROL_API(), { ...body }, signal), signal);
  const session = await control({
    action: "initiate", requestId,
    filename: file.name,
    title: metadata.title,
    contentType,
    size: file.size,
    durationSec: metadata.durationSec,
    category: metadata.category ?? "B",
  });
  if (typeof session?.sessionId !== "string" || !Number.isSafeInteger(session.partSize) || session.partSize <= 0) {
    throw new Error("تعذر بدء الرفع — حاول مجدداً");
  }
  onProgress(0, 0, file.size);
  const inspected = await control({ action: "inspect", sessionId: session.sessionId });
  const parts = new Map<number, { partNumber: number; etag: string; size: number }>(
    (inspected.parts ?? []).map((p: { partNumber: number; etag: string; size: number }) => [p.partNumber, p]),
  );
  let body = inspected.receipt;
  if (!body) {
    if (inspected.state !== "completing") {
      await uploadParts(file, session, parts, control, signal, onProgress);
    }
    body = await control({ action: "complete", sessionId: session.sessionId });
  }
  signal.throwIfAborted();
  if (body?.kind === "zip") {
    localStorage.removeItem(savedKey);
    return { code: "", name: metadata.title, status: "accepté", reason: "", kind: "zip", libraryUrl: String(body.libraryUrl) };
  }
  if (body?.status === "refusé") {
    localStorage.removeItem(savedKey);
    trackEvent("clip_upload_success", { outcome: "refused" });
    return { code: "", name: metadata.title, status: "refusé", reason: String(body.reason ?? "") };
  }
  const clip = body?.clip && typeof body.clip === "object" ? body.clip : null;
  const code = body?.code ?? clip?.code;
  if (body?.ok === false || !clip || typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("لم يؤكد الخادم نشر الكليب");
  }
  trackEvent("clip_upload_success", { outcome: "published" });
  localStorage.removeItem(savedKey);
  return { ...clip, status: "accepté", reason: "", code, name: clip.title ?? body.name ?? clip.name ?? metadata.title };
}
