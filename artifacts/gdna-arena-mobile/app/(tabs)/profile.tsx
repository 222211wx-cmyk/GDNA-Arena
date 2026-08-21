import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, type TransactionItem } from '@/lib/api';

function getRank(xp: number): { label: string; color: string; next: number; progress: number } {
  const tiers = [
    { label: 'BRONZE',   color: '#cd7f32', min: 0,     max: 500   },
    { label: 'SILVER',   color: '#c0c0c0', min: 500,   max: 2000  },
    { label: 'GOLD',     color: '#ffd700', min: 2000,  max: 5000  },
    { label: 'PLATINUM', color: '#b0c4de', min: 5000,  max: 10000 },
    { label: 'DIAMOND',  color: '#00d4ff', min: 10000, max: 10000 },
  ];
  const tier = tiers.find(t => xp < t.max) ?? tiers[tiers.length - 1];
  const progress = tier.max === tier.min ? 1 : Math.min((xp - tier.min) / (tier.max - tier.min), 1);
  return { ...tier, next: tier.max, progress };
}

function StatPill({ label, value, color, colors }: {
  label: string; value: string | number; color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[pillStyles.pill, { backgroundColor: colors.card, borderColor: color + '44' }]}>
      <Text style={[pillStyles.val, { color }]}>{value}</Text>
      <Text style={[pillStyles.lbl, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}
const pillStyles = StyleSheet.create({
  pill: { flex: 1, alignItems: 'center', borderRadius: 14, borderWidth: 1, paddingVertical: 14 },
  val: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  lbl: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginTop: 2 },
});

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = styles(colors);

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => apiGet<{ transactions: TransactionItem[]; balance: number }>('/wallet/transactions'),
    enabled: !!user,
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'Leave the Empire?',
      'You will be signed out of GDNA Arena.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await logout();
            } catch (error) {
              Alert.alert(
                'Sign out incomplete',
                error instanceof Error ? error.message : 'Please try again.',
              );
            }
          },
        },
      ]
    );
  };

  if (!user) return null;
  const rank = getRank(user.xp);
  const winRate = user.gamesPlayed > 0
    ? Math.round((user.wins / user.gamesPlayed) * 100)
    : 0;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Profile hero */}
      <View style={s.hero}>
        <View style={[s.avatarCircle, { borderColor: rank.color }]}>
          <Text style={[s.avatarLetter, { color: rank.color }]}>{user.username[0].toUpperCase()}</Text>
        </View>
        <Text style={s.username}>{user.username}</Text>
        <View style={[s.rankBadge, { borderColor: rank.color }]}>
          <Ionicons name="shield" size={12} color={rank.color} />
          <Text style={[s.rankBadgeText, { color: rank.color }]}>{rank.label} CITIZEN</Text>
        </View>
      </View>

      {/* XP progress bar */}
      <View style={s.xpSection}>
        <View style={s.xpRow}>
          <Text style={s.xpLabel}>XP Progress</Text>
          <Text style={s.xpVal}>{user.xp.toLocaleString()} / {rank.next.toLocaleString()}</Text>
        </View>
        <View style={s.xpBar}>
          <View style={[s.xpFill, { width: `${Math.round(rank.progress * 100)}%` as any, backgroundColor: rank.color }]} />
        </View>
        <Text style={s.xpHint}>
          {rank.label === 'DIAMOND'
            ? 'Maximum rank achieved'
            : `${(rank.next - user.xp).toLocaleString()} XP to ${
                ['SILVER','GOLD','PLATINUM','DIAMOND'][['BRONZE','SILVER','GOLD','PLATINUM'].indexOf(rank.label)] ?? 'next rank'
              }`}
        </Text>
      </View>

      {/* Stats */}
      <View style={s.pillRow}>
        <StatPill label="COINS" value={user.balance.toLocaleString()} color="#ffd700" colors={colors} />
        <StatPill label="XP" value={user.xp.toLocaleString()} color={colors.primary} colors={colors} />
        <StatPill label="WINS" value={user.wins} color="#00ff88" colors={colors} />
      </View>
      <View style={[s.pillRow, { marginTop: 8 }]}>
        <StatPill label="PLAYED" value={user.gamesPlayed} color="#ff8c00" colors={colors} />
        <StatPill label="WIN RATE" value={`${winRate}%`} color="#9b59b6" colors={colors} />
        <StatPill label="RANK" value={rank.label} color={rank.color} colors={colors} />
      </View>

      {/* Transaction history */}
      <Text style={s.sectionTitle}>TRANSACTION HISTORY</Text>
      <View style={s.txCard}>
        {txLoading ? (
          <View style={s.txEmpty}>
            <Text style={s.txEmptyText}>Loading…</Text>
          </View>
        ) : !txData?.transactions?.length ? (
          <View style={s.txEmpty}>
            <Ionicons name="receipt-outline" size={28} color={colors.mutedForeground} />
            <Text style={s.txEmptyText}>No transactions yet. Play a game!</Text>
          </View>
        ) : (
          txData.transactions.slice(0, 15).map((tx, i) => (
            <View key={tx.id} style={[s.txRow, i < Math.min(txData.transactions.length, 15) - 1 && s.txRowBorder]}>
              <View style={[s.txIcon, { backgroundColor: tx.amount >= 0 ? '#001a0d' : '#1a0000' }]}>
                <Ionicons
                  name={tx.amount >= 0 ? 'arrow-down' : 'arrow-up'}
                  size={14}
                  color={tx.amount >= 0 ? '#00ff88' : '#ff4444'}
                />
              </View>
              <View style={s.txInfo}>
                <Text style={s.txDesc} numberOfLines={1}>{tx.description}</Text>
                <Text style={s.txDate}>{new Date(tx.createdAt).toLocaleDateString()}</Text>
              </View>
              <Text style={[s.txAmount, { color: tx.amount >= 0 ? '#00ff88' : '#ff4444' }]}>
                {tx.amount >= 0 ? '+' : ''}{tx.amount}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Logout */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={colors.destructive} />
        <Text style={s.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hero: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
  avatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.accent, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarLetter: { fontSize: 40, fontFamily: 'Inter_700Bold' },
  username: { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
  rankBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  rankBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  xpSection: { marginHorizontal: 20, marginBottom: 20 },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  xpLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
  xpVal: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.foreground },
  xpBar: {
    height: 6, backgroundColor: colors.secondary, borderRadius: 3, overflow: 'hidden', marginBottom: 6,
  },
  xpFill: { height: '100%', borderRadius: 3 },
  xpHint: { fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  pillRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  sectionTitle: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.mutedForeground,
    letterSpacing: 2, paddingHorizontal: 20, marginTop: 24, marginBottom: 12,
  },
  txCard: {
    marginHorizontal: 16, backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    marginBottom: 24,
  },
  txEmpty: { padding: 28, alignItems: 'center', gap: 10 },
  txEmptyText: { fontSize: 14, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  txRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  txIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1 },
  txDesc: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.foreground },
  txDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  txAmount: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  logoutBtn: {
    marginHorizontal: 16, borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1a0000', borderWidth: 1, borderColor: colors.destructive + '44',
  },
  logoutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.destructive },
});
