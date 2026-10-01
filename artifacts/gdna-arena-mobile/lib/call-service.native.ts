import { Platform, AppState, NativeModules, DeviceEventEmitter } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  checkNativeCallPushCall, registerNativeCallPushInstallation,
  removeNativeCallPushInstallation, setBaseUrl,
} from '@workspace/api-client-react';
import { apiGet, apiPost, getApiBase, getHeaders, loadSessionCookie, type AuthUser } from './api';
import { parseCallPush, RegistrationGeneration, type CallPush, type CallAction } from './call-actions';
import { pushInstallation, providerInstallationIds } from './push-installation';

const enabledKey = (id: number) => `gdna.native.calls.enabled.${id}`;
// Android channel sound is immutable after creation; do not reuse legacy "calls".
const CALL_CHANNEL_ID = 'native-calls-ringtone-v1';
const CALL_SOUND = 'gdna_call';
const iosVoipEnabled = Constants.expoConfig?.extra?.iosVoipEnabled === true;
const IOS_VOIP_DISABLED = 'iOS VoIP calls are disabled in this build. PushKit registration and delivery are unavailable.';
const generation = new RegistrationGeneration();
let setupError: string | null = null;
let messaging: any, notifee: any, callkeep: any, voip: any;
let voipToken: string | null = null;
let enabledUser: number | null = null;
let audioActive = false;
const audioWaiters = new Set<() => void>();
const invitations = new Map<string, CallPush>();
const pending = new Map<string, CallAction>();
const processed = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
type Controller = { call: { callId: string; phase: string } | null; answer: () => Promise<void>; reject: () => void; end: () => void };
let binding: { id: number; controller: Controller; navigate: () => void } | null = null;
let actionBusy = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastOwnedCall: string | null = null;

