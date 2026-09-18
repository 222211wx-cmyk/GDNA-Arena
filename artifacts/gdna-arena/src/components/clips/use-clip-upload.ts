import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { prepareClip } from "./prepare-clip";
import {
  CLIP_CHUNK_SIZE, MAX_CLIP_BYTES, clipPartRanges, clipProgress, clipResumeKey,
  readClipDraft, writeClipDraft, type ClipUploadDraft,
} from "./clip-upload-data";

type Phase = "loading" | "ready" | "preparing" | "uploading" | "paused" | "processing" | "error" | "canceling";
const endpoint = `${import.meta.env.BASE_URL}api/clips/uploads`;

export function useClipUpload(userId: number, onDone: () => void) {
  const [draft, setDraft] = useState<ClipUploadDraft | null>(null);
  const draftRef = useRef<ClipUploadDraft | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const phaseRef = useRef<Phase>("loading");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [restored, setRestored] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preparation, setPreparation] = useState(0);
  const [speed, setSpeed] = useState(0);
  const uploads = useRef<Upload[]>([]);
  const offsets = useRef<number[]>([]);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const completeBusy = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const changePhase = useCallback((value: Phase) => {
    phaseRef.current = value;
    if (mounted.current) setPhase(value);
  }, []);

  const persist = useCallback((value: ClipUploadDraft | null) => {
    persistence.current = persistence.current.then(() => writeClipDraft(String(userId), value)).catch(() => {
      if (mounted.current) setStorageWarning(true);
    });
    return persistence.current;
  }, [userId]);

  const updateDraft = useCallback((value: ClipUploadDraft | null) => {
    draftRef.current = value;
    if (mounted.current) setDraft(value);
    void persist(value);
  }, [persist]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    readClipDraft(String(userId)).then(value => {
      if (disposed) return;
      if (value?.userId === String(userId)) {
        draftRef.current = value;
        setDraft(value);
        setRestored(true);
        changePhase(value.urls.some(Boolean) ? "paused" : "ready");
      } else changePhase("ready");
    }).catch(() => {
      if (!disposed) { setStorageWarning(true); changePhase("ready"); }
    });
    return () => {
      disposed = true;
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
      uploads.current.forEach(upload => { void upload.abort(false).catch(() => undefined); });
    };
  }, [userId, changePhase]);

  const pause = useCallback(async () => {
    if (!["uploading", "preparing", "processing"].includes(phaseRef.current)) return;
    generation.current++;
    controller.current?.abort();
    changePhase("paused");
    setSpeed(0);
    await Promise.all(uploads.current.map(upload => upload.abort(false).catch(() => undefined)));
    await persist(draftRef.current);
  }, [changePhase, persist]);

  const selectFile = useCallback((file: File, title: string, compress: boolean) => {
    if (draftRef.current || phaseRef.current === "loading") return;
    if (!file.size || file.size > MAX_CLIP_BYTES) {
      setError("size");
      return;
    }
    if (!file.type.startsWith("video/")) { setError("video"); return; }
    setError("");
    setProgress(0);
    setRestored(false);
    updateDraft({
      userId: String(userId), groupId: crypto.randomUUID(), file, title, compress,
      duration: 0, thumbnail: null, prepared: false, urls: [], completed: [], createdAt: Date.now(),
    });
    changePhase("ready");
  }, [userId, updateDraft, changePhase]);

  const edit = useCallback((title: string, compress: boolean) => {
    const current = draftRef.current;
    if (!current || current.urls.some(Boolean) || ["uploading", "preparing", "processing", "canceling"].includes(phaseRef.current)) return;
    // A prepared file must never be described as compressed if it was not.
    updateDraft({ ...current, title, compress: current.prepared ? current.compress : compress });
  }, [updateDraft]);

  const start = useCallback(async () => {
    let current = draftRef.current;
    if (!current || !current.title.trim() || ["loading", "uploading", "preparing", "processing", "canceling"].includes(phaseRef.current) || completeBusy.current) return;
    const run = ++generation.current;
    const live = () => mounted.current && generation.current === run;
    setError("");
    setSpeed(0);
    controller.current = new AbortController();
    try {
      // Abort completion of a previous pause before creating replacement instances.
      await Promise.all(uploads.current.map(upload => upload.abort(false)));
      if (!live()) return;
      if (!current.prepared) {
        changePhase("preparing");
        setPreparation(0);
        const prepared = await prepareClip(current.file, {
          compress: current.compress, signal: controller.current.signal,
          onProgress: value => { if (live()) setPreparation(value); },
        });
        if (!live()) return;
        if (!Number.isFinite(prepared.duration) || prepared.duration < 60) throw new Error("duration");
        if (!prepared.file.size || prepared.file.size > MAX_CLIP_BYTES) throw new Error("size");
        current = { ...current, ...prepared, prepared: true };
        updateDraft(current);
        await persistence.current;
        if (!live()) return;
      }
      const active = current;
      const ranges = clipPartRanges(active.file.size);
      const sizes = ranges.map(part => part.end - part.start);
      offsets.current = sizes.map((size, index) => active.completed[index] ? size : 0);
      setProgress(clipProgress(offsets.current, sizes).percent);
      let sample = { time: performance.now(), bytes: clipProgress(offsets.current, sizes).bytes };

      const finalize = async () => {
        if (!live() || completeBusy.current) return;
        const latest = draftRef.current;
        if (!latest || !ranges.every((_, index) => latest.completed[index] && latest.urls[index])) return;
        completeBusy.current = true;
        changePhase("processing");
        setSpeed(0);
        try {
          const uploadIds = ranges.map((_, index) => new URL(latest.urls[index]!, window.location.href).pathname.split("/").filter(Boolean).pop()!);
          const response = await fetch(`${endpoint}/complete`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadIds }), signal: controller.current!.signal,
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
          if (!body.clip) throw new Error("Invalid completion response");
          if (!live()) return;
          updateDraft(null);
          await persistence.current;
          if (!live()) return;
          changePhase("ready");
          setRestored(false);
          doneRef.current();
        } catch (reason) {
          if (live()) { setError(reason instanceof Error ? reason.message : String(reason)); changePhase("error"); }
        } finally {
          completeBusy.current = false;
        }
      };

      const fail = (reason: Error) => {
        if (!live()) return;
        generation.current++;
        uploads.current.forEach(upload => { void upload.abort(false).catch(() => undefined); });
        setError(reason.message);
        setSpeed(0);
        changePhase("error");
      };

      changePhase("uploading");
      uploads.current = ranges.map((part, index) => {
        const upload = new Upload(active.file.slice(part.start, part.end, active.file.type), {
          endpoint, uploadUrl: active.urls[index] ?? undefined,
          chunkSize: CLIP_CHUNK_SIZE, retryDelays: [0, 1000, 3000, 5000, 10000, 30000],
          storeFingerprintForResuming: false,
          fingerprint: async () => clipResumeKey(userId, active.groupId, index),
          metadata: {
            groupId: active.groupId, partIndex: String(index), partCount: String(ranges.length),
            totalSize: String(active.file.size), title: active.title.trim(),
            contentType: active.file.type, durationSec: String(active.duration),
          },
          onBeforeRequest: request => {
            const xhr = request.getUnderlyingObject() as XMLHttpRequest;
            xhr.withCredentials = true;
          },
          onAfterResponse: (request, response) => {
            if (!live() || request.getMethod() !== "HEAD" || response.getStatus() !== 200) return;
            // Bytes discovered via HEAD were sent in an earlier session, not at
            // the current network speed. Rebase the speed sample accordingly.
            const offset = Number(response.getHeader("Upload-Offset"));
            if (!Number.isFinite(offset)) return;
            offsets.current[index] = offset;
            const measured = clipProgress(offsets.current, sizes);
            setProgress(measured.percent);
            sample = { time: performance.now(), bytes: measured.bytes };
          },
          onUploadUrlAvailable: () => {
            // Creation can finish concurrently with pause/unmount. Keep that
            // resource URL even after the transfer generation was invalidated.
            if (!upload.url || draftRef.current?.groupId !== active.groupId) return;
            const urls = [...draftRef.current.urls];
            urls[index] = upload.url;
            updateDraft({ ...draftRef.current, urls });
          },
          onProgress: bytes => {
            if (!live()) return;
            offsets.current[index] = bytes;
            const measured = clipProgress(offsets.current, sizes);
            setProgress(measured.percent);
            const now = performance.now();
            if (now - sample.time >= 500) {
              setSpeed(Math.max(0, (measured.bytes - sample.bytes) * 1000 / (now - sample.time)));
              sample = { time: now, bytes: measured.bytes };
            }
          },
          onSuccess: () => {
            if (!live() || !draftRef.current) return;
            const completed = [...draftRef.current.completed];
            completed[index] = true;
            const urls = [...draftRef.current.urls];
            urls[index] = upload.url;
            offsets.current[index] = sizes[index];
            setProgress(clipProgress(offsets.current, sizes).percent);
            updateDraft({ ...draftRef.current, completed, urls });
            void finalize();
          },
          onError: fail,
        });
        return upload;
      });
      uploads.current.forEach((upload, index) => { if (!active.completed[index]) upload.start(); });
      await finalize();
    } catch (reason) {
      if (live()) {
        setError(reason instanceof Error ? reason.message : String(reason));
        changePhase("error");
      }
    }
  }, [userId, changePhase, updateDraft]);

  const cancel = useCallback(async () => {
    if (phaseRef.current === "canceling" || phaseRef.current === "processing") return;
    generation.current++;
    controller.current?.abort();
    changePhase("canceling");
    setSpeed(0);
    try {
      await Promise.all(uploads.current.map(upload => upload.abort(false)));
      const known = new Set([
        ...(draftRef.current?.urls ?? []), ...uploads.current.map(upload => upload.url),
      ].filter((url): url is string => Boolean(url)));
      await Promise.all([...known].map(async url => {
        const response = await fetch(url, {
          method: "DELETE", credentials: "include", headers: { "Tus-Resumable": "1.0.0" },
        });
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`HTTP ${response.status}`);
      }));
      uploads.current = [];
      updateDraft(null);
      await persistence.current;
      setProgress(0);
      setPreparation(0);
      setError("");
      setRestored(false);
      changePhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      changePhase("error");
    }
  }, [changePhase, updateDraft]);

  return { draft, phase, error, storageWarning, restored, progress, preparation, speed, selectFile, edit, start, pause, cancel };
}