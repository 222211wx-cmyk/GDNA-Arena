import * as Notifications from 'expo-notifications';
import * as Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { apiGet, getApiBase, getHeaders, type AuthUser } from '@/lib/api';
import {
  checkExpoPushCall,
  registerExpoPushInstallation,
  removeExpoPushInstallation,
  setBaseUrl,
} from '@workspace/api-client-react';
import { createPushTapGuard, resolvePushTap } from '@/lib/push-tap';
import { enableNativeCalls, disableNativeCalls, refreshNativeCalls, canUseFullScreenIntent, FullScreenIntentAccessError } from './call-service';
import { RegistrationGeneration } from './call-actions';

const ID_KEY = 'gdna.expo.push.installation';
const enabledKey = (id: number) => `gdna.expo.push.enabled.${id}`;
function expoProjectId(): string {
  const id = Constants.default.expoConfig?.extra?.eas?.projectId ?? Constants.default.easConfig?.projectId;
  if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) {
    throw new Error('Expo project ID is missing. Configure extra.eas.projectId in app.json and rebuild the installed app.');
  }
  return id;
}
function apiOptions() {
  setBaseUrl(getApiBase().replace(/\/api$/, ''));
  return { headers: getHeaders(), credentials: 'include' as const };
}
let tapSubscription: Notifications.EventSubscription | null = null;
const guardedTap = createPushTapGuard();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

async function installationId(): Promise<string> {
  let id = await SecureStore.getItemAsync(ID_KEY);
  if (!id) {
    id = Crypto.randomUUID().replace(/-/g, '');
    await SecureStore.setItemAsync(ID_KEY, id);
  }
  return id;
}

export async function pushEnabled(userId: number): Promise<boolean> {
  if ((await SecureStore.getItemAsync(enabledKey(userId))) !== 'yes') return false;
  try { expoProjectId(); } catch { return false; }
  if (!(await Notifications.getPermissionsAsync()).granted) return false;
  if (!await canUseFullScreenIntent()) {
    throw new FullScreenIntentAccessError('Full-screen call alerts are off in Android Settings. Allow them, then re-enable phone alerts.');
  }
  return true;
}

export async function enablePush(userId: number): Promise<void> {
  const current = registration.capture();
  const request = apiOptions();
  const projectId = expoProjectId();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('amis', {
      name: 'Amis', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  const granted = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!granted.granted) throw new Error('Notifications are off. Allow notifications in your phone settings, then try again.');
  const fresh = await apiGet<AuthUser>('/auth/me');
  if (fresh.id !== userId) throw new Error('Account changed. Sign in again before enabling notifications.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$/.test(token.data)) {
    throw new Error('Expo did not return a valid push token.');
  }
  if (!current()) throw new Error('Notification registration was cancelled.');
  try {
    await enableNativeCalls(userId);
    if (!current()) throw new Error('Notification registration was cancelled.');
    await registration.run(async valid => {
      if (!valid()) return;
      await registerExpoPushInstallation({ installationId: await installationId(), token: token.data }, request);
    });
  } catch (error) {
    if (current()) {
      try { await disableNativeCalls(userId); }
      catch { throw new Error('Notification setup failed and registration cleanup could not reach the server. Retry disabling phone alerts when online.'); }
    }
    throw error;
  }
  if (!current()) throw new Error('Notification registration was cancelled.');
  await SecureStore.setItemAsync(enabledKey(userId), 'yes');
  if (!current()) await SecureStore.deleteItemAsync(enabledKey(userId));
}

export async function disablePush(userId: number): Promise<void> {
  registration.invalidate();
  const request = apiOptions();
  await SecureStore.deleteItemAsync(enabledKey(userId));
  await disableNativeCalls(userId);
  await registration.run(async () => {
    const id = await SecureStore.getItemAsync(ID_KEY);
    if (id) await removeExpoPushInstallation({ installationId: id }, request);
  });
}

export async function forgetPushOnLogout(userId: number): Promise<void> {
  await disablePush(userId);
}

export async function refreshPushIfAllowed(userId: number): Promise<void> {
  const current = registration.capture();
  const request = apiOptions();
  if (!await pushEnabled(userId)) return;
  if (!current()) return;
  await refreshNativeCalls(userId);
  const token = await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId() });
  if (!current()) return;
  await registration.run(async valid => {
    if (valid()) await registerExpoPushInstallation({ installationId: await installationId(), token: token.data }, request);
  });
}

async function dismissStaleCallAlerts(): Promise<void> {
  const account = await apiGet<AuthUser>('/auth/me');
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const item of presented) {
    const data = item.request.content.data;
    if (!data) continue;
    if ((data.type !== 'call' && data.type !== 'group-call') || data.recipientId !== String(account.id)) continue;
    let active = false;
    try {
      if (typeof data.callId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.callId)) continue;
      if (data.type === 'call') {
        active = (await checkExpoPushCall(data.callId, apiOptions())).active;
      } else {
        const result = await apiGet<{ call: { status: string } }>(`/communication/groups/${data.callId}`);
        active = result.call.status === 'active';
      }
    } catch { continue; } // Offline is not evidence that the call ended.
    if (!active) await Notifications.dismissNotificationAsync(item.request.identifier);
  }
}

/** Only dismiss the specific direct-call alert; never cancel unrelated notifications. */
export async function dismissCallAlert(callId: string): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const item of presented) {
    const data = item.request.content.data;
    if (data?.type === 'call' && data.callId === callId) {
      await Notifications.dismissNotificationAsync(item.request.identifier);
    }
  }
}

export function listenForPushTaps(navigate: (path: string) => void): () => void {
  const handle = async (response: Notifications.NotificationResponse) => {
    const request = response.notification.request;
    const data = request.content.data;
    if (!data) return;
    try {
      const route = await guardedTap(request.identifier, async () => {
        const account = await apiGet<AuthUser>('/auth/me');
        if (!await pushEnabled(account.id)) return null;
        return resolvePushTap(data, account.id,
          async roomId => { await apiGet(`/messages/rooms/${roomId}`); },
          async callId => (await checkExpoPushCall(callId, apiOptions())).active,
          async (callId, roomId) => {
            const result = await apiGet<{ call: { status: string; roomId: number; participants: { userId: number; status: string }[] } }>(`/communication/groups/${callId}`);
            return result.call.status === 'active' && result.call.roomId === roomId &&
              result.call.participants.some(person => person.userId === account.id && person.status === 'invited');
          },
        );
      });
      if (route) navigate(route);
    } catch {
      // Never navigate on an expired/offline session or inaccessible room/call.
    }
  };
  tapSubscription?.remove();
  tapSubscription = Notifications.addNotificationResponseReceivedListener(response => { void handle(response); });
  void Notifications.getLastNotificationResponseAsync().then(response => { if (response) void handle(response); });
  const appState = AppState.addEventListener('change', state => {
    if (state === 'active') void dismissStaleCallAlerts().catch(() => {});
  });
  void dismissStaleCallAlerts().catch(() => {});
  return () => { tapSubscription?.remove(); tapSubscription = null; appState.remove(); };
}

const registration = new RegistrationGeneration();
