import { describe, expect, it } from "vitest";
import { videoOutputSize, webmWithDuration } from "./prepareVideo";

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
});