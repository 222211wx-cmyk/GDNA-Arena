import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { apiPost, type PlayResult } from '@/lib/api';

const GAMES = [
  {
    id: 'arena-strike',
    name: 'Arena Strike',
    desc: 'Fast-paced head-to-head battle in the digital arena',
    icon: 'flash' as const,
    color: '#ff4444',
    reward: 200,
    winChance: '45%',
    difficulty: 'Hard',
  },
  {
    id: 'neon-racer',
    name: 'Neon Racer',
    desc: 'Race through neon highways in a digital speed duel',
    icon: 'speedometer' as const,
    color: '#00d4ff',
    reward: 80,
    winChance: '60%',
    difficulty: 'Medium',
  },
  {
    id: 'crypto-clash',
    name: 'Crypto Clash',
    desc: 'Clash in the crypto arena for coin supremacy',
    icon: 'logo-bitcoin' as const,
    color: '#ffd700',
    reward: 120,
    winChance: '50%',
    difficulty: 'Hard',
  },
  {
    id: 'globalstar-tournament',
    name: 'GlobalStar Tournament',
    desc: 'Compete for supremacy in the GlobalStar voting league',
    icon: 'trophy' as const,
    color: '#9b59b6',
    reward: 200,
    winChance: '12%',
    difficulty: 'Expert',
  },
];

function ResultModal({
  visible, result, onClose, colors,
}: {
  visible: boolean;
  result: PlayResult | null;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (!result) return null;
  // Standard games use `win`; GlobalStar tournament uses `isWin`
  const isWin = result.win ?? result.isWin ?? false;
  const accentColor = isWin ? '#00ff88' : '#ff4444';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.card, { backgroundColor: colors.card, borderColor: accentColor }]}>
          <View style={[modalStyles.iconCircle, { backgroundColor: accentColor + '22' }]}>
            <Ionicons name={isWin ? 'trophy' : 'close-circle'} size={48} color={accentColor} />
          </View>
          <Text style={[modalStyles.headline, { color: accentColor }]}>
            {isWin ? 'VICTORY!' : 'DEFEAT'}
          </Text>
          <Text style={[modalStyles.message, { color: colors.foreground }]}>{result.message}</Text>

          <View style={[modalStyles.rewardRow, { borderColor: colors.border }]}>
            <View style={modalStyles.rewardItem}>
              <Text style={[modalStyles.rewardVal, { color: '#ffd700' }]}>+{result.coinsEarned}</Text>
              <Text style={[modalStyles.rewardLbl, { color: colors.mutedForeground }]}>COINS</Text>
            </View>
            <View style={[modalStyles.rewardDivider, { backgroundColor: colors.border }]} />
            <View style={modalStyles.rewardItem}>
              <Text style={[modalStyles.rewardVal, { color: colors.primary }]}>+{result.xpEarned}</Text>
              <Text style={[modalStyles.rewardLbl, { color: colors.mutedForeground }]}>XP</Text>
            </View>
            <View style={[modalStyles.rewardDivider, { backgroundColor: colors.border }]} />
            <View style={modalStyles.rewardItem}>
              <Text style={[modalStyles.rewardVal, { color: '#ffd700' }]}>{result.newBalance}</Text>
              <Text style={[modalStyles.rewardLbl, { color: colors.mutedForeground }]}>BALANCE</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[modalStyles.closeBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={[modalStyles.closeBtnText, { color: colors.primaryForeground }]}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center' },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  headline: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: 3, marginBottom: 8 },
  message: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 24 },
  rewardRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, width: '100%', marginBottom: 20 },
  rewardItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  rewardDivider: { width: 1 },
  rewardVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  rewardLbl: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 1, marginTop: 2 },
  closeBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 },
  closeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});

