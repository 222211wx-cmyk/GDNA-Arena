import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { apiGet, apiRequest, createAuthenticatedWebSocket } from '@/lib/api';
import {
  decryptAttachmentToDataUri,
  decryptVideoToLocalUri,
  decryptPayload,
  encryptAndUploadImage,
  encryptAndUploadVideo,
  encryptPayload,
  withKeyRefreshRetry,
  type EncryptedAttachment,
  type SecurePayload,
} from '@/lib/e2e';
import { useAuth } from '@/contexts/AuthContext';
import { useOnline } from '@/contexts/OnlineContext';

type Stored = {
  id: number;
  userId: number;
  username: string;
  content: string | null;
  fileUrl?: string | null;
  createdAt: string;
};
type Visible = Stored & { payload?: SecurePayload; error?: string };
type Response = { room: { name?: string | null }; messages: Stored[] };
type SendVariables = { payload: SecurePayload; fileUrl?: string; content?: string; clientMessageId?: string };
type SendResponse = { message: Stored };
type MessagingEntitlement = { hasActiveSubscription: boolean; canSendMessages: boolean; freeMessagesRemaining: number };
const exhaustedNotice = "Contactez l'AMIS pour activer";
function parseEntitlement(value: unknown): MessagingEntitlement {
  if (!value || typeof value !== 'object' ||
      typeof (value as MessagingEntitlement).hasActiveSubscription !== 'boolean' ||
      typeof (value as MessagingEntitlement).canSendMessages !== 'boolean' ||
      !Number.isSafeInteger((value as MessagingEntitlement).freeMessagesRemaining) ||
      (value as MessagingEntitlement).freeMessagesRemaining < 0) {
    throw new Error('Invalid messaging entitlement response');
  }
  return value as MessagingEntitlement;
}
const copy = {
  ar: { video: 'إرسال فيديو مشفّر', image: 'إرسال صورة مشفّرة', compress: 'تحضير الملف وتشفيره…', upload: 'رفع الملف المشفّر', failed: 'فشل الإرسال الآمن', retry: 'إعادة المحاولة', decrypt: 'تعذّر فك تشفير الفيديو', loading: 'فك تشفير الفيديو…', permission: 'اسمح بالوصول إلى الصور والفيديو لإرسال ملف مشفّر.' },
  en: { video: 'Send encrypted video', image: 'Send encrypted image', compress: 'Preparing and encrypting media…', upload: 'Uploading encrypted file', failed: 'Secure send failed', retry: 'Retry', decrypt: 'Unable to decrypt video', loading: 'Decrypting video…', permission: 'Allow photo and video access to send encrypted media.' },
  fr: { video: 'Envoyer une vidéo chiffrée', image: 'Envoyer une image chiffrée', compress: 'Préparation et chiffrement du média…', upload: 'Envoi du fichier chiffré', failed: 'Échec de l’envoi sécurisé', retry: 'Réessayer', decrypt: 'Impossible de déchiffrer la vidéo', loading: 'Déchiffrement de la vidéo…', permission: 'Autorisez l’accès aux photos et vidéos pour envoyer un média chiffré.' },
  es: { video: 'Enviar vídeo cifrado', image: 'Enviar imagen cifrada', compress: 'Preparando y cifrando contenido…', upload: 'Subiendo archivo cifrado', failed: 'Error en el envío seguro', retry: 'Reintentar', decrypt: 'No se pudo descifrar el vídeo', loading: 'Descifrando vídeo…', permission: 'Permite acceso a fotos y vídeos para enviar contenido cifrado.' },
  de: { video: 'Verschlüsseltes Video senden', image: 'Verschlüsseltes Bild senden', compress: 'Medien werden vorbereitet und verschlüsselt…', upload: 'Verschlüsselte Datei wird hochgeladen', failed: 'Sicheres Senden fehlgeschlagen', retry: 'Erneut versuchen', decrypt: 'Video kann nicht entschlüsselt werden', loading: 'Video wird entschlüsselt…', permission: 'Erlaube Zugriff auf Fotos und Videos, um verschlüsselte Medien zu senden.' },
};
const t = copy[Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2) as keyof typeof copy] ?? copy.en;

function SecureImage({ fileUrl, metadata }: { fileUrl: string; metadata: EncryptedAttachment }) {
  const colors = useColors();
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    setUri(undefined);
    setError(false);
    decryptAttachmentToDataUri(fileUrl, metadata)
      .then(value => { if (mounted) setUri(value); })
      .catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [fileUrl, metadata]);
  if (error) return <Typography style={{ color: colors.destructive }}>Unable to decrypt image.</Typography>;
  if (!uri) return <Typography variant="muted">Decrypting image…</Typography>;
  return <Image source={{ uri }} accessibilityLabel={metadata.name} contentFit="cover" style={styles.image} />;
}

