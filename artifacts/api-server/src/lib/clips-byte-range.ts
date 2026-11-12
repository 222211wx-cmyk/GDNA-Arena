/** A single RFC 9110 byte range. null means malformed or unsatisfiable. */
export function clipByteRange(header: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const count = Number(match[2]);
    return Number.isSafeInteger(count) && count > 0
      ? { start: Math.max(0, size - count), end: size - 1 }
      : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start >= size || start > end) return null;
  return { start, end: Math.min(end, size - 1) };
}
