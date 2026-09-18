import { clipFile } from "./clip-storage.js";

// Long enough for a 24-hour recording. This is an expiring public-playback
// capability, not a CDN configuration or a value to persist in the database.
export const CLIP_PLAYBACK_TTL_MS = 26 * 60 * 60 * 1000;

/** Replit's supported sidecar signing API; media bytes go directly to GCS. */
export async function signClipPlayback(
  filename: string,
  request: typeof fetch = fetch,
): Promise<{ url: string; urlExpiresAt: string }> {
  const file = clipFile(filename);
  const urlExpiresAt = new Date(Date.now() + CLIP_PLAYBACK_TTL_MS).toISOString();
  const response = await request("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: file.bucket.name,
      object_name: file.name,
      method: "GET",
      expires_at: urlExpiresAt,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Clip playback signing unavailable (${response.status})`);
  const body: unknown = await response.json();
  const raw = (body as { signed_url?: unknown })?.signed_url;
  if (typeof raw !== "string") throw new Error("Storage did not return a playback URL");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || url.username || url.password) {
    throw new Error("Storage returned an unsupported playback URL");
  }
  return { url: url.href, urlExpiresAt };
}