import { afterEach, describe, expect, it, vi } from "vitest";
import { outputDimensions, prepareClip, VIDEO_BITS_PER_SECOND } from "./prepareClip";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native video preparation policy", () => {
  it("caps portrait and landscape output at 480 pixels high with even dimensions and no upscaling", () => {
    expect(outputDimensions(1920, 1080)).toEqual({ width: 852, height: 480 });
    expect(outputDimensions(1080, 1920)).toEqual({ width: 270, height: 480 });
    expect(outputDimensions(320, 240)).toEqual({ width: 320, height: 240 });
    expect(VIDEO_BITS_PER_SECOND).toBe(800_000);
  });
  it("explicitly explains original-upload plus server fallback when recording is unsupported", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const original = new File(["source"], "v.mp4", { type: "video/mp4" });
    const result = await prepareClip(original, new AbortController().signal, vi.fn());
    expect(result.file).toBe(original);
    expect(result.mode).toBe("original");
    expect(result.message).toContain("Envoi de l’original");
    expect(result.message).toContain("serveur 480p");
  });
  it("does not invent a video stream for audio-only inputs", async () => {
    const original = new File(["audio"], "a.m4a", { type: "audio/mp4" });
    expect((await prepareClip(original, new AbortController().signal, vi.fn())).file).toBe(original);
  });
  it("cancellation never silently falls back to uploading the original", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareClip(new File(["v"], "v.mp4", { type: "video/mp4" }), controller.signal, vi.fn())).rejects.toMatchObject({ name: "AbortError" });
  });
  it("records the routed source audio together with 480p canvas frames through a 61-second source", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      duration: { value: 61 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
      src: { set: () => queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata"))) },
    });
    vi.spyOn(video, "play").mockImplementation(async () => {
      video.dispatchEvent(new Event("playing"));
      video.currentTime = 61;
      queueMicrotask(() => video.dispatchEvent(new Event("ended")));
    });
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "load").mockImplementation(() => {});
    const canvas = document.createElement("canvas");
    const track = { readyState: "live", stop: vi.fn() };
    const addTrack = vi.fn();
    const stream = { addTrack, getTracks: () => [track] };
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", { configurable: true, value: vi.fn(() => stream) });
    vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "video" ? video : tag === "canvas" ? canvas : create(tag)) as typeof document.createElement);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    const connect = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "running";
      resume = async () => {};
      close = async () => {};
      createMediaElementSource = () => ({ connect });
      createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [track] } });
    });
    const options = vi.fn();
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported = (type: string) => type.startsWith("video/webm");
      state = "inactive";
      mimeType = "video/webm;codecs=vp8,opus";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor(input: unknown, config: unknown) { options(input, config); }
      start() { this.state = "recording"; }
      pause() { this.state = "paused"; }
      resume() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["simulated encoded bytes"]) }); this.onstop?.(); }
    });
    const result = await prepareClip(new File(["source"], "v.mp4", { type: "video/mp4" }), new AbortController().signal, vi.fn());
    expect(result.mode).toBe("compressed");
    expect(result.duration).toBe(61);
    expect(result.file.type).toBe("video/webm");
    expect([canvas.width, canvas.height]).toEqual([852, 480]);
    expect(connect).toHaveBeenCalledOnce();
    expect(addTrack).toHaveBeenCalledWith(track);
    expect(options).toHaveBeenCalledWith(stream, expect.objectContaining({ videoBitsPerSecond: 800_000, audioBitsPerSecond: 128_000 }));
    expect(track.stop).toHaveBeenCalled();
    delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).captureStream;
  });
});