import { describe, expect, it } from "vitest";
import {
  browserCompressionUnavailableReason,
  compressionCandidateError,
  MAX_BROWSER_COMPRESSION_SOURCE_BYTES,
  videoOutputSize,
  webmWithDuration,
} from "./prepareVideo";

describe("video preparation metadata", () => {
  it("uses 480p on the short edge and preserves aspect ratio with even dimensions", () => {
    expect(videoOutputSize(1280, 720)).toEqual({ width: 852, height: 480 });
    expect(videoOutputSize(720, 1280)).toEqual({ width: 480, height: 852 });
    expect(videoOutputSize(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("adds finite WebM Duration to Segment Info without changing media bytes", () => {
    // Info(size=7) containing TimecodeScale(size=3, 1,000,000), then Cluster.
    const source = new Uint8Array([
      0x15, 0x49, 0xa9, 0x66, 0x87,
      0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
      0x1f, 0x43, 0xb6, 0x75, 0xff, 0xaa,
    ]);
    const fixed = webmWithDuration(source, 67);
    expect(fixed[4]).toBe(0x92); // Info payload grew from 7 to 18 bytes.
    expect([...fixed.slice(12, 15)]).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(fixed.buffer).getFloat64(15, false)).toBe(67_000);
    expect([...fixed.slice(-6)]).toEqual([0x1f, 0x43, 0xb6, 0x75, 0xff, 0xaa]);
  });

  it("refuses unbounded browser work and non-video input before decoding", () => {
    const large = new File(["x"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(large, "size", { value: MAX_BROWSER_COMPRESSION_SOURCE_BYTES + 1 });
    expect(browserCompressionUnavailableReason(large)).toContain("كبير");
    expect(browserCompressionUnavailableReason(
      new File(["x"], "audio.m4a", { type: "audio/mp4" }),
    )).toContain("للفيديو فقط");
  });

  it("rejects a candidate that would upload as many or more bytes than the original", () => {
    expect(compressionCandidateError(100, 100)).toContain("ليست أصغر");
    expect(compressionCandidateError(100, 101)).toContain("ليست أصغر");
    expect(compressionCandidateError(100, 99)).toBeNull();
  });
});