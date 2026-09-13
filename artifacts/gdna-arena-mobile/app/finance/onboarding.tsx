/**
 * Organizer onboarding wizard — Arena Qaisypro.
 *
 * Backend contract:
 * - CURRENT_TERMS_VERSION is fetched from GET /finance/terms → { currentVersion }.
 *   Acceptance is disabled while loading or if the endpoint errors — no hardcoded
 *   version, no probe, no fallback string.
 *
 * - country must be exactly 2-letter ISO 3166-1 alpha-2 (backend regex: /^[A-Za-z]{2}$/).
 * - accept-terms body: { ownerType, displayName, country, termsVersion, accepted: true }.
 * - Accepting terms registers the beneficiary record used by the simulated
 *   ledger. There is no hosted provider handoff.
 *
 * - Bank details are collected only in the manual payout panel.
 * - Mutations are blocked when offline.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { Spinner } from '@workspace/gdna-ds/components/native/spinner';
import { Badge } from '@workspace/gdna-ds/components/native/badge';

import { useOnline } from '@/contexts/OnlineContext';
import {
  useFinanceTerms,
  useAcceptTerms,
  type AcceptTermsBody,
} from '@/hooks/use-finance';

// ─── Constants ────────────────────────────────────────────────────────────────

const SETTLEMENT_SHARE_ORGANIZER = 70;
const SETTLEMENT_SHARE_PLATFORM = 30;

type EntityType = AcceptTermsBody['ownerType'];

const ENTITY_OPTIONS: Array<{
  value: EntityType;
  label: string;
  description: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  {
    value: 'citizen',
    label: 'Individual citizen',
    description: 'Personal organizer — events or competitions run under your name.',
    iconName: 'person-outline',
  },
  {
    value: 'event',
    label: 'Event organizer',
    description: 'Non-profit association, sports club, or cultural venue.',
    iconName: 'calendar-outline',
  },
  {
    value: 'company',
    label: 'Company',
    description: 'Registered legal entity (SARL, SA, etc.).',
    iconName: 'business-outline',
  },
];

// ─── Step 1: Entity type ──────────────────────────────────────────────────────

function StepEntityType({
  selected,
  onSelect,
  onNext,
}: {
  selected: EntityType | null;
  onSelect: (v: EntityType) => void;
  onNext: () => void;
}) {
  const colors = useColors();
  return (
    <>
      <Typography variant="title" style={onbSs.stepTitle}>
        What best describes you?
      </Typography>
      <Typography variant="muted" style={onbSs.stepSubtitle}>
        This determines your settlement account type for the simulated ledger.
      </Typography>
      {ENTITY_OPTIONS.map(opt => {
        const isSelected = selected === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.7}
            testID={`entity-option-${opt.value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            style={[
              onbSs.entityOption,
              {
                backgroundColor: isSelected ? colors.primary + '18' : colors.card,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={[onbSs.entityIcon, { backgroundColor: isSelected ? colors.primary + '22' : colors.secondary }]}>
              <Ionicons name={opt.iconName} size={22} color={isSelected ? colors.primary : colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[onbSs.entityLabel, { color: colors.foreground }]}>{opt.label}</Text>
              <Text style={[onbSs.entityDesc, { color: colors.mutedForeground }]}>{opt.description}</Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
          </TouchableOpacity>
        );
      })}
      <Button onPress={onNext} disabled={!selected} style={{ marginTop: 24 }} testID="entity-next-btn">
        <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 14 }}>
          Continue
        </Text>
      </Button>
    </>
  );
}

// ─── Step 2: Legal details ────────────────────────────────────────────────────

function StepDetails({
  displayName,
  country,
  onChangeName,
  onChangeCountry,
  onNext,
  onBack,
}: {
  displayName: string;
  country: string;
  onChangeName: (v: string) => void;
  onChangeCountry: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const colors = useColors();
  // Backend requires exactly 2-letter ISO code
  const countryValid = /^[A-Za-z]{2}$/.test(country.trim());
  const canContinue = displayName.trim().length >= 2 && countryValid;
  return (
    <>
      <Typography variant="title" style={onbSs.stepTitle}>
        Your legal details
      </Typography>
      <Typography variant="muted" style={onbSs.stepSubtitle}>
        This name appears on settlements and invoices. Use the exact legal name registered with authorities.
      </Typography>

      <Typography variant="label" style={onbSs.fieldLabel}>Legal display name</Typography>
      <TextInput
        value={displayName}
        onChangeText={onChangeName}
        placeholder="e.g. Youssef Ait Benhaddou"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="words"
        autoCorrect={false}
        style={[onbSs.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        testID="legal-name-input"
        accessibilityLabel="Legal display name"
      />

      <Typography variant="label" style={[onbSs.fieldLabel, { marginTop: 18 }]}>
        Country — 2-letter ISO code (e.g. MA, FR, US)
      </Typography>
      <TextInput
        value={country}
        onChangeText={v => onChangeCountry(v.toUpperCase().slice(0, 2))}
        placeholder="MA"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={2}
        style={[
          onbSs.input,
          {
            color: colors.foreground,
            borderColor: country.length > 0 && !countryValid ? colors.destructive : colors.border,
            backgroundColor: colors.card,
          },
        ]}
        testID="country-input"
        accessibilityLabel="Country ISO code"
      />
      {country.length > 0 && !countryValid && (
        <Typography variant="muted" style={{ fontSize: 12, color: colors.destructive, marginTop: 4 }}>
          Enter exactly 2 letters (e.g. MA for Morocco)
        </Typography>
      )}

      <View style={onbSs.btnRow}>
        <Button variant="outline" onPress={onBack} style={{ flex: 1 }} testID="details-back-btn">
          <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 14 }}>Back</Text>
        </Button>
        <Button onPress={onNext} disabled={!canContinue} style={{ flex: 2 }} testID="details-next-btn">
          <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 14 }}>
            Review terms
          </Text>
        </Button>
      </View>
    </>
  );
}

// ─── Step 3: Terms acceptance ─────────────────────────────────────────────────

function StepTerms({
  displayName,
  country,
  entityType,
  termsVersion,
  termsVersionLoading,
  termsVersionError,
  simulation,
  accepted,
  onToggle,
  onSubmit,
  onBack,
  isLoading,
  isOnline,
}: {
  displayName: string;
  country: string;
  entityType: EntityType;
  termsVersion: string | null;
  termsVersionLoading: boolean;
  termsVersionError: boolean;
  simulation:boolean;
  accepted: boolean;
  onToggle: () => void;
  onSubmit: () => void;
  onBack: () => void;
  isLoading: boolean;
  isOnline: boolean;
}) {
  const colors = useColors();
  const versionLabel = termsVersionLoading ? '…' : (termsVersion ?? null);

  return (
    <>
      <Typography variant="title" style={onbSs.stepTitle}>
        Settlement terms
      </Typography>
      <Typography variant="muted" style={onbSs.stepSubtitle}>
        Read carefully before accepting. These terms govern how your revenue is split and transferred.
      </Typography>

      {/* Simulation notice */}
      {simulation && <View style={[onbSs.noticeBox, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40' }]} testID="onboarding-simulation-notice">
        <Ionicons name="flask-outline" size={14} color={colors.chart1} />
        <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
           The finance flow runs in Simulation mode. This is an in-app simulation of the {SETTLEMENT_SHARE_ORGANIZER}/{SETTLEMENT_SHARE_PLATFORM} net-settlement model — no real account is charged or paid.
        </Typography>
      </View>}

      <Card style={{ marginBottom: 20 }} testID="terms-box">
        <View style={onbSs.termsVersionRow}>
          <Typography variant="label" style={{ fontSize: 13 }}>
            Net-settlement agreement
          </Typography>
          {termsVersionLoading ? (
            <Spinner size="small" />
          ) : (
            <Badge style={{ backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }}>
              <Text style={{ fontSize: 9, fontFamily: nativeTheme.fonts.bold, color: colors.primary, letterSpacing: 0.8 }}>
                {versionLabel}
              </Text>
            </Badge>
          )}
        </View>

        <Typography variant="muted" style={{ fontSize: 12, lineHeight: 18, marginTop: 10 }}>
           Arena Qaisypro operates a {SETTLEMENT_SHARE_ORGANIZER}/{SETTLEMENT_SHARE_PLATFORM} net revenue split. During this beta, all amounts are computed in a ledger simulation.
          {'\n\n'}
          As an organizer, you will receive {SETTLEMENT_SHARE_ORGANIZER}% of the net ticket and registration revenue generated by events you create on this platform, after deducting applicable payment processing fees and platform costs.
          {'\n\n'}
          Arena Qaisypro retains {SETTLEMENT_SHARE_PLATFORM}% to cover platform operations, compliance, and infrastructure.
          {'\n\n'}
           Simulated settlements use the selected currency. Manual payout requests are reviewed by the platform, and requests for accounts in Morocco remain subject to the platform's eligibility review.
          {'\n\n'}
           This agreement is governed by the platform's finance terms. Submitting this form constitutes your explicit acceptance of these terms as the legal representative of:
          {'\n\n'}
          <Text style={{ fontFamily: nativeTheme.fonts.bold, color: colors.foreground }}>
            {displayName} ({entityType}) — {country}
          </Text>
        </Typography>
      </Card>

      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={onbSs.checkRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        testID="terms-checkbox"
        disabled={!termsVersion}
      >
        <View style={[onbSs.checkbox, { borderColor: accepted ? colors.primary : colors.border, backgroundColor: accepted ? colors.primary : 'transparent' }]}>
          {accepted && <Ionicons name="checkmark" size={14} color={colors.primaryForeground} />}
        </View>
        <Text style={[onbSs.checkLabel, { color: termsVersion ? colors.foreground : colors.mutedForeground }]}>
          I have read and explicitly accept the versioned {SETTLEMENT_SHARE_ORGANIZER}/{SETTLEMENT_SHARE_PLATFORM} net-settlement terms above
          {versionLabel ? ` (${versionLabel})` : ''}
        </Text>
      </TouchableOpacity>

      {termsVersionError && (
        <View
          style={[onbSs.noticeBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '40' }]}
          testID="terms-version-error"
        >
          <Ionicons name="warning-outline" size={16} color={colors.destructive} />
          <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
            Could not load the current terms version from the server. Acceptance is disabled until it can be verified. Please retry.
          </Typography>
        </View>
      )}

      {!isOnline && (
        <View style={[onbSs.noticeBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '40' }]} testID="terms-offline-notice">
          <Ionicons name="cloud-offline-outline" size={16} color={colors.destructive} />
          <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
            You are offline. Reconnect to submit.
          </Typography>
        </View>
      )}

      <View style={onbSs.btnRow}>
        <Button variant="outline" onPress={onBack} style={{ flex: 1 }} testID="terms-back-btn">
          <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 14 }}>Back</Text>
        </Button>
        <Button
          onPress={onSubmit}
          disabled={!accepted || isLoading || !isOnline || termsVersionLoading || !termsVersion || termsVersionError}
          loading={isLoading}
          style={{ flex: 2 }}
          testID="terms-submit-btn"
        >
          <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 14 }}>
             Accept and continue
          </Text>
        </Button>
      </View>
    </>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────────