function SecureVideo({ fileUrl, metadata }: { fileUrl: string; metadata: EncryptedAttachment }) {
  const colors = useColors();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(uri);
  useEffect(() => {
    let active = true;
    let temporaryUri: string | undefined;
    setUri(null);
    setError(null);
    decryptVideoToLocalUri(fileUrl, metadata)
      .then(value => {
        temporaryUri = value;
        if (active) setUri(value);
        else void import('expo-file-system/legacy').then(fs => fs.deleteAsync(value, { idempotent: true }));
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : t.decrypt); });
    return () => {
      active = false;
      if (temporaryUri) {
        const path = temporaryUri;
        void import('expo-file-system/legacy').then(fs => fs.deleteAsync(path, { idempotent: true }));
      }
    };
  }, [fileUrl, metadata, attempt]);
  if (error) return <View><Typography style={{ color: colors.destructive }}>{error}</Typography>
    <Button variant="outline" onPress={() => setAttempt(value => value + 1)}>{t.retry}</Button></View>;
  if (!uri) return <Typography variant="muted">{t.loading}</Typography>;
  return <VideoView player={player} nativeControls style={styles.video} />;
}

export default function Conversation() {
  const id = Number(useLocalSearchParams<{ roomId: string }>().roomId);
  const colors = useColors();
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const subscriptionKey = ['messaging-subscription', user?.id];
  const subscription = useQuery({
    queryKey: subscriptionKey,
    enabled: !!user,
    queryFn: async () => parseEntitlement(await apiGet<unknown>('/messages/subscription')),
    refetchInterval: 10000,
    staleTime: 0,
  });
  const canSend = subscription.data?.canSendMessages === true && !subscription.isError;
  const canSendNow = () => queryClient.getQueryState(subscriptionKey)?.status === 'success' &&
    queryClient.getQueryData<MessagingEntitlement>(subscriptionKey)?.canSendMessages === true;
  const subscriptionNotice = I18nManager.isRTL
    ? 'اشتراك المراسلة غير نشط. تواصل مع الإدارة لتفعيل الإرسال. القراءة والمكالمات متاحة.'
    : 'Messaging subscription inactive. Contact an administrator to enable sending. Reading and calls remain available.';
  const { isOnline } = useOnline();
  const [text, setText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryUpload, setRetryUpload] = useState<(() => Promise<void>) | null>(null);
  const [retrySend, setRetrySend] = useState<SendVariables | null>(null);
  const [messages, setMessages] = useState<Visible[]>([]);
  const active = useRef(true);
  const socket = useRef<WebSocket | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ping = useRef<ReturnType<typeof setInterval> | null>(null);

  const room = useQuery({
    queryKey: ['room', user?.id, id],
    enabled: !!user && Number.isSafeInteger(id) && id > 0,
    queryFn: () => apiGet<Response>(`/messages/rooms/${id}`),
  });
  const hydrate = useCallback(async (data: Response) => {
    if (!user) return;
    const hydrated = await Promise.all(data.messages.map(async message => {
      if (!message.content?.startsWith('e2e:v1:')) return { ...message, error: 'Legacy message' };
      try {
        return { ...message, payload: await decryptPayload(message.content, user.id) };
      } catch {
        return { ...message, error: 'Message unavailable on this device.' };
      }
    }));
    if (active.current) setMessages(hydrated);
  }, [user]);
  useEffect(() => { if (room.data) void hydrate(room.data); }, [room.data, hydrate]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, [id]);

  useEffect(() => {
    if (!user || !isOnline) return;
    let stopped = false;
    let reconnectAttempt = 0;
    const clearHeartbeat = () => {
      if (ping.current) clearInterval(ping.current);
      ping.current = null;
    };
    const scheduleReconnect = (connect: () => void) => {
      if (stopped || !isOnline) return;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt++, 5)) +
        Math.floor(Math.random() * 500);
      retry.current = setTimeout(() => {
        retry.current = null;
        connect();
      }, delay);
    };
    const connect = () => {
      if (stopped || !isOnline) return;
      let ws: WebSocket;
      try {
        ws = createAuthenticatedWebSocket();
      } catch {
        scheduleReconnect(connect);
        return;
      }
      socket.current = ws;
      ws.onopen = () => {
        if (stopped || socket.current !== ws) return;
        ws.send(JSON.stringify({ type: 'register', userId: user.id, username: user.username }));
        clearHeartbeat();
        ping.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };
      ws.onmessage = event => {
        void (async () => {
          let incoming: { type?: string; userId?: number; roomId?: number; recipientUserId?: number; message?: Stored };
          try {
            incoming = JSON.parse(String(event.data)) as typeof incoming;
          } catch {
            return;
          }
          if (incoming.type === 'session-ended') {
            stopped = true;
            ws.close();
            return;
          }
          if (incoming.type === 'registered') {
            if (incoming.userId !== user.id) {
              stopped = true;
              ws.close(4002, 'Identity changed');
              return;
            }
            reconnectAttempt = 0;
            await room.refetch();
            await queryClient.invalidateQueries({ queryKey: ['amis-rooms', user.id] });
            return;
          }
          if (incoming.type !== 'chat-message' || incoming.roomId !== id ||
              incoming.recipientUserId !== user.id || !incoming.message) return;
          const message = incoming.message;
          let visible: Visible;
          try {
            visible = message.content?.startsWith('e2e:v1:')
              ? { ...message, payload: await decryptPayload(message.content, user.id) }
              : { ...message, error: 'Legacy message' };
          } catch {
            visible = { ...message, error: 'Message unavailable on this device.' };
          }
          if (active.current) {
            setMessages(previous => previous.some(item => item.id === message.id) ? previous : [...previous, visible]);
          }
          await queryClient.invalidateQueries({ queryKey: ['amis-rooms', user.id] });
        })();
      };
      ws.onerror = () => {
        if (!stopped && ws.readyState !== WebSocket.CLOSED) ws.close();
      };
      ws.onclose = () => {
        clearHeartbeat();
        if (socket.current === ws) socket.current = null;
        if (!stopped) scheduleReconnect(connect);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      clearHeartbeat();
      socket.current?.close();
      socket.current = null;
    };
  }, [id, user, isOnline, queryClient, room.refetch]);

  const send = useMutation({
    mutationFn: (variables: SendVariables) => {
      if (!canSendNow()) throw new Error(subscriptionNotice);
      const post = (content: string) => apiRequest<SendResponse, { content: string; fileUrl?: string; clientMessageId?: string }>(
        'POST', `/messages/rooms/${id}/send`,
        { content, ...(variables.fileUrl ? { fileUrl: variables.fileUrl } : {}),
          ...(variables.clientMessageId ? { clientMessageId: variables.clientMessageId } : {}) },
      );
      if (variables.content) return post(variables.content);
      return withKeyRefreshRetry(async keys => {
        variables.content = await encryptPayload(variables.payload, keys);
        return post(variables.content);
      }, id);
    },
    onSuccess: (result, variables) => {
      queryClient.setQueryData<MessagingEntitlement>(subscriptionKey, previous => {
        if (!previous || previous.hasActiveSubscription) return previous;
        const remaining = Math.max(0, previous.freeMessagesRemaining - 1);
        return { ...previous, freeMessagesRemaining: remaining, canSendMessages: remaining > 0 };
      });
      void subscription.refetch();
      setRetrySend(null);
      setUploadError(null);
      if (variables.payload.kind === 'text') {
        const sentText = variables.payload.text;
        setText(current => current.trim() === sentText ? '' : current);
      }
      setMessages(previous => previous.some(item => item.id === result.message.id)
        ? previous
        : [...previous, { ...result.message, payload: variables.payload }]);
      if (user) void queryClient.invalidateQueries({ queryKey: ['amis-rooms', user.id] });
    },
    onError: (error, variables) => {
      void subscription.refetch();
      if (variables.payload.kind === 'attachment') {
        setRetrySend(variables);
        setUploadError(error instanceof Error ? error.message : t.failed);
      } else Alert.alert(t.failed, error instanceof Error ? error.message : t.retry);
    },
  });

  const sendText = () => {
    const value = text.trim();
    if (canSend && value && !send.isPending) send.mutate({ payload: { kind: 'text', text: value } });
  };
  const pickMedia = async (kind: 'image' | 'video') => {
    if (!canSendNow() || send.isPending || uploadProgress !== null) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t.failed, t.permission);
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [kind === 'video' ? 'videos' : 'images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const upload = async () => {
        setUploadError(null);
        setRetrySend(null);
        try {
          const current = await subscription.refetch();
          if (current.isError || !current.data?.canSendMessages) throw new Error(
            current.data?.freeMessagesRemaining === 0 && !current.data.hasActiveSubscription
              ? exhaustedNotice : subscriptionNotice,
          );
          setUploadProgress(0);
          const mime = asset.mimeType ?? 'image/jpeg';
          const name = asset.fileName ?? `${kind}-${Date.now()}.${kind === 'video' ? 'mp4' : mime.split('/')[1] ?? 'jpg'}`;
          const update = (value: number) => setUploadProgress(value);
          const encrypted = kind === 'video'
            ? await encryptAndUploadVideo(asset.uri, name, id, update)
            : await encryptAndUploadImage(asset.uri, name, mime, asset.fileSize, id, update);
          setRetryUpload(null);
          send.mutate({
            payload: { kind: 'attachment', attachment: encrypted.metadata },
            fileUrl: encrypted.fileUrl, clientMessageId: Crypto.randomUUID(),
          });
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : t.failed);
        } finally {
          setUploadProgress(null);
        }
      };
      setRetryUpload(() => upload);
      await upload();
    } catch (error) {
      Alert.alert(t.failed, error instanceof Error ? error.message : t.retry);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, {
      backgroundColor: colors.background,
      paddingTop: inset.top,
      direction: I18nManager.isRTL ? 'rtl' : 'ltr',
    }]}>
      <View style={[styles.header, {
        borderColor: colors.border,
        flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
      }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={router.back}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.foreground} />
        </Pressable>
        <Typography variant="title">{room.data?.room.name ?? 'Secure chat'}</Typography>
      </View>
      <FlatList
        inverted
        data={[...messages].reverse()}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.userId === user?.id;
          return (
            <View style={[styles.bubble, {
              alignSelf: mine ? 'flex-end' : 'flex-start',
              backgroundColor: mine ? colors.primary : colors.card,
            }]}>
              {item.payload?.kind === 'attachment' && item.fileUrl
                ? item.payload.attachment.kind === 'video'
                  ? <SecureVideo fileUrl={item.fileUrl} metadata={item.payload.attachment} />
                  : <SecureImage fileUrl={item.fileUrl} metadata={item.payload.attachment} />
                : <Typography style={{ color: mine ? colors.primaryForeground : colors.foreground }}>
                    {item.payload?.kind === 'text'
                      ? item.payload.text
                      : item.payload?.kind === 'attachment'
                        ? 'Encrypted attachment is unavailable.'
                        : item.error ?? 'Encrypted message'}
                  </Typography>}
            </View>
          );
        }}
      />
      <View style={styles.status}>
        <Typography variant="muted">{subscription.isPending ? 'Checking messaging subscription…'
          : subscription.isError ? 'Unable to verify messaging subscription. Sending is unavailable; reading and calls remain available.'
          : !canSend ? subscription.data?.freeMessagesRemaining === 0 && !subscription.data.hasActiveSubscription
            ? exhaustedNotice : subscriptionNotice
          : subscription.data?.hasActiveSubscription ? 'Messaging subscription active.'
          : `${subscription.data?.freeMessagesRemaining} free messages remaining`}</Typography>
        {subscription.isError && <Button variant="outline" onPress={() => void subscription.refetch()}>Retry</Button>}
      </View>
      {(uploadProgress !== null || uploadError) && <View style={styles.status}>
        <Typography variant="muted">{uploadError ?? `${uploadProgress! < 0.3 ? t.compress : t.upload} ${Math.round(uploadProgress! * 100)}%`}</Typography>
        {uploadError && (retrySend || retryUpload) && <Button variant="outline" onPress={() => {
          if (retrySend) send.mutate(retrySend);
          else if (retryUpload) void retryUpload();
        }} disabled={!canSend || send.isPending}>{t.retry}</Button>}
      </View>}
      <View style={[styles.composer, {
        borderColor: colors.border,
        paddingBottom: Math.max(inset.bottom, 8),
        flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
      }]}>
        <Button size="icon" variant="outline" disabled={!canSend || !isOnline || send.isPending || uploadProgress !== null} accessibilityLabel={t.image} onPress={() => void pickMedia('image')}>
          <Ionicons name="image-outline" color={colors.foreground} size={20} />
        </Button>
        <Button size="icon" variant="outline" disabled={!canSend || !isOnline || send.isPending || uploadProgress !== null} accessibilityLabel={t.video} onPress={() => void pickMedia('video')}>
          <Ionicons name="videocam-outline" color={colors.foreground} size={20} />
        </Button>
        <Input value={text} onChangeText={setText} multiline placeholder="Encrypted message"
          textAlign={I18nManager.isRTL ? 'right' : 'left'}
          style={[styles.input, { writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' }]} />
        <Button size="icon" disabled={!canSend || !isOnline || !text.trim() || send.isPending} loading={send.isPending} onPress={sendText}>
          <Ionicons name="send" color={colors.primaryForeground} size={18} />
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 60, borderBottomWidth: 1, padding: 12, alignItems: 'center', gap: 12 },
  list: { padding: 14, gap: 8 },
  bubble: { padding: 10, borderRadius: 10, maxWidth: '80%' },
  composer: { gap: 8, borderTopWidth: 1, padding: 10, alignItems: 'flex-end' },
  input: { flex: 1 },
  image: { width: 220, height: 220, borderRadius: 8 },
  video: { width: 240, height: 180, borderRadius: 8 },
  status: { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
});