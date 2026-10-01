import * as Notifications from 'expo-notifications';
import * as Constants from 'expo-constants';
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
import { enableNativeCalls, disableNativeCalls, refreshNativeCalls, nativeCallsEnabled, recordCallSetupError } from './call-service';
import { RegistrationGeneration } from './call-actions';
import { pushInstallation, providerInstallationIds } from './push-installation';

const enabledKey = (id: number) => `gdna.expo.push.enabled.${id}`;
const nativeEnabledKey = (id: number) => `gdna.native.calls.enabled.${id}`;
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

export async function pushEnabled(userId: number): Promise<boolean> {
  // Phone-call enrollment is not evidence of Expo enrollment, or vice versa.
  // In particular an optional Expo project/token failure must not hide FCM opt-in.
  if (Platform.OS === 'android') return nativeCallsEnabled(userId);
  // Retain the existing generic-alert status on iOS; deferred VoIP still
  // explicitly fails enrollment in the native call service.
  try { expoProjectId(); } catch { return false; }
  return expoAlertsEnabled(userId);
}

async function expoAlertsEnabled(userId: number): Promise<boolean> {
  if ((await SecureStore.getItemAsync(enabledKey(userId))) !== 'yes') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

async function registerExpoAlerts(userId: number, current: () => boolean, request: ReturnType<typeof apiOptions>, askPermission: boolean): Promise<void> {
  const projectId = expoProjectId();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('amis', {
      name: 'Amis', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!current()) throw new Error('Notification registration was cancelled.');
  const granted = permission.granted || !askPermission ? permission : await Notifications.requestPermissionsAsync();
  if (!granted.granted) throw new Error('Notifications are off. Allow notifications in your phone settings, then try again.');
  const fresh = await apiGet<AuthUser>('/auth/me');
  if (fresh.id !== userId) throw new Error('Account changed. Sign in again before enabling notifications.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$/.test(token.data)) {
    throw new Error('Expo did not return a valid push token.');
  }
  if (!current()) throw new Error('Notification registration was cancelled.');
  await registration.run(async valid => {
    if (!valid() || !current()) return;
    const installation = await pushInstallation();
    if (!valid() || !current()) return;
    if (!installation.id) throw new Error('Expo notification installation identity is unavailable.');
    // Do not move an existing Expo subscription to a different ID: unlike
    // native registration the server does not deduplicate Expo tokens.
    if (installation.expoId !== installation.id) {
      throw new Error('Existing Expo notification identities conflict. Generic alerts need server-side reconciliation before re-registration.');
    }
    await registerExpoPushInstallation({ installationId: installation.id, token: token.data }, request);
  });
  if (!current()) throw new Error('Notification registration was cancelled.');
  await SecureStore.setItemAsync(enabledKey(userId), 'yes');
  if (!current()) await SecureStore.deleteItemAsync(enabledKey(userId));
}

function optionalExpoError(error: unknown): Error {
  const reason = error instanceof Error ? error.message : 'Expo registration unavailable.';
  return new Error(`Native call enrollment is saved, but generic phone alert registration is incomplete. ${reason}`);
}

export async function enablePush(userId: number): Promise<void> {
  const current = registration.capture();
  const request = apiOptions();
  const fresh = await apiGet<AuthUser>('/auth/me');
  if (fresh.id !== userId) throw new Error('Account changed. Sign in again before enabling notifications.');
  if (!current()) throw new Error('Notification registration was cancelled.');
  // FCM/PushKit is the call transport. No Expo configuration or network call
  // may precede it, and an optional alert failure must never revoke it.
  await enableNativeCalls(userId);
  if (!current()) throw new Error('Notification registration was cancelled.');
  try {
    await registerExpoAlerts(userId, current, request, true);
  } catch (error) {
    if (!current()) throw new Error('Notification registration was cancelled.');
    if (Platform.OS !== 'android') throw error;
    recordCallSetupError(optionalExpoError(error));
    // Android native opt-in succeeded; the existing status display reports
    // the separate optional-alert error rather than claiming complete setup.
  }
  if (!current()) throw new Error('Notification registration was cancelled.');
}

export async function disablePush(userId: number): Promise<void> {
  registration.invalidate();
  const request = apiOptions();
  // Failure to remove one provider must not skip removal of the other.
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(enabledKey(userId)),
    disableNativeCalls(userId),
    registration.run(async () => {
      const installation = await pushInstallation(false);
      const removals = await Promise.allSettled(providerInstallationIds(installation, 'expo')
        .map(installationId => removeExpoPushInstallation({ installationId }, request)));
      if (removals.some(result => result.status === 'rejected')) {
        throw new Error('Expo notification removal could not reach the server for every installation.');
      }
    }),
  ]);
  if (results.some(result => result.status === 'rejected')) {
    const error = new Error('Phone alert removal did not finish for every provider. Retry disabling phone alerts when online.');
    recordCallSetupError(error);
    throw error;
  }
}

export async function forgetPushOnLogout(userId: number): Promise<void> {
  await disablePush(userId);
}

export async function refreshPushIfAllowed(userId: number): Promise<void> {
  const current = registration.capture();
  const request = apiOptions();
  // Refresh the native opt-in even if Expo never registered or its project
  // configuration has since become unavailable. Neither path prompts here.
  await refreshNativeCalls(userId);
  if (!current()) return;
  const nativeAllowed = await SecureStore.getItemAsync(nativeEnabledKey(userId)) === 'yes';
  const expoAllowed = await SecureStore.getItemAsync(enabledKey(userId)) === 'yes';
  if (!current() || (!nativeAllowed && !expoAllowed)) return;
  try {
    await registerExpoAlerts(userId, current, request, false);
    if (nativeAllowed && current()) recordCallSetupError(null);
  } catch (error) {
    if (!current()) return;
    const failure = Platform.OS === 'android' && nativeAllowed ? optionalExpoError(error) : error;
    recordCallSetupError(failure);
    throw failure;
  }
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
        if (!await expoAlertsEnabled(account.id)) return null;
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
