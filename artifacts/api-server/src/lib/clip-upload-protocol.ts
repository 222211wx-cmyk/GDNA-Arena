export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;
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
  return Object.hasOwn(CLIP_EXT, normalized) ? normalized : null;
}
const CLIP_EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
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
  return normalized ? CLIP_EXT[normalized] : ".bin";
}
export const isAudioClip = (contentType: string): boolean =>
  normalizeClipContentType(contentType)?.startsWith("audio/") === true;

export class ClipUploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function clipDurationSeconds(seconds: number, contentType: string): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ClipUploadError(400, "مدة الملف غير صالحة");
  if (isAudioClip(contentType)) return Math.max(1, Math.floor(seconds));
  if (seconds < 60) throw new ClipUploadError(400, "أي فيديو أقل من 60 ثانية يتم حظره تلقائياً. الحد الأدنى دقيقة واحدة.");
  return Math.floor(seconds);
}