export const MAX_BUFFERED_ICE_CANDIDATES = 256;

/**
 * Keep signaling memory bounded while retaining FIFO ordering. A false return
 * is an explicit overflow/drop signal; callers must never grow the buffer
 * without a limit.
 */
export function appendBoundedIce<T>(
  buffer: T[],
  candidate: T,
  maximum = MAX_BUFFERED_ICE_CANDIDATES,
): boolean {
  if (buffer.length >= maximum) return false;
  buffer.push(candidate);
  return true;
}
