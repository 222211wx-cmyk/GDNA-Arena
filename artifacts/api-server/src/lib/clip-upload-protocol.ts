/** Numeric protocol safety, not a product upload-size limit. */
export const MAX_CLIP_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_NEW_CLIP_BYTES = Number.MAX_SAFE_INTEGER;
export const NEW_CLIP_TOO_LARGE = "Invalid upload byte count";
export const CLIP_EXT: Record<string, string> = {
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac",
  "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/webm": ".webm", "audio/flac": ".flac",
};
const CLIP_MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg", "audio/mpeg3": "audio/mpeg",
  "audio/x-mpeg-3": "audio/mpeg", "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4",
  "audio/x-mp4": "audio/mp4", "audio/x-aac": "audio/aac", "audio/aacp": "audio/aac",
  "application/ogg": "audio/ogg", "audio/opus": "audio/ogg",
  "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
  "audio/x-flac": "audio/flac", "video/x-m4v": "video/mp4",
};
export function normalizeClipContentType(value: string): string | null {
  const raw = value.split(";", 1)[0].trim().toLowerCase();
  const normalized = Object.hasOwn(CLIP_MIME_ALIASES, raw) ? CLIP_MIME_ALIASES[raw] : raw;
  return /^(audio|video)\/[a-z0-9.+-]+$/.test(normalized) ? normalized : null;
}
const CLIP_EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg",
  ts: "video/mp2t", m2ts: "video/mp2t", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  wma: "audio/x-ms-wma", aiff: "audio/aiff", aif: "audio/aiff", ac3: "audio/ac3",
  "3gp": "video/3gpp", "3g2": "video/3gpp2", mka: "audio/x-matroska",
};
/** Only mobile-provider empty/generic MIME may fall back to a strict extension. */
export function resolveClipUploadType(contentType: string, filename: string): string | null {
  const normalized = normalizeClipContentType(contentType);
  if (normalized) return normalized;
  const raw = contentType.split(";", 1)[0].trim().toLowerCase();
  if (raw && raw !== "application/octet-stream") return null;
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase();
  return extension && Object.hasOwn(CLIP_EXTENSION_TYPES, extension) ? CLIP_EXTENSION_TYPES[extension] : null;
}
export function clipDownloadExtension(contentType: string): string {
  const normalized = normalizeClipContentType(contentType);
  return normalized ? CLIP_EXT[normalized] ?? ".bin" : ".bin";
}
export const isAudioClip = (contentType: string): boolean =>
  normalizeClipContentType(contentType)?.startsWith("audio/") === true;

/** Audio overlap alone protects audio/music-only uploads, never citizen footage. */
export function shouldBlockForProtectedAudio(
  contentType: string,
  isOriginalFootage: boolean,
  registeredCoverage: number,
): boolean {
  return (isAudioClip(contentType) || !isOriginalFootage) &&
    Number.isFinite(registeredCoverage) && registeredCoverage >= 0.9;
}

export class ClipUploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ClipPublishPurpose = "story" | "original";
export function parseIsOriginalFootage(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ClipUploadError(400, "isOriginalFootage must be true or false");
}
export type ClipRightsInput =
  | { purpose: "story"; originalReference?: undefined }
  | {
      purpose: "original";
      originalReference: string;
      rightsHolderName: string;
      rightsHolderRole: "owner" | "producer";
    };

export function validateClipRightsInput(
  purpose: unknown,
  originalReference: unknown,
  rightsHolderName?: unknown,
  rightsHolderRole?: unknown,
): ClipRightsInput {
  const normalizedPurpose = purpose === undefined || purpose === null || purpose === ""
    ? "story"
    : purpose;
  if (normalizedPurpose !== "story" && normalizedPurpose !== "original") {
    throw new ClipUploadError(400, "purpose must be story or original");
  }
  if (normalizedPurpose === "story") return { purpose: "story" };
  if (typeof originalReference !== "string") {
    throw new ClipUploadError(400, "Original registration requires an originalReference");
  }
  const reference = originalReference.trim();
  if (reference.length < 3 || reference.length > 200) {
    throw new ClipUploadError(400, "originalReference must be 3–200 characters after trimming");
  }
  if (typeof rightsHolderName !== "string") {
    throw new ClipUploadError(400, "Original registration requires a rightsHolderName");
  }
  const holderName = rightsHolderName.trim();
  if (holderName.length < 2 || holderName.length > 120) {
    throw new ClipUploadError(400, "rightsHolderName must be 2–120 characters after trimming");
  }
  if (rightsHolderRole !== "owner" && rightsHolderRole !== "producer") {
    throw new ClipUploadError(400, "rightsHolderRole must be owner or producer");
  }
  return {
    purpose: "original",
    originalReference: reference,
    rightsHolderName: holderName,
    rightsHolderRole,
  };
}
export function clipDurationSeconds(seconds: number, contentType: string): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ClipUploadError(400, "مدة الملف غير صالحة");
  if (seconds < 60) throw new ClipUploadError(400, "خاص دقيقة الفوق");
  return Math.floor(seconds);
}