type AndroidTelecom = {
  register(): Promise<void>;
  create(id: string, uuid: string, label: string, incoming: boolean, lifetime: number): Promise<void>;
  startAudio(id: string): Promise<void>;
  end(id: string): Promise<void>;
  drain(): Promise<{ callId: string; kind: string }[]>;
};
type FullScreenIntentBridge = { canUse: () => Promise<boolean>; openSettings: () => Promise<void> };
export class FullScreenIntentAccessError extends Error {
  constructor(message: string) { super(message); this.name = 'FullScreenIntentAccessError'; }
}
export async function canUseFullScreenIntent(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const bridge = NativeModules.GDNAFullScreenIntent as FullScreenIntentBridge | undefined;
  if (!bridge?.canUse) throw new FullScreenIntentAccessError('Full-screen call access cannot be checked in this build. Install an updated native build.');
  // The native bridge returns true on Android < 14, where this special access does not exist.
  return (await bridge.canUse()) === true;
}
export async function openFullScreenIntentSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const bridge = NativeModules.GDNAFullScreenIntent as FullScreenIntentBridge | undefined;
  if (!bridge?.openSettings) throw new FullScreenIntentAccessError('Full-screen call settings are unavailable in this build.');
  await bridge.openSettings();
}
const options = () => {
  setBaseUrl(getApiBase().replace(/\/api$/, ''));
  return { headers: getHeaders(), credentials: 'include' as const };
};
function diagnostic(error: unknown) {
  // Never log payloads, registration tokens, cookies or native error objects.
  setupError = error instanceof Error ? error.message : 'Native call setup failed.';
}
export const callSetupError = () => setupError;
export function recordCallSetupError(error: unknown) {
  if (error === null) setupError = null;
  else diagnostic(error);
}
export async function nativeCallsEnabled(userId: number): Promise<boolean> {
  if (await SecureStore.getItemAsync(enabledKey(userId)) !== 'yes') return false;
  if (Platform.OS === 'ios' && !iosVoipEnabled) throw new Error(IOS_VOIP_DISABLED);
  if (!messaging && !voip) throw new Error(setupError ?? 'Native call support unavailable in this build.');
  if (Platform.OS === 'android') {
    if ((await notifee.getNotificationSettings()).authorizationStatus < 1) return false;
    if (!await canUseFullScreenIntent()) {
      throw new FullScreenIntentAccessError('Full-screen call alerts are off in Android Settings. Allow them, then re-enable phone alerts.');
    }
  }
  return true;
}
export function resetCallAccount() {
  generation.invalidate();
  enabledUser = null;
  binding = null;
  lastOwnedCall = null;
  audioActive = false;
  if (Platform.OS === 'android' && NativeModules.GDNACallTelecom) {
    void androidTelecom().end('').catch(diagnostic);
    androidCalls.clear();
  }
  pending.clear();
  processed.clear();
  for (const uuid of invitations.keys()) void dismiss(uuid).catch(diagnostic);
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
async function registerToken(userId: number, token: string) {
  if (Platform.OS === 'ios' && !iosVoipEnabled) throw new Error(IOS_VOIP_DISABLED);
  const request = options();
  await generation.run(async current => {
    const account = await apiGet<AuthUser>('/auth/me');
    if (!current()) return;
    if (account.id !== userId || enabledUser !== userId) throw new Error('Account changed during call registration.');
    const installation = await pushInstallation();
    const id = installation.id;
    if (!id) throw new Error('Native call installation identity is unavailable.');
    if (!current()) return;
    await registerNativeCallPushInstallation({
      installationId: id, provider: Platform.OS === 'android' ? 'fcm' : 'apns-voip', token,
    }, request);
    // The backend transfers an identical native token to the shared ID. Also
    // remove a known legacy registration if its token had rotated. Retain its
    // persisted ID so a failed cleanup can be retried, including on disable.
    for (const staleId of providerInstallationIds(installation, 'native')) {
      if (staleId === id || !current()) continue;
      try { await removeNativeCallPushInstallation({ installationId: staleId }, request); }
      catch { throw new Error('Native call registration was saved, but legacy installation cleanup failed. Retry phone alert setup or disable alerts when online.'); }
    }
  });
}
export async function enableNativeCalls(userId: number) {
  generation.invalidate();
  const current = generation.capture();
  enabledUser = userId;
  try {
  if (Platform.OS === 'ios' && !iosVoipEnabled) throw new Error(IOS_VOIP_DISABLED);
  if (!messaging && !voip) throw new Error(setupError ?? 'Locked-screen calls need a native build with Firebase / PushKit configured.');
  if (Platform.OS === 'android') {
    await androidTelecom().register();
    const permission = await notifee.requestPermission();
    if (!current()) throw new Error('Call registration was cancelled.');
    if (permission.authorizationStatus < 1) throw new Error('Allow phone notifications in Settings to receive calls.');
    if (!await canUseFullScreenIntent()) throw new FullScreenIntentAccessError('Allow full-screen call alerts in Android Settings, then try again. Until then, calls cannot open full-screen.');
    if (!current()) throw new Error('Call registration was cancelled.');
    const token = await messaging.getToken();
    if (!current()) throw new Error('Call registration was cancelled.');
    await registerToken(userId, token);
  } else {
    voip.registerVoipToken();
    // PushKit registration is asynchronous; do not claim successful setup
    // until a real token has been registered under this session.
    for (let i = 0; !voipToken && i < 100 && enabledUser === userId; i++) await new Promise(r => setTimeout(r, 100));
    if (!voipToken) throw new Error('Call push registration is unavailable. Check this build’s PushKit entitlement and network.');
    if (!current()) throw new Error('Call registration was cancelled.');
    await registerToken(userId, voipToken);
  }
  if (!current() || enabledUser !== userId) throw new Error('Account changed during call registration.');
  await SecureStore.setItemAsync(enabledKey(userId), 'yes');
  if (!current()) {
    await SecureStore.deleteItemAsync(enabledKey(userId));
    throw new Error('Call registration was cancelled.');
  }
  setupError = null;
  } catch (error) {
    if (current()) { enabledUser = null; diagnostic(error); }
    throw error;
  }
}
export async function disableNativeCalls(userId: number) {
  const request = options();
  resetCallAccount();
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(enabledKey(userId)),
    generation.run(async () => {
      const installation = await pushInstallation(false);
      const removals = await Promise.allSettled(providerInstallationIds(installation, 'native')
        .map(installationId => removeNativeCallPushInstallation({ installationId }, request)));
      if (removals.some(result => result.status === 'rejected')) {
        throw new Error('Native call removal could not reach the server for every installation.');
      }
    }),
  ]);
  if (results.some(result => result.status === 'rejected')) {
    const error = new Error('Native call removal did not finish for every installation. Retry disabling phone alerts when online.');
    diagnostic(error);
    throw error;
  }
  setupError = null;
}
export async function refreshNativeCalls(userId: number) {
  const current = generation.capture();
  if (await SecureStore.getItemAsync(enabledKey(userId)) !== 'yes') return;
  if (!current()) return;
  if (Platform.OS === 'ios' && !iosVoipEnabled) throw new Error(IOS_VOIP_DISABLED);
  if (!messaging && !voip) throw new Error(setupError ?? 'Native call support unavailable in this build.');
  enabledUser = userId;
  // No permission request on startup or token refresh.
  if (Platform.OS === 'android') {
    if ((await notifee.getNotificationSettings()).authorizationStatus < 1 || !await canUseFullScreenIntent()) {
      throw new FullScreenIntentAccessError('Full-screen call alerts are not allowed in Android Settings. Re-enable phone alerts after granting access.');
    }
    if (!current()) return;
    const token = await messaging.getToken();
    if (current()) await registerToken(userId, token);
  }
  else if (voipToken) await registerToken(userId, voipToken);
  else voip.registerVoipToken();
}
async function dismiss(uuid: string) {
  uuid = uuid.toLowerCase();
  const timer = timers.get(uuid);
  if (timer) clearTimeout(timer);
  timers.delete(uuid);
  const payload = invitations.get(uuid);
  invitations.delete(uuid);
  pending.delete(uuid);
  if (Platform.OS === 'android' && notifee) await notifee.cancelNotification(uuid);
  if (Platform.OS === 'android' && payload) await endAndroidCall(payload.callId);
  if (Platform.OS === 'ios' && callkeep) callkeep.endCall(uuid);
}
function remember(data: unknown) {
  const payload = parseCallPush(data);
  if (!payload) return null;
  invitations.set(payload.callUUID, payload);
  if (timers.has(payload.callUUID)) clearTimeout(timers.get(payload.callUUID));
  timers.set(payload.callUUID, setTimeout(() => { void dismiss(payload.callUUID).catch(diagnostic); }, Math.max(0, Date.parse(payload.expiresAt) - Date.now())));
  void drain().catch(diagnostic);
  return payload;
}
async function receive(data: Record<string, unknown> | undefined) {
  if (data?.type === 'call-ended' && typeof data.callUUID === 'string') {
    const payload = invitations.get(data.callUUID.toLowerCase());
    // Confirm identity even for termination pushes; the authenticated server status
    // remains authoritative for a stale/out-of-order invitation.
    if (payload) {
      await loadSessionCookie();
      const account = await apiGet<AuthUser>('/auth/me');
      if (String(account.id) !== payload.recipientId) return;
      if (binding?.controller.call?.callId === payload.callId) binding.controller.end();
    }
    await dismiss(data.callUUID); return;
  }
  const current = generation.capture();
  const payload = parseCallPush(data);
  if (!payload || Platform.OS !== 'android') return;
  // Preferences are account-scoped and checked even in headless execution.
  if (await SecureStore.getItemAsync(enabledKey(Number(payload.recipientId))) !== 'yes') return;
  if (!current()) return;
  if (!await verified(payload) || !current()) return;
  const fullScreen = await canUseFullScreenIntent();
  if (!fullScreen) throw new FullScreenIntentAccessError('Full-screen call access is disabled. Enable it in Android Settings.');
  if (!current()) return;
  if (androidCalls.has(payload.callId)) return; // Do not re-ring an accepted duplicate.
  await androidTelecom().create(payload.callId, payload.callUUID, payload.callerName, true, Date.parse(payload.expiresAt) - Date.now());
  androidCalls.set(payload.callId, payload.callUUID);
  if (!current()) { await endAndroidCall(payload.callId); return; }
  remember(data);
  try {
  await notifee.createChannel({ id: CALL_CHANNEL_ID, name: 'Incoming calls', importance: 4, sound: CALL_SOUND, vibration: true });
  if (!current()) return;
  await notifee.displayNotification({
    id: payload.callUUID, title: payload.callerName, body: payload.hasVideo ? 'Incoming video call' : 'Incoming audio call',
    data: { ...payload, hasVideo: String(payload.hasVideo) },
    android: {
      channelId: CALL_CHANNEL_ID, category: 'call', importance: 4, ongoing: true, autoCancel: false,
      sound: CALL_SOUND, loopSound: true, timeoutAfter: Date.parse(payload.expiresAt) - Date.now(),
      pressAction: { id: 'open', launchActivity: 'default' },
       ...(fullScreen ? { fullScreenAction: { id: 'open', launchActivity: `${Constants.expoConfig?.android?.package}.GDNACallActivity` } } : {}),
      actions: [
        { title: 'Decline', pressAction: { id: 'decline' } },
        { title: 'Accept', pressAction: { id: 'answer', launchActivity: 'default' } },
      ],
    },
  });
  if (!current()) await dismiss(payload.callUUID);
  } catch (error) {
    await dismiss(payload.callUUID);
    throw error;
  }
}
async function verified(payload: CallPush, established = false) {
  const current = generation.capture();
  await loadSessionCookie();
  const account = await apiGet<AuthUser>('/auth/me');
  const authorized = String(account.id) === payload.recipientId &&
    (established || Date.parse(payload.expiresAt) > Date.now()) &&
    // Active media is owned by the authenticated WebSocket controller. The
    // push status endpoint intentionally authorizes only ringing invitations.
    (established || (await checkNativeCallPushCall(payload.callId, options())).active);
  return current() && authorized ? account : null;
}
async function action(uuid: string, kind: CallAction, data?: unknown) {
  if (typeof uuid !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(uuid)) return;
  if (data) remember(data);
  uuid = uuid.toLowerCase();
  pending.set(uuid, kind); // UUID-only CallKeep events may precede PushKit replay.
  if (!timers.has(uuid)) timers.set(uuid, setTimeout(() => { void dismiss(uuid).catch(diagnostic); }, 45_000));
  await drain();
}
async function drain() {
  if (actionBusy) return;
  actionBusy = true;
  try {
    for (const [uuid, kind] of pending) {
      const payload = invitations.get(uuid);
      if (!payload) continue;
      const key = `${uuid}:${kind}`;
      if (processed.has(key)) { pending.delete(uuid); continue; }
      const established = kind === 'end' && binding?.controller.call?.callId === payload.callId &&
        binding.controller.call.phase !== 'incoming';
       const current = generation.capture();
      const account = await verified(payload, established);
       if (!current()) continue;
      if (!account) { await dismiss(uuid); continue; }
      const owner = binding;
      if (kind === 'end') {
        if (owner?.id === account.id && owner.controller.call?.callId === payload.callId) {
          if (owner.controller.call.phase === 'incoming') owner.controller.reject();
          else owner.controller.end();
        } else await apiPost(`/call/decline?id=${encodeURIComponent(payload.callId)}`, {});
        processed.add(key);
        await dismiss(uuid);
      } else {
        if (!owner || owner.id !== account.id || AppState.currentState !== 'active') continue;
        owner.navigate();
        // Only authoritative WebSocket replay can supply the secure invitation.
        if (owner.controller.call?.callId !== payload.callId || owner.controller.call.phase !== 'incoming') continue;
        pending.delete(uuid);
        processed.add(key);
        if (Platform.OS === 'android') await notifee.cancelNotification(uuid);
        const timer = timers.get(uuid); if (timer) clearTimeout(timer);
        timers.delete(uuid);
        await owner.controller.answer();
      }
    }
  } finally {
    actionBusy = false;
    if (pending.size && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain().catch(diagnostic);
    }, 1000);
  }
}
export function bindCallController(id: number, controller: Controller, navigate: () => void) {
  const owner = { id, controller, navigate };
  binding = owner;
  for (const [uuid, payload] of invitations) {
    if (lastOwnedCall === payload.callId && controller.call?.callId !== payload.callId) void dismiss(uuid).catch(diagnostic);
    if (controller.call?.callId === payload.callId && controller.call.phase === 'active') callkeep?.setCurrentCallActive(uuid);
  }
  lastOwnedCall = controller.call?.callId ?? null;
  void drain().catch(diagnostic);
  if (Platform.OS === 'android') void drainAndroidActions().catch(diagnostic);
  return () => { if (binding === owner) binding = null; };
}
export function hasNativeCallAudio() { return Platform.OS === 'ios' && [...invitations.keys()].some(uuid => processed.has(`${uuid}:answer`)); }
export async function prepareCallAnswer(callId: string) {
  for (const [uuid, payload] of invitations) {
    if (payload.callId !== callId) continue;
    const alreadyAnswered = processed.has(`${uuid}:answer`);
    processed.add(`${uuid}:answer`);
    pending.delete(uuid);
    const timer = timers.get(uuid); if (timer) clearTimeout(timer);
    timers.delete(uuid);
    if (Platform.OS === 'ios' && !alreadyAnswered) callkeep.answerIncomingCall(uuid);
    if (Platform.OS === 'android') await notifee.cancelNotification(uuid);
  }
}
export async function waitForCallAudio() {
  if (!hasNativeCallAudio() || audioActive) return;
  await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timer); audioWaiters.delete(ready); resolve(); };
    const timer = setTimeout(() => { audioWaiters.delete(ready); reject(new Error('The system call audio session did not activate.')); }, 15000);
    audioWaiters.add(ready);
  });
}
function iosEvent(name: string, data: any) {
  if (name === 'RNCallKeepDidDisplayIncomingCall') {
    if (data.error || data.errorCode) {
      diagnostic(new Error('The system could not display this incoming call.'));
      if (typeof data.callUUID === 'string') void dismiss(data.callUUID).catch(diagnostic);
      return;
    }
    remember(data.payload);
  }
  else if (name === 'RNCallKeepPerformAnswerCallAction') void action(data.callUUID, 'answer').catch(diagnostic);
  else if (name === 'RNCallKeepPerformEndCallAction') void action(data.callUUID, 'end').catch(diagnostic);
  else if (name === 'RNCallKeepDidActivateAudioSession') {
    audioActive = true; for (const ready of audioWaiters) ready();
  }
}
// Native contract: report the payload's callUUID once, with the original payload
// (including authoritative callId) in didDisplayIncomingCall.payload. PushKit's
// notification and didLoadWithEvents replay may also supply that same payload.
// JS must NEVER call displayIncomingCall: native reports before JS cold-starts.
try {
  if (Constants.executionEnvironment === 'storeClient') throw new Error('Locked-screen calls require an installed development or release build, not Expo Go.');
  if (Platform.OS === 'android') {
    messaging = require('@react-native-firebase/messaging').default();
    notifee = require('@notifee/react-native').default;
    DeviceEventEmitter.addListener('GDNACallAction', () => { void drainAndroidActions().catch(diagnostic); });
    messaging.setBackgroundMessageHandler(async (message: any) => {
      try { await receive(message.data); } catch (error) { diagnostic(error); throw error; }
    });
    messaging.onMessage((message: any) => receive(message.data).catch(diagnostic));
    messaging.onTokenRefresh((token: string) => { if (enabledUser) void registerToken(enabledUser, token).catch(diagnostic); });
    const event = async ({ detail }: any) => {
      const id = detail.pressAction?.id;
      if (id === 'answer' || id === 'decline') await action(detail.notification.id, id === 'answer' ? 'answer' : 'end', detail.notification.data);
    };
    notifee.onBackgroundEvent(event);
    notifee.onForegroundEvent((e: any) => { void event(e).catch(diagnostic); });
    void notifee.getInitialNotification().then((initial: any) => initial && event({ detail: initial })).catch(diagnostic);
  } else if (Platform.OS === 'ios' && iosVoipEnabled) {
    if (!NativeModules.RNCallKeep || !NativeModules.RNVoipPushNotificationManager) throw new Error('This build does not include native CallKit / PushKit support.');
    callkeep = require('react-native-callkeep').default;
    voip = require('react-native-voip-push-notification').default;
    callkeep.addEventListener('didDisplayIncomingCall', (data: any) => iosEvent('RNCallKeepDidDisplayIncomingCall', data));
    callkeep.addEventListener('answerCall', (data: any) => iosEvent('RNCallKeepPerformAnswerCallAction', data));
    callkeep.addEventListener('endCall', (data: any) => iosEvent('RNCallKeepPerformEndCallAction', data));
    callkeep.addEventListener('didActivateAudioSession', () => iosEvent('RNCallKeepDidActivateAudioSession', {}));
    callkeep.addEventListener('didDeactivateAudioSession', () => { audioActive = false; });
    callkeep.addEventListener('didLoadWithEvents', (events: any[]) => events.forEach(e => iosEvent(e.name, e.data)));
    void callkeep.getInitialEvents().then((events: any[]) => {
      events.forEach(e => iosEvent(e.name, e.data));
      callkeep.clearInitialEvents();
    }).catch(diagnostic);
    const token = (value: string) => { voipToken = value; if (enabledUser) void registerToken(enabledUser, value).catch(diagnostic); };
    voip.addEventListener('register', token);
    voip.addEventListener('notification', remember);
    voip.addEventListener('didLoadWithEvents', (events: any[]) => events.forEach(e => {
      if (e.name === 'RNVoipPushRemoteNotificationsRegisteredEvent') token(e.data);
      if (e.name === 'RNVoipPushRemoteNotificationReceivedEvent') remember(e.data);
    }));
  }
  AppState.addEventListener('change', state => {
    if (state === 'active') {
      void drain().catch(diagnostic);
      if (Platform.OS === 'android') void drainAndroidActions().catch(diagnostic);
    }
  });
} catch (error) { diagnostic(error); }

