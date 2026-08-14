import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { apiGet, apiPost, type GsFigure, type GsDomain } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function GlobalStarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [domain, setDomain] = useState<string>('all');
  const [voted, setVoted] = useState<Set<number>>(new Set());

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = styles(colors);

  const { data: domainsData } = useQuery({
    queryKey: ['gs-domains'],
    queryFn: () => apiGet<{ domains: GsDomain[] }>('/gs/domains'),
    staleTime: 120_000,
  });

  const {
    data: figuresData,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['gs-figures', domain],
    queryFn: () =>
      apiGet<{ figures: GsFigure[] }>(`/gs/figures${domain !== 'all' ? `?domain=${domain}&limit=20` : '?limit=30'}`),
    staleTime: 30_000,
  });

  const voteMutation = useMutation({
    mutationFn: (figureId: number) => apiPost(`/gs/figures/${figureId}/vote`),
    onSuccess: (_data, figureId) => {
      setVoted(prev => new Set(prev).add(figureId));
      qc.invalidateQueries({ queryKey: ['gs-figures'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const domains = [{ id: 'all', label: 'All', icon: '🌍' }, ...(domainsData?.domains ?? [])];
  const figures = figuresData?.figures ?? [];

  const renderFigure = ({ item, index }: { item: GsFigure; index: number }) => {
    const hasVoted = voted.has(item.id);
    const isVoting = voteMutation.isPending && voteMutation.variables === item.id;
    const rankColor = index === 0 ? '#ffd700' : index === 1 ? '#c0c0c0' : index === 2 ? '#cd7f32' : colors.mutedForeground;

    return (
      <View style={[s.figureCard, index === 0 && s.topCard]}>
        {/* Rank */}
        <View style={s.rankCol}>
          <Text style={[s.rankNum, { color: rankColor }]}>#{item.rank}</Text>
        </View>

        {/* Avatar */}
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={s.avatar} />
        ) : (
          <View style={[s.avatarPlaceholder, { backgroundColor: colors.accent }]}>
            <Text style={[s.avatarInitial, { color: colors.primary }]}>{item.name[0]}</Text>
          </View>
        )}

        {/* Info */}
        <View style={s.figureInfo}>
          <Text style={s.figureName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.figureMeta} numberOfLines={1}>
            {item.domainLabel} · {item.nationality}
          </Text>
          <View style={s.voteCountRow}>
            <Ionicons name="star" size={11} color="#ffd700" />
            <Text style={s.voteCount}>{item.votes.toLocaleString()} votes</Text>
          </View>
        </View>

        {/* Vote button */}
        <TouchableOpacity
          style={[
            s.voteBtn,
            hasVoted
              ? { backgroundColor: colors.accent, borderColor: colors.primary }
              : { backgroundColor: colors.primary },
          ]}
          onPress={() => !hasVoted && !isVoting && user && voteMutation.mutate(item.id)}
          disabled={hasVoted || isVoting || !user}
          activeOpacity={0.75}
        >
          {isVoting ? (
            <ActivityIndicator size="small" color={hasVoted ? colors.primary : '#000'} />
          ) : (
            <Ionicons
              name={hasVoted ? 'checkmark' : 'thumbs-up'}
              size={16}
              color={hasVoted ? colors.primary : '#000'}
            />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.root}>
      {/* Fixed header + domain tabs */}
      <View style={[s.stickyHeader, { paddingTop: topPad + 12 }]}>
        <Text style={s.title}>GlobalStar</Text>
        <Text style={s.subtitle}>Vote for global legends across 10 domains</Text>

        {/* Domain filter */}
        <FlatList
          data={domains}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={d => d.id}
          contentContainerStyle={s.domainRow}
          renderItem={({ item: d }) => (
            <TouchableOpacity
              style={[s.domainChip, domain === d.id && s.domainChipActive]}
              onPress={() => { setDomain(d.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              activeOpacity={0.75}
            >
              <Text style={[s.domainText, domain === d.id && s.domainTextActive]}>
                {d.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Figures list */}
      {isLoading ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={s.loadingText}>Loading legends…</Text>
        </View>
      ) : figures.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="star-outline" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyText}>No figures found</Text>
        </View>
      ) : (
        <FlatList
          data={figures}
          keyExtractor={f => String(f.id)}
          renderItem={renderFigure}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
          }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        />
      )}

      {!user && (
        <View style={s.loginBanner}>
          <Ionicons name="lock-closed" size={14} color={colors.mutedForeground} />
          <Text style={s.loginBannerText}>Login to vote for your favourites</Text>
        </View>
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  stickyHeader: {
    backgroundColor: colors.background, paddingHorizontal: 20, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 2 },
  subtitle: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 14 },
  domainRow: { paddingRight: 20, gap: 8 },
  domainChip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border,
  },
  domainChipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  domainText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
  domainTextActive: { color: colors.primary, fontFamily: 'Inter_700Bold' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 16, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
  figureCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    marginBottom: 10, padding: 12, gap: 10,
  },
  topCard: { borderColor: '#ffd70044', backgroundColor: '#0d0d00' },
  rankCol: { width: 32, alignItems: 'center' },
  rankNum: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.muted },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  figureInfo: { flex: 1 },
  figureName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 2 },
  figureMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 4 },
  voteCountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#ffd700' },
  voteBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  loginBanner: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    backgroundColor: colors.secondary, borderRadius: 12, paddingVertical: 10,
    paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  loginBannerText: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
});
