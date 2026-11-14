import type { File } from "@google-cloud/storage";
import { objectStorageClient } from "./chatStorage.js";
import { isR2Reference, r2File } from "./r2-storage.js";
export { retryThumbnailName } from "./clips-storage-names.js";
export { providerSibling } from "./r2-storage.js";

export function clipFile(name: string): File {
  if (isR2Reference(name)) return r2File(name) as unknown as File;
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const full = `${dir.replace(/\/$/, "")}/clips/${name}`;
  const parts = (full.startsWith("/") ? full : `/${full}`).split("/");
  return objectStorageClient.bucket(parts[1]).file(parts.slice(2).join("/"));
}