function StepDots({ step, total }: { step: number; total: number }) {
  const colors = useColors();
  return (
    <View style={onbSs.dotsRow} accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[onbSs.dot, { backgroundColor: i < step ? colors.primary : colors.border, width: i < step ? 20 : 8 }]} />
      ))}
    </View>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline } = useOnline();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const acceptTerms = useAcceptTerms();
  const termsQuery = useFinanceTerms();
  // version is null while loading or on error — acceptance stays disabled in both cases
  const termsVersion = termsQuery.data?.currentVersion ?? null;
  const termsVersionLoading = termsQuery.isLoading;
  const termsVersionError = termsQuery.isError;
  const simulation = true;

  const isLoading = acceptTerms.isPending;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSubmit = useCallback(async () => {
    if (!entityType || !termsAccepted || !isOnline || !termsVersion) return;

    try {
      await acceptTerms.mutateAsync({
        ownerType: entityType,
        displayName: displayName.trim(),
        country: country.trim().toUpperCase(),
        termsVersion,
        accepted: true,
      });
      Alert.alert(
        'Account registered',
        'Your beneficiary record is ready for the simulated ledger and manual payout review.',
        [{ text: 'OK', onPress: () => router.replace('/finance') }],
      );
    } catch (err) {
      Alert.alert(
        'Terms submission failed',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }, [entityType, termsAccepted, isOnline, termsVersion, displayName, country, acceptTerms, router]);

  return (
    <View style={[onbSs.root, { backgroundColor: colors.background }]} testID="onboarding-screen">
      {/* Header */}
      <View style={[onbSs.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (step > 1 ? setStep(s => (s - 1) as 1 | 2 | 3) : router.back())}
          style={onbSs.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="onboarding-back-btn"
        >
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Typography variant="title" style={{ flex: 1, fontSize: 17 }}>
          Organizer registration
        </Typography>
        {isLoading && <Spinner size="small" />}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[onbSs.content, { paddingBottom: bottomPad + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StepDots step={step} total={3} />

        {step === 1 && (
          <StepEntityType
            selected={entityType}
            onSelect={setEntityType}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <StepDetails
            displayName={displayName}
            country={country}
            onChangeName={setDisplayName}
            onChangeCountry={setCountry}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && entityType && (
          <StepTerms
            displayName={displayName}
            country={country}
            entityType={entityType}
            termsVersion={termsVersion}
            termsVersionLoading={termsVersionLoading}
            termsVersionError={termsVersionError}
            simulation={simulation}
            accepted={termsAccepted}
            onToggle={() => setTermsAccepted(v => !v)}
            onSubmit={handleSubmit}
            onBack={() => setStep(2)}
            isLoading={isLoading}
            isOnline={isOnline}
          />
        )}
      </ScrollView>
    </View>
  );
}

const onbSs = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 8, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  content: { paddingHorizontal: 20, paddingTop: 28 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  dot: { height: 8, borderRadius: 4 },
  stepTitle: { marginBottom: 6, fontFamily: nativeTheme.fonts.bold, fontSize: 22 },
  stepSubtitle: { marginBottom: 24, fontSize: 14 },
  entityOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1.5, borderRadius: nativeTheme.radius * 2, padding: 16, marginBottom: 10,
  },
  entityIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  entityLabel: { fontSize: 15, fontFamily: nativeTheme.fonts.semibold },
  entityDesc: { fontSize: 12, fontFamily: nativeTheme.fonts.regular, marginTop: 2 },
  fieldLabel: { marginBottom: 6 },
  input: { height: 48, borderWidth: 1, borderRadius: nativeTheme.radius, paddingHorizontal: 14, fontFamily: nativeTheme.fonts.regular, fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 28 },
  noticeBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10,
    borderRadius: nativeTheme.radius, borderWidth: 1, marginBottom: 16,
  },
  termsVersionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkLabel: { flex: 1, fontSize: 13, fontFamily: nativeTheme.fonts.medium, lineHeight: 19 },
});
