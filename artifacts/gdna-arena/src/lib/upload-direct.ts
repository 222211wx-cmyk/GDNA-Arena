/**
 * Direct browser -> R2 multipart upload. The API server only signs URLs; video
 * bytes go straight to R2 with fetch PUT. Parts upload in parallel, each retried
 * with exponential backoff, and finished parts are persisted so a dropped
 * connection (or a reload) resumes from the missing parts, never from 0%.
 * There is deliberately no timeout on part uploads.
 */
export const PARALLEL_PARTS = 5;
export const MAX_PART_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const STORE_PREFIX = "upload-direct:";

export type DirectUploadProgress = (percent: number, uploadedBytes: number, totalBytes: number) => void;
export type DirectUploadOptions = {
  signal?: AbortSignal;
  onProgress?: DirectUploadProgress;
  /** Sent to /init and /complete; the server verifies it against the session. */
  title?: string;
  durationSec?: number | null;
  expectedOwnerId?: number;
  /** Test seams. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

type SavedUpload = { key: string; uploadId: string; partSize: number; totalParts: number; doneParts: Record<number, string> };

const api = (path: string) => `${(import.meta as any).env?.BASE_URL ?? "/"}api/upload/${path}`;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const retryable = (e: unknown) => {
  const s = (e as HttpError).status;
  return !s || s >= 500 || s === 408 || s === 429 || s === 403; // 403: expired signature, re-sign
};

async function post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(api(path), {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try { const j = await res.json(); if (typeof j?.error === "string") msg = j.error; } catch { /* keep default */ }
    throw new HttpError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const t = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(signal!.reason); };
  signal?.addEventListener("abort", stop, { once: true });
});

/** Resolves immediately when online; otherwise when the browser reconnects. */
function whenOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false || typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { window.removeEventListener("online", done); signal?.removeEventListener("abort", stop); resolve(); };
    const stop = () => { window.removeEventListener("online", done); reject(signal!.reason); };
    window.addEventListener("online", done, { once: true });
    signal?.addEventListener("abort", stop, { once: true });
  });
}

export function uploadStorageKey(file: File, owner?: number) {
  return `${STORE_PREFIX}${owner ?? 0}:${file.name}:${file.size}:${file.lastModified}`;
}

export async function uploadDirect(file: File, options: DirectUploadOptions = {}): Promise<Record<string, any>> {
  const { signal, onProgress, storage = localStorage, sleep = defaultSleep } = options;
  const storeKey = uploadStorageKey(file, options.expectedOwnerId);
  const owner = options.expectedOwnerId === undefined ? {} : { expectedOwnerId: options.expectedOwnerId };
  const total = file.size;

  const load = (): SavedUpload | null => {
    try {
      const s = JSON.parse(storage.getItem(storeKey) ?? "null") as SavedUpload | null;
      return s && typeof s.key === "string" && typeof s.uploadId === "string" && s.doneParts ? s : null;
    } catch { return null; }
  };
  const save = (s: SavedUpload) => { try { storage.setItem(storeKey, JSON.stringify(s)); } catch { /* quota: resume degrades to server ListParts-less restart */ } };

  const init = async (): Promise<SavedUpload> => {
    const r = await post<{ uploadId: string; key: string; partSize: number; totalParts: number }>("init", {
      filename: file.name, contentType: file.type || "application/octet-stream", fileSize: file.size,
      title: options.title, durationSec: options.durationSec ?? null, ...owner,
    }, signal);
    const s: SavedUpload = { key: r.key, uploadId: r.uploadId, partSize: r.partSize, totalParts: r.totalParts, doneParts: {} };
    save(s);
    return s;
  };

  let state = load() ?? (await init());
  let restarted = false;

  const sizeOf = (n: number) => Math.min(state.partSize, total - (n - 1) * state.partSize);
  const report = () => {
    const bytes = Object.keys(state.doneParts).reduce((sum, n) => sum + sizeOf(Number(n)), 0);
    onProgress?.(total ? (bytes / total) * 100 : 100, bytes, total);
  };

  async function putPart(n: number): Promise<void> {
    const body = file.slice((n - 1) * state.partSize, (n - 1) * state.partSize + sizeOf(n));
    let delay = BASE_DELAY_MS;
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      await whenOnline(signal);
      try {
        const { signedUrl } = await post<{ signedUrl: string }>("sign-part",
          { key: state.key, uploadId: state.uploadId, partNumber: n, ...owner }, signal);
        // No timeout: a slow link must be allowed to finish.
        const res = await fetch(signedUrl, { method: "PUT", body, signal });
        if (!res.ok) throw new HttpError(res.status, `Part ${n} failed (${res.status})`);
        const etag = res.headers.get("ETag");
        if (!etag) throw new HttpError(0, "R2 CORS must expose the ETag header");
        state.doneParts[n] = etag;
        save(state);
        report();
        return;
      } catch (e) {
        signal?.throwIfAborted();
        if (!retryable(e) || attempt >= MAX_PART_ATTEMPTS) throw e;
        await sleep(delay, signal);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  }

  async function uploadMissing() {
    const pending: number[] = [];
    for (let n = 1; n <= state.totalParts; n++) if (!state.doneParts[n]) pending.push(n);
    report();
    let failure: unknown;
    const worker = async () => {
      for (let n = pending.shift(); n !== undefined && failure === undefined; n = pending.shift()) {
        try { await putPart(n); } catch (e) { failure = failure ?? e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, pending.length) }, worker));
    if (failure !== undefined) throw failure;
  }

  for (;;) {
    try {
      await uploadMissing();
      const parts = Object.keys(state.doneParts).map(Number).sort((a, b) => a - b)
        .map(PartNumber => ({ PartNumber, ETag: state.doneParts[PartNumber] }));
      const result = await post<Record<string, any>>("complete",
        { key: state.key, uploadId: state.uploadId, parts, title: options.title, ...owner }, signal);
      storage.removeItem(storeKey);
      return result;
    } catch (e) {
      // The saved session is gone server-side (expired/aborted): start over once.
      if (!restarted && (e as HttpError).status === 404) {
        restarted = true;
        storage.removeItem(storeKey);
        state = await init();
        continue;
      }
      throw e; // doneParts stay saved: calling uploadDirect again resumes.
    }
  }
}

/** Cancel: abort the multipart upload in R2 and forget the saved state. */
export async function abortDirectUpload(file: File, owner?: number): Promise<void> {
  const key = uploadStorageKey(file, owner);
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null") as SavedUpload | null;
    if (s) await post("abort", { key: s.key, uploadId: s.uploadId }).catch(() => {});
  } finally { localStorage.removeItem(key); }
}
