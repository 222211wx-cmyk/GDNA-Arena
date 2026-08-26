import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getApiBase, getHeaders } from '@/lib/api';
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const STARTERS = [
  'Who is the greatest athlete of all time?',
  'What is my empire rank?',
  'Tell me about GlobalStar voting',
  'How do I earn more coins?',
];

function MessageBubble({ msg, colors }: { msg: Message; colors: ReturnType<typeof useColors> }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[bubbleStyles.row, isUser && bubbleStyles.rowUser]}>
      {!isUser && (
        <View style={[bubbleStyles.avatar, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
          <MaterialCommunityIcons name="robot" size={16} color={colors.primary} />
        </View>
      )}
      <View style={[
        bubbleStyles.bubble,
        isUser
          ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
          : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
      ]}>
        <Text style={[bubbleStyles.text, { color: isUser ? colors.primaryForeground : colors.foreground }]}>
          {msg.content}
        </Text>
      </View>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 12, paddingHorizontal: 16, alignItems: 'flex-end', gap: 8 },
  rowUser: { flexDirection: 'row-reverse' },
  avatar: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  text: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
});

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Welcome${user ? `, ${user.username}` : ''}! I am GDN-AI — the sovereign intelligence of the empire. Ask me anything about legends, games, GlobalStar voting, or your progress.`,
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<FlatList>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const s = styles(colors);

  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      ts: Date.now(),
    };

    setMessages(prev => [userMsg, ...prev]);
    setInput('');
    setStreaming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const aiId = `a-${Date.now()}`;

    try {
      const res = await fetch(`${getApiBase()}/chat`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ message: content, lang: 'en' }),
      });

      if (!res.ok) throw new Error(`Chat failed: ${res.status}`);

      // POST /chat returns { reply: string }
      const data = await res.json() as { reply?: string; message?: string };
      const reply = data?.reply ?? data?.message ?? 'The empire AI is processing your request.';

      setMessages(prev => [{
        id: aiId, role: 'assistant', content: reply, ts: Date.now(),
      }, ...prev]);
    } catch {
      setMessages(prev => [{
        id: aiId,
        role: 'assistant',
        content: 'The empire AI is currently offline. Please try again shortly.',
        ts: Date.now(),
      }, ...prev]);
    } finally {
      setStreaming(false);
    }
  }, [streaming]);

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: topPad }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={[s.headerAvatar, { backgroundColor: colors.accent }]}>
            <MaterialCommunityIcons name="robot" size={18} color={colors.primary} />
          </View>
          <View>
            <Text style={s.headerTitle}>GDN-AI</Text>
            <View style={s.statusRow}>
              <View style={s.statusDot} />
              <Text style={s.statusText}>Sovereign Intelligence · Online</Text>
            </View>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Messages — inverted FlatList */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => <MessageBubble msg={item} colors={colors} />}
        inverted
        style={s.list}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          streaming ? (
            <View style={s.typingRow}>
              <View style={[s.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[s.typingText, { color: colors.mutedForeground }]}>GDN-AI is thinking…</Text>
              </View>
            </View>
          ) : null
        }
      />

      {/* Starters */}
      {messages.length === 1 && (
        <View style={s.startersRow}>
          {STARTERS.map(q => (
            <TouchableOpacity
              key={q}
              style={[s.starter, { borderColor: colors.border }]}
              onPress={() => sendMessage(q)}
              activeOpacity={0.75}
            >
              <Text style={[s.starterText, { color: colors.mutedForeground }]} numberOfLines={2}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View style={[s.inputBar, { paddingBottom: bottomPad + 8 }]}>
        <TextInput
          style={[s.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask the empire AI…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={() => sendMessage(input)}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, { backgroundColor: input.trim() && !streaming ? colors.primary : colors.secondary }]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || streaming}
          activeOpacity={0.8}
        >
          {streaming ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Ionicons name="send" size={18} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nativeTheme.colors.dark.chart3 },
  statusText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  list: { flex: 1 },
  typingRow: { paddingHorizontal: 16, paddingBottom: 8 },
  typingBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start', borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, maxWidth: '60%',
  },
  typingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  startersRow: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12,
    paddingBottom: 8, gap: 8,
  },
  starter: {
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    maxWidth: '47%',
  },
  starterText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16,
    paddingTop: 10, paddingBottom: 10, fontSize: 14, fontFamily: 'Inter_400Regular',
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
