/** Upload policy: MP4 and ZIP only, at most 1 GB (1000 MB) per file. */
export const MAX_UPLOAD_BYTES = 1_000_000_000;
export const UPLOAD_PART_BYTES = 5 * 1024 * 1024;
export const ZIP_CONTENT_TYPE = "application/zip";
export const MP4_CONTENT_TYPE = "video/mp4";

/** Content type by extension; the browser-reported MIME is unreliable for both formats. */
export function allowedUploadType(filename: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1].toLowerCase();
  return ext === "mp4" ? MP4_CONTENT_TYPE : ext === "zip" ? ZIP_CONTENT_TYPE : null;
}
export const isZipType = (contentType: string) => contentType === ZIP_CONTENT_TYPE;
