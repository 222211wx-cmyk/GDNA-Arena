import { trackEvent } from "@/lib/analytics";
import { uploadDirect } from "@/lib/upload-direct";


export type ClipUploadMetadata = {
  /** Citizen-facing publication title. */
  title: string;
  /** Untrusted hint only. Null means the browser could not read media metadata. */
  durationSec: number | null;
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

export async function currentUploadOwner(signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Reconnectez-vous pour publier");
  if (!response.ok) throw new Error(`Vérification de session indisponible (${response.status}) — réessayez`);
  const me = await response.json();
  if (!Number.isSafeInteger(me?.id) || me.id <= 0 || typeof me.username !== "string") throw new Error("Compte non vérifié — réessayez");
  return me.id;
}

/** Browser -> R2 directly (multipart, parallel, resumable). No bytes via the API server. */
export async function uploadClip(
  file: File,
  metadata: ClipUploadMetadata,
  signal: AbortSignal,
  onProgress: ClipUploadProgress,
  options: { expectedOwner: number },
): Promise<PublishedClip> {
  signal.throwIfAborted();
  const owner = await currentUploadOwner(signal);
  if (owner !== options.expectedOwner) {
    throw new Error("Le compte a changé — ce fichier ne sera pas publié avec un autre compte");
  }
  const body = await uploadDirect(file, {
    signal, onProgress, title: metadata.title, durationSec: metadata.durationSec, expectedOwnerId: owner,
  });
  signal.throwIfAborted();
  const clip = body?.clip && typeof body.clip === "object" ? body.clip : body?.receipt?.clip ?? null;
  const code = body?.code ?? clip?.code;
  if (body?.ok === false || !clip || typeof code !== "string" || !/^HELX-\d{6}$/.test(code)) {
    throw new Error("لم يؤكد الخادم نشر الكليب");
  }
  trackEvent("clip_upload_success", { outcome: "published" });
  return { ...clip, code, name: clip.title ?? body.name ?? clip.name ?? metadata.title };
}
