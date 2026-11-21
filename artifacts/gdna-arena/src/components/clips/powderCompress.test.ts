import { describe, expect, it } from "vitest";
import { COMPRESSION_PROFILES, formatSavings, targetSize } from "./powderCompress";

describe("powder compression", () => {
  it("defines the two modes", () => {
    expect(COMPRESSION_PROFILES.powder).toMatchObject({ shortSide: 480, videoBps: 500_000 });
    expect(COMPRESSION_PROFILES.normal).toMatchObject({ shortSide: 720, videoBps: 1_000_000 });
  });
  it("scales the short side, keeps aspect, never upscales", () => {
    expect(targetSize(1920, 1080, 480)).toEqual({ width: 854, height: 480 });
    expect(targetSize(1080, 1920, 480)).toEqual({ width: 480, height: 854 });
    expect(targetSize(320, 240, 480)).toEqual({ width: 320, height: 240 });
  });
  it("formats the before/after result line", () => {
    expect(formatSavings(48_000_000, 2_600_000)).toBe("قبل: 48 MB -> من بعد: 2.6 MB | وفرتي 94% ✅");
  });
});
