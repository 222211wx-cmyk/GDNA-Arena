/** Native, real-time preparation. No encoder download and no duration cutoff. */
export const VIDEO_BITS_PER_SECOND = 800_000;
export function outputDimensions(width: number, height: number) {
  const scale = Math.min(1, 854 / width, 480 / height);
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}
export type Preparation = { file: File; mode: "compressed" | "original"; message: string; duration?: number };
const completed = new WeakMap<File, Preparation>();

export async function prepareClip(file: File, signal: AbortSignal, progress: (percent: number, message: string) => void): Promise<Preparation> {
  signal.throwIfAborted();
  const cached = completed.get(file);
  if (cached) return cached;
  if (!file.type.startsWith("video/")) return { file, mode: "original", message: "Audio original — traitement audio serveur." };
  const fallback = (reason: string): Preparation => ({
    file, mode: "original",
    message: `Compression locale indisponible (${reason}). Envoi de l’original, puis traitement serveur 480p; le transfert sera plus volumineux.`,
  });
  if (typeof document === "undefined") throw new Error("Ouvrez Clips pour préparer la vidéo avant la reprise en arrière-plan.");
  const mime = typeof MediaRecorder === "undefined" ? undefined :
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp8,opus"].find(value => MediaRecorder.isTypeSupported(value));
  if (!mime || typeof AudioContext === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    const result = fallback("navigateur non compatible"); completed.set(file, result); return result;
  }
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let frame = 0;
  let visibility: (() => void) | undefined;
  const aborted = () => {
    video.pause();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  signal.addEventListener("abort", aborted, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { video.onloadedmetadata = null; video.onerror = null; signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(signal.reason); };
      video.onloadedmetadata = () => { cleanup(); resolve(); };
      video.onerror = () => { cleanup(); reject(new Error("format vidéo non décodable")); };
      signal.addEventListener("abort", abort, { once: true });
      video.src = url;
    });
    signal.throwIfAborted();
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw new Error("durée ou dimensions non vérifiables");
    const duration = video.duration;
    const canvas = document.createElement("canvas");
    const dimensions = outputDimensions(video.videoWidth, video.videoHeight);
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const drawing = canvas.getContext("2d", { alpha: false });
    if (!drawing) throw new Error("canvas indisponible");
    context = new AudioContext();
    await context.resume();
    if (context.state !== "running") throw new Error("autorisation audio requise");
    // A MediaElementAudioSource routes the decoded source audio, not a capture
    // stream sampled before playback (which can silently omit its audio track).
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    stream = canvas.captureStream(30);
    const audio = destination.stream.getAudioTracks()[0];
    if (!audio || audio.readyState !== "live") throw new Error("piste audio indisponible");
    stream.addTrack(audio);
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITS_PER_SECOND, audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    const recording = recorder;
    const result = await new Promise<Blob>((resolve, reject) => {
      const fail = () => reject(new Error("échec de lecture ou d’encodage"));
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = fail;
      recording.onstop = () => signal.aborted ? reject(signal.reason) : resolve(new Blob(chunks, { type: recording.mimeType }));
      video.onerror = fail;
      video.onended = () => { if (recording.state !== "inactive") recording.stop(); };
      video.onwaiting = () => { if (recording.state === "recording") recording.pause(); };
      video.onplaying = () => { if (recording.state === "paused" && !document.hidden) recording.resume(); };
      const draw = () => {
        if (video.readyState >= 2) drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
        progress(Math.min(99, video.currentTime / duration * 100), `Compression 480p · vidéo 800 kb/s · audio conservé — ${Math.floor(video.currentTime)} / ${Math.ceil(duration)} s. Gardez cet onglet visible.`);
        frame = requestAnimationFrame(draw);
      };
      visibility = () => {
        if (document.hidden) {
          video.pause();
          if (recording.state === "recording") recording.pause();
          progress(video.currentTime / duration * 100, "Compression en pause — revenez à cet onglet pour continuer.");
        } else if (!video.ended && !signal.aborted) {
          void context!.resume().then(() => {
            if (context!.state !== "running") throw new Error("Audio interrompu");
            return video.play();
          }).catch(fail);
        }
      };
      document.addEventListener("visibilitychange", visibility);
      recording.start(1_000);
      draw();
      void video.play().then(() => { if (document.hidden) visibility?.(); }).catch(fail);
    });
    signal.throwIfAborted();
    if (!result.size || video.currentTime < duration - 0.5) throw new Error("encodage incomplet");
    const prepared: Preparation = {
      file: new File([result], `${file.name.replace(/\.[^.]+$/, "")}-480p.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`, { type: mime.startsWith("video/mp4") ? "video/mp4" : "video/webm" }),
      mode: "compressed", duration,
      message: `Compression terminée — ${dimensions.width}×${dimensions.height}, cible vidéo 800 kb/s, audio 128 kb/s. ${Math.round(result.size / 1024)} KiB à transférer.`,
    };
    completed.set(file, prepared);
    return prepared;
  } catch (error) {
    signal.throwIfAborted();
    const result = fallback(error instanceof Error ? error.message : "erreur encodeur");
    completed.set(file, result);
    return result;
  } finally {
    signal.removeEventListener("abort", aborted);
    cancelAnimationFrame(frame);
    if (visibility) document.removeEventListener("visibilitychange", visibility);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    video.pause(); video.removeAttribute("src"); video.load();
    stream?.getTracks().forEach(track => track.stop());
    if (context) await context.close().catch(() => {});
    URL.revokeObjectURL(url);
  }
}