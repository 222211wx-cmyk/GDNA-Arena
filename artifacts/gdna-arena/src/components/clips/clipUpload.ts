import { enqueueFile, readQueue, saveQueue, removeQueue, storeProcessingJob, storePreparedFile, lockName, type QueueRecord } from "./uploadQueue";
import { prepareClip } from "./prepareClip";
import { trackEvent } from "@/lib/analytics";
const R2_API = `${import.meta.env.BASE_URL}api/upload/presign`;
const CLIPS_CREATE_API = `${import.meta.env.BASE_URL}api/upload/complete`;
export const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_CLIP_BYTES = 10 * 1024 * 1024 * 1024;
export function validateClipSize(size: number) {
  if (size > MAX_CLIP_BYTES) throw new Error("الحد الأقصى للملف هو 10 GiB (10 737 418 240 octets)");
}
const REQUEST_TIMEOUT_MS = 300_000;
const RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 20_000];

export type ClipUploadMetadata = {
  /** Citizen-facing publication title. Omitted by legacy callers. */
  title?: string;
  /** Actual source filename, kept separate from the citizen-facing title. */
  originalFilename?: string;
  contentType: string;
  /** Untrusted hint only. Null means the browser could not inspect the media. */
  durationSec: number | null;
};

export type ClipUploadState = "uploading" | "offline" | "stalled" | "processing" | "preparing";
export type ClipUploadProgress = (
  percent: number,
  uploadedBytes: number,
  speedBytesPerSecond: number,
  state: ClipUploadState,
  message?: string,
) => void;

type SavedUpload = {
  requestId: string;
  sessionId?: string;
  completed: Map<number, string>;
  owner?: number;
  persist?: () => Promise<void>;
};
const fileSessionIds = new WeakMap<File, string>();
const resumableSessions = new Map<string, SavedUpload>();

function timeoutSignal(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

async function request(url: string, init: RequestInit, parent: AbortSignal) {
  const timed = timeoutSignal(parent);
  try {
    return await fetch(url, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: timed.signal,
    });
  } finally {
    timed.dispose();
  }
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // The status message below remains actionable.
  }
  return `تعذر الرفع (${response.status})`;
}

function sessionKey(file: File, metadata: ClipUploadMetadata) {
  // Resume is deliberately scoped to this exact File object for the lifetime of
  // this page. Filename/size/date fingerprints can splice two different files.
  let sessionId = fileSessionIds.get(file);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    fileSessionIds.set(file, sessionId);
  }
  return JSON.stringify([
    sessionId,
    metadata.title ?? null,
    metadata.originalFilename ?? null,
    metadata.contentType,
    metadata.durationSec,
  ]);
}

function retryableStatus(status: number) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function r2Json(body: Record<string, unknown>, signal: AbortSignal) {
  const response = await request(R2_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, signal);
  if (!response.ok) throw Object.assign(new Error(await errorMessage(response)), { status: response.status });
  return response.status === 204 ? null : response.json();
}

async function finalizeClip(body: Record<string, unknown>, signal: AbortSignal) {
  const response = await request(CLIPS_CREATE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, signal);
  if (!response.ok) throw Object.assign(new Error(await errorMessage(response)), { status: response.status });
  const result = await response.json();
  if (result?.state === "ready") {
    if (!result.receipt) throw new Error("Publication non confirmée par le serveur");
    return result.receipt;
  }
  return result;
}

function isProcessing(body: { state?: string } | null) {
  return body?.state === "queued" || body?.state === "processing" || body?.state === "failed";
}

/** One bounded status read, never a minutes-long Sync event. No original File required. */
async function pollProcessingJob(record: QueueRecord, signal: AbortSignal, progress: ClipUploadProgress) {
  if (!record.sessionId) throw new Error("Session de traitement manquante");
  const response = await request(`${import.meta.env.BASE_URL}api/upload/status/${encodeURIComponent(record.sessionId)}`, {}, signal);
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = await response.json();
  progress(100, record.size, 0, "processing");
  if (body.state === "failed") {
    record.status = "failed";
    record.error = typeof body.error === "string" ? body.error : "Traitement serveur échoué";
    await saveQueue(record);
    throw new Error(`${record.error} — Supprimez le suivi puis sélectionnez le fichier pour réessayer.`);
  }
  if (body.state === "queued" || body.state === "processing") return null;
  const receipt = body.state === "ready" ? body.receipt : null;
  const code = receipt?.code ?? receipt?.clip?.code;
  if (receipt?.ok === false || !receipt?.clip || typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("Publication non confirmée par le serveur");
  }
  await removeQueue(record.id, record.owner);
  return { ...receipt.clip, code, name: record.metadata.title ?? receipt.clip.title };
}

function putR2Part(
  url: string,
  bytes: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string> {
  if (typeof XMLHttpRequest === "undefined") {
    // Workers expose fetch, not XHR. Report only acknowledged bytes there.
    const timed = timeoutSignal(signal);
    return fetch(url, { method: "PUT", body: bytes, signal: timed.signal, credentials: "omit" }).then(response => {
      if (!response.ok) throw Object.assign(new Error(`R2 part upload failed (${response.status})`), { status: response.status });
      const etag = response.headers.get("ETag");
      if (!etag) throw new Error("R2 upload response did not expose ETag");
      onProgress(bytes.size);
      return etag;
    }).finally(timed.dispose);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(bytes.size, event.loaded));
    };
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(Object.assign(new Error(`R2 part upload failed (${xhr.status})`), { status: xhr.status }));
        return;
      }
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) { reject(new Error("R2 upload response did not expose ETag")); return; }
      resolve(etag);
    };
    xhr.onerror = () => {
      done();
      reject(Object.assign(new Error("R2 part upload failed (network error)"), { status: 0 }));
    };
    xhr.ontimeout = () => {
      done();
      reject(Object.assign(new Error("R2 part upload timed out"), { status: 408 }));
    };
    xhr.onabort = () => {
      done();
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else xhr.send(bytes);
  });
}

async function uploadR2Part(
  file: File,
  sessionId: string,
  partNumber: number,
  start: number,
  end: number,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  owner?: number,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    signal.throwIfAborted();
    if (RETRY_DELAYS_MS[attempt]) await wait(RETRY_DELAYS_MS[attempt], signal);
    // A retry starts this part from byte zero. Reset its active contribution so
    // acknowledged + in-flight totals never count the same part twice.
    onProgress(0);
    try {
      // Always request a fresh URL on retry. This handles expiry without ever
      // routing media bytes through the GDNA API server.
      const signed = await r2Json({ action: "part", sessionId, partNumber, expectedOwnerId: owner }, signal);
      if (typeof signed?.url !== "string") throw new Error("R2 did not return an upload URL");
      return await putR2Part(signed.url, file.slice(start, end), signal, onProgress);
    } catch (error) {
      onProgress(0);
      if (signal.aborted) throw signal.reason;
      const status = Number((error as { status?: number }).status ?? 0);
      if (status && !retryableStatus(status) && status !== 403) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("R2 part upload failed after retries");
}

async function runR2Upload(
  file: File,
  metadata: ClipUploadMetadata,
  saved: SavedUpload,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
) {
  if (!saved.sessionId) {
    const initiation: Record<string, unknown> = {
      action: "initiate",
      requestId: saved.requestId,
      filename: metadata.originalFilename ?? metadata.title ?? file.name,
      contentType: metadata.contentType,
      durationSec: metadata.durationSec,
      size: file.size,
      expectedOwnerId: saved.owner,
    };
    // Omission preserves the legacy API contract for old upload callers. New
    // callers provide originalFilename, making title explicitly display-only.
    if (metadata.originalFilename !== undefined && metadata.title !== undefined) {
      initiation.title = metadata.title;
    }
    const initiated = await r2Json(initiation, signal);
    if (typeof initiated?.sessionId !== "string" || initiated.partSize !== UPLOAD_CHUNK_BYTES) {
      throw new Error("R2 did not create a valid upload session");
    }
    saved.sessionId = initiated.sessionId;
    await saved.persist?.();
  }
  const inspected = await r2Json({
    action: "inspect",
    sessionId: saved.sessionId,
    expectedOwnerId: saved.owner,
  }, signal);
  if ((inspected?.state === "published" || inspected?.state === "ready") && inspected.receipt) return inspected.receipt;
  if (isProcessing(inspected)) {
    onProgress(100, file.size, 0, "processing");
    return inspected;
  }
  if (inspected?.state === "aborted") throw new Error("R2 upload was cancelled");
  // Once finalization has started, the R2 multipart may already be consumed.
  // Keep the durable completion manifest and let the idempotent server endpoint
  // reconcile it against ListParts/HEAD, rather than trying to PUT nonexistent parts.
  if (inspected?.state === "completing" || inspected?.objectComplete === true) {
    onProgress(100, file.size, 0, "processing");
    return finalizeClip({
      sessionId: saved.sessionId, expectedOwnerId: saved.owner, title: metadata.title,
      parts: [...saved.completed].sort(([a], [b]) => a - b).map(([partNumber, etag]) => ({ partNumber, etag })),
    }, signal);
  }
  if (inspected?.state !== "active" || !Array.isArray(inspected.parts)) {
    throw new Error("Impossible de vérifier les parties R2 — réessayez la reprise");
  }
  if (Array.isArray(inspected.parts)) {
    // For an active multipart upload, R2's ListParts result is authoritative.
    // Remove stale local acknowledgements before restoring server-confirmed ETags.
    saved.completed.clear();
    for (const part of inspected.parts) {
      if (Number.isSafeInteger(part?.partNumber) && part.partNumber >= 1 &&
          part.partNumber <= Math.ceil(file.size / UPLOAD_CHUNK_BYTES) && typeof part?.etag === "string" &&
          Number(part?.size) === Math.min(UPLOAD_CHUNK_BYTES, file.size - (part.partNumber - 1) * UPLOAD_CHUNK_BYTES)) {
        saved.completed.set(part.partNumber, part.etag);
      }
    }
  }
  await saved.persist?.();
  const partCount = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
  let uploadedBytes = 0;
  const activeBytes = new Map<number, number>();
  for (const partNumber of saved.completed.keys()) {
    const start = (partNumber - 1) * UPLOAD_CHUNK_BYTES;
    uploadedBytes += Math.min(UPLOAD_CHUNK_BYTES, file.size - start);
  }
  let lastBytes = uploadedBytes;
  let lastTime = performance.now();
  let speed = 0;
  let lastMovement = performance.now();
  const report = () => {
    const currentBytes = Math.min(file.size, uploadedBytes +
      Array.from(activeBytes.values()).reduce((total, bytes) => total + bytes, 0));
    const now = performance.now();
    const elapsed = Math.max(0.001, (now - lastTime) / 1_000);
    const current = Math.max(0, currentBytes - lastBytes) / elapsed;
    if (currentBytes > lastBytes) lastMovement = now;
    speed = speed ? speed * 0.65 + current * 0.35 : current;
    lastBytes = currentBytes;
    lastTime = now;
    onProgress(Math.min(100, currentBytes / file.size * 100), currentBytes, speed,
      navigator.onLine === false ? "offline" : now - lastMovement > 10_000 ? "stalled" : "uploading");
  };
  report();
  // Three independent multipart PUTs improve throughput without concurrent
  // writes to one sequential Tus offset.
  let nextPart = 1;
  const worker = async () => {
    while (nextPart <= partCount) {
      signal.throwIfAborted();
      const partNumber = nextPart++;
      if (saved.completed.has(partNumber)) continue;
      while (!navigator.onLine) {
        report();
        await new Promise<void>((resolve, reject) => {
          const online = () => { cleanup(); resolve(); };
          const abort = () => { cleanup(); reject(signal.reason); };
          const cleanup = () => {
             globalThis.removeEventListener("online", online);
            signal.removeEventListener("abort", abort);
          };
           globalThis.addEventListener("online", online, { once: true });
          signal.addEventListener("abort", abort, { once: true });
        });
      }
      const start = (partNumber - 1) * UPLOAD_CHUNK_BYTES;
      const end = Math.min(file.size, start + UPLOAD_CHUNK_BYTES);
      const etag = await uploadR2Part(
        file,
        saved.sessionId!,
        partNumber,
        start,
        end,
        signal,
        loaded => {
          activeBytes.set(partNumber, loaded);
          report();
        },
        saved.owner,
      );
      signal.throwIfAborted();
      activeBytes.delete(partNumber);
      saved.completed.set(partNumber, etag);
      uploadedBytes += end - start;
      await saved.persist?.();
      report();
    }
  };
  const heartbeat = setInterval(report, 2_000);
  try {
    // Settle all workers before releasing the cross-context lock on failure.
    const results = await Promise.allSettled(Array.from({ length: Math.min(3, partCount) }, worker));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  } finally { clearInterval(heartbeat); }
  signal.throwIfAborted();
  onProgress(100, file.size, 0, "processing");
  const completion: Record<string, unknown> = {
    sessionId: saved.sessionId,
    expectedOwnerId: saved.owner,
    parts: Array.from(saved.completed, ([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber),
  };
  if (metadata.originalFilename !== undefined && metadata.title !== undefined) {
    completion.title = metadata.title;
  }
  return finalizeClip(completion, signal);
}

export async function uploadForeground(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
  owner?: number,
) {
  signal.throwIfAborted();
  validateClipSize(file.size);
  const key = sessionKey(file, metadata);
  const saved = resumableSessions.get(key) ?? {
    requestId: crypto.randomUUID(),
    completed: new Map<number, string>(),
  };
  resumableSessions.set(key, saved);
  saved.owner = owner;
  const body = await runR2Upload(file, metadata, saved, signal, onProgress);
  if (isProcessing(body)) {
    if (owner === undefined || !saved.sessionId) throw new Error("Compte ou session de traitement manquant");
    await storeProcessingJob({ id: saved.requestId, requestId: saved.requestId, sessionId: saved.sessionId,
      owner, name: file.name, size: file.size, metadata, completed: [], uploaded: file.size, status: "processing", serverOwned: true });
    resumableSessions.delete(key);
    trackEvent("clip_upload_success", { outcome: "processing" });
    return null;
  }
  if (body?.ok === false || !body?.clip || typeof body.clip !== "object") {
    throw new Error("لم يؤكد الخادم نشر الكليب");
  }
  const code = body.code ?? body.clip.code;
  if (typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("لم يؤكد الخادم كود الكليب");
  }
  resumableSessions.delete(key);
  onProgress(100, file.size, 0, "uploading");
  trackEvent("clip_upload_success", { outcome: "published" });
  return {
    ...body.clip,
    code,
    name: body.clip.title ?? body.name ?? body.clip.name,
    duration: body.duration ?? body.clip.duration ?? body.clip.duration_sec,
    url: body.url ?? body.clip.url ?? body.clip.video_url,
    created_at: body.created_at ?? body.clip.created_at,
    processingStatus:
      body.processingStatus ?? body.clip.processingStatus ?? body.clip.compression_status,
  };
}

export async function currentUploadOwner(signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Reconnectez-vous pour reprendre le transfert");
  if (!response.ok) throw new Error(`Vérification de session indisponible (${response.status}) — réessayez`);
  const me = await response.json();
  if (!Number.isSafeInteger(me?.id) || me.id <= 0 || typeof me.username !== "string") throw new Error("Compte non vérifié — réessayez");
  return me.id;
}

const activeControllers = new Map<string, AbortController>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("helixly-clip-control") : null;
channel?.addEventListener("message", event => {
  if (event.data?.type === "pause") activeControllers.get(event.data.id)?.abort();
});
export function pauseQueuedUpload(id: string) {
  activeControllers.get(id)?.abort();
  channel?.postMessage({ type: "pause", id });
}

export async function markQueuedPaused(id: string, owner: number) {
  pauseQueuedUpload(id);
  if (!navigator.locks) throw new Error("Verrouillage indisponible");
  await navigator.locks.request(lockName(id), async () => {
    const { record } = await readQueue(id, owner);
    if (record.serverOwned) return;
    record.status = "paused";
    await saveQueue(record);
  });
}

export async function runQueuedUpload(id: string, owner: number, parent: AbortSignal, progress: ClipUploadProgress, resumePaused = true) {
  if (!navigator.locks) throw new Error("Reprise sécurisée indisponible dans ce navigateur");
  return navigator.locks.request(lockName(id), { mode: "exclusive", signal: parent }, async () => {
    parent.throwIfAborted();
    if (await currentUploadOwner(parent) !== owner) throw new Error("Ce transfert appartient à un autre compte");
    const { record, file: storedFile } = await readQueue(id, owner);
    let file = storedFile;
    if (record.serverOwned) return pollProcessingJob(record, parent, progress);
    if (!resumePaused && record.status === "paused") return null;
    const controller = new AbortController();
    const abort = () => controller.abort(parent.reason);
    parent.addEventListener("abort", abort, { once: true });
    activeControllers.set(id, controller);
    const saved: SavedUpload = { requestId: record.requestId, sessionId: record.sessionId, completed: new Map(record.completed), owner };
    saved.persist = async () => {
      controller.signal.throwIfAborted();
      record.sessionId = saved.sessionId;
      record.completed = [...saved.completed];
      await saveQueue(record);
    };
    record.status = "uploading";
    try {
      await saveQueue(record);
      if (!file) throw new Error("Fichier local introuvable");
      if (record.preparation === "pending" && !record.sessionId) {
        const original = file;
        const prepared = await prepareClip(original, controller.signal, (percent, message) => progress(percent, 0, 0, "preparing", message));
        file = prepared.file;
        record.preparation = prepared.mode;
        record.preparationMessage = prepared.message;
        record.name = file.name;
        record.size = file.size;
        record.metadata = { ...record.metadata, contentType: file.type || record.metadata.contentType };
        progress(100, 0, 0, "preparing", "Enregistrement durable de la vidéo préparée…");
        try {
          await storePreparedFile(record, original, file, controller.signal);
        } catch (error) {
          // Never persist a transformed descriptor pointing at original bytes.
          record.preparation = "pending";
          record.name = original.name; record.size = original.size;
          record.metadata = { ...record.metadata, contentType: original.type || record.metadata.contentType };
          throw error;
        }
      }
      if (record.preparationMessage) progress(0, 0, 0, "preparing", record.preparationMessage);
      controller.signal.throwIfAborted();
      const body = await runR2Upload(file, record.metadata, saved, controller.signal, (percent, bytes, speed, state) => {
        record.uploaded = bytes;
        record.status = state === "processing" ? "processing" : "uploading";
        progress(percent, bytes, speed, state);
      });
      if (isProcessing(body)) {
        record.sessionId = saved.sessionId;
        record.serverOwned = true;
        record.status = "processing";
        record.error = undefined;
        await storeProcessingJob(record);
        progress(100, record.size, 0, "processing");
        return null;
      }
      const code = body?.code ?? body?.clip?.code;
      if (body?.ok === false || !body?.clip || typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) throw new Error("Publication non confirmée par le serveur");
      await removeQueue(id, owner);
      progress(100, file.size, 0, "processing");
      return { ...body.clip, code, name: record.metadata.title ?? body.clip.title };
    } catch (error) {
      record.sessionId = saved.sessionId;
      record.completed = [...saved.completed];
      record.status = controller.signal.aborted ? "paused" : "error";
      record.error = error instanceof Error ? error.message : "Transfert interrompu";
      await saveQueue(record);
      throw error;
    } finally {
      activeControllers.delete(id);
      parent.removeEventListener("abort", abort);
    }
  });
}

export async function discardQueuedUpload(id: string, owner: number) {
  pauseQueuedUpload(id);
  if (!navigator.locks) throw new Error("Verrouillage indisponible");
  await navigator.locks.request(lockName(id), async () => {
    if (await currentUploadOwner() !== owner) throw new Error("Compte différent");
    const { record } = await readQueue(id, owner);
    if (record.serverOwned) { await removeQueue(id, owner); return; }
    if (record.preparation === "pending" && !record.sessionId) {
      // Preparation precedes initiation: there is no remote upload to recover.
      await removeQueue(id, owner);
      return;
    }
    // Recover an initiation whose response was lost before sessionId was saved.
    const signal = new AbortController().signal;
    const sessionId = record.sessionId ?? (await r2Json({
      action: "initiate", requestId: record.requestId, filename: record.name,
      title: record.metadata.title, contentType: record.metadata.contentType,
      durationSec: record.metadata.durationSec, size: record.size, expectedOwnerId: owner,
    }, signal)).sessionId;
    await r2Json({ action: "abort", sessionId, expectedOwnerId: owner }, signal);
    await removeQueue(id, owner);
  });
}

export async function uploadClip(file: File, metadata: ClipUploadMetadata, signal: AbortSignal, progress: ClipUploadProgress,
  options?: { expectedOwner?: number | null; onStored?: (record: QueueRecord) => void; onForegroundOnly?: (message: string) => void }) {
  signal.throwIfAborted();
  validateClipSize(file.size);
  const owner = await currentUploadOwner(signal);
  signal.throwIfAborted();
  if (options?.expectedOwner !== undefined && options.expectedOwner !== owner) {
    throw new Error("Le compte a changé — ce fichier ne sera pas transféré avec un autre compte");
  }
  let record: QueueRecord;
  try {
    record = await enqueueFile(file, metadata, owner, true);
  } catch (error) {
    const message = `Stockage local impossible (${error instanceof Error ? error.message : "quota"}). Transfert au premier plan uniquement; reprise après fermeture indisponible.`;
    // Legacy consumers must not silently claim durable success.
    if (!options?.onForegroundOnly) throw new Error(message);
    options.onForegroundOnly(message);
    const prepared = await prepareClip(file, signal, (percent, detail) => progress(percent, 0, 0, "preparing", detail));
    progress(0, 0, 0, "preparing", prepared.message);
    return uploadForeground(prepared.file, { ...metadata, contentType: prepared.file.type }, signal, progress, owner);
  }
  options?.onStored?.(record);
  if (signal.aborted) {
    record.status = "paused";
    await saveQueue(record);
    signal.throwIfAborted();
  }
  return runQueuedUpload(record.id, owner, signal, progress);
}