export default function GamesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateBalance, submitBirthDate } = useAuth();
  const [playing, setPlaying] = useState<string | null>(null);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [savingBirthDate, setSavingBirthDate] = useState(false);
  const [ageError, setAgeError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = styles(colors);

  const playGame = async (gameId: string) => {
    if (!user || user.isAdult !== true || playing) return;
    setAgeError('');
    setPlaying(gameId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // GlobalStar tournament uses a dedicated endpoint
      const endpoint = gameId === 'globalstar-tournament'
        ? '/games/globalstar/tournament'
        : `/games/${gameId}/play`;
      const res = await apiPost<PlayResult>(endpoint);
      setResult(res);
      setModalVisible(true);
      updateBalance(res.newBalance);
      const won = res.win ?? res.isWin ?? false;
      if (won) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('هذا القسم يتطلب +18')) {
        setAgeError('هذا القسم يتطلب +18 حسب قوانين بلدك');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPlaying(null);
    }
  };

  const saveBirthDate = async () => {
    setAgeError('');
    setSavingBirthDate(true);
    try {
      await submitBirthDate(birthDate);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setAgeError(e instanceof Error ? e.message : 'تعذر التحقق من العمر');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingBirthDate(false);
    }
  };

  const canPlay = user?.isAdult === true;

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Gaming Arena</Text>
          <View style={s.balancePill}>
            <Ionicons name="wallet" size={13} color="#ffd700" />
            <Text style={s.balanceText}>{user?.balance ?? 0}</Text>
          </View>
        </View>
        <Text style={s.subtitle}>Play · Win · Earn Crypto Coins</Text>

        <View style={s.ageBanner}>
          <Ionicons name="warning" size={18} color={colors.primary} />
          <Text style={s.ageBannerText}>هذا القسم يتطلب +18 حسب قوانين بلدك</Text>
        </View>

        {!canPlay ? (
          <View style={s.ageCard}>
            <Ionicons
              name={user?.isAdult === false ? 'lock-closed' : 'calendar'}
              size={34}
              color={user?.isAdult === false ? colors.destructive : colors.primary}
            />
            {user?.isAdult === false ? (
              <>
                <Text style={s.ageTitle}>الدخول إلى الألعاب ممنوع لأقل من 18 سنة</Text>
                <Text style={s.ageBody}>باقي أقسام الإمبراطورية متاحة لك بدون شرط السن.</Text>
              </>
            ) : (
              <>
                <Text style={s.ageTitle}>أدخل تاريخ ميلادك لمرة واحدة</Text>
                <Text style={s.ageBody}>التسجيل متاح لجميع الأعمار. التحقق يخص قسم الألعاب فقط.</Text>
                <TextInput
                  style={s.birthDateInput}
                  value={birthDate}
                  onChangeText={setBirthDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  maxLength={10}
                  testID="games-birth-date"
                />
                <TouchableOpacity
                  style={[s.verifyButton, (!birthDate || savingBirthDate) && s.verifyButtonDisabled]}
                  onPress={saveBirthDate}
                  disabled={!birthDate || savingBirthDate}
                  activeOpacity={0.8}
                  testID="verify-games-age"
                >
                  {savingBirthDate ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={s.verifyButtonText}>تحقق من العمر</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
            {ageError ? <Text style={s.ageError}>{ageError}</Text> : null}
          </View>
        ) : GAMES.map(game => (
          <View key={game.id} style={[s.gameCard, { borderColor: game.color + '33' }]}>
            {/* Top accent line */}
            <View style={[s.accentLine, { backgroundColor: game.color }]} />

            <View style={s.gameContent}>
              <View style={[s.gameIconWrap, { backgroundColor: game.color + '22' }]}>
                <Ionicons name={game.icon} size={28} color={game.color} />
              </View>

              <View style={s.gameInfo}>
                <Text style={s.gameName}>{game.name}</Text>
                <Text style={s.gameDesc} numberOfLines={2}>{game.desc}</Text>

                <View style={s.gameMeta}>
                  <View style={s.metaChip}>
                    <Ionicons name="flash" size={11} color="#ffd700" />
                    <Text style={[s.metaText, { color: '#ffd700' }]}>+{game.reward} coins</Text>
                  </View>
                  <View style={s.metaChip}>
                    <Ionicons name="shield-checkmark" size={11} color={colors.primary} />
                    <Text style={[s.metaText, { color: colors.primary }]}>{game.winChance} win</Text>
                  </View>
                  <View style={s.metaChip}>
                    <Text style={[s.metaText, { color: colors.mutedForeground }]}>{game.difficulty}</Text>
                  </View>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[s.playBtn, { backgroundColor: game.color }, playing === game.id && s.playBtnLoading]}
              onPress={() => playGame(game.id)}
              disabled={!!playing}
              activeOpacity={0.8}
            >
              {playing === game.id ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <>
                  <Ionicons name="play" size={16} color="#000" />
                  <Text style={s.playBtnText}>Play Now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ))}

        {/* Info banner */}
        {canPlay ? (
          <View style={s.infoBanner}>
            <MaterialCommunityIcons name="information" size={16} color={colors.mutedForeground} />
            <Text style={s.infoText}>Each game awards coins and XP. Win to climb the empire leaderboard.</Text>
          </View>
        ) : null}
      </ScrollView>

      <ResultModal
        visible={modalVisible}
        result={result}
        onClose={() => setModalVisible(false)}
        colors={colors}
      />
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 4,
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.foreground },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#1a1500', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#ffd70033',
  },
  balanceText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#ffd700' },
  subtitle: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', paddingHorizontal: 20, marginBottom: 24 },
  ageBanner: {
    marginHorizontal: 16, marginBottom: 16, padding: 14, flexDirection: 'row',
    alignItems: 'center', gap: 8, backgroundColor: colors.secondary,
    borderRadius: 12, borderWidth: 1, borderColor: colors.primary,
  },
  ageBannerText: {
    flex: 1, color: colors.primary, fontFamily: 'Inter_700Bold',
    fontSize: 14, textAlign: 'right', writingDirection: 'rtl',
  },
  ageCard: {
    marginHorizontal: 16, padding: 22, alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
  },
  ageTitle: {
    color: colors.foreground, fontSize: 17, fontFamily: 'Inter_700Bold',
    textAlign: 'center', writingDirection: 'rtl',
  },
  ageBody: {
    color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular',
    lineHeight: 20, textAlign: 'center', writingDirection: 'rtl',
  },
  birthDateInput: {
    width: '100%', backgroundColor: colors.secondary, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: colors.foreground, textAlign: 'center',
  },
  verifyButton: {
    width: '100%', backgroundColor: colors.primary, borderRadius: 12,
    minHeight: 48, alignItems: 'center', justifyContent: 'center',
  },
  verifyButtonDisabled: { opacity: 0.6 },
  verifyButtonText: {
    color: colors.primaryForeground, fontFamily: 'Inter_700Bold',
    fontSize: 14, writingDirection: 'rtl',
  },
  ageError: {
    color: colors.destructive, fontFamily: 'Inter_500Medium',
    fontSize: 12, textAlign: 'center', writingDirection: 'rtl',
  },
  gameCard: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  accentLine: { height: 3, width: '100%' },
  gameContent: { flexDirection: 'row', padding: 16, gap: 14, alignItems: 'flex-start' },
  gameIconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  gameInfo: { flex: 1 },
  gameName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
  gameDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 10, lineHeight: 18 },
  gameMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.secondary, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
  },
  metaText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  playBtn: {
    marginHorizontal: 16, marginBottom: 16, borderRadius: 12,
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  playBtnLoading: { opacity: 0.7 },
  playBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#000' },
  infoBanner: {
    marginHorizontal: 16, padding: 14, flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: colors.secondary, borderRadius: 12,
  },
  infoText: { flex: 1, fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
