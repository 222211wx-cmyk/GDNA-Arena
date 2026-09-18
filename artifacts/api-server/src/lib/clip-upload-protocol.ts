export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;
export const CLIP_EXT: Record<string, string> = {
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
};
export class ClipUploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}