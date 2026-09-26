import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { useNightCamera } from '@/lib/night-camera';

const copy = {
  en: { title: 'Night video', night: 'Low-light', light: 'Flashlight', switchCamera: 'Switch camera', waiting: 'Waiting for camera capture…', unsupported: 'Flashlight unavailable on this camera. Try switching to the rear camera.', unavailable: 'Available during a native video call.' },
  ar: { title: 'فيديو ليلي', night: 'تحسين الإضاءة', light: 'المصباح', switchCamera: 'تبديل الكاميرا', waiting: 'في انتظار تشغيل الكاميرا…', unsupported: 'المصباح غير متاح لهذه الكاميرا. جرّب الكاميرا الخلفية.', unavailable: 'متاح أثناء مكالمة فيديو على الهاتف.' },
  fr: { title: 'Vidéo de nuit', night: 'Faible lumière', light: 'Lampe', switchCamera: 'Changer de caméra', waiting: 'En attente de la caméra…', unsupported: 'Lampe indisponible pour cette caméra. Essayez la caméra arrière.', unavailable: 'Disponible pendant un appel vidéo natif.' },
  es: { title: 'Vídeo nocturno', night: 'Poca luz', light: 'Linterna', switchCamera: 'Cambiar cámara', waiting: 'Esperando la cámara…', unsupported: 'Linterna no disponible en esta cámara. Prueba la cámara trasera.', unavailable: 'Disponible durante una videollamada nativa.' },
  de: { title: 'Nachtvideo', night: 'Wenig Licht', light: 'Taschenlampe', switchCamera: 'Kamera wechseln', waiting: 'Warten auf Kamera…', unsupported: 'Taschenlampe für diese Kamera nicht verfügbar. Versuche die Rückkamera.', unavailable: 'Während eines nativen Videoanrufs verfügbar.' },
} as const;

export function NightCallControls({ callId }: { callId: string }) {
  const colors = useColors();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  const text = copy[locale as keyof typeof copy] ?? copy.en;
  const { state, available, setNight, setTorch, switchCamera } = useNightCamera(callId);

  return <View style={[styles.container, { borderColor: colors.border }]}>
    <Typography variant="label">{text.title}</Typography>
    <View style={styles.row}>
      <Button size="sm" variant={state.nightEnabled ? 'default' : 'outline'}
        accessibilityLabel={text.night} accessibilityState={{ selected: state.nightEnabled, disabled: !state.ready }}
        disabled={!state.ready} onPress={() => setNight(!state.nightEnabled)}>{text.night}</Button>
      <Button size="sm" variant={state.torchEnabled ? 'default' : 'outline'}
        accessibilityLabel={text.light} accessibilityState={{ selected: state.torchEnabled, disabled: !state.ready || !state.torchSupported }}
        disabled={!state.ready || !state.torchSupported} onPress={() => setTorch(!state.torchEnabled)}>{text.light}</Button>
      <Button size="sm" variant="outline" disabled={!state.ready} onPress={switchCamera}>{text.switchCamera}</Button>
    </View>
    {!available && <Typography variant="muted">{text.unavailable}</Typography>}
    {available && !state.ready && !state.error && <Typography variant="muted">{text.waiting}</Typography>}
    {available && state.ready && !state.torchSupported && <Typography variant="muted">{text.unsupported}</Typography>}
    {state.error && <Typography variant="muted" accessibilityRole="alert">{state.error}</Typography>}
  </View>;
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});