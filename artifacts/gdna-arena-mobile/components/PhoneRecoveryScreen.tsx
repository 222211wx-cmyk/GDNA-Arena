import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  bindRecoveryPhone, getRecoveryConfig, removeRecoveryPhone, resetRecoveryPassword, setBaseUrl, useGetRecoveryPhone,
} from '@workspace/api-client-react';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { assertNetworkOnline } from '@/contexts/OnlineContext';
import { apiGet, getApiBase, getHeaders, type AuthUser } from '@/lib/api';
import {
  createPhoneRecoverySession, phoneRecoveryPlatform, type PhoneRecoverySession,
} from '@/lib/phone-recovery';
import {
  phoneRecoveryErrorMessage, recoveryPasswordValid, recoveryWebsiteUrl,
} from '@/lib/phone-recovery-links';

type Action = 'bind' | 'remove';
type Props = { mode: 'reset' | 'settings' };

export function PhoneRecoveryScreen({ mode }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const platform = phoneRecoveryPlatform();
  const isNative = platform === 'android';
  const isSettings = mode === 'settings';
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [action, setAction] = useState<Action>('bind');
  const [step, setStep] = useState<'phone' | 'code' | 'success'>('phone');
  const [automaticallyVerified, setAutomaticallyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const session = useRef<PhoneRecoverySession | null>(null);
  const generation = useRef(0);
  const operationBusy = useRef(false);
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const ownerId = user?.id;
  const phoneQueryKey = ['recovery-phone', ownerId] as const;
  if (isNative) setBaseUrl(getApiBase().replace(/\/api$/, ''));
  const recoveryRequestOptions = () => {
    assertNetworkOnline();
    setBaseUrl(getApiBase().replace(/\/api$/, ''));
    return { headers: getHeaders(), credentials: 'include' as const, cache: 'no-store' as const };
  };
  const status = useGetRecoveryPhone({
    query: {
      queryKey: phoneQueryKey,
      enabled: isSettings && isNative && !!ownerId,
      retry: false,
      staleTime: 0,
    },
    request: { headers: getHeaders(), credentials: 'include', cache: 'no-store' },
  });

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setConsent(false);
    setStep('phone');
    setAutomaticallyVerified(false);
    setError('');
    setBusy(false);
    operationBusy.current = false;
    return () => {
      generation.current += 1;
      const prior = session.current;
      session.current = null;
      // Cleanup failures are surfaced while this screen remains mounted; never
      // log a Firebase object, credential, password, number, or token on exit.
      if (prior) void prior.close().catch(() => {});
    };
  }, [mode, ownerId]);

  const closeChallenge = async () => {
    generation.current += 1;
    const prior = session.current;
    session.current = null;
    setCode('');
    setAutomaticallyVerified(false);
    if (prior) await prior.close();
  };

  const validate = (): string | null => {
    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) return 'Enter the full phone number with + and country calling code (8–15 digits).';
    if (isSettings) {
      if (!password) return 'Enter your current account password.';
      if (!status.data) return 'Load your current recovery-number status before continuing.';
    } else {
      if (!recoveryPasswordValid(password)) return 'Your new password must have at least 6 characters and at most 72 UTF-8 bytes.';
      if (password !== confirmPassword) return 'The new passwords do not match.';
    }
    if (!consent) return 'Confirm that you agree to SMS phone verification before requesting a code.';
    return null;
  };

  const sendCode = async () => {
    if (operationBusy.current || cooldown > 0) return;
    const validation = validate();
    if (validation) { setError(validation); return; }
    operationBusy.current = true;
    setBusy(true);
    setError('');
    const requestGeneration = ++generation.current;
    const isCurrent = () => requestGeneration === generation.current;
    let candidate: PhoneRecoverySession | null = null;
    try {
      assertNetworkOnline();
      const prior = session.current;
      session.current = null;
      if (prior) await prior.close();
      if (!isCurrent()) return;
      const config = await getRecoveryConfig(recoveryRequestOptions());
      if (!isCurrent()) return;
      if (!config.configured || !config.firebaseConfig?.projectId) {
        throw new Error('SMS recovery is unavailable. The owner must configure Firebase phone recovery on the server before requesting verification.');
      }
      candidate = await createPhoneRecoverySession(config.firebaseConfig.projectId);
      if (!isCurrent()) { await candidate.close(); return; }
      session.current = candidate;
      setClock(Date.now());
      setCooldownUntil(Date.now() + 60_000);
      await candidate.send(phone.trim(), () => {
        if (isCurrent()) setAutomaticallyVerified(true);
      });
      if (!isCurrent()) return;
      setCode('');
      setStep('code');
    } catch (failure) {
      let cleanupMessage = '';
      if (candidate) {
        session.current = null;
        try { await candidate.close(); }
        catch { cleanupMessage = ' Could not clear phone verification. Close and reopen the Android app before trying again.'; }
      }
      if (isCurrent()) setError(`${phoneRecoveryErrorMessage(failure)}${cleanupMessage}`);
    } finally {
      if (isCurrent()) { operationBusy.current = false; setBusy(false); }
    }
  };

  const submit = async () => {
    if (operationBusy.current) return;
    if (!automaticallyVerified && !/^\d{6}$/.test(code)) { setError('Enter the 6-digit SMS code.'); return; }
    const challenge = session.current;
    if (!challenge) { setError('Request a new SMS code before continuing.'); setStep('phone'); return; }
    operationBusy.current = true;
    setBusy(true);
    setError('');
    const requestGeneration = generation.current;
    const isCurrent = () => requestGeneration === generation.current;
    try {
      const completed = await challenge.submit(code, async idToken => {
        if (!isCurrent()) throw new Error('Phone recovery was cancelled.');
        if (isSettings) {
          if (!ownerId || currentUserId.current !== ownerId) throw new Error('Account changed. Sign in again before updating recovery.');
          const fresh = await apiGet<AuthUser>('/auth/me');
          if (!isCurrent() || fresh.id !== ownerId || currentUserId.current !== ownerId) {
            throw new Error('Account changed. Sign in again before updating recovery.');
          }
          const body = { idToken, currentPassword: password };
          return action === 'remove'
            ? removeRecoveryPhone(body, recoveryRequestOptions())
            : bindRecoveryPhone(body, recoveryRequestOptions());
        }
        return resetRecoveryPassword({ idToken, newPassword: password }, recoveryRequestOptions());
      });
      if (!isCurrent()) return;
      session.current = null;
      setPassword('');
      setConfirmPassword('');
      setCode('');
      setPhone('');
      setStep('success');
      if (isSettings && 'hasVerifiedPhone' in completed) {
        queryClient.setQueryData(phoneQueryKey, completed);
        await queryClient.invalidateQueries({ queryKey: phoneQueryKey });
      }
    } catch (failure) {
      if (!isCurrent()) return;
      session.current = null;
      setCode('');
      setAutomaticallyVerified(false);
      setStep('phone');
      setError(`${phoneRecoveryErrorMessage(failure)} Request a fresh SMS verification before retrying.`);
    } finally {
      if (isCurrent()) { operationBusy.current = false; setBusy(false); }
    }
  };

  const startOver = async (nextAction: Action = action) => {
    if (operationBusy.current) return;
    setError('');
    try {
      await closeChallenge();
      setAction(nextAction);
      setPhone('');
      setPassword('');
      setConfirmPassword('');
      setConsent(false);
      setStep('phone');
    } catch {
      setError('Could not clear phone verification. Close and reopen the Android app before trying again.');
    }
  };

  const openWebsite = async () => {
    setError('');
    try {
      await Linking.openURL(recoveryWebsiteUrl(isSettings ? '/recovery-phone' : '/recover-account'));
    } catch (failure) {
      setError(phoneRecoveryErrorMessage(failure));
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.page, {
        paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + nativeTheme.spacing * 4,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + nativeTheme.spacing * 6,
      }]}
      bottomOffset={nativeTheme.spacing * 6}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Button variant="ghost" size="icon" accessibilityLabel="Back" testID="recovery-back"
          disabled={busy} onPress={() => router.canGoBack() ? router.back() : router.replace(isSettings ? '/(tabs)/profile' : '/(auth)/login')}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Button>
        <Typography variant="title" style={styles.heading}>{isSettings ? 'Recovery number' : 'Forgot password'}</Typography>
      </View>

      <Card style={styles.card}>
        <Ionicons name="shield-checkmark-outline" size={32} color={colors.primary} />
        <Typography variant="title">{isSettings ? 'Protect your account' : 'Recover your account'}</Typography>
        <Typography variant="muted">
          {isSettings
            ? 'An optional verified phone number lets you reset your password if you lose access. Your password and fresh phone verification are required to change or remove it.'
            : 'Use the phone number you previously verified in your account settings. Accounts without a verified recovery number cannot be reset by SMS.'}
        </Typography>

        {error ? <Typography accessibilityRole="alert" style={{ color: colors.destructive }} testID="recovery-error">{error}</Typography> : null}

        {!isNative ? (
          <>
            <Typography>{platform === 'unsupported'
              ? 'Native SMS recovery is not supported on iOS. Continue on the website for browser phone verification.'
              : 'Continue on the main website for secure browser phone verification with reCAPTCHA.'}</Typography>
            {isSettings ? <Typography variant="muted">You may need to sign in again in your browser. The Android app session is not transferred.</Typography> : null}
            <Button onPress={openWebsite} testID="recovery-open-website">Continue on website</Button>
          </>
        ) : step === 'success' ? (
          <>
            <Typography accessibilityLiveRegion="polite" testID="recovery-success">
              {isSettings
                ? action === 'remove' ? 'Your recovery number was removed. SMS password recovery is now disabled for this account.' : 'Your recovery number is verified and saved.'
                : 'Your password was reset. Previous signed-in sessions were revoked. Sign in with your new password.'}
            </Typography>
            {isSettings && status.data?.hasVerifiedPhone ? <Typography variant="label">Verified number: {status.data.maskedPhone}</Typography> : null}
            <Button onPress={() => router.replace(isSettings ? '/(tabs)/profile' : '/(auth)/login')} testID="recovery-done">
              {isSettings ? 'Back to profile' : 'Back to sign in'}
            </Button>
          </>
        ) : isSettings && status.isPending ? (
          <Typography variant="muted">Loading your recovery number…</Typography>
        ) : isSettings && status.isError ? (
          <>
            <Typography accessibilityRole="alert" style={{ color: colors.destructive }}>{phoneRecoveryErrorMessage(status.error)}</Typography>
            <Button variant="outline" onPress={() => void status.refetch()} testID="recovery-status-retry">Retry</Button>
          </>
        ) : (
          <>
            {isSettings ? (
              <View style={styles.group}>
                <Typography variant="label">
                  {status.data?.hasVerifiedPhone ? `Verified number: ${status.data.maskedPhone}` : 'No verified recovery number'}
                </Typography>
                {step === 'phone' && status.data?.hasVerifiedPhone ? (
                  <View style={styles.actions}>
                    <Button style={styles.action} variant={action === 'bind' ? 'secondary' : 'outline'}
                      disabled={busy} onPress={() => void startOver('bind')} testID="recovery-select-bind">Change number</Button>
                    <Button style={styles.action} variant={action === 'remove' ? 'destructive' : 'outline'}
                      disabled={busy} onPress={() => void startOver('remove')} testID="recovery-select-remove">Remove number</Button>
                  </View>
                ) : null}
                {action === 'remove' ? <Typography variant="muted">Enter your currently linked number in full. Removing it disables SMS recovery.</Typography> : null}
              </View>
            ) : null}

            {step === 'phone' ? (
              <>
                <View style={styles.group}>
                  <Typography variant="label">{isSettings && action === 'bind' ? 'Number to verify' : 'Verified recovery number'}</Typography>
                  <Input value={phone} onChangeText={setPhone} editable={!busy} accessibilityLabel="Phone number with country code"
                    placeholder="+212…" keyboardType="phone-pad" textContentType="telephoneNumber"
                    autoComplete="tel" autoCapitalize="none" autoCorrect={false} maxLength={16} testID="recovery-phone" />
                  <Typography variant="muted">Include + and the country calling code.</Typography>
                </View>
                <View style={styles.group}>
                  <Typography variant="label">{isSettings ? 'Current password' : 'New password'}</Typography>
                  <Input value={password} onChangeText={setPassword} editable={!busy} secureTextEntry
                    accessibilityLabel={isSettings ? 'Current password' : 'New password'}
                    textContentType={isSettings ? 'password' : 'newPassword'} autoComplete={isSettings ? 'current-password' : 'new-password'}
                    autoCapitalize="none" autoCorrect={false} testID="recovery-password" />
                </View>
                {!isSettings ? (
                  <View style={styles.group}>
                    <Typography variant="label">Confirm new password</Typography>
                    <Input value={confirmPassword} onChangeText={setConfirmPassword} editable={!busy} secureTextEntry
                      accessibilityLabel="Confirm new password" textContentType="newPassword" autoComplete="new-password"
                      autoCapitalize="none" autoCorrect={false} testID="recovery-password-confirm" />
                    <Typography variant="muted">At least 6 characters; maximum 72 UTF-8 bytes.</Typography>
                  </View>
                ) : null}
                <Button variant="outline" accessibilityRole="checkbox" accessibilityState={{ checked: consent }}
                  accessibilityLabel="I agree to receive an SMS for phone verification" style={styles.consent}
                  disabled={busy} onPress={() => setConsent(value => !value)} testID="recovery-consent">
                  <Ionicons name={consent ? 'checkbox-outline' : 'square-outline'} size={22} color={colors.primary} />
                  <Typography style={styles.consentText}>I agree to receive an SMS for phone verification.</Typography>
                </Button>
                <Typography variant="muted">Firebase processes the phone number to verify it and prevent abuse. Carrier charges may apply. Protect this number: anyone who controls it can reset your account password.</Typography>
                <Button onPress={() => void sendCode()} loading={busy} disabled={cooldown > 0}
                  testID="recovery-send-code">{cooldown > 0 ? `Request again in ${cooldown}s` : 'Send verification SMS'}</Button>
              </>
            ) : (
              <>
                <Typography accessibilityLiveRegion="polite">
                  {automaticallyVerified ? 'Android verified this phone automatically.' : `Firebase accepted the SMS request for the number ending in ${phone.trim().slice(-4)}. Enter the code when it arrives.`}
                </Typography>
                {!automaticallyVerified ? (
                  <View style={styles.group}>
                    <Typography variant="label">SMS verification code</Typography>
                    <Input value={code} onChangeText={setCode} editable={!busy} keyboardType="number-pad"
                      textContentType="oneTimeCode" autoComplete="sms-otp" accessibilityLabel="6-digit SMS code"
                      autoCapitalize="none" autoCorrect={false} maxLength={6} testID="recovery-code" />
                  </View>
                ) : null}
                <Button variant={isSettings && action === 'remove' ? 'destructive' : 'default'}
                  loading={busy} onPress={() => void submit()} testID="recovery-confirm">
                  {isSettings ? action === 'remove' ? 'Verify and remove number' : 'Verify and save number' : 'Verify and reset password'}
                </Button>
                <Button variant="outline" disabled={busy} onPress={() => void startOver()} testID="recovery-restart">Start over / request another code</Button>
                <Typography variant="muted">A fresh verification is required for every attempt. Firebase SMS delivery and app validation depend on the project configuration and your carrier.</Typography>
              </>
            )}
          </>
        )}
      </Card>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: nativeTheme.spacing * 6, gap: nativeTheme.spacing * 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: nativeTheme.spacing * 2 },
  heading: { flex: 1 },
  card: { gap: nativeTheme.spacing * 4 },
  group: { gap: nativeTheme.spacing * 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTheme.spacing * 2 },
  action: { flexGrow: 1 },
  consent: { padding: nativeTheme.spacing * 3, gap: nativeTheme.spacing * 2 },
  consentText: { flex: 1 },
});