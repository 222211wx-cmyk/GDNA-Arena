import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { subtle as nativeSubtle } from 'react-native-quick-crypto';
import {
  ChannelProfileType,
  ConnectionStateType,
  createAgoraRtcEngine,
  EncryptionMode,
  RtcSurfaceView,
  type IRtcEngine,
  type IRtcEngineEventHandler,
  type LastmileProbeResult,
} from 'react-native-agora';
import { apiGet, apiPost, createAuthenticatedWebSocket, type AuthUser } from './api';
import { assertNetworkOnline, useOnline } from '@/contexts/OnlineContext';
import {
  decryptCallSecret,
  encryptCallSecret,
  getCurrentDeviceId,
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
  e2e?: E2eOffer;
  message?: string;
};
type Credentials = { appId: string; token: string; uid: number; channel?: string };

const RING_MS = 30_000;
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

export function useAgoraCalls(user: AuthUser | null, onIncoming: () => void) {
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

  useEffect(() => { callRef.current = call; }, [call]);
  const send = useCallback((value: object) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error('Call signaling is reconnecting.');
    wsRef.current.send(JSON.stringify(value));
  }, []);
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const release = useCallback(() => {
    clearTimer();
    callRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) {
      engine.stopPreview();
      engine.leaveChannel();
      engine.release();
    }
    secretRef.current = null;
    incomingE2eRef.current = null;
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
    callRef.current = null;
    if (notify) {
      try { send({ type: 'call-end', to: current.peer, callId: current.callId }); } catch { /* teardown locally */ }
    }
    void log(current, current.startedAt ? 'answered' : status === 'no-answer' ? 'missed' : 'ended');
    release();
    setCall(null);
  }, [log, release, send]);

  const join = useCallback(async (current: ActiveCall, secret: string) => {
    await permissions(current.video);
    const credentials = await apiGet<Credentials>(
      `/rtc/agora-token?channel=${encodeURIComponent(current.callId)}`,
    );
    const engine = createAgoraRtcEngine();
    const handler: IRtcEngineEventHandler = {
      onJoinChannelSuccess: () => setCall(value => value ? { ...value, phase: 'active', startedAt: value.startedAt ?? Date.now() } : value),
      onUserJoined: (_connection, remoteUid) => setCall(value => value ? { ...value, remoteUid, phase: 'active', startedAt: value.startedAt ?? Date.now() } : value),
      onUserOffline: () => finish('completed', true),
      onConnectionStateChanged: (_connection, state) => {
        if (state === ConnectionStateType.ConnectionStateReconnecting) {
          setCall(value => value ? { ...value, phase: 'reconnecting' } : value);
        } else if (state === ConnectionStateType.ConnectionStateConnected) {
          setCall(value => value ? { ...value, phase: 'active' } : value);
        } else if (state === ConnectionStateType.ConnectionStateFailed) {
          setError('The secure media connection failed.');
          finish('failed');
        }
      },
      onError: (_code, message) => setError(message || 'Agora media error.'),
    };
    engine.initialize({ appId: credentials.appId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
    engine.registerEventHandler(handler);
    const salt = new Uint8Array(await nativeSubtle.digest(
      'SHA-256',
      new TextEncoder().encode(`gdna-agora:${current.callId}`),
    ));
    const encrypted = engine.enableEncryption(true, {
      encryptionMode: EncryptionMode.Aes256Gcm2,
      encryptionKey: secret,
      encryptionKdfSalt: Array.from(salt),
    });
    if (encrypted !== 0) {
      engine.release();
      throw new Error('Mandatory Agora AES-256-GCM2 encryption could not be enabled.');
    }
    engine.enableAudio();
    if (current.video) {
      engine.enableVideo();
      engine.startPreview();
    }
    engineRef.current = engine;
    const joined = engine.joinChannel(credentials.token, current.callId, credentials.uid, {
      publishMicrophoneTrack: true,
      publishCameraTrack: current.video,
      autoSubscribeAudio: true,
      autoSubscribeVideo: current.video,
    });
    if (joined !== 0) throw new Error(`Agora could not join the call (${joined}).`);
  }, [finish]);

  const handleSignal = useCallback(async (message: Signal) => {
    if (message.type === 'session-ended') {
      setError('Your session ended. Sign in again to make calls.');
      finish('session-ended');
      return;
    }
    if (message.type === 'call-incoming' && message.callId && message.from && message.e2e) {
      if (callRef.current) {
        send({ type: 'call-reject', to: message.from, callId: message.callId });
        return;
      }
      incomingE2eRef.current = message.e2e;
      const next: ActiveCall = { callId: message.callId, peer: message.from, video: !!message.video, incoming: true, phase: 'incoming' };
      callRef.current = next;
      setCall(next);
      onIncoming();
      timerRef.current = setTimeout(() => {
        try { send({ type: 'call-reject', to: message.from!, callId: message.callId! }); } catch {}
        release();
        setCall(null);
      }, RING_MS);
      return;
    }
    const current = callRef.current;
    if (!current || message.callId && message.callId !== current.callId) return;
    if (message.type === 'call-accepted') {
      clearTimer();
      setCall(value => value ? { ...value, phase: 'connecting' } : value);
      try { await join(current, secretRef.current!); } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not join the call.');
        finish('failed', true);
      }
    } else if (message.type === 'call-rejected') finish('rejected');
    else if (message.type === 'call-ended') finish(current.phase === 'active' ? 'completed' : 'ended');
    else if (message.type === 'call-busy') { setError(`${current.peer} is busy.`); finish('busy'); }
    else if (message.type === 'call-blocked') { setError('Calling is unavailable because this contact is blocked.'); finish('blocked'); }
    else if (message.type === 'call-unavailable') {
      setError(message.reason === 'secure-device-keys-changed'
        ? 'Secure devices changed. Please call again.'
        : `${current.peer} is unavailable.`);
      finish('unavailable');
    }
  }, [finish, join, onIncoming, release, send]);
  const signalHandlerRef = useRef(handleSignal);
  useEffect(() => { signalHandlerRef.current = handleSignal; }, [handleSignal]);

  useEffect(() => {
    if (!user || !isOnline) return;
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
    const connect = () => {
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
        ws.send(JSON.stringify({ type: 'register', userId: user.id, username: user.username }));
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };
      ws.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data)) as Signal & { userId?: number };
          if (message.type === 'registered' && message.userId !== user.id) {
            ws.close(4002, 'Identity changed');
            return;
          }
          if (message.type === 'registered') {
            reconnectAttemptRef.current = 0;
            void queryClient.invalidateQueries({ queryKey: ['amis-calls', user.id] });
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
      release();
    };
  }, [finish, isOnline, queryClient, release, user]);

  const start = useCallback(async (peer: string, video: boolean) => {
    assertNetworkOnline();
    if (!user || callRef.current) return;
    setError(null);
    await permissions(video);
    const callId = `call_${randomUrl(32)}`;
    const secret = randomUrl(32);
    const e2e = await makeOffer(peer, secret);
    secretRef.current = secret;
    const next: ActiveCall = { callId, peer, video, incoming: false, phase: 'ringing' };
    callRef.current = next;
    setCall(next);
    send({ type: 'call-offer', to: peer, offer: null, callId, video, e2e });
    timerRef.current = setTimeout(() => finish('no-answer', true), RING_MS);
  }, [finish, send, user]);

  const answer = useCallback(async () => {
    assertNetworkOnline();
    const current = callRef.current;
    if (!current || !user || !incomingE2eRef.current) return;
    clearTimer();
    setError(null);
    try {
      await permissions(current.video);
      const deviceId = await getCurrentDeviceId(user.id);
      if (!deviceId) throw new Error('No secure device identity is available.');
      const envelope = incomingE2eRef.current.devices[deviceId];
      if (!envelope) throw new Error('This call was not encrypted for this device.');
      const secret = await decryptCallSecret(user.id, envelope);
      secretRef.current = secret;
      send({ type: 'call-answer', to: current.peer, answer: null, callId: current.callId });
      setCall(value => value ? { ...value, phase: 'connecting' } : value);
      await join(current, secret);
    } catch (cause) {
      try { send({ type: 'call-reject', to: current.peer, callId: current.callId }); } catch {}
      release();
      setCall(null);
      setError(cause instanceof Error ? cause.message : 'Could not answer securely.');
    }
  }, [join, release, send, user]);
  const reject = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    try { send({ type: 'call-reject', to: current.peer, callId: current.callId }); } catch {}
    release();
    setCall(null);
  }, [release, send]);
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