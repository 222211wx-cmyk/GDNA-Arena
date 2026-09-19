const R2_API = `${import.meta.env.BASE_URL}api/r2/presign`;
export const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 20_000];

export type ClipUploadMetadata = {
  /** Citizen-facing publication title. Omitted by legacy callers. */
  title?: string;
  /** Actual source filename, kept separate from the citizen-facing title. */
  originalFilename?: string;
  contentType: string;
  durationSec: number;
};

export type PreparedClipUpload = {
  originalFile: File;
  uploadFile: File;
  outputDuration: number;
  /** Citizen-facing publication title. */
  title?: string;
  /** Actual source filename when it was captured before preparation. */
  originalFilename?: string;
};

export type ClipUploadState = "uploading" | "offline";
export type ClipUploadProgress = (
  percent: number,
  uploadedBytes: number,
  speedBytesPerSecond: number,
  state: ClipUploadState,
) => void;

type SavedUpload = {
  requestId: string;
  sessionId?: string;
  completed: Map<number, string>;
};
const fileSessionIds = new WeakMap<File, string>();
const resumableSessions = new Map<string, SavedUpload>();

function timeoutSignal(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
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
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    }, { once: true });
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

async function uploadR2Part(
  file: File,
  sessionId: string,
  partNumber: number,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    signal.throwIfAborted();
    if (RETRY_DELAYS_MS[attempt]) await wait(RETRY_DELAYS_MS[attempt], signal);
    try {
      // Always request a fresh URL on retry. This handles expiry without ever
      // routing media bytes through the GDNA API server.
      const signed = await r2Json({ action: "part", sessionId, partNumber }, signal);
      if (typeof signed?.url !== "string") throw new Error("R2 did not return an upload URL");
      const response = await fetch(signed.url, {
        method: "PUT",
        body: file.slice(start, end),
        signal,
      });
      if (!response.ok) {
        const error = Object.assign(new Error(`R2 part upload failed (${response.status})`), { status: response.status });
        if (!retryableStatus(response.status) && response.status !== 403) throw error;
        lastError = error;
        continue;
      }
      const etag = response.headers.get("ETag");
      if (!etag) throw new Error("R2 upload response did not expose ETag");
      return etag;
    } catch (error) {
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
  }
  const inspected = await r2Json({
    action: "inspect",
    sessionId: saved.sessionId,
  }, signal);
  if (inspected?.state === "published" && inspected.receipt) return inspected.receipt;
  if (inspected?.state === "aborted") throw new Error("R2 upload was cancelled");
  if (Array.isArray(inspected?.parts)) {
    // For an active multipart upload, R2's ListParts result is authoritative.
    // Remove stale local acknowledgements before restoring server-confirmed ETags.
    if (inspected.state === "active") saved.completed.clear();
    for (const part of inspected.parts) {
      if (Number.isSafeInteger(part?.partNumber) && typeof part?.etag === "string" &&
          Number(part?.size) > 0) {
        saved.completed.set(part.partNumber, part.etag);
      }
    }
  }
  const partCount = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
  let uploadedBytes = 0;
  for (const partNumber of saved.completed.keys()) {
    const start = (partNumber - 1) * UPLOAD_CHUNK_BYTES;
    uploadedBytes += Math.min(UPLOAD_CHUNK_BYTES, file.size - start);
  }
  let lastBytes = uploadedBytes;
  let lastTime = performance.now();
  let speed = 0;
  const report = () => {
    const now = performance.now();
    const elapsed = Math.max(0.001, (now - lastTime) / 1_000);
    const current = Math.max(0, uploadedBytes - lastBytes) / elapsed;
    speed = speed ? speed * 0.65 + current * 0.35 : current;
    lastBytes = uploadedBytes;
    lastTime = now;
    onProgress(Math.min(99, uploadedBytes / file.size * 100), uploadedBytes, speed,
      navigator.onLine ? "uploading" : "offline");
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
            window.removeEventListener("online", online);
            signal.removeEventListener("abort", abort);
          };
          window.addEventListener("online", online, { once: true });
          signal.addEventListener("abort", abort, { once: true });
        });
      }
      const start = (partNumber - 1) * UPLOAD_CHUNK_BYTES;
      const end = Math.min(file.size, start + UPLOAD_CHUNK_BYTES);
      const etag = await uploadR2Part(file, saved.sessionId!, partNumber, start, end, signal);
      saved.completed.set(partNumber, etag);
      uploadedBytes += end - start;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, partCount) }, worker));
  return r2Json({
    action: "complete",
    sessionId: saved.sessionId,
    parts: Array.from(saved.completed, ([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber),
  }, signal);
}

export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
) {
  signal.throwIfAborted();
  if (file.size > MAX_CLIP_BYTES) throw new Error("الحد الأقصى للملف هو 2GB");
  const key = sessionKey(file, metadata);
  const saved = resumableSessions.get(key) ?? {
    requestId: crypto.randomUUID(),
    completed: new Map<number, string>(),
  };
  resumableSessions.set(key, saved);
  const body = await runR2Upload(file, metadata, saved, signal, onProgress);
  if (body?.ok === false || !body?.clip || typeof body.clip !== "object") {
    throw new Error("لم يؤكد الخادم نشر الكليب");
  }
  const code = body.code ?? body.clip.code;
  if (typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("لم يؤكد الخادم كود الكليب");
  }
  resumableSessions.delete(key);
  onProgress(100, file.size, 0, "uploading");
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

/**
 * Entry-point adapter for prepareClipForUpload(). It preserves the citizen's
 * original filename as publication metadata while sending only the verified
 * prepared File. The original File remains available to the caller for an
 * explicit fallback; this function never retries with it implicitly.
 */
export function uploadPreparedClip(
  prepared: PreparedClipUpload,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
) {
  return uploadClip(prepared.uploadFile, {
    title: prepared.title,
    originalFilename: prepared.originalFilename ?? prepared.originalFile.name,
    contentType: prepared.uploadFile.type,
    durationSec: prepared.outputDuration,
  }, signal, onProgress);
}