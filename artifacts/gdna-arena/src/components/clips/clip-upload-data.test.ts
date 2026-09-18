import { describe, expect, it } from "vitest";
import { CLIP_CHUNK_SIZE, MAX_CLIP_BYTES, clipPartRanges, clipProgress, clipResumeKey } from "./clip-upload-data";

describe("clip upload parts", () => {
  it.each([1, CLIP_CHUNK_SIZE, CLIP_CHUNK_SIZE + 1, 3 * CLIP_CHUNK_SIZE + 7, MAX_CLIP_BYTES])("covers %i bytes exactly once with no more than three parts", size => {
    const parts = clipPartRanges(size);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts[0].start).toBe(0);
    expect(parts.at(-1)?.end).toBe(size);
    expect(parts.reduce((sum, part) => sum + part.end - part.start, 0)).toBe(size);
    parts.forEach((part, index) => {
      expect(part.end).toBeGreaterThan(part.start);
      if (index) expect(part.start).toBe(parts[index - 1].end);
    });
  });
  it("rejects empty, invalid, and oversized input", () => {
    [0, -1, NaN, Infinity, 1.5, MAX_CLIP_BYTES + 1].forEach(size => expect(() => clipPartRanges(size)).toThrow());
  });
});

describe("aggregate progress", () => {
  it("weights bytes rather than averaging part percentages", () => {
    expect(clipProgress([10, 0], [10, 90])).toEqual({ bytes: 10, total: 100, percent: 10 });
  });
  it("clamps offsets and handles resumed and missing parts", () => {
    expect(clipProgress([200, -8], [100, 100, 100])).toEqual({ bytes: 100, total: 300, percent: 33 });
    expect(clipProgress([100, 100, 100], [100, 100, 100]).percent).toBe(100);
    expect(clipProgress([], []).percent).toBe(0);
  });
});

describe("resume isolation", () => {
  it("is stable and separates users, groups, and parts", () => {
    const key = clipResumeKey(1, "group", 0);
    expect(clipResumeKey("1", "group", 0)).toBe(key);
    expect(new Set([key, clipResumeKey(2, "group", 0), clipResumeKey(1, "other", 0), clipResumeKey(1, "group", 1)]).size).toBe(4);
  });
});