export const SCIENCE_METHODOLOGY = "Payload bytes and request outcomes are client-reported, not independently verified. Avoided bytes require a matching one-use server receipt for a complete audio response and a successful client report; sizes come from stored original and ready audio metadata. Server completion does not prove reception or listening. Cache/failure reports earn no avoided-byte estimate. Estimates are not billed mobile data. Success score = (successful requests + offline-cache responses) / sampled requests, not uptime or carrier performance. No samples means null. No external-platform baseline.";
export function observedRequestSuccessScore(successes: number, cached: number, samples: number): number | null {
  if (![successes, cached, samples].every(n => Number.isSafeInteger(n) && n >= 0) || successes + cached > samples) throw new Error("Invalid sample counts");
  return samples ? (successes + cached) / samples : null;
}
export function estimateAvoidedBytes(originalBytes: number, alternativeBytes: number, outcome: "success" | "failure" | "cache"): number {
  if (![originalBytes, alternativeBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid stored sizes");
  return outcome !== "success" ? 0 : Math.max(0, originalBytes - alternativeBytes);
}
/** Local heuristic, not an encoder, AI service, or perceptual-quality guarantee. */
export function predictMediaSize(input: { originalBytes: number; durationSec: number; width: number; height: number; targetWidth?: number; targetHeight?: number; audioBitrateKbps?: number }) {
  const { originalBytes, durationSec, width, height, targetWidth = 640, targetHeight = 360, audioBitrateKbps = 48 } = input;
  if (![originalBytes, durationSec, width, height, targetWidth, targetHeight, audioBitrateKbps].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(originalBytes) || originalBytes > 10_737_418_240 || durationSec > 86400 || Math.max(width, height, targetWidth, targetHeight) > 16384 || audioBitrateKbps > 512) throw new Error("Invalid media predictor input");
  const originalBitrateBps = originalBytes * 8 / durationSec;
  const scale = Math.min(1, targetWidth / width, targetHeight / height);
  const targetBitrateBps = Math.min(originalBitrateBps, Math.max(0, originalBitrateBps - audioBitrateKbps * 1000) * scale * scale + audioBitrateKbps * 1000);
  const estimatedBytes = Math.min(originalBytes, Math.ceil(targetBitrateBps * durationSec / 8));
  return { estimatedBytes, estimatedAvoidedBytes: originalBytes - estimatedBytes, originalBitrateBps, targetBitrateBps, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)), status: "local_estimate" as const, qualityGuaranteed: false as const, methodology: "Bitrate × duration / 8; video bitrate scales with target pixel area, audio bitrate remains fixed. Container overhead and encoder behavior may differ." };
}