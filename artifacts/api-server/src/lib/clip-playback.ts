import { clipFile } from "./clip-storage.js";
import { isR2Reference, signR2Get } from "./r2-storage.js";
import { isFsReference } from "./fs-storage.js";

// Long enough for a 24-hour recording. This is an expiring public-playback
// capability, not a CDN configuration or a value to persist in the database.
export const CLIP_PLAYBACK_TTL_MS = 26 * 60 * 60 * 1000;

/** Replit's supported sidecar signing API; media bytes go directly to GCS. */
export async function signClipPlayback(
  filename: string,
  request: typeof fetch = fetch,
  clipId?: number,
): Promise<{ url: string; urlExpiresAt: string }> {
  if (isFsReference(filename)) {
    if (!clipId) throw new Error("Clip id required for local playback");
    // Served by GET /api/clips/stream/:id (byte ranges, no expiry).
    return { url: `/api/clips/stream/${clipId}`, urlExpiresAt: new Date(Date.now() + CLIP_PLAYBACK_TTL_MS).toISOString() };
  }
  if (isR2Reference(filename)) {
    const seconds = Math.floor(CLIP_PLAYBACK_TTL_MS / 1000);
    return {
      url: await signR2Get(filename, seconds),
      urlExpiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    };
  }
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