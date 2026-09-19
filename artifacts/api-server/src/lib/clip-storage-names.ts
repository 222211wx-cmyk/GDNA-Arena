import { createHash } from "node:crypto";

// Stable across retries and restarts, including a crash after storage succeeds
// but before the database commits. Deletion and reconciliation share this name.
export function retryThumbnailName(id: number, objectName: string): string {
  const key = createHash("sha256").update(objectName).digest("hex").slice(0, 32);
  const name = `thumb_retry_${id}_${key}.jpg`;
  return objectName.startsWith("r2:") ? `r2:clips/derived/${name}` : name;
}