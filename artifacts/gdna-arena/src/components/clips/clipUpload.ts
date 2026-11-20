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

/** browser chunks → authenticated server → storage; resume confirmed parts. */
export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
  _options?: unknown,
): Promise<PublishedClip> {
  signal.throwIfAborted();
  // No registration: the server opens an anonymous session on first publish.
  const owner = "guest";
  const contentType = file.type || "application/octet-stream";
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
    for (let partNumber = 1; inspected.state !== "completing" && partNumber <= session.partCount; partNumber++) {
      const start = (partNumber - 1) * session.partSize;
      const end = Math.min(file.size, start + session.partSize);
      if (!parts.has(partNumber)) {
        let attempted = false;
        const part = await retry(async () => {
          if (attempted) {
            const confirmed = await control({ action: "inspect", sessionId: session.sessionId });
            const stored = confirmed.parts?.find((p: { partNumber: number; size: number }) =>
              p.partNumber === partNumber && p.size === end - start);
            if (stored) return stored;
          }
          attempted = true;
          return putChunk(`${import.meta.env.BASE_URL}api/upload/chunk/${session.sessionId}/${partNumber}`,
            file.slice(start, end), signal,
            loaded => { const sent = Math.min(file.size, start + loaded); onProgress(sent / file.size * 100, sent, file.size); });
        }, signal);
        parts.set(partNumber, part);
      }
      onProgress(end / file.size * 100, end, file.size);
    }
    body = await control({ action: "complete", sessionId: session.sessionId });
  }
  signal.throwIfAborted();
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
