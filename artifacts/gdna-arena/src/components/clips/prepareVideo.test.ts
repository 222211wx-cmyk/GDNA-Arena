import { describe, expect, it } from "vitest";
import {
  browserCompressionUnavailableReason,
  compressionCandidateError,
  ffmpegCompressionArguments,
  ffprobeInvocationError,
  ffmpegVideoBitrate,
  MAX_BROWSER_COMPRESSION_SOURCE_BYTES,
  preparedProbeError,
  videoOutputSize,
} from "./prepareVideo";

describe("video preparation metadata", () => {
  it("caps the short edge at 720 and preserves aspect ratio with even dimensions", () => {
    expect(videoOutputSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(videoOutputSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(videoOutputSize(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("requests interoperable H264/AAC MP4 and keeps optional source audio", () => {
    const args = ffmpegCompressionArguments(1280, 720, 61);
    expect(args).toEqual(expect.arrayContaining([
      "-map", "0:v:0", "0:a:0?", "-c:v", "libx264",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "prepared.mp4",
    ]));
    expect(ffmpegVideoBitrate(61)).toBeLessThanOrEqual(1_600_000);
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

  it("budgets long clips beneath the bounded output cap", () => {
    expect(ffmpegVideoBitrate(30 * 60)).toBeLessThan(ffmpegVideoBitrate(60));
    expect(ffmpegCompressionArguments(1280, 720, 65)).not.toContain("-shortest");
  });

  it("rejects lost audio, wrong codecs, and duration damage on clips over 60 seconds", () => {
    const source = { duration: 65, hasAudio: true };
    const valid = {
      duration: 65,
      width: 1280,
      height: 720,
      videoCodec: "h264",
      hasAudio: true,
      audioCodec: "aac",
    };
    expect(preparedProbeError(source, valid, { width: 1280, height: 720 })).toBeNull();
    expect(preparedProbeError(source, { ...valid, duration: 50 }, { width: 1280, height: 720 }))
      .toContain("مدة");
    expect(preparedProbeError(source, { ...valid, hasAudio: false }, { width: 1280, height: 720 }))
      .toContain("الصوت");
  });

  it("accepts the packaged core's -1 ffprobe status when it wrote a report", () => {
    expect(ffprobeInvocationError(-1, '{"streams":[]}')).toBeNull();
    expect(ffprobeInvocationError(-1, "")).toContain("ffprobe -1");
  });
});