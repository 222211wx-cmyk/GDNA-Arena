import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { PhoneRecoveryPlatform, PhoneRecoverySession } from './phone-recovery';

let sessionSequence = 0;

export function phoneRecoveryPlatform(): PhoneRecoveryPlatform {
  return Platform.OS === 'android' ? 'android' : 'unsupported';
}

/**
 * Recovery never signs in to the default Firebase app used by call/push auth.
 * Tokens and SMS verification state stay in this short-lived closure, not React
 * state, secure storage, URLs, analytics, or logs. Native Firebase itself manages
 * its auth cache; sign-out and app deletion clear this separate recovery session.
 */
export async function createPhoneRecoverySession(expectedProjectId: string): Promise<PhoneRecoverySession> {
  if (Platform.OS !== 'android') {
    throw new Error('Native SMS recovery is not supported on iOS. Use the website instead.');
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('SMS recovery requires a rebuilt Android app with Firebase Auth. It is not available in Expo Go.');
  }
  const [apps, sdk] = await Promise.all([
    import('@react-native-firebase/app'),
    import('@react-native-firebase/auth'),
  ]);
  const options = apps.getApp().options;
  if (!expectedProjectId || options.projectId !== expectedProjectId) {
    throw new Error('The Android Firebase project does not match the recovery server. The owner must align google-services.json and the server Firebase configuration before rebuilding.');
  }
  const app = await apps.initializeApp(options, {
    name: `gdna-phone-recovery-${Date.now()}-${++sessionSequence}`,
    automaticDataCollectionEnabled: false,
  });
  let auth: ReturnType<typeof sdk.getAuth>;
  try { auth = sdk.getAuth(app); }
  catch (error) { await apps.deleteApp(app); throw error; }
  let closed = false;
  let busy = false;
  let verificationId: string | null = null;
  let automaticallyVerified = false;
  let automaticallyRetrievedCode: string | null = null;
  let expectedPhone: string | null = null;
  let notifyAutomaticallyVerified: (() => void) | null = null;
  let cancelSending: (() => void) | null = null;
  let closePromise: Promise<void> | null = null;
  let nativeOperation: Promise<unknown> | null = null;

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    verificationId = null;
    automaticallyRetrievedCode = null;
    automaticallyVerified = false;
    expectedPhone = null;
    notifyAutomaticallyVerified = null;
    cancelSending?.();
    cancelSending = null;
    closePromise = (async () => {
      // A late native confirmation must finish before sign-out. Otherwise
      // leaving the screen mid-SMS could sign the recovery app in after cleanup.
      if (nativeOperation) await nativeOperation.catch(() => {});
      try { await sdk.signOut(auth); }
      finally { await apps.deleteApp(app); }
    })();
    return closePromise;
  };

  try {
    // A proof always requires fresh phone authentication.
    await sdk.signOut(auth);
  } catch (error) {
    await close();
    throw error;
  }

  return {
    async send(phone, onAutomaticallyVerified) {
      if (closed || busy || expectedPhone) throw new Error('Start a new SMS verification before continuing.');
      busy = true;
      expectedPhone = phone;
      notifyAutomaticallyVerified = onAutomaticallyVerified;
      try {
        // Unlike signInWithPhoneNumber, this API does not automatically sign in
        // after onCodeSent resolves. Late native auto-retrieval events therefore
        // cannot recreate a signed-in recovery session after leaving the screen.
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (failure?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cancelSending = null;
            if (failure) reject(failure); else resolve();
          };
          const timer = setTimeout(() => finish(new Error('Phone verification timed out. Check your connection and request a new SMS.')), 90_000);
          cancelSending = () => finish(new Error('Phone verification was cancelled.'));
          sdk.verifyPhoneNumber(auth, phone, 60, true).on('state_changed', snapshot => {
            if (closed) return;
            if (snapshot.state === 'error') {
              finish(snapshot.error ?? new Error('Firebase could not verify this phone number.'));
              return;
            }
            if (snapshot.verificationId) verificationId = snapshot.verificationId;
            if (snapshot.state === 'verified') {
              automaticallyVerified = true;
              automaticallyRetrievedCode = snapshot.code;
              notifyAutomaticallyVerified?.();
              finish();
            } else if ((snapshot.state === 'sent' || snapshot.state === 'timeout') && verificationId) {
              finish();
            }
          }, failure => finish(failure));
        });
        if (closed) throw new Error('Phone verification was cancelled.');
      } catch (error) {
        await close();
        throw error;
      } finally {
        busy = false;
      }
    },
    async submit(code, consumeProof) {
      if (closed || busy || (!verificationId && !automaticallyVerified) || !expectedPhone) {
        throw new Error('Phone verification expired. Request a new SMS code.');
      }
      busy = true;
      try {
        // Android can genuinely verify a number without manual code entry.
        // Never substitute a local or test code for that native credential.
        // A genuine Android instant-verification snapshot can have a null ID:
        // RNFirebase then uses its native cached PhoneAuthCredential. The exact
        // resulting phone is checked before exposing any proof to the API.
        const credential = sdk.PhoneAuthProvider.credential(
          verificationId!, automaticallyRetrievedCode ?? code,
        );
        const verifying = sdk.signInWithCredential(auth, credential);
        nativeOperation = verifying;
        const result = await verifying;
        if (closed) throw new Error('Phone verification was cancelled.');
        if (!result?.user || result.user.phoneNumber !== expectedPhone) {
          throw new Error('The verified phone number does not match this request.');
        }
        const tokenRequest = sdk.getIdToken(result.user, true);
        nativeOperation = tokenRequest;
        let idToken: string | null = await tokenRequest;
        try {
          if (closed) throw new Error('Phone verification was cancelled.');
          if (!idToken) throw new Error('Firebase did not return a phone verification proof.');
          return await consumeProof(idToken);
        } finally {
          idToken = null;
        }
      } finally {
        // A submitted challenge is single-use even when the API rejects it.
        busy = false;
        await close();
      }
    },
    close,
  };
}
