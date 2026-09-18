import type { File } from "@google-cloud/storage";
import { objectStorageClient } from "./chatStorage.js";
export { retryThumbnailName } from "./clip-storage-names.js";

export function clipFile(name: string): File {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const full = `${dir.replace(/\/$/, "")}/clips/${name}`;
  const parts = (full.startsWith("/") ? full : `/${full}`).split("/");
  return objectStorageClient.bucket(parts[1]).file(parts.slice(2).join("/"));
}
