import React from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { recoveryCopy } from '@/lib/recovery-copy';

/** Explains what an offline-code reset keeps, loses and revokes. */
export function RecoveryConsequences() {
  const t = recoveryCopy();
  return (
    <Card style={s.card}>
      {[t.preserved, t.e2ee, t.revoked, t.offlineCopies, t.internet].map(line => (
        <Typography key={line} variant="muted" style={s.line}>{line}</Typography>
      ))}
    </Card>
  );
}

export function FormMessage({ text, tone }: { text: string; tone: 'error' | 'info' }) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole={tone === 'error' ? 'alert' : 'text'}>
      <Typography variant={tone === 'error' ? 'label' : 'muted'} style={s.line}>{text}</Typography>
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: nativeTheme.spacing * 2 },
  line: { textAlign: I18nManager.isRTL ? 'right' : 'left' },
});
