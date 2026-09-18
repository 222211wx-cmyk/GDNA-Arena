import { createHash } from "node:crypto";
import type { File } from "@google-cloud/storage";
import { objectStorageClient } from "./chatStorage";

export function clipFile(name: string): File {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const full = `${dir.replace(/\/$/, "")}/clips/${name}`;
  const parts = (full.startsWith("/") ? full : `/${full}`).split("/");
  return objectStorageClient.bucket(parts[1]).file(parts.slice(2).join("/"));
}

// Stable across retries and restarts, including a crash after storage succeeds
// but before the database commits. Deletion must also remove this candidate.
export function retryThumbnailName(id: number, objectName: string): string {
  const key = createHash("sha256").update(objectName).digest("hex").slice(0, 32);
  return `thumb_retry_${id}_${key}.jpg`;
}