import { ClipUploadError } from "./clips-upload-protocol.js";
export function validateClipDisplayTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ClipUploadError(400, "Clip display title must be text");
  const title = value.trim();
  if (!title || [...title].length > 120) throw new ClipUploadError(400, "Clip title must contain 1–120 characters");
  return title;
}
