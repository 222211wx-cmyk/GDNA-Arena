import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SHARED_ID_KEY = 'gdna.push.installation';
const EXPO_ID_KEY = 'gdna.expo.push.installation';
const NATIVE_ID_KEY = 'gdna.native.calls.installation';
type Installation = { id: string | null; expoId: string | null; nativeId: string | null };
let tail: Promise<unknown> = Promise.resolve();

/** Keep legacy identities available for provider-scoped cleanup; never discard them. */
export function pushInstallation(create = true): Promise<Installation> {
  const result = tail.then(async () => {
    const [sharedId, expoId, nativeId] = await Promise.all([
      SecureStore.getItemAsync(SHARED_ID_KEY),
      SecureStore.getItemAsync(EXPO_ID_KEY),
      SecureStore.getItemAsync(NATIVE_ID_KEY),
    ]);
    // Prefer the existing Expo identity: native registration already transfers
    // duplicate FCM tokens atomically, while Expo registration does not.
    const id = sharedId ?? expoId ?? nativeId ?? (create ? Crypto.randomUUID() : null);
    if (create && id) {
      if (!sharedId) await SecureStore.setItemAsync(SHARED_ID_KEY, id);
      if (!expoId) await SecureStore.setItemAsync(EXPO_ID_KEY, id);
      if (!nativeId) await SecureStore.setItemAsync(NATIVE_ID_KEY, id);
    }
    return { id, expoId: expoId ?? id, nativeId: nativeId ?? id };
  });
  // Concurrent enrollment/token refresh must not generate different identities.
  tail = result.catch(() => undefined);
  return result;
}

export function providerInstallationIds(installation: Installation, provider: 'expo' | 'native'): string[] {
  return [...new Set([installation.id, provider === 'expo' ? installation.expoId : installation.nativeId]
    .filter((id): id is string => id !== null))];
}