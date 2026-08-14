import React from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, type LeaderboardPlayer } from '@/lib/api';

function getRankLabel(xp: number): { label: string; color: string } {
  if (xp >= 10000) return { label: 'DIAMOND', color: '#00d4ff' };
  if (xp >= 5000)  return { label: 'PLATINUM', color: '#b0c4de' };
  if (xp >= 2000)  return { label: 'GOLD', color: '#ffd700' };
  if (xp >= 500)   return { label: 'SILVER', color: '#c0c0c0' };
  return { label: 'BRONZE', color: '#cd7f32' };
}

const MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

export default function LeaderboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = styles(colors);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiGet<{ players: LeaderboardPlayer[] }>('/leaderboard'),
    staleTime: 30_000,
  });

  const players = data?.players ?? [];
  const myPosition = user ? players.findIndex(p => p.id === user.id) : -1;

  const renderPlayer = ({ item, index }: { item: LeaderboardPlayer; index: number }) => {
    const isMe = user?.id === item.id;
    const medal = index < 3;
    const medalColor = medal ? MEDAL_COLORS[index] : null;
    const rank = getRankLabel(item.xp);

    return (
      <View style={[
        s.row,
        isMe && s.myRow,
        index < players.length - 1 && s.rowBorder,
      ]}>
        {/* Position */}
        <View style={s.posCol}>
          {medal ? (
            <Ionicons name="medal" size={22} color={medalColor!} />
          ) : (
            <Text style={s.posNum}>{index + 1}</Text>
          )}
        </View>

        {/* Avatar circle */}
        <View style={[s.avatar, isMe && { borderColor: colors.primary, borderWidth: 2 }]}>
          <Text style={[s.avatarLetter, { color: isMe ? colors.primary : colors.foreground }]}>
            {item.username[0].toUpperCase()}
          </Text>
        </View>

        {/* Name + rank */}
        <View style={s.nameCol}>
          <View style={s.nameRow}>
            <Text style={[s.username, isMe && { color: colors.primary }]} numberOfLines={1}>
              {item.username}
            </Text>
            {isMe && <Text style={s.youBadge}>YOU</Text>}
          </View>
          <Text style={[s.rankLabel, { color: rank.color }]}>{rank.label}</Text>
        </View>

        {/* Stats */}
        <View style={s.statsCol}>
          <Text style={s.xpVal}>{item.xp.toLocaleString()}</Text>
          <Text style={s.xpLbl}>XP</Text>
        </View>
        <View style={s.statsCol}>
          <Text style={s.winsVal}>{item.wins}</Text>
          <Text style={s.winsLbl}>WINS</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <Text style={s.title}>Leaderboard</Text>
        <Text style={s.subtitle}>Top empire citizens by XP</Text>

        {/* My position banner */}
        {user && myPosition >= 0 && (
          <View style={s.myPosBanner}>
            <Ionicons name="person-circle" size={16} color={colors.primary} />
            <Text style={s.myPosText}>
              Your position: <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>#{myPosition + 1}</Text>
              {'  '}·{'  '}
              {user.xp.toLocaleString()} XP
            </Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={s.loading}>
          <Ionicons name="hourglass" size={32} color={colors.primary} />
          <Text style={s.loadingText}>Loading rankings…</Text>
        </View>
      ) : (
        <FlatList
          data={players}
          keyExtractor={p => String(p.id)}
          renderItem={renderPlayer}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
          }}
          style={s.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="bar-chart-outline" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>No rankings yet. Play a game!</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 2 },
  subtitle: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  myPosBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: colors.primary + '44',
  },
  myPosText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.foreground },
  list: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    gap: 10, backgroundColor: colors.card,
  },
  myRow: { backgroundColor: colors.accent },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  posCol: { width: 36, alignItems: 'center' },
  posNum: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.mutedForeground },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  nameCol: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  username: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground, flexShrink: 1 },
  youBadge: {
    fontSize: 9, fontFamily: 'Inter_700Bold', color: colors.primaryForeground,
    backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
    letterSpacing: 0.5,
  },
  rankLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  statsCol: { alignItems: 'center', minWidth: 44 },
  xpVal: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  xpLbl: { fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, letterSpacing: 0.5 },
  winsVal: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#00ff88' },
  winsLbl: { fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, letterSpacing: 0.5 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 15, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', textAlign: 'center' },
});