const androidCalls = new Map<string, string>();

export async function prepareAndroidCall(callId: string, peer: string, incoming: boolean) {
  if (Platform.OS !== 'android') return;
  const current = generation.capture();
  let uuid = androidCalls.get(callId);
  if (!uuid) {
    uuid = [...invitations.values()].find(p => p.callId === callId)?.callUUID ?? Crypto.randomUUID();
    androidCalls.set(callId, uuid);
  }
  try {
    await androidTelecom().create(callId, uuid, peer, incoming, 60000);
    if (!current()) { await endAndroidCall(callId); throw new Error('Call account changed.'); }
  } catch (error) { androidCalls.delete(callId); throw error; }
}

async function drainAndroidActions() {
  if (Platform.OS !== 'android' || nativeDrainBusy) return;
  nativeDrainBusy = true;
  try {
    for (const event of await androidTelecom().drain()) {
      const owner = binding;
      const payload = [...invitations.values()].find(p => p.callId === event.callId);
      if (event.kind === 'answer' && payload) await action(payload.callUUID, 'answer');
      else if (event.kind === 'answer' && owner?.controller.call?.callId === event.callId) {
        if (AppState.currentState === 'active' && owner.controller.call.phase === 'incoming') await owner.controller.answer();
      } else {
        if (event.kind === 'interrupted' || event.kind === 'unavailable')
          diagnostic(new Error('Android interrupted the call or could not allocate Telecom audio.'));
        if (owner?.controller.call?.callId === event.callId) owner.controller.end();
        if (payload) await action(payload.callUUID, 'end');
      }
    }
  } finally { nativeDrainBusy = false; }
}

export async function startAndroidCallAudio(callId: string) {
  if (Platform.OS !== 'android') return;
  if (AppState.currentState !== 'active') throw new Error('Open the call screen to enable microphone audio.');
  await androidTelecom().startAudio(callId);
}

export async function endAndroidCall(callId: string) {
  if (Platform.OS !== 'android') return;
  androidCalls.delete(callId);
  await androidTelecom().end(callId);
}

let nativeDrainBusy = false;

function androidTelecom(): AndroidTelecom {
  const bridge = NativeModules.GDNACallTelecom as AndroidTelecom | undefined;
  if (!bridge) throw new Error('Android Telecom is unavailable. Install an updated native build.');
  return bridge;
}
