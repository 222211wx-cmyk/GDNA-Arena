import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
  decryptPayload,
  encryptAndUploadImage,
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
type SendVariables = { payload: SecurePayload; fileUrl?: string };
type SendResponse = { message: Stored };

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

export default function Conversation() {
  const id = Number(useLocalSearchParams<{ roomId: string }>().roomId);
  const colors = useColors();
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
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
    mutationFn: (variables: SendVariables) => withKeyRefreshRetry(
      async keys => apiRequest<SendResponse, { content: string; fileUrl?: string }>(
        'POST',
        `/messages/rooms/${id}/send`,
        { content: await encryptPayload(variables.payload, keys), ...(variables.fileUrl ? { fileUrl: variables.fileUrl } : {}) },
      ),
      id,
    ),
    onSuccess: (result, variables) => {
      if (variables.payload.kind === 'text') {
        const sentText = variables.payload.text;
        setText(current => current.trim() === sentText ? '' : current);
      }
      setMessages(previous => previous.some(item => item.id === result.message.id)
        ? previous
        : [...previous, { ...result.message, payload: variables.payload }]);
      if (user) void queryClient.invalidateQueries({ queryKey: ['amis-rooms', user.id] });
    },
    onError: error => Alert.alert('Secure send failed', error instanceof Error ? error.message : 'Try again'),
  });

  const sendText = () => {
    const value = text.trim();
    if (value && !send.isPending) send.mutate({ payload: { kind: 'text', text: value } });
  };
  const pickImage = async () => {
    if (send.isPending) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access required', 'Allow photo access to send an encrypted image.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const mime = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `image-${Date.now()}.${mime.split('/')[1] ?? 'jpg'}`;
      const encrypted = await encryptAndUploadImage(asset.uri, name, mime, asset.fileSize);
      send.mutate({ payload: { kind: 'attachment', attachment: encrypted.metadata }, fileUrl: encrypted.fileUrl });
    } catch (error) {
      Alert.alert('Encrypted image failed', error instanceof Error ? error.message : 'Try again');
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
                ? <SecureImage fileUrl={item.fileUrl} metadata={item.payload.attachment} />
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
      <View style={[styles.composer, {
        borderColor: colors.border,
        paddingBottom: Math.max(inset.bottom, 8),
        flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
      }]}>
        <Button size="icon" variant="outline" disabled={!isOnline || send.isPending} accessibilityLabel="Send encrypted image" onPress={() => void pickImage()}>
          <Ionicons name="image-outline" color={colors.foreground} size={20} />
        </Button>
        <Input value={text} onChangeText={setText} multiline placeholder="Encrypted message"
          textAlign={I18nManager.isRTL ? 'right' : 'left'}
          style={[styles.input, { writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' }]} />
        <Button size="icon" disabled={!isOnline || !text.trim() || send.isPending} loading={send.isPending} onPress={sendText}>
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
});