import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoView } from 'expo-video';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Spinner } from '@workspace/gdna-ds/components/native/spinner';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { useClipPlayback } from '@/contexts/ClipPlaybackContext';
import { parseClipCode } from '@/lib/clip-logic';

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export default function ClipPlayerScreen() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = parseClipCode(rawCode ?? '');
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const playback = useClipPlayback();
  const [trackWidth, setTrackWidth] = useState(0);
  const top = Platform.OS === 'web' ? 67 : insets.top;
  const isAudio = playback.clip?.contentType.startsWith('audio/') ?? false;
  const progress = playback.duration > 0
    ? Math.min(1, Math.max(0, playback.position / playback.duration))
    : 0;

  useEffect(() => {
    if (code) void playback.load(code);
  }, [code, playback.load]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: top + nativeTheme.spacing * 2 }]}>
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/clips' as never);
          }}
          accessibilityLabel="Go back"
          testID="clip-player-back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Button>
        <Typography variant="label">HELIXLY CLIPS</Typography>
        <View style={styles.headerSpacer} />
      </View>

      {!code ? (
        <Card style={styles.stateCard}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.destructive} />
          <Typography variant="title">Invalid clip code</Typography>
          <Button onPress={() => router.replace('/clips' as never)}>Enter a code</Button>
        </Card>
      ) : playback.phase === 'loading' || playback.phase === 'processing' ? (
        <Card style={styles.stateCard}>
          <Spinner size="large" />
          <Typography variant="title">
            {playback.phase === 'processing' ? 'Preparing clip…' : 'Loading clip…'}
          </Typography>
          <Typography variant="muted">{code}</Typography>
        </Card>
      ) : playback.phase === 'error' ? (
        <Card style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.destructive} />
          <Typography variant="title">Playback unavailable</Typography>
          <Typography style={styles.center} accessibilityRole="alert">{playback.error}</Typography>
          <Button onPress={() => void playback.retry()} testID="clip-retry">Try again</Button>
        </Card>
      ) : playback.clip ? (
        <View style={styles.content}>
          {!isAudio ? (
            <VideoView
              player={playback.player}
              style={[styles.video, { backgroundColor: colors.card }]}
              nativeControls
              contentFit="contain"
              allowsFullscreen
              testID="clip-video"
            />
          ) : (
            <Card style={styles.audioArtwork}>
              <View style={[styles.audioIcon, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="musical-notes" size={48} color={colors.primary} />
              </View>
              <Typography variant="muted">AUDIO CLIP</Typography>
            </Card>
          )}
          <View style={styles.details}>
            <Typography variant="title" numberOfLines={2}>
              {playback.clip.name || playback.clip.originalName || playback.clip.code}
            </Typography>
            <Typography variant="muted">{playback.clip.code}</Typography>
          </View>
          <Pressable
            style={[styles.track, { backgroundColor: colors.muted }]}
            accessibilityRole="adjustable"
            accessibilityLabel="Playback position"
            accessibilityValue={{ min: 0, max: Math.round(playback.duration), now: Math.round(playback.position) }}
            onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={event => {
              if (trackWidth > 0) {
                playback.seekTo((event.nativeEvent.locationX / trackWidth) * playback.duration);
              }
            }}
          >
            <View style={[styles.trackFill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
          </Pressable>
          <View style={styles.timeRow}>
            <Typography variant="muted">{formatTime(playback.position)}</Typography>
            <Typography variant="muted">{formatTime(playback.duration || playback.clip.duration)}</Typography>
          </View>
          <View style={styles.controls}>
            <Button variant="outline" size="icon" onPress={() => playback.seekBy(-10)} accessibilityLabel="Back 10 seconds">
              <Ionicons name="play-back" size={21} color={colors.foreground} />
            </Button>
            <Button
              size="icon"
              style={styles.playButton}
              onPress={playback.isPlaying ? playback.pause : playback.play}
              accessibilityLabel={playback.isPlaying ? 'Pause' : 'Play'}
              testID="clip-play-pause"
            >
              <Ionicons
                name={playback.isPlaying ? 'pause' : 'play'}
                size={30}
                color={colors.primaryForeground}
              />
            </Button>
            <Button variant="outline" size="icon" onPress={() => playback.seekBy(10)} accessibilityLabel="Forward 10 seconds">
              <Ionicons name="play-forward" size={21} color={colors.foreground} />
            </Button>
          </View>
          {playback.phase === 'recovering' ? (
            <View style={styles.recovering}>
              <Spinner />
              <Typography variant="muted">Refreshing playback link…</Typography>
            </View>
          ) : null}
          <Typography variant="muted" style={styles.backgroundNote}>
            {Platform.OS === 'web'
              ? 'Background playback and media controls depend on browser policies.'
              : 'Playback continues in the background and can be controlled from the system media controls.'}
          </Typography>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: nativeTheme.spacing * 4 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 44 },
  stateCard: { marginTop: nativeTheme.spacing * 10, alignItems: 'center', gap: nativeTheme.spacing * 4 },
  content: { flex: 1, paddingTop: nativeTheme.spacing * 3 },
  video: {
    width: '100%', aspectRatio: 9 / 16, maxHeight: '58%',
    borderRadius: nativeTheme.radius * 2, overflow: 'hidden',
  },
  audioArtwork: {
    height: 240, alignItems: 'center', justifyContent: 'center',
    gap: nativeTheme.spacing * 4,
  },
  audioIcon: {
    width: 104, height: 104, borderRadius: nativeTheme.radius * 10,
    alignItems: 'center', justifyContent: 'center',
  },
  details: { paddingTop: nativeTheme.spacing * 4, gap: nativeTheme.spacing },
  center: { textAlign: 'center' },
  track: {
    height: 5, borderRadius: nativeTheme.radius,
    marginTop: nativeTheme.spacing * 4, overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: nativeTheme.radius },
  timeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: nativeTheme.spacing * 2,
  },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: nativeTheme.spacing * 6, paddingTop: nativeTheme.spacing * 3,
  },
  playButton: { width: 58, height: 58, borderRadius: nativeTheme.radius * 6 },
  recovering: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: nativeTheme.spacing * 2, paddingTop: nativeTheme.spacing * 3,
  },
  backgroundNote: { textAlign: 'center', paddingTop: nativeTheme.spacing * 3 },
});