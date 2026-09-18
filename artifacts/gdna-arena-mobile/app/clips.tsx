import React, { useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { parseClipCode } from '@/lib/clip-logic';

export default function ClipsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const top = Platform.OS === 'web' ? 67 : insets.top;

  const openClip = () => {
    const code = parseClipCode(input);
    if (!code) {
      setError('Enter a HELX-123456 code or paste an HTTPS HELIXLY clip link.');
      return;
    }
    Keyboard.dismiss();
    setError(null);
    router.push({ pathname: '/clip/[code]', params: { code } } as never);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: top + nativeTheme.spacing * 3 }]}>
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)' as never);
          }}
          accessibilityLabel="Go back"
          testID="clips-back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Button>
        <Typography variant="title">CLIPS</Typography>
        <View style={styles.headerSpacer} />
      </View>
      <Card style={styles.card}>
        <View style={[styles.icon, { backgroundColor: colors.primary + '22' }]}>
          <Ionicons name="play" size={28} color={colors.primary} />
        </View>
        <Typography variant="title" style={styles.center}>Open a clip</Typography>
        <Typography variant="muted" style={styles.center}>
          Use its six-digit HELX code or paste the HTTPS share link.
        </Typography>
        <Input
          value={input}
          onChangeText={value => {
            setInput(value);
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardType="url"
          placeholder="HELX-123456"
          returnKeyType="go"
          onSubmitEditing={openClip}
          accessibilityLabel="Clip code or HTTPS link"
          testID="clip-code-input"
        />
        {error ? (
          <Typography style={{ color: colors.destructive }} accessibilityRole="alert">
            {error}
          </Typography>
        ) : null}
        <Button onPress={openClip} testID="open-clip">
          Open clip
        </Button>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: nativeTheme.spacing * 4 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 44 },
  card: { marginTop: nativeTheme.spacing * 7, gap: nativeTheme.spacing * 4 },
  icon: {
    width: 60, height: 60, borderRadius: nativeTheme.radius * 6,
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});