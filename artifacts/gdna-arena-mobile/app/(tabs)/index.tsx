import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Platform, ActivityIndicator, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { useAuth } from '@/contexts/AuthContext';
import { apiPost, apiGet } from '@/lib/api';

interface Stats { totalCitizens: number; totalVotes: number; gamesPlayed: number; }

function getRank(xp: number): { label: string; color: string } {
  if (xp >= 10000) return { label: 'DIAMOND', color: nativeTheme.colors.dark.chart2 };
  if (xp >= 5000)  return { label: 'PLATINUM', color: nativeTheme.colors.dark.chart2 };
  if (xp >= 2000)  return { label: 'GOLD', color: nativeTheme.colors.dark.chart1 };
  if (xp >= 500)   return { label: 'SILVER', color: nativeTheme.colors.dark.mutedForeground };
  return { label: 'BRONZE', color: nativeTheme.colors.dark.chart1 };
}

function StatCard({ label, value, icon, color, colors }: {
  label: string; value: string | number; icon: string; color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[cardStyles.card, { borderColor: color + '44', backgroundColor: colors.card }]}>
      <View style={[cardStyles.iconWrap, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon as never} size={18} color={color} />
      </View>
      <Text style={[cardStyles.value, { color: colors.foreground }]}>{value}</Text>
      <Text style={[cardStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flex: 1, borderRadius: 14, borderWidth: 1, padding: 14,
    alignItems: 'center', gap: 6, minWidth: 90,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  label: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, textAlign: 'center' },
});

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data: stats } = useQuery<Stats>({
    queryKey: ['home-stats'],
    queryFn: () => apiGet<Stats>('/citizens/stats').catch(() => ({ totalCitizens: 0, totalVotes: 0, gamesPlayed: 0 })),
    staleTime: 60_000,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['home-lb'],
    queryFn: () => apiGet<{ players: { username: string; xp: number }[] }>('/leaderboard'),
    staleTime: 60_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshUser();
    setRefreshing(false);
  }, [refreshUser]);

  const claimDaily = async () => {
    if (!user?.canClaimDaily || claiming) return;
    setClaiming(true);
    try {
      const res = await apiPost<{ coinsEarned: number; newBalance: number }>('/rewards/daily');
      setClaimMsg(`+${res.coinsEarned} coins claimed!`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshUser();
      setTimeout(() => setClaimMsg(''), 4000);
    } catch {
      setClaimMsg('Already claimed today');
      setTimeout(() => setClaimMsg(''), 3000);
    } finally {
      setClaiming(false);
    }
  };

  const rank = user ? getRank(user.xp) : null;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = styles(colors);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Welcome back,</Text>
          <Text style={s.username}>{user?.username ?? '—'}</Text>
        </View>
        <View style={s.headerRight}>
          {rank && (
            <View style={[s.rankBadge, { borderColor: rank.color }]}>
              <Text style={[s.rankText, { color: rank.color }]}>{rank.label}</Text>
            </View>
          )}
          <TouchableOpacity style={s.chatBtn} onPress={() => router.push('/chat')}>
            <MaterialCommunityIcons name="robot" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stat row */}
      <View style={s.statRow}>
        <StatCard label="COINS" value={user?.balance ?? 0} icon="wallet" color="#ffd700" colors={colors} />
        <StatCard label="XP" value={user?.xp ?? 0} icon="flash" color={colors.primary} colors={colors} />
        <StatCard label="WINS" value={user?.wins ?? 0} icon="trophy" color="#00ff88" colors={colors} />
        <StatCard label="PLAYED" value={user?.gamesPlayed ?? 0} icon="game-controller" color="#ff8c00" colors={colors} />
      </View>

      {/* Daily reward */}
      {user?.canClaimDaily && !claimMsg ? (
        <TouchableOpacity style={s.dailyBtn} onPress={claimDaily} activeOpacity={0.85}>
          {claiming ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Ionicons name="gift" size={18} color={colors.primaryForeground} />
              <Text style={s.dailyText}>Claim Daily +100 Coins</Text>
            </>
          )}
        </TouchableOpacity>
      ) : claimMsg ? (
        <View style={s.claimMsgBox}>
          <Ionicons name="checkmark-circle" size={16} color="#00ff88" />
          <Text style={s.claimMsgText}>{claimMsg}</Text>
        </View>
      ) : null}

      {/* Empire banner */}
      <View style={s.banner}>
        <View style={s.bannerGlow} />
        <Text style={s.bannerLabel}>EMPIRE ETERNAL</Text>
        <Text style={s.bannerSub}>The Sovereign Digital Civilization</Text>
        <View style={s.bannerStats}>
          <View style={s.bannerStat}>
            <Text style={s.bannerStatVal}>{stats?.totalCitizens?.toLocaleString() ?? '—'}</Text>
            <Text style={s.bannerStatLbl}>Citizens</Text>
          </View>
          <View style={s.bannerDivider} />
          <View style={s.bannerStat}>
            <Text style={s.bannerStatVal}>{stats?.totalVotes?.toLocaleString() ?? '—'}</Text>
            <Text style={s.bannerStatLbl}>Votes</Text>
          </View>
          <View style={s.bannerDivider} />
          <View style={s.bannerStat}>
            <Text style={s.bannerStatVal}>{stats?.gamesPlayed?.toLocaleString() ?? '—'}</Text>
            <Text style={s.bannerStatLbl}>Games</Text>
          </View>
        </View>
      </View>

      {/* Quick actions */}
      <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
      <View style={s.actionsGrid}>
        {[
          { label: 'Play Games', icon: 'game-controller', color: nativeTheme.colors.dark.chart1, route: '/(tabs)/games' },
          { label: 'Vote', icon: 'star', color: nativeTheme.colors.dark.chart1, route: '/(tabs)/globalstar' },
          { label: 'Leaderboard', icon: 'bar-chart', color: colors.primary, route: '/(tabs)/leaderboard' },
          { label: 'GDN-AI Chat', icon: 'chatbubble-ellipses', color: nativeTheme.colors.dark.chart3, route: '/chat' },
          { label: 'Open Clip', icon: 'play-circle', color: colors.primary, route: '/clips' },
        ].map(a => (
          <TouchableOpacity
            key={a.label}
            style={[s.actionCard, { borderColor: a.color + '44' }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(a.route as never); }}
            activeOpacity={0.75}
          >
            <View style={[s.actionIcon, { backgroundColor: a.color + '22' }]}>
              <Ionicons name={a.icon as never} size={24} color={a.color} />
            </View>
            <Text style={s.actionLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Top players */}
      {leaderboard?.players && leaderboard.players.length > 0 && (
        <>
          <Text style={s.sectionTitle}>TOP PLAYERS</Text>
          <View style={s.lbCard}>
            {leaderboard.players.slice(0, 5).map((p, i) => (
              <View key={p.username} style={[s.lbRow, i < 4 && s.lbRowBorder]}>
                <Text style={[s.lbPos, i === 0 && { color: nativeTheme.colors.dark.chart1 }, i === 1 && { color: nativeTheme.colors.dark.mutedForeground }, i === 2 && { color: nativeTheme.colors.dark.chart1 }]}>
                  {i + 1}
                </Text>
                <Text style={s.lbName}>{p.username}</Text>
                <Text style={s.lbXp}>{p.xp.toLocaleString()} XP</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 20,
  },
  greeting: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  username: { fontSize: 22, color: colors.foreground, fontFamily: 'Inter_700Bold' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankBadge: {
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  rankText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  chatBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  dailyBtn: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: colors.primary,
    borderRadius: 14, paddingVertical: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  dailyText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primaryForeground },
  claimMsgBox: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: nativeTheme.colors.dark.accent,
    borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: nativeTheme.colors.dark.chart3,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  claimMsgText: { fontSize: 14, color: nativeTheme.colors.dark.chart3, fontFamily: 'Inter_600SemiBold' },
  banner: {
    marginHorizontal: 16, marginBottom: 24, backgroundColor: colors.accent,
    borderRadius: 16, borderWidth: 1, borderColor: colors.primary + '44',
    padding: 20, alignItems: 'center', overflow: 'hidden',
  },
  bannerGlow: {
    position: 'absolute', top: -40, left: '25%', right: '25%',
    height: 80, borderRadius: 40,
    backgroundColor: colors.primary, opacity: 0.12,
  },
  bannerLabel: {
    fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.primary,
    letterSpacing: 4, marginBottom: 4,
  },
  bannerSub: { fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  bannerStats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bannerStat: { alignItems: 'center' },
  bannerStatVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground },
  bannerStatLbl: { fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  bannerDivider: { width: 1, height: 28, backgroundColor: colors.border },
  sectionTitle: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.mutedForeground,
    letterSpacing: 2, paddingHorizontal: 20, marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12,
    gap: 10, marginBottom: 24,
  },
  actionCard: {
    width: '46%', backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, padding: 16,
    alignItems: 'center', gap: 10,
  },
  actionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground, textAlign: 'center' },
  lbCard: {
    marginHorizontal: 16, marginBottom: 24, backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  lbRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
  },
  lbRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lbPos: { width: 28, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.mutedForeground },
  lbName: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.foreground },
  lbXp: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary },
});
