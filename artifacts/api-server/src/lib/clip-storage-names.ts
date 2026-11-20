import { createHash } from "node:crypto";

// Stable across retries and restarts, including a crash after storage succeeds
// but before the database commits. Deletion and reconciliation share this name.
export function retryThumbnailName(id: number, objectName: string, format: "jpg" | "webp" = "jpg"): string {
  const key = createHash("sha256").update(objectName).digest("hex").slice(0, 32);
  const name = `thumb_retry_${id}_${key}.${format}`;
  if (objectName.startsWith("fs:")) return `fs:clips/derived/${name}`;
  return objectName.startsWith("r2:") ? `r2:clips/derived/${name}` : name;
}