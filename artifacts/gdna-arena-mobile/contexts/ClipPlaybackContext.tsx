import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  useVideoPlayer,
  type VideoPlayer,
  type VideoSource,
} from 'expo-video';
import { ClipApiError, fetchClipByCode, type Clip } from '@/lib/clip-api';
import {
  playbackSnapshot,
  retryAfterMilliseconds,
  shouldApplyReplacement,
  withPlaybackIntent,
  withPlaybackPosition,
  type PlaybackSnapshot,
} from '@/lib/clip-logic';

type PlaybackPhase = 'idle' | 'loading' | 'processing' | 'ready' | 'recovering' | 'error';

type ClipPlaybackValue = {
  player: VideoPlayer;
  clip: Clip | null;
  phase: PlaybackPhase;
  error: string | null;
  position: number;
  duration: number;
  isPlaying: boolean;
  load: (code: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  retry: () => Promise<void>;
};

type PendingReplacement = {
  generation: number;
  operation: number;
  url: string;
  snapshot: PlaybackSnapshot;
  isRecovery: boolean;
};

const ClipPlaybackContext = createContext<ClipPlaybackValue | null>(null);
const POLL_DELAY_MS = 4_000;
const MAX_POLLS = 30;
const MAX_URL_RECOVERIES = 3;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function displayError(cause: unknown): string {
  if (cause instanceof ClipApiError && cause.status === 404) return 'Clip not found.';
  if (cause instanceof Error && cause.name === 'AbortError') return '';
  return cause instanceof Error ? cause.message : 'Unable to open this clip.';
}

function sourceUri(source: VideoSource): string | null {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object' && 'uri' in source && typeof source.uri === 'string') {
    return source.uri;
  }
  return null;
}

export function ClipPlaybackProvider({ children }: { children: ReactNode }) {
  const player = useVideoPlayer(null, instance => {
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = true;
    instance.showNowPlayingNotification = true;
    instance.timeUpdateEventInterval = 1;
  });
  const [clip, setClip] = useState<Clip | null>(null);
  const [phase, setPhase] = useState<PlaybackPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const clipRef = useRef<Clip | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const desiredPlayingRef = useRef(false);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingReplacementRef = useRef<PendingReplacement | null>(null);
  const replacementGenerationRef = useRef(0);
  const replacementQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSourceUrlRef = useRef<string | null>(null);
  const sourceOperationRef = useRef<number | null>(null);
  const recoveringRef = useRef(false);
  const recoverySnapshotRef = useRef<PlaybackSnapshot | null>(null);
  const recoveryCountRef = useRef(0);
  const requestedCodeRef = useRef<string | null>(null);
  const lastCodeRef = useRef<string | null>(null);
  const recoverSourceRef = useRef<() => Promise<void>>(async () => undefined);

  const getPlayableClip = useCallback(async (
    code: string,
    signal: AbortSignal,
    recovery: boolean,
  ): Promise<Clip> => {
    let polls = 0;
    while (!signal.aborted) {
      try {
        const result = await fetchClipByCode(code, signal);
        if (result.url) return result;
        if (result.processingStatus === 'failed') {
          throw new Error('Clip processing failed. Please try again later.');
        }
        polls += 1;
        if (polls >= MAX_POLLS) throw new Error('The clip is still processing. Please try again later.');
        setPhase(recovery ? 'recovering' : 'processing');
        await wait(POLL_DELAY_MS, signal);
      } catch (cause) {
        if (cause instanceof ClipApiError && cause.status === 503 && polls < MAX_POLLS) {
          polls += 1;
          setPhase(recovery ? 'recovering' : 'processing');
          await wait(retryAfterMilliseconds(cause.retryAfter), signal);
          continue;
        }
        throw cause;
      }
    }
    throw signal.reason;
  }, []);

  const enqueueReplacement = useCallback((
    nextClip: Clip,
    snapshot: PlaybackSnapshot,
    operation: number,
    isRecovery: boolean,
  ): Promise<void> => {
    if (!nextClip.url) return Promise.reject(new Error('The clip has no playback URL.'));
    const generation = ++replacementGenerationRef.current;
    const url = nextClip.url;
    const execute = async () => {
      if (operation !== operationRef.current) return;
      pendingReplacementRef.current = { generation, operation, url, snapshot, isRecovery };
      try {
        await player.replaceAsync({
          uri: url,
          metadata: {
            title: nextClip.name || nextClip.originalName || nextClip.code,
            artist: 'HELIXLY',
          },
          contentType: 'auto',
        });
      } catch (cause) {
        if (pendingReplacementRef.current?.generation === generation) {
          pendingReplacementRef.current = null;
        }
        throw cause;
      }
    };
    const queued = replacementQueueRef.current.then(execute, execute);
    replacementQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [player]);

  const recoverSource = useCallback(async () => {
    const active = clipRef.current;
    if (!active || recoveringRef.current) return;
    if (recoveryCountRef.current >= MAX_URL_RECOVERIES) {
      recoveringRef.current = false;
      setIsPlaying(false);
      setPhase('error');
      setError('Playback could not be restored. Check your connection and try again.');
      return;
    }
    if (!recoverySnapshotRef.current) {
      recoverySnapshotRef.current = playbackSnapshot(
        positionRef.current,
        desiredPlayingRef.current,
        durationRef.current || active.duration,
      );
    }
    recoveringRef.current = true;
    recoveryCountRef.current += 1;
    setIsPlaying(recoverySnapshotRef.current.shouldPlay);
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('recovering');
    setError(null);
    try {
      const refreshed = await getPlayableClip(active.code, controller.signal, true);
      if (operation !== operationRef.current) return;
      clipRef.current = refreshed;
      setClip(refreshed);
      await enqueueReplacement(
        refreshed,
        recoverySnapshotRef.current,
        operation,
        true,
      );
    } catch (cause) {
      if (operation !== operationRef.current) return;
      recoveringRef.current = false;
      const message = displayError(cause);
      if (!message) return;
      setError(message);
      if (recoveryCountRef.current < MAX_URL_RECOVERIES) {
        setPhase('recovering');
        setTimeout(() => void recoverSourceRef.current(), 0);
      } else {
        setIsPlaying(false);
        setPhase('error');
      }
    }
  }, [enqueueReplacement, getPlayableClip]);
  recoverSourceRef.current = recoverSource;

  const load = useCallback(async (code: string) => {
    if (requestedCodeRef.current === code) return;
    requestedCodeRef.current = code;
    lastCodeRef.current = code;
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    recoveryCountRef.current = 0;
    recoveringRef.current = false;
    recoverySnapshotRef.current = null;
    desiredPlayingRef.current = false;
    clipRef.current = null;
    setClip(null);
    positionRef.current = 0;
    durationRef.current = 0;
    setPosition(0);
    setDuration(0);
    setIsPlaying(false);
    setError(null);
    setPhase('loading');
    player.pause();
    try {
      const loaded = await getPlayableClip(code, controller.signal, false);
      if (operation !== operationRef.current) return;
      clipRef.current = loaded;
      setClip(loaded);
      await enqueueReplacement(loaded, playbackSnapshot(0, false), operation, false);
    } catch (cause) {
      if (operation !== operationRef.current) return;
      const message = displayError(cause);
      if (message) {
        setError(message);
        setPhase('error');
        requestedCodeRef.current = null;
      }
    }
  }, [enqueueReplacement, getPlayableClip, player]);

  useEffect(() => {
    const sourceSubscription = player.addListener('sourceChange', event => {
      const uri = sourceUri(event.source);
      activeSourceUrlRef.current = uri;
      const pending = pendingReplacementRef.current;
      sourceOperationRef.current = pending && pending.url === uri ? pending.operation : null;
    });
    const statusSubscription = player.addListener('statusChange', event => {
      const pending = pendingReplacementRef.current;
      if (event.status === 'readyToPlay' && pending && shouldApplyReplacement(
        operationRef.current,
        pending.operation,
        activeSourceUrlRef.current,
        pending.url,
      )) {
        const snapshot = pending.isRecovery
          ? recoverySnapshotRef.current ?? pending.snapshot
          : pending.snapshot;
        pendingReplacementRef.current = null;
        const restoredPosition = playbackSnapshot(
          snapshot.position,
          snapshot.shouldPlay,
          player.duration || durationRef.current,
        ).position;
        player.currentTime = restoredPosition;
        positionRef.current = restoredPosition;
        setPosition(restoredPosition);
        desiredPlayingRef.current = snapshot.shouldPlay;
        if (snapshot.shouldPlay) player.play();
        else player.pause();
        recoveringRef.current = false;
        recoverySnapshotRef.current = null;
        const nextDuration = player.duration || clipRef.current?.duration || 0;
        durationRef.current = nextDuration;
        setDuration(nextDuration);
        setIsPlaying(snapshot.shouldPlay);
        setPhase('ready');
        setError(null);
      } else if (
        event.status === 'error' &&
        clipRef.current &&
        (
          sourceOperationRef.current === operationRef.current ||
          (recoveringRef.current && pending?.operation === operationRef.current)
        )
      ) {
        if (!recoverySnapshotRef.current) {
          recoverySnapshotRef.current = playbackSnapshot(
            positionRef.current,
            desiredPlayingRef.current,
            durationRef.current || clipRef.current.duration,
          );
        }
        if (pending?.operation === operationRef.current) pendingReplacementRef.current = null;
        recoveringRef.current = false;
        void recoverSourceRef.current();
      }
    });
    const playingSubscription = player.addListener('playingChange', event => {
      if (!recoverySnapshotRef.current && player.status !== 'error') {
        desiredPlayingRef.current = event.isPlaying;
        setIsPlaying(event.isPlaying);
      }
    });
    const timeSubscription = player.addListener('timeUpdate', event => {
      if (recoverySnapshotRef.current || recoveringRef.current || player.status === 'error') return;
      if (event.currentTime > positionRef.current + 0.1) recoveryCountRef.current = 0;
      positionRef.current = event.currentTime;
      setPosition(event.currentTime);
      const nextDuration = player.duration || clipRef.current?.duration || 0;
      durationRef.current = nextDuration;
      setDuration(nextDuration);
    });
    const endSubscription = player.addListener('playToEnd', () => {
      desiredPlayingRef.current = false;
      if (recoverySnapshotRef.current) {
        recoverySnapshotRef.current = withPlaybackIntent(recoverySnapshotRef.current, false);
      }
      setIsPlaying(false);
    });
    return () => {
      sourceSubscription.remove();
      statusSubscription.remove();
      playingSubscription.remove();
      timeSubscription.remove();
      endSubscription.remove();
    };
  }, [player]);

  useEffect(() => {
    if (!clip?.urlExpiresAt) return;
    const refreshAt = Date.parse(clip.urlExpiresAt) - 60_000;
    if (!Number.isFinite(refreshAt)) return;
    const delay = Math.max(0, refreshAt - Date.now());
    const timer = setTimeout(() => void recoverSourceRef.current(), Math.min(delay, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [clip?.urlExpiresAt]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const play = useCallback(() => {
    desiredPlayingRef.current = true;
    if (recoverySnapshotRef.current) {
      recoverySnapshotRef.current = withPlaybackIntent(recoverySnapshotRef.current, true);
      setIsPlaying(true);
      return;
    }
    player.play();
  }, [player]);
  const pause = useCallback(() => {
    desiredPlayingRef.current = false;
    if (recoverySnapshotRef.current) {
      recoverySnapshotRef.current = withPlaybackIntent(recoverySnapshotRef.current, false);
      setIsPlaying(false);
      return;
    }
    player.pause();
  }, [player]);
  const seekTo = useCallback((seconds: number) => {
    const next = playbackSnapshot(seconds, desiredPlayingRef.current, durationRef.current).position;
    positionRef.current = next;
    setPosition(next);
    if (recoverySnapshotRef.current) {
      recoverySnapshotRef.current = withPlaybackPosition(
        recoverySnapshotRef.current,
        next,
        durationRef.current,
      );
      return;
    }
    player.currentTime = next;
  }, [player]);
  const seekBy = useCallback((seconds: number) => seekTo(positionRef.current + seconds), [seekTo]);
  const retry = useCallback(async () => {
    if (clipRef.current) {
      recoveryCountRef.current = 0;
      recoveringRef.current = false;
      await recoverSourceRef.current();
    } else if (lastCodeRef.current) {
      requestedCodeRef.current = null;
      await load(lastCodeRef.current);
    }
  }, [load]);

  const value = useMemo<ClipPlaybackValue>(() => ({
    player, clip, phase, error, position, duration, isPlaying,
    load, play, pause, seekBy, seekTo, retry,
  }), [player, clip, phase, error, position, duration, isPlaying, load, play, pause, seekBy, seekTo, retry]);

  return <ClipPlaybackContext.Provider value={value}>{children}</ClipPlaybackContext.Provider>;
}

export function useClipPlayback(): ClipPlaybackValue {
  const value = useContext(ClipPlaybackContext);
  if (!value) throw new Error('useClipPlayback must be used within ClipPlaybackProvider');
  return value;
}