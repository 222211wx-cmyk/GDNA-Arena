import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { getGetRecoveryCodeStatusQueryKey, useGetRecoveryCodeStatus } from '@workspace/api-client-react';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Badge } from '@workspace/gdna-ds/components/native/badge';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useAuth } from '@/contexts/AuthContext';
import { useOnline } from '@/contexts/OnlineContext';
import {
  PASSWORD_MAX_BYTES, classifyRecoveryError, issueRecoveryCode, recoveryApiOptions, revokeRecoveryCode,
} from '@/lib/offline-recovery';
import { recoveryCopy } from '@/lib/recovery-copy';
import { FormMessage, RecoveryConsequences } from '@/components/RecoveryNotices';
import { useRecoveryReminderPreference } from '@/hooks/useRecoveryReminderPreference';
import { isRecoveryCodeExpiringSoon, recoveryReminderCopy } from '../../../lib/recovery-code-reminder';

type Busy = 'issue' | 'remove' | null;

export default function SecurityScreen() {
  const t = recoveryCopy();
  const deviceLanguage = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  const language = ['ar', 'en', 'fr', 'es', 'de'].includes(deviceLanguage) ? deviceLanguage : 'ar';
  const reminderCopy = recoveryReminderCopy(language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const reminder = useRecoveryReminderPreference(userId);
  const scroll = useRef<ScrollView>(null);
  const passwordPosition = useRef(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  // Non-secret status only, scoped per account so identities never share it.
  const statusKey = [...getGetRecoveryCodeStatusQueryKey(), userId] as const;

  const status = useGetRecoveryCodeStatus({
    query: {
      queryKey: statusKey,
      enabled: userId !== null && isOnline,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
    request: recoveryApiOptions(),
  });

  // Sensitive values live only in component state: never cached or persisted.
  const [password, setPassword] = useState('');
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  // Synchronous guards. Every identity change, background transition or
  // unmount bumps the generation so late responses are discarded.
  const inFlight = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
    setBusy(null);
    setPassword(''); setIssued(null); setAcknowledged(false);
  }, []);

  useEffect(() => invalidate, [userId, invalidate]);
  const refreshStatus = useCallback((uid: number | null) => {
    void queryClient.invalidateQueries({ queryKey: [...getGetRecoveryCodeStatusQueryKey(), uid] });
  }, [queryClient]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state !== 'active') invalidate();
      else refreshStatus(currentUser.current);
    });
    return () => sub.remove();
  }, [invalidate, refreshStatus]);

  const errorText = (e: unknown) => {
    const kind = classifyRecoveryError(e);
    return kind === 'offline' ? t.offline : kind === 'credentials' ? t.errCredentials : kind === 'rate' ? t.errRate : t.errGeneric;
  };

  const run = async (kind: 'issue' | 'remove') => {
    if (inFlight.current || !password || !isOnline) return;
    inFlight.current = true;
    const myGeneration = ++generation.current;
    const requestUser = currentUser.current;
    const abort = new AbortController();
    controller.current = abort;
    const pw = password;
    setPassword('');
    setBusy(kind); setMessage(null);
    const stale = () => myGeneration !== generation.current || requestUser !== currentUser.current;
    try {
      if (kind === 'issue') {
        const result = await issueRecoveryCode(pw, abort.signal);
        if (stale()) return; // never redisplay a code after background/unmount/switch
        setAcknowledged(false);
        setIssued({ code: result.code, expiresAt: result.expiresAt });
      } else {
        await revokeRecoveryCode(pw, abort.signal);
        if (stale()) return;
        setIssued(null);
        setMessage({ text: t.removed, tone: 'info' });
      }
    } catch (e) {
      if (stale()) return;
      setMessage({ text: kind === 'issue' ? `${errorText(e)} ${t.lostResponse}` : errorText(e), tone: 'error' });
    } finally {
      // Success or partial failure: the server state may have changed.
      refreshStatus(requestUser);
      if (myGeneration === generation.current) {
        inFlight.current = false;
        controller.current = null;
        setBusy(null);
      }
    }
  };

  const dismissCode = () => { setIssued(null); setAcknowledged(false); };
  const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(language) : '');
  const active = status.data?.active ?? false;
  const showReminder = userId !== null && foreground && isOnline && reminder.enabled
    && !reminder.loading && !reminder.saving && !reminder.error
    && status.isSuccess && status.isFetchedAfterMount && !status.isFetching
    && !issued && busy === null && isRecoveryCodeExpiringSoon(status.data);
  const dir = { direction: language === 'ar' ? 'rtl' : 'ltr' } as const;

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[s.content, dir, { paddingTop: insets.top + space(4), paddingBottom: insets.bottom + space(8) }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.header}>
        <Button variant="ghost" size="sm" onPress={() => { invalidate(); router.back(); }} accessibilityLabel={t.back}>
          <Typography>{t.back}</Typography>
        </Button>
      </View>
      <Typography variant="title">{t.title}</Typography>
      <Typography variant="muted">{t.intro}</Typography>

      {!isOnline ? <FormMessage text={t.offline} tone="error" /> : null}

      <Card style={s.gap}>
        <View style={s.row}>
          <Typography variant="label" style={s.flex}>{reminderCopy.label}</Typography>
          <Switch testID="recovery-reminder-toggle" value={reminder.enabled}
            onValueChange={reminder.setEnabled} disabled={userId === null || reminder.loading || reminder.saving}
            accessibilityLabel={reminderCopy.label} accessibilityHint={reminderCopy.hint}
            trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        <Typography variant="muted">{reminderCopy.hint}</Typography>
        {reminder.error ? <FormMessage text={reminderCopy.storageError} tone="error" /> : null}
      </Card>

      {showReminder ? (
        <Card style={s.gap} testID="recovery-expiry-reminder">
          <FormMessage text={reminderCopy.warning.replace('{date}', formatDate(status.data?.expiresAt))} tone="info" />
          <Button variant="outline" testID="recovery-reminder-replace"
            onPress={() => scroll.current?.scrollTo({ y: passwordPosition.current, animated: true })}>
            <Typography>{reminderCopy.replace}</Typography>
          </Button>
        </Card>
      ) : null}

      {issued ? (
        <Card style={s.gap}>
          <Typography variant="label">{t.issued}</Typography>
          <View style={[s.codeBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Typography selectable style={s.code} accessibilityLabel={issued.code}>{issued.code}</Typography>
          </View>
          <Typography variant="muted">{t.expires} {formatDate(issued.expiresAt)}</Typography>
          <Typography variant="label">{t.shownOnce}</Typography>
          <Typography variant="muted">{t.rotateWarn}</Typography>
          <View style={s.row}>
            <Switch value={acknowledged} onValueChange={setAcknowledged} accessibilityLabel={t.ack}
              trackColor={{ true: colors.primary, false: colors.border }} />
            <Typography style={s.flex}>{t.ack}</Typography>
          </View>
          <Button disabled={!acknowledged} onPress={dismissCode}>
            <Typography style={{ color: colors.primaryForeground }}>{t.done}</Typography>
          </Button>
        </Card>
      ) : (
        <>
          <Card style={s.gap}>
            {status.isLoading ? (
              <View accessibilityLabel={t.loading} style={s.gap}>
                <View style={[s.skeleton, { backgroundColor: colors.muted, width: '60%' }]} />
                <View style={[s.skeleton, { backgroundColor: colors.muted, width: '40%' }]} />
              </View>
            ) : status.isError ? (
              <View style={s.gap}>
                <FormMessage text={t.loadError} tone="error" />
                <Button variant="outline" size="sm" onPress={() => void status.refetch()} disabled={!isOnline}>
                  <Typography>{t.retry}</Typography>
                </Button>
              </View>
            ) : status.data ? (
              <View style={s.gap}>
                <Badge><Typography variant="label">{active ? t.statusActive : t.statusNone}</Typography></Badge>
                {active && status.data.expiresAt ? <Typography variant="muted">{t.expires} {formatDate(status.data.expiresAt)}</Typography> : null}
              </View>
            ) : null}
          </Card>

          <Card style={s.gap} onLayout={event => { passwordPosition.current = event.nativeEvent.layout.y; }}>
            <Typography variant="label">{t.password}</Typography>
            <Input value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
              autoComplete="current-password" textContentType="password" placeholder={t.passwordHint}
              maxLength={PASSWORD_MAX_BYTES} accessibilityLabel={t.password} editable={busy === null} />
            {active ? <Typography variant="muted">{t.rotateWarn}</Typography> : null}
            <Typography variant="muted">{t.lostResponse}</Typography>
            {message ? <FormMessage text={message.text} tone={message.tone} /> : null}
            <Button loading={busy === 'issue'} disabled={!password || busy !== null || !isOnline} onPress={() => void run('issue')}>
              <Typography style={{ color: colors.primaryForeground }}>{busy === 'issue' ? t.generating : active ? t.rotate : t.generate}</Typography>
            </Button>
            {active ? (
              <Button variant="destructive" loading={busy === 'remove'} disabled={!password || busy !== null || !isOnline} onPress={() => void run('remove')}>
                <Typography style={{ color: colors.destructiveForeground }}>{busy === 'remove' ? t.removing : t.remove}</Typography>
              </Button>
            ) : null}
          </Card>
        </>
      )}

      <RecoveryConsequences />
    </ScrollView>
  );
}

const space = (n: number) => nativeTheme.spacing * n;

const s = StyleSheet.create({
  content: { paddingHorizontal: space(5), gap: space(4) },
  header: { flexDirection: 'row' },
  gap: { gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  flex: { flex: 1 },
  codeBox: { borderWidth: 1, borderRadius: nativeTheme.radius, padding: space(4), alignItems: 'center' },
  code: { fontFamily: nativeTheme.fonts.semibold, fontSize: space(5), letterSpacing: space(0.5), textAlign: 'center' },
  skeleton: { height: space(4), borderRadius: nativeTheme.radius },
});
