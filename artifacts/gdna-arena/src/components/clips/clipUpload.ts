import { Upload, type DetailedError, type HttpRequest } from "tus-js-client";

const ROOT = `${import.meta.env.BASE_URL}api/clips/uploads`;
export const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 20_000];

export type ClipUploadMetadata = {
  title: string;
  contentType: string;
  durationSec: number;
};

export type PreparedClipUpload = {
  originalFile: File;
  uploadFile: File;
  outputDuration: number;
};

export type ClipUploadState = "uploading" | "offline";
export type ClipUploadProgress = (
  percent: number,
  uploadedBytes: number,
  speedBytesPerSecond: number,
  state: ClipUploadState,
) => void;

type SavedUpload = { location?: string; id?: string; groupId: string };
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
  return `${sessionId}:${metadata.title}:${metadata.contentType}:${metadata.durationSec}`;
}

function uploadId(location: string) {
  return new URL(location, window.location.href).pathname.split("/").filter(Boolean).at(-1);
}

function prepareCredentialedRequest(request: HttpRequest) {
  const xhr = request.getUnderlyingObject() as XMLHttpRequest | undefined;
  if (xhr) xhr.withCredentials = true;
}

function shouldRetry(error: DetailedError) {
  const status = error.originalResponse?.getStatus() ?? 0;
  return status === 0 || status === 408 || status === 409 || status === 425 ||
    status === 429 || status >= 500;
}

function runTusUpload(
  file: File,
  metadata: ClipUploadMetadata,
  saved: SavedUpload,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
) {
  return new Promise<SavedUpload>((resolve, reject) => {
    let settled = false;
    let pausedOffline = false;
    let latestBytes = 0;
    let lastSampleBytes = 0;
    let lastTime = performance.now();
    let smoothedSpeed = 0;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      action();
    };

    const upload = new Upload(file, {
      endpoint: saved.location ? undefined : ROOT,
      uploadUrl: saved.location,
      uploadSize: file.size,
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: RETRY_DELAYS_MS,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        groupId: saved.groupId,
        partIndex: "0",
        partCount: "1",
        totalSize: String(file.size),
        title: metadata.title,
        contentType: metadata.contentType,
        durationSec: String(metadata.durationSec),
      },
      onBeforeRequest: prepareCredentialedRequest,
      onShouldRetry: error => !signal.aborted && navigator.onLine && shouldRetry(error),
      onUploadUrlAvailable: () => {
        if (!upload.url) return;
        saved.location = upload.url;
        saved.id = uploadId(upload.url);
      },
      onProgress: (uploadedBytes, totalBytes) => {
        latestBytes = uploadedBytes;
        const now = performance.now();
        const elapsed = (now - lastTime) / 1_000;
        if (elapsed >= 0.35) {
          const current = Math.max(0, uploadedBytes - lastSampleBytes) / elapsed;
          smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.65 + current * 0.35 : current;
          lastSampleBytes = uploadedBytes;
          lastTime = now;
        }
        onProgress(
          Math.min(99, totalBytes ? uploadedBytes / totalBytes * 100 : 0),
          uploadedBytes,
          smoothedSpeed,
          "uploading",
        );
      },
      onError: error => {
        if (signal.aborted) return;
        if (!navigator.onLine) {
          offline();
          return;
        }
        finish(() => reject(new Error(error.message || "تعذر متابعة الرفع بعد عدة محاولات")));
      },
      onSuccess: () => {
        if (upload.url) {
          saved.location = upload.url;
          saved.id = uploadId(upload.url);
        }
        if (!saved.id) {
          finish(() => reject(new Error("لم يعرض الخادم موقع جلسة الرفع")));
          return;
        }
        finish(() => resolve(saved));
      },
    });

    const abort = () => {
      void upload.abort(false).finally(() => finish(() => reject(
        signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
      )));
    };
    const offline = () => {
      if (settled || pausedOffline) return;
      pausedOffline = true;
      onProgress(
        Math.min(99, file.size ? latestBytes / file.size * 100 : 0),
        latestBytes,
        0,
        "offline",
      );
      void upload.abort(false);
    };
    const online = () => {
      if (settled || !pausedOffline || signal.aborted) return;
      pausedOffline = false;
      lastSampleBytes = latestBytes;
      lastTime = performance.now();
      upload.start();
    };

    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (signal.aborted) abort();
    else if (!navigator.onLine) offline();
    else upload.start();
  });
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
  const saved = resumableSessions.get(key) ?? { groupId: crypto.randomUUID() };
  resumableSessions.set(key, saved);
  await runTusUpload(file, metadata, saved, signal, onProgress);

  const completion = await request(`${import.meta.env.BASE_URL}api/clip/upload-final`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: saved.groupId, uploadIds: [saved.id] }),
  }, signal);
  if (!completion.ok) throw new Error(await errorMessage(completion));
  const body = await completion.json();
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
    name: body.name ?? body.clip.name ?? body.clip.title,
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
    title: prepared.originalFile.name,
    contentType: prepared.uploadFile.type,
    durationSec: prepared.outputDuration,
  }, signal, onProgress);
}