import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { dismissCallAlert } from './native-push.native';
import { nativeSubtle } from './native-crypto';
import {
  AudioSessionOperationRestriction,
  ChannelProfileType,
  ConnectionStateType,
  createAgoraRtcEngine,
  EncryptionMode,
  RtcSurfaceView,
  type IRtcEngine,
  type IRtcEngineEventHandler,
  type LastmileProbeResult,
} from 'react-native-agora';
import { hasNativeCallAudio, waitForCallAudio, prepareCallAnswer } from './call-service';
import { attachNightCamera, detachNightCamera } from './night-camera';
import { ApiError, apiGet, apiPost, createAuthenticatedWebSocket, type AuthUser } from './api';
import { assertNetworkOnline, useOnline } from '@/contexts/OnlineContext';
import {
  decryptCallSecret,
  encryptCallSecret,
  ensureDeviceIdentity,
  type DeviceKey,
} from './e2e';

type CallPhase = 'idle' | 'incoming' | 'ringing' | 'connecting' | 'active' | 'reconnecting';
type E2eOffer = {
  devices: Record<string, { wrappedSecret: string; fingerprint: string }>;
};
export type ActiveCall = {
  callId: string;
  peer: string;
  video: boolean;
  incoming: boolean;
  phase: CallPhase;
  remoteUid?: number;
  startedAt?: number;
};
export function AgoraSurface({
  uid,
  local = false,
  style,
}: {
  uid: number;
  local?: boolean;
  style?: object;
}) {
  return <RtcSurfaceView style={style} canvas={{ uid }} zOrderMediaOverlay={local} />;
}
type Signal = {
  type: string;
  callId?: string;
  from?: string;
  by?: string;
  reason?: string;
  video?: boolean;
  offer?: unknown;
  answer?: unknown;
  e2e?: E2eOffer;
  message?: string;
  transport?: { provider: 'agora' | 'webrtc'; version: 1 };
};
type Credentials = { appId: string; token: string; uid: number; channel?: string };
const AGORA_TRANSPORT = { provider: 'agora', version: 1 } as const;

const RING_MS = 30_000;
const SIGNAL_WAIT_MS = 15_000;
const END_QUEUE_KEY = 'gdna.pending-call-ends.v1';
type PendingEnd = { callId: string; deviceId: string; userId: number };
let endQueueOperation: Promise<void> = Promise.resolve();
function queueOperation(work: () => Promise<void>): Promise<void> {
  const next = endQueueOperation.then(work, work);
  endQueueOperation = next.catch(() => {});
  return next;
}
async function pendingEnds(): Promise<PendingEnd[]> {
  const raw = await SecureStore.getItemAsync(END_QUEUE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid pending call termination data.');
  return parsed.filter((item): item is PendingEnd => !!item &&
    typeof item.callId === 'string' && typeof item.deviceId === 'string' && Number.isSafeInteger(item.userId));
}
async function retryPendingEnds(userId: number): Promise<void> {
  await queueOperation(async () => {
    const entries = await pendingEnds();
    const remaining: PendingEnd[] = [];
    for (const item of entries) {
      if (item.userId !== userId) { remaining.push(item); continue; }
      try {
        await apiPost('/call/end', { callId: item.callId, deviceId: item.deviceId });
      } catch (cause) {
        if (!(cause instanceof ApiError) || ![400, 403, 404].includes(cause.status)) remaining.push(item);
      }
    }
    await SecureStore.setItemAsync(END_QUEUE_KEY, JSON.stringify(remaining));
  });
}
async function requestCallEnd(item: PendingEnd): Promise<void> {
  await queueOperation(async () => {
    const entries = await pendingEnds();
    if (!entries.some(entry => entry.callId === item.callId && entry.userId === item.userId))
      await SecureStore.setItemAsync(END_QUEUE_KEY, JSON.stringify([...entries, item]));
  });
  await retryPendingEnds(item.userId);
}
type SignalWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};
const randomUrl = (length: number) => {
  let binary = '';
  Crypto.getRandomBytes(length).forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function permissions(video: boolean) {
  if (Platform.OS !== 'android') return;
  const requested = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (video) requested.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(requested);
  if (requested.some(permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error(`${video ? 'Camera and microphone' : 'Microphone'} permission is required.`);
  }
}

async function makeOffer(username: string, secret: string): Promise<E2eOffer> {
  const target = await apiGet<{ keys: DeviceKey[] }>(
    `/messages/e2e/users/${encodeURIComponent(username)}/key`,
  );
  if (!target.keys.length) throw new Error('The recipient has no active secure device.');
  const wrapped = await Promise.all(target.keys.map(async key => ({
    key,
    envelope: await encryptCallSecret(secret, key),
  })));
  return {
    devices: Object.fromEntries(wrapped.map(({ key, envelope }) => [key.deviceId, envelope])),
  };
}

export async function fetchAgoraToken(channel: string, deviceId: string): Promise<Credentials> {
  if (!channel || !deviceId) throw new Error('A call channel and secure device identity are required.');
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const credentials = await apiGet<Credentials>(
        `/agora/token?channel=${encodeURIComponent(channel)}&deviceId=${encodeURIComponent(deviceId)}`,
      );
      if (typeof credentials.appId !== 'string' || !credentials.appId ||
          typeof credentials.token !== 'string' || !credentials.token ||
          !Number.isSafeInteger(credentials.uid)) {
        throw new Error('The secure Agora token response is invalid.');
      }
      return credentials;
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error('Agora token request failed.');
      if (!(cause instanceof ApiError) || cause.status !== 503 || attempt === 2) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('Agora token request failed.');
}

export function useAgoraCalls(user: AuthUser | null, onIncoming: () => void) {
  const authRef = useRef(user);
  authRef.current = user;
  const { isOnline } = useOnline();
  const queryClient = useQueryClient();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<IRtcEngine | null>(null);
  const secretRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedRef = useRef(false);
  const incomingE2eRef = useRef<E2eOffer | null>(null);
  const incomingProviderRef = useRef<'agora' | 'webrtc'>('agora');
  const deviceIdRef = useRef<string | null>(null);
  const joiningCallRef = useRef<string | null>(null);
  const callGenerationRef = useRef(0);
  const answeredCallRef = useRef<string | null>(null);
  const callReadyWaitersRef = useRef(new Map<string, SignalWaiter>());
  const callResumeWaitersRef = useRef(new Map<string, SignalWaiter>());
  const providerWaitersRef = useRef(new Map<string, SignalWaiter>());

  useEffect(() => { callRef.current = call; }, [call]);
  const send = useCallback((value: object) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error('Call signaling is reconnecting.');
    wsRef.current.send(JSON.stringify(value));
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const active = callRef.current;
      const deviceId = deviceIdRef.current;
      if (active?.phase !== 'active' || !authRef.current || !deviceId) return;
      const background = state !== 'active';
      try { send({ type: 'call-heartbeat', callId: active.callId, background }); } catch {}
      void apiPost('/call/heartbeat', { callId: active.callId, deviceId, background }).catch(() => {});
    });
    return () => subscription.remove();
  }, [send, user?.id]);
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const release = useCallback((callId?: string) => {
    ++callGenerationRef.current;
    const endingId = callId ?? callRef.current?.callId;
    if (endingId) void dismissCallAlert(endingId).catch(() => {});
    clearTimer();
    const error = new Error('Call ended before secure media was ready.');
    for (const waiter of callReadyWaitersRef.current.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    for (const waiter of callResumeWaitersRef.current.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    for (const waiter of providerWaitersRef.current.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    providerWaitersRef.current.clear();
    incomingProviderRef.current = 'agora';
    callReadyWaitersRef.current.clear();
    callResumeWaitersRef.current.clear();
    joiningCallRef.current = null;
    answeredCallRef.current = null;
    callRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    detachNightCamera(endingId);
    if (engine) {
      try { engine.stopPreview(); } catch {}
      try { engine.leaveChannel(); } catch {}
      try { engine.release(); } catch {}
    }
    secretRef.current = null;
    incomingE2eRef.current = null;
  }, []);

  const waitForSignal = useCallback((
    waiters: MutableRefObject<Map<string, SignalWaiter>>,
    callId: string,
  ) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const waiter = waiters.current.get(callId);
      if (waiter?.timeout !== timeout) return;
      waiters.current.delete(callId);
      reject(new Error('Secure call signaling timed out.'));
    }, SIGNAL_WAIT_MS);
    waiters.current.set(callId, { resolve, reject, timeout });
  }), []);

  const settleSignal = useCallback((
    waiters: MutableRefObject<Map<string, SignalWaiter>>,
    callId: string,
  ) => {
    const waiter = waiters.current.get(callId);
    if (!waiter) return;
    waiters.current.delete(callId);
    clearTimeout(waiter.timeout);
    waiter.resolve();
  }, []);
  const log = useCallback(async (value: ActiveCall, status: string) => {
    if (value.incoming) return;
    const durationSec = value.startedAt ? Math.max(0, Math.round((Date.now() - value.startedAt) / 1000)) : 0;
    await apiPost('/social/v2/call-history', {
      calleeUsername: value.peer,
      callType: value.video ? 'video' : 'audio',
      status,
      durationSec,
    }).catch(() => undefined);
  }, []);
  const finish = useCallback((status: string, notify = false) => {
    const current = callRef.current;
    if (!current) return;
    if (notify) {
      if (user && deviceIdRef.current) {
        void requestCallEnd({ callId: current.callId, userId: user.id, deviceId: deviceIdRef.current })
          .catch(cause => setError(cause instanceof Error ? cause.message : 'Call termination could not be queued.'));
      }
      try { send({ type: current.incoming && current.phase === 'incoming' ? 'call-reject' : 'call-end', to: current.peer, callId: current.callId }); } catch {}
    }
    void dismissCallAlert(current.callId).catch(() => {});
    void log(current, current.startedAt ? 'answered' : status === 'no-answer' ? 'missed' : 'ended');
    callRef.current = null;
    release(current.callId);
    setCall(null);
  }, [log, release, send, user?.id]);

  const join = useCallback(async (current: ActiveCall, secret: string, deviceId: string, generation: number) => {
    const stillCurrent = () => callGenerationRef.current === generation && callRef.current?.callId === current.callId;
    await waitForCallAudio();
    if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
    const credentials = await fetchAgoraToken(current.callId, deviceId);
    if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
    const engine = createAgoraRtcEngine();
    engineRef.current = engine;
    try {
      if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
      const handler: IRtcEngineEventHandler = {
      onJoinChannelSuccess: () => { if (!stillCurrent()) return; setCall(value => value
        ? { ...value, phase: value.phase === 'active' ? 'active' : value.phase }
        : value); },
      onUserJoined: (_connection, remoteUid) => { if (stillCurrent()) setCall(value => value ? { ...value, remoteUid, phase: 'active', startedAt: value.startedAt ?? Date.now() } : value); },
      onUserOffline: () => { if (stillCurrent()) finish('completed', true); },
      onConnectionStateChanged: (_connection, state) => {
        if (!stillCurrent()) return;
        if (state === ConnectionStateType.ConnectionStateReconnecting) {
          setCall(value => value ? { ...value, phase: 'reconnecting' } : value);
        } else if (state === ConnectionStateType.ConnectionStateConnected) {
          setCall(value => value
            ? { ...value, phase: value.remoteUid !== undefined || value.phase === 'active' ? 'active' : value.phase }
            : value);
        } else if (state === ConnectionStateType.ConnectionStateFailed) {
          setError('The secure media connection failed.');
          finish('failed', true);
        }
      },
      onRequestToken: () => {
        if (!stillCurrent()) return;
        void fetchAgoraToken(current.callId, deviceId)
          .then(next => { if (stillCurrent()) engine.renewToken(next.token); })
          .catch(() => {
            if (!stillCurrent()) return;
            setError('The secure media token could not be refreshed.');
            finish('failed', true);
          });
      },
      onTokenPrivilegeWillExpire: () => {
        if (!stillCurrent()) return;
        void fetchAgoraToken(current.callId, deviceId)
          .then(next => { if (stillCurrent()) engine.renewToken(next.token); })
          .catch(() => {
            if (!stillCurrent()) return;
            setError('The secure media token could not be refreshed.');
            finish('failed', true);
          });
      },
      onError: (_code, message) => { if (!stillCurrent()) return; setError(message || 'Agora media error.'); finish('failed', true); },
      };
      if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
      engine.initialize({ appId: credentials.appId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      if (hasNativeCallAudio()) {
        // CallKit owns activation and deactivation of the audio session.
        engine.setAudioSessionOperationRestriction(AudioSessionOperationRestriction.AudioSessionOperationRestrictionDeactivateSession);
      }
      engine.registerEventHandler(handler);
      const salt = new Uint8Array(await nativeSubtle.digest(
        'SHA-256',
        new TextEncoder().encode(`gdna-agora:${current.callId}`),
      ));
      if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
      const encrypted = engine.enableEncryption(true, {
        encryptionMode: EncryptionMode.Aes256Gcm2,
        encryptionKey: secret,
        encryptionKdfSalt: Array.from(salt),
      });
      if (encrypted !== 0) {
        throw new Error('Mandatory Agora AES-256-GCM2 encryption could not be enabled.');
      }
      if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
      engine.enableAudio();
      if (current.video) {
        // Register before enabling capture: Android can emit the first camera
        // state synchronously, leaving night controls waiting forever otherwise.
        attachNightCamera(engine, current.callId);
        const videoEnabled = engine.enableVideo();
        if (videoEnabled !== 0) throw new Error(`Agora could not enable video (${videoEnabled}).`);
        const previewStarted = engine.startPreview();
        if (previewStarted !== 0) throw new Error(`Agora could not start camera preview (${previewStarted}).`);
      }
      if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
      const joined = engine.joinChannel(credentials.token, current.callId, credentials.uid, {
        publishMicrophoneTrack: true,
        publishCameraTrack: current.video,
        autoSubscribeAudio: true,
        autoSubscribeVideo: current.video,
      });
      if (joined !== 0) throw new Error(`Agora could not join the call (${joined}).`);
    } catch (cause) {
      if (engineRef.current === engine) {
        engineRef.current = null;
        detachNightCamera(current.callId);
        try { engine.stopPreview(); } catch {}
        try { engine.leaveChannel(); } catch {}
        try { engine.release(); } catch {}
      }
      throw cause;
    }
  }, [finish]);

  const beginJoin = useCallback((current: ActiveCall, deviceId: string) => {
    if (joiningCallRef.current === current.callId || engineRef.current) return;
    const secret = secretRef.current;
    if (!secret) {
      setError('The secure call key is unavailable.');
      finish('failed', true);
      return;
    }
    joiningCallRef.current = current.callId;
    const generation = callGenerationRef.current;
    setCall(value => value ? { ...value, phase: 'connecting' } : value);
    void join(current, secret, deviceId, generation).catch(cause => {
      if (callGenerationRef.current !== generation || callRef.current?.callId !== current.callId) return;
      setError(cause instanceof Error ? cause.message : 'Could not join the call.');
      finish('failed', true);
    });
  }, [finish, join]);

  const handleSignal = useCallback(async (message: Signal) => {
    if (message.type === 'session-ended') {
      setError('Your session ended. Sign in again to make calls.');
      finish('session-ended');
      return;
    }
    if (message.type === 'call-incoming' && message.callId && message.from) {
      const provider = message.transport?.provider;
      if ((provider !== 'agora' && provider !== 'webrtc') ||
          message.transport?.version !== 1 || !message.e2e ||
          (provider === 'agora' && message.offer !== null)) {
        try { send({ type: 'call-reject', to: message.from, callId: message.callId }); } catch {}
        if (user && deviceIdRef.current)
          void requestCallEnd({ callId: message.callId, userId: user.id, deviceId: deviceIdRef.current })
            .catch(cause => setError(cause instanceof Error ? cause.message : 'Call rejection could not be queued.'));
        return;
      }
      // A provider change replays the same durable invitation. It is not a
      // second call and must never trigger a busy rejection.
      if (callRef.current?.callId === message.callId) {
        incomingProviderRef.current = provider;
        if (provider === 'agora') settleSignal(providerWaitersRef, message.callId);
        return;
      }
      if (callRef.current) {
        try { send({ type: 'call-reject', to: message.from, callId: message.callId }); } catch {}
        if (user && deviceIdRef.current)
          void requestCallEnd({ callId: message.callId, userId: user.id, deviceId: deviceIdRef.current })
            .catch(cause => setError(cause instanceof Error ? cause.message : 'Call rejection could not be queued.'));
        return;
      }
      incomingE2eRef.current = message.e2e;
      incomingProviderRef.current = provider;
      const next: ActiveCall = { callId: message.callId, peer: message.from, video: !!message.video, incoming: true, phase: 'incoming' };
      callRef.current = next;
      setCall(next);
      onIncoming();
      timerRef.current = setTimeout(() => {
        finish('no-answer', true);
      }, RING_MS);
      return;
    }
    const current = callRef.current;
    if (!current || message.callId && message.callId !== current.callId) return;
    if (message.type === 'call-provider-changed' && message.transport?.provider === 'agora') {
      incomingProviderRef.current = 'agora';
      settleSignal(providerWaitersRef, current.callId);
    } else if (message.type === 'call-ready') {
      const wasWaiting = callReadyWaitersRef.current.has(current.callId);
      settleSignal(callReadyWaitersRef, current.callId);
      if (!current.incoming && !wasWaiting && deviceIdRef.current) beginJoin(current, deviceIdRef.current);
    } else if (message.type === 'call-resumed') {
      settleSignal(callResumeWaitersRef, current.callId);
    } else if (message.type === 'call-accepted') {
      clearTimer();
      if (message.transport?.provider !== 'agora' || message.transport.version !== 1 || message.answer !== null) {
        setError('The secure Agora media protocol was not accepted.');
        finish('failed', true);
        return;
      }
      answeredCallRef.current = current.callId;
      try { send({ type: 'call-heartbeat', callId: current.callId }); } catch {}
      setCall(value => value ? { ...value, phase: value.phase === 'active' ? value.phase : 'connecting' } : value);
    } else if (message.type === 'call-rejected') finish('rejected');
    else if (message.type === 'call-ended') finish(current.phase === 'active' ? 'completed' : 'ended');
    else if (message.type === 'call-busy') { setError(`${current.peer} is busy.`); finish('busy'); }
    else if (message.type === 'call-blocked') { setError('Calling is unavailable because this contact is blocked.'); finish('blocked'); }
    else if (message.type === 'call-unavailable') {
      setError(message.reason === 'secure-device-keys-changed'
        ? 'Secure devices changed. Please call again.'
        : `${current.peer} is unavailable.`);
      finish('unavailable', true);
    }
  }, [beginJoin, finish, onIncoming, send, settleSignal, user?.id]);
  const signalHandlerRef = useRef(handleSignal);
  useEffect(() => { signalHandlerRef.current = handleSignal; }, [handleSignal]);

  useEffect(() => {
    if (!user || !isOnline) return;
    const userId = user.id;
    closedRef.current = false;
    const scheduleReconnect = (connect: () => void) => {
      if (closedRef.current || !isOnline) return;
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 500);
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        connect();
      }, delay);
    };
    const connect = async () => {
      if (closedRef.current || !isOnline) return;
      let deviceId: string;
      try {
        const account = authRef.current;
        if (!account || account.id !== userId) return;
        deviceId = (await ensureDeviceIdentity(account)).deviceId;
        deviceIdRef.current = deviceId;
      } catch {
        scheduleReconnect(connect);
        return;
      }
      if (closedRef.current || !isOnline) return;
      let ws: WebSocket;
      try {
        ws = createAuthenticatedWebSocket();
      } catch {
        scheduleReconnect(connect);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', userId, username: authRef.current?.username, deviceId }));
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
          if (callRef.current && answeredCallRef.current === callRef.current.callId) {
            try { send({ type: 'call-heartbeat', callId: callRef.current.callId }); } catch {}
          }
        }, 25_000);
      };
      ws.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data)) as Signal & { userId?: number };
          if (message.type === 'registered' && message.userId !== userId) {
            ws.close(4002, 'Identity changed');
            return;
          }
          if (message.type === 'registered') {
            reconnectAttemptRef.current = 0;
            void retryPendingEnds(userId).catch(cause => setError(cause instanceof Error ? cause.message : 'Call termination retry failed.'));
            void queryClient.invalidateQueries({ queryKey: ['amis-calls', userId] });
          }
          void signalHandlerRef.current(message);
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = event => {
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = null;
        if (wsRef.current === ws) wsRef.current = null;
        if (event.code === 4001) {
          setError('Your session ended. Sign in again.');
          finish('session-ended');
        } else if (!closedRef.current) {
          scheduleReconnect(connect);
        }
      };
    };
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
      reconnectAttemptRef.current = 0;
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = null;
      wsRef.current?.close();
      deviceIdRef.current = null;
      if (callRef.current) finish('ended', true);
      else release();
    };
  }, [finish, isOnline, queryClient, release, send, user?.id]);

  const start = useCallback(async (peer: string, video: boolean) => {
    assertNetworkOnline();
    if (!user || callRef.current) return;
    const generation = callGenerationRef.current;
    const stillCurrent = () => callGenerationRef.current === generation && !callRef.current;
    setError(null);
    await permissions(video);
    if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
    const identity = await ensureDeviceIdentity(user);
    if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
    deviceIdRef.current = identity.deviceId;
    const callId = `call_${randomUrl(32)}`;
    const secret = randomUrl(32);
    const e2e = await makeOffer(peer, secret);
    if (!stillCurrent()) throw new Error('CALL_SETUP_CANCELLED');
    secretRef.current = secret;
    const next: ActiveCall = { callId, peer, video, incoming: false, phase: 'ringing' };
    callRef.current = next;
    setCall(next);
    const callReady = waitForSignal(callReadyWaitersRef, callId);
    void callReady.catch(() => {});
    try {
      send({
        type: 'call-offer',
        to: peer,
        offer: null,
        callId,
        from: user.username,
        video,
        deferredMedia: false,
        transport: AGORA_TRANSPORT,
        e2e,
      });
      timerRef.current = setTimeout(() => finish('no-answer', true), RING_MS);
      await callReady;
    } catch (cause) {
      if (callGenerationRef.current === generation && callRef.current?.callId === callId) {
        setError(cause instanceof Error ? cause.message : 'Secure call signaling timed out.');
        finish('failed', true);
      }
      throw cause;
    }
    if (callGenerationRef.current !== generation || callRef.current?.callId !== callId) throw new Error('CALL_SETUP_CANCELLED');
    beginJoin(next, identity.deviceId);
  }, [beginJoin, ensureDeviceIdentity, finish, send, user, waitForSignal]);

  const answer = useCallback(async () => {
    assertNetworkOnline();
    const current = callRef.current;
    if (!current || !user || !incomingE2eRef.current) return;
    const generation = callGenerationRef.current;
    const stillCurrent = () => callGenerationRef.current === generation && callRef.current?.callId === current.callId;
    clearTimer();
    setError(null);
    try {
      await prepareCallAnswer(current.callId);
      if (!stillCurrent()) return;
      await permissions(current.video);
      if (!stillCurrent()) return;
      const identity = await ensureDeviceIdentity(user);
      if (!stillCurrent()) return;
      const deviceId = identity.deviceId;
      deviceIdRef.current = deviceId;
      const envelope = incomingE2eRef.current.devices[deviceId];
      if (!envelope) throw new Error('This call was not encrypted for this device.');
      const secret = await decryptCallSecret(user.id, envelope);
      if (!stillCurrent()) return;
      secretRef.current = secret;
      // Native uses Agora. Negotiate that capability only after the person
      // presses Answer, without acquiring a token or joining before consent.
      if (incomingProviderRef.current === 'webrtc') {
        const switched = waitForSignal(providerWaitersRef, current.callId);
        send({ type: 'call-provider-switch', callId: current.callId, provider: 'agora' });
        await switched;
        if (!stillCurrent()) return;
      }
      const durableResume = waitForSignal(callResumeWaitersRef, current.callId);
      send({
        type: 'call-answer',
        to: current.peer,
        answer: null,
        callId: current.callId,
        deferredMedia: false,
        transport: AGORA_TRANSPORT,
      });
      send({ type: 'call-resume', callId: current.callId });
      const resumeTimer = setInterval(() => {
        try { send({ type: 'call-resume', callId: current.callId }); } catch {}
      }, 500);
      setCall(value => value ? { ...value, phase: 'connecting' } : value);
      try {
        await durableResume;
      } finally {
        clearInterval(resumeTimer);
      }
      if (!stillCurrent()) return;
      answeredCallRef.current = current.callId;
      try { send({ type: 'call-heartbeat', callId: current.callId }); } catch {}
      await join(current, secret, deviceId, generation);
    } catch (cause) {
      if (!stillCurrent()) return;
      finish('failed', true);
      setError(cause instanceof Error ? cause.message : 'Could not answer securely.');
    }
  }, [ensureDeviceIdentity, finish, join, send, user, waitForSignal]);
  const reject = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    finish('rejected', true);
  }, [finish]);
  const end = useCallback(() => finish('completed', true), [finish]);

  const testConnection = useCallback(async () => {
    assertNetworkOnline();
    setPreflight('Testing Agora last mile…');
    setError(null);
    const credentials = await apiGet<Credentials & { channel: string }>('/rtc/preflight-token');
    const engine = createAgoraRtcEngine();
    engine.initialize({ appId: credentials.appId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Agora preflight timed out.')), 35_000);
      const handler: IRtcEngineEventHandler = {
        onLastmileProbeResult: (result: LastmileProbeResult) => {
          clearTimeout(timeout);
          const loss = Math.max(result.uplinkReport?.packetLossRate ?? 0, result.downlinkReport?.packetLossRate ?? 0);
          const jitter = Math.max(result.uplinkReport?.jitter ?? 0, result.downlinkReport?.jitter ?? 0);
          const label = loss <= 2 && jitter <= 30 && (result.rtt ?? 0) <= 180 ? 'Excellent'
            : loss <= 8 && jitter <= 80 && (result.rtt ?? 0) <= 350 ? 'Usable' : 'Poor';
          setPreflight(`${label} · RTT ${result.rtt ?? '—'}ms · loss ${loss}% · jitter ${jitter}ms`);
          resolve();
        },
      };
      engine.registerEventHandler(handler);
      const code = engine.startLastmileProbeTest({
        probeUplink: true, probeDownlink: true,
        expectedUplinkBitrate: 1_000_000, expectedDownlinkBitrate: 1_000_000,
      });
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Agora preflight could not start (${code}).`));
      }
    }).finally(() => {
      engine.stopLastmileProbeTest();
      engine.release();
    }).catch(cause => {
      setPreflight(null);
      setError(cause instanceof Error ? cause.message : 'Preflight failed.');
    });
  }, []);

  return { call, error, preflight, start, answer, reject, end, testConnection };
}