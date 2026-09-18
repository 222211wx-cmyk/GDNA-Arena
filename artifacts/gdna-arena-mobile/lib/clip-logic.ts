export const CLIP_CODE_PATTERN = /^HELX-\d{6}$/u;

export type PlaybackSnapshot = {
  position: number;
  shouldPlay: boolean;
};

export function parseClipCode(input: string): string | null {
  const value = input.trim();
  const direct = value.toUpperCase();
  if (CLIP_CODE_PATTERN.test(direct)) return direct;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const match = url.pathname.match(/(?:^|\/)clip\/(HELX-\d{6})(?:\/|$)/iu);
  return match?.[1]?.toUpperCase() ?? null;
}

export function playbackSnapshot(
  position: number,
  shouldPlay: boolean,
  duration?: number,
): PlaybackSnapshot {
  const finitePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const finiteDuration = Number.isFinite(duration) && Number(duration) > 0
    ? Number(duration)
    : Number.POSITIVE_INFINITY;
  return {
    position: Math.min(finitePosition, finiteDuration),
    shouldPlay,
  };
}

export function withPlaybackIntent(
  snapshot: PlaybackSnapshot,
  shouldPlay: boolean,
): PlaybackSnapshot {
  return { ...snapshot, shouldPlay };
}

export function withPlaybackPosition(
  snapshot: PlaybackSnapshot,
  position: number,
  duration?: number,
): PlaybackSnapshot {
  return playbackSnapshot(position, snapshot.shouldPlay, duration);
}

export function shouldApplyReplacement(
  currentOperation: number,
  pendingOperation: number,
  activeUrl: string | null,
  expectedUrl: string,
): boolean {
  return currentOperation === pendingOperation && activeUrl === expectedUrl;
}

export function retryAfterMilliseconds(value: string | null, fallback = 2_000): number {
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return fallback;
  return Math.min(Math.max(0, date - Date.now()), 30_000);
}