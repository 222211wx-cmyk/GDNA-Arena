import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, I18nManager, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useAuth } from '@/contexts/AuthContext';
import { useOnline } from '@/contexts/OnlineContext';
import {
  CODE_MAX_LENGTH, PASSWORD_MAX_BYTES, classifyRecoveryError, passwordPolicyError, redeemCode,
} from '@/lib/offline-recovery';
import { recoveryCopy } from '@/lib/recovery-copy';
import { FormMessage, RecoveryConsequences } from '@/components/RecoveryNotices';

export default function RecoverScreen() {
  const t = recoveryCopy();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline } = useOnline();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ username: string; revocationPending: boolean } | null>(null);

  const inFlight = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
    setSubmitting(false);
    setCode(''); setNewPassword(''); setConfirm(''); setResult(null);
  }, []);

  // Unmount and identity changes discard any pending reset and its result.
  useEffect(() => invalidate, [userId, invalidate]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') invalidate(); });
    return () => sub.remove();
  }, [invalidate]);

  const submit = async () => {
    if (inFlight.current) return;
    if (!isOnline) { setError(t.offline); return; }
    const policy = passwordPolicyError(newPassword);
    if (policy) { setError(policy === 'short' ? t.tooShort : t.tooLong); return; }
    if (newPassword !== confirm) { setError(t.mismatch); setNewPassword(''); setConfirm(''); return; }
    inFlight.current = true;
    const myGeneration = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const c = code; const p = newPassword;
    // Clear secrets from state before the request leaves the device.
    setNewPassword(''); setConfirm('');
    setSubmitting(true); setError('');
    try {
      const res = await redeemCode(c, p, abort.signal);
      if (myGeneration !== generation.current) return;
      setCode('');
      setResult({ username: res.username, revocationPending: res.revocationPending });
    } catch (e) {
      if (myGeneration !== generation.current) return;
      const kind = classifyRecoveryError(e);
      setError(kind === 'offline' ? t.offline : kind === 'rate' ? t.errRate : kind === 'expired' || kind === 'credentials' ? t.errExpired : t.errGeneric);
    } finally {
      if (myGeneration === generation.current) {
        inFlight.current = false;
        controller.current = null;
        setSubmitting(false);
      }
    }
  };

  const leave = () => { invalidate(); router.replace('/(auth)/login'); };
  const dir = { direction: I18nManager.isRTL ? 'rtl' : 'ltr' } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[s.content, dir, { paddingTop: insets.top + space(6), paddingBottom: insets.bottom + space(8) }]} keyboardShouldPersistTaps="handled">
        <Typography variant="title">{t.recoverTitle}</Typography>
        {result ? (
          <Card style={s.gap}>
            <Typography variant="label">{t.successTitle}</Typography>
            <Typography variant="muted">{t.successBody}</Typography>
            <Typography selectable variant="title">{result.username}</Typography>
            {result.revocationPending ? <Typography variant="muted">{t.pending}</Typography> : null}
            <Button onPress={leave}><Typography style={{ color: colors.primaryForeground }}>{t.backToLogin}</Typography></Button>
          </Card>
        ) : (
          <Card style={s.gap}>
            <Typography variant="muted">{t.recoverIntro}</Typography>
            {!isOnline ? <FormMessage text={t.offline} tone="error" /> : null}
            <Typography variant="label">{t.code}</Typography>
            <Input value={code} onChangeText={setCode} placeholder={t.codeHint} autoCapitalize="characters" autoCorrect={false}
              autoComplete="off" importantForAutofill="no" maxLength={CODE_MAX_LENGTH} accessibilityLabel={t.code} editable={!submitting} />
            <Typography variant="label">{t.newPassword}</Typography>
            <Input value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password"
              textContentType="newPassword" maxLength={PASSWORD_MAX_BYTES} accessibilityLabel={t.newPassword} editable={!submitting} />
            <Typography variant="label">{t.confirmPassword}</Typography>
            <Input value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password"
              textContentType="newPassword" maxLength={PASSWORD_MAX_BYTES} accessibilityLabel={t.confirmPassword} editable={!submitting}
              onSubmitEditing={() => void submit()} />
            {error ? <FormMessage text={error} tone="error" /> : null}
            <Button loading={submitting} disabled={submitting || !code.trim() || !newPassword || !confirm || !isOnline} onPress={() => void submit()}>
              <Typography style={{ color: colors.primaryForeground }}>{submitting ? t.submitting : t.submit}</Typography>
            </Button>
            <View>
              <Button variant="ghost" size="sm" onPress={leave}><Typography>{t.backToLogin}</Typography></Button>
            </View>
          </Card>
        )}
        <RecoveryConsequences />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const space = (n: number) => nativeTheme.spacing * n;

const s = StyleSheet.create({
  content: { paddingHorizontal: space(5), gap: space(4) },
  gap: { gap: space(3) },
});
