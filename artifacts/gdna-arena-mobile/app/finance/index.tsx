/**
 * Finance screen — Arena Qaisypro
 *
 * Backend contract facts:
 * - CURRENT_TERMS_VERSION = "finance-terms-2025-01" (returned in wallet response / accept-terms 400 body)
 * - FINANCE_SIMULATION_MODE is always true in the current deployment.
 *   POST /finance/payouts → 409 in simulation. UI never presents it.
 * - Simulation payout = POST /finance/manual-payouts (manual, monthly, provider: redotpay_manual).
 *   Requires PUT /finance/beneficiaries/:id/payout-details first.
 * - POST /finance/connect/refresh returns { beneficiary, url, simulated }.
 * - Wallet response: { coinBalance, fiat, entries, beneficiary, beneficiaries }.
 * - beneficiary stub when none registered: { status: 'none' }.
 * - Morocco: eligibilityConfirmed = false until Stripe + Bank Al-Maghrib confirm.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Badge } from '@workspace/gdna-ds/components/native/badge';
import { Spinner } from '@workspace/gdna-ds/components/native/spinner';
import { Empty } from '@workspace/gdna-ds/components/native/empty';
import { Typography } from '@workspace/gdna-ds/components/native/typography';

import { useAuth } from '@/contexts/AuthContext';
import { useOnline } from '@/contexts/OnlineContext';
import {
  useWallet,
  useInvoices,
  useManualPayouts,
  useRefreshOnboarding,
  useRequestManualPayout,
  useSavePayoutDetails,
  useSimulatePayment,
  useFinanceTerms,
  isRealBeneficiary,
  type WalletEntry,
  type Invoice,
  type ManualPayout,
  type Beneficiary,
} from '@/hooks/use-finance';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMinor(minor: number, currency: string): string {
  try {
    return (minor / 100).toLocaleString('fr-MA', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    });
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Static shared styles (do not depend on colors) ─────────────────────────

const ss = StyleSheet.create({
  sectionHeader: {
    fontSize: 11, fontFamily: nativeTheme.fonts.bold, letterSpacing: 2,
    paddingHorizontal: 20, marginTop: 28, marginBottom: 10,
  },
  fiatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  divider: { height: 1, marginVertical: 4 },
  entryRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  entryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  entryInfo: { flex: 1 },
  entryDesc: { fontSize: 13, fontFamily: nativeTheme.fonts.medium },
  entryDate: { fontSize: 11, fontFamily: nativeTheme.fonts.regular, marginTop: 2 },
  entryAmount: { fontSize: 14, fontFamily: nativeTheme.fonts.bold },
  invoiceInfo: { flex: 1 },
  badgeText: { fontSize: 9, fontFamily: nativeTheme.fonts.bold, letterSpacing: 0.8 },
});

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[ss.sectionHeader, { color: colors.mutedForeground }]}>
      {title}
    </Text>
  );
}

function FiatRow({
  label,
  minor,
  currency,
  accent,
}: {
  label: string;
  minor: number;
  currency: string;
  accent?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={ss.fiatRow}>
      <Typography variant="label" style={{ color: colors.mutedForeground }}>
        {label}
      </Typography>
      <Typography variant="label" style={{ color: accent ? colors.primary : colors.foreground }}>
        {formatMinor(minor, currency)}
      </Typography>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  return <View style={[ss.divider, { backgroundColor: colors.border }]} />;
}

function EntryRow({ entry, isLast }: { entry: WalletEntry; isLast: boolean }) {
  const colors = useColors();
  const isPositive = entry.amountMinor > 0;
  const signColor = isPositive ? colors.chart3 : colors.destructive;
  const iconName: React.ComponentProps<typeof Ionicons>['name'] = isPositive
    ? 'arrow-down-circle-outline'
    : 'arrow-up-circle-outline';
  return (
    <View style={[ss.entryRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[ss.entryIcon, { backgroundColor: signColor + '22' }]}>
        <Ionicons name={iconName} size={18} color={signColor} />
      </View>
      <View style={ss.entryInfo}>
        <Text numberOfLines={1} style={[ss.entryDesc, { color: colors.foreground }]}>
          {entry.description || entry.type}
        </Text>
        <Text style={[ss.entryDate, { color: colors.mutedForeground }]}>
          {new Date(entry.createdAt).toLocaleDateString('fr-MA')}
        </Text>
      </View>
      <Text style={[ss.entryAmount, { color: signColor }]}>
        {isPositive ? '+' : ''}{formatMinor(entry.amountMinor, entry.currency)}
      </Text>
    </View>
  );
}

function InvoiceRow({ invoice, isLast }: { invoice: Invoice; isLast: boolean }) {
  const colors = useColors();
  const statusColor = invoice.status === 'paid' ? colors.primary
    : invoice.status === 'open' ? colors.chart2
    : colors.mutedForeground;
  return (
    <View style={[ss.entryRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={ss.invoiceInfo}>
        <Text numberOfLines={1} style={[ss.entryDesc, { color: colors.foreground }]}>
          {invoice.reference}
        </Text>
        <Text numberOfLines={1} style={[ss.entryDate, { color: colors.mutedForeground }]}>
          {invoice.description}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[ss.entryAmount, { color: colors.foreground }]}>
          {formatMinor(invoice.amountMinor, invoice.currency)}
        </Text>
        <Badge style={{ backgroundColor: statusColor + '22', borderColor: statusColor + '55' }}>
          <Text style={[ss.badgeText, { color: statusColor }]}>
            {invoice.status.toUpperCase()}
          </Text>
        </Badge>
      </View>
    </View>
  );
}

function ManualPayoutRow({ payout, isLast }: { payout: ManualPayout; isLast: boolean }) {
  const colors = useColors();
  const statusColor = payout.status === 'paid' ? colors.primary
    : payout.status === 'approved' ? colors.chart3
    : payout.status === 'rejected' ? colors.destructive
    : colors.chart1;
  return (
    <View style={[ss.entryRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[ss.entryIcon, { backgroundColor: statusColor + '22' }]}>
        <Ionicons name="paper-plane-outline" size={18} color={statusColor} />
      </View>
      <View style={ss.entryInfo}>
        <Text style={[ss.entryDesc, { color: colors.foreground }]}>
          {payout.period} — {payout.provider}
        </Text>
        {payout.maskedAccount && (
          <Text style={[ss.entryDate, { color: colors.mutedForeground }]}>
            {payout.maskedAccount}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[ss.entryAmount, { color: colors.foreground }]}>
          {formatMinor(payout.amountMinor, payout.currency)}
        </Text>
        <Badge style={{ backgroundColor: statusColor + '22', borderColor: statusColor + '55' }}>
          <Text style={[ss.badgeText, { color: statusColor }]}>
            {payout.status.toUpperCase()}
          </Text>
        </Badge>
      </View>
    </View>
  );
}

// ─── Payout details modal ─────────────────────────────────────────────────────

interface PayoutDetailsModalProps {
  visible: boolean;
  beneficiary: Beneficiary;
  isOnline: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function PayoutDetailsModal({ visible, beneficiary, isOnline, onClose, onSaved }: PayoutDetailsModalProps) {
  const colors = useColors();
  const [accountHolder, setAccountHolder] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingCode, setRoutingCode] = useState('');
  const saveDetails = useSavePayoutDetails(beneficiary.id);

  const canSave = accountHolder.trim().length > 1
    && bankName.trim().length > 1
    && accountNumber.trim().length > 3;

  const handleSave = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Reconnect to save payout details.');
      return;
    }
    try {
      await saveDetails.mutateAsync({
        accountHolder: accountHolder.trim(),
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        routingCode: routingCode.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[modalSs.overlay, { backgroundColor: colors.background + 'ee' }]}>
        <View style={[modalSs.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={modalSs.sheetHeader}>
            <Typography variant="title" style={{ fontSize: 17 }}>Bank payout details</Typography>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={[modalSs.notice, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40' }]}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.chart1} />
            <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
              Details are encrypted server-side before storage. Arena Qaisypro never stores raw bank credentials.
            </Typography>
          </View>

          {(['accountHolder', 'bankName', 'accountNumber', 'routingCode'] as const).map((field) => {
            const labels = {
              accountHolder: 'Account holder name',
              bankName: 'Bank name',
              accountNumber: 'Account number / IBAN',
              routingCode: 'Routing / SWIFT code (optional)',
            };
            const values = { accountHolder, bankName, accountNumber, routingCode };
            const setters = { accountHolder: setAccountHolder, bankName: setBankName, accountNumber: setAccountNumber, routingCode: setRoutingCode };
            return (
              <View key={field} style={modalSs.fieldWrap}>
                <Typography variant="label" style={{ marginBottom: 6 }}>{labels[field]}</Typography>
                <TextInput
                  value={values[field]}
                  onChangeText={setters[field]}
                  autoCapitalize={field === 'accountHolder' ? 'words' : 'none'}
                  autoCorrect={false}
                  style={[modalSs.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  testID={`payout-details-${field}`}
                  accessibilityLabel={labels[field]}
                />
              </View>
            );
          })}

          <View style={modalSs.btnRow}>
            <Button variant="outline" onPress={onClose} style={{ flex: 1 }} testID="payout-details-cancel">
              <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 14 }}>Cancel</Text>
            </Button>
            <Button
              onPress={handleSave}
              disabled={!canSave || !isOnline}
              loading={saveDetails.isPending}
              style={{ flex: 2 }}
              testID="payout-details-save"
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 14 }}>Save details</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalSs = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 36, gap: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: nativeTheme.radius, borderWidth: 1 },
  fieldWrap: { gap: 4 },
  input: { height: 44, borderWidth: 1, borderRadius: nativeTheme.radius, paddingHorizontal: 12, fontFamily: nativeTheme.fonts.regular, fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
});

// ─── Simulate payment modal ───────────────────────────────────────────────────

interface SimPaymentModalProps {
  visible: boolean;
  beneficiaryId: string;
  currency: string;
  isOnline: boolean;
  onClose: () => void;
  onDone: (result: { journalId: string; beneficiaryMinor: number; platformMinor: number }) => void;
}

function SimPaymentModal({ visible, beneficiaryId, currency, isOnline, onClose, onDone }: SimPaymentModalProps) {
  const colors = useColors();
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const simulatePayment = useSimulatePayment();

  const amountMajor = parseFloat(amountStr.replace(',', '.'));
  const amountMinor = Number.isFinite(amountMajor) && amountMajor > 0 ? Math.round(amountMajor * 100) : 0;
  const canSubmit = amountMinor > 0 && description.trim().length > 2;

  const handleSubmit = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Reconnect to run a simulation.');
      return;
    }
    const idempotencyKey = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const result = await simulatePayment.mutateAsync({
        beneficiaryId,
        amountMinor,
        currency,
        description: description.trim(),
        idempotencyKey,
      });
      const p = result.payment;
      onDone({
        journalId: p.id,
        beneficiaryMinor: p.beneficiaryMinor ?? 0,
        platformMinor: p.platformMinor ?? 0,
      });
    } catch (err) {
      Alert.alert('Simulation failed', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[modalSs.overlay, { backgroundColor: colors.background + 'ee' }]}>
        <View style={[modalSs.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={modalSs.sheetHeader}>
            <Typography variant="title" style={{ fontSize: 17 }}>Simulate payment</Typography>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={[modalSs.notice, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40' }]}>
            <Ionicons name="flask-outline" size={14} color={colors.chart1} />
            <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
              This posts a simulated payment using the 70/30 split. No real money moves.
            </Typography>
          </View>

          <View style={modalSs.fieldWrap}>
            <Typography variant="label" style={{ marginBottom: 6 }}>Amount ({currency.toUpperCase()})</Typography>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              keyboardType="decimal-pad"
              placeholder="e.g. 100.00"
              placeholderTextColor={colors.mutedForeground}
              style={[modalSs.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              testID="sim-payment-amount"
            />
          </View>
          <View style={modalSs.fieldWrap}>
            <Typography variant="label" style={{ marginBottom: 6 }}>Description</Typography>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Event ticket sale"
              placeholderTextColor={colors.mutedForeground}
              style={[modalSs.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              testID="sim-payment-description"
            />
          </View>

          <View style={modalSs.btnRow}>
            <Button variant="outline" onPress={onClose} style={{ flex: 1 }} testID="sim-payment-cancel">
              <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 14 }}>Cancel</Text>
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={!canSubmit || !isOnline}
              loading={simulatePayment.isPending}
              style={{ flex: 2 }}
              testID="sim-payment-submit"
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 14 }}>Run simulation</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function FinanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const [refreshing, setRefreshing] = useState(false);
  const [showPayoutDetails, setShowPayoutDetails] = useState(false);
  const [showSimPayment, setShowSimPayment] = useState(false);

  const walletQuery = useWallet(user?.id);
  const invoicesQuery = useInvoices(user?.id);
  const manualPayoutsQuery = useManualPayouts(user?.id);
  const termsQuery=useFinanceTerms();
  const moneyMovementEnabled=termsQuery.data?.moneyMovementEnabled===true&&termsQuery.data.operatingMode==='live';
  const simulation=!moneyMovementEnabled;
  const refreshOnboarding = useRefreshOnboarding();
  const requestManualPayout = useRequestManualPayout();

  const wallet = walletQuery.data;
  const invoiceList = invoicesQuery.data;
  const manualPayoutsList = manualPayoutsQuery.data;

  // The server returns beneficiary as either a real Beneficiary or { status: 'none' }
  const rawBeneficiary = wallet?.beneficiary;
  const beneficiary: Beneficiary | null = isRealBeneficiary(rawBeneficiary) ? rawBeneficiary : null;

  // Derive key flags
  const bStatus = beneficiary?.status ?? 'none';
  const isMorocco = (beneficiary?.country ?? '').toUpperCase() === 'MA';
  const moroccoRestricted = isMorocco && !beneficiary?.eligibilityConfirmed;
  // In simulation mode: canPayout is always false from the server (eligibilityConfirmed = false).
  // We surface the manual payout request flow for event/company beneficiaries.
  const canManualPayout = moneyMovementEnabled &&
    !!beneficiary
    && ['event', 'company'].includes(beneficiary.ownerType ?? '')
    && (bStatus === 'enabled' || bStatus === 'pending' || bStatus === 'onboarding');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 90;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      walletQuery.refetch(),
      invoicesQuery.refetch(),
      manualPayoutsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [walletQuery, invoicesQuery, manualPayoutsQuery]);

  const handleResumeOnboarding = useCallback(async () => {
    if (!isOnline) { Alert.alert('Offline', 'You must be connected to resume onboarding.'); return; }
    try {
      const result = await refreshOnboarding.mutateAsync(
        beneficiary?.id ? { beneficiaryId: beneficiary.id } : undefined,
      );
      if (result.url) {
        await Linking.openURL(result.url);
      } else {
        Alert.alert('Status updated', 'Your Connect account status has been refreshed.');
      }
    } catch (err) {
      Alert.alert('Could not resume', err instanceof Error ? err.message : 'Please try again.');
    }
  }, [isOnline, refreshOnboarding, beneficiary]);

  const handleManualPayout = useCallback(() => {
    if (!isOnline) { Alert.alert('Offline', 'Reconnect to request a payout.'); return; }
    if (!beneficiary?.id) return;
    const currency = wallet?.fiat.currency ?? 'usd';
    const period = currentPeriod();
    Alert.alert(
      'Request monthly payout',
      `Submit a manual payout request for ${period}? The platform will process your 70% net share.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: async () => {
            try {
              const result = await requestManualPayout.mutateAsync({
                beneficiaryId: beneficiary.id,
                period,
                currency,
              });
              Alert.alert(
                'Payout requested',
                `Status: ${result.payout.status} — ${formatMinor(result.payout.amountMinor, result.payout.currency)}. Provider: ${result.payout.provider}.`,
              );
            } catch (err) {
              Alert.alert('Request failed', err instanceof Error ? err.message : 'Please try again.');
            }
          },
        },
      ],
    );
  }, [isOnline, beneficiary, wallet, requestManualPayout]);

  function beneficiaryStatusLabel(): string {
    if (moroccoRestricted) return 'ELIGIBILITY PENDING';
    switch (bStatus) {
      case 'none':          return 'NOT REGISTERED';
      case 'pending':       return 'PENDING';
      case 'onboarding':    return 'ONBOARDING';
      case 'restricted':    return 'RESTRICTED';
      case 'requirements_due': return 'ACTION REQUIRED';
      case 'enabled':       return 'ACTIVE';
      case 'disabled':      return 'DISABLED';
      default:              return String(bStatus).toUpperCase();
    }
  }

  function beneficiaryStatusColor(): string {
    if (moroccoRestricted || bStatus === 'pending' || bStatus === 'onboarding' || bStatus === 'restricted') {
      return colors.chart1;
    }
    if (bStatus === 'requirements_due') return colors.destructive;
    if (bStatus === 'enabled') return colors.primary;
    if (bStatus === 'disabled') return colors.destructive;
    return colors.mutedForeground;
  }

  const s = styles(colors);

  return (
    <View style={s.root} testID="finance-screen">
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="finance-back-btn"
        >
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Typography variant="title">Finance</Typography>
          {simulation && <Badge
            style={{ backgroundColor: colors.chart1 + '22', borderColor: colors.chart1 + '44', marginTop: 3, alignSelf: 'flex-start' }}
            testID="finance-simulation-badge"
          >
            <Text style={[s.simBadgeText, { color: colors.chart1 }]}>TEST / SIMULATION</Text>
          </Badge>}
        </View>
        {walletQuery.isFetching && !refreshing && <Spinner size="small" />}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        testID="finance-scroll"
      >
        {/* ── Simulation notice ── */}
        {simulation && <View
          style={[s.simBanner, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40' }]}
          testID="finance-simulation-notice"
        >
          <Ionicons name="flask-outline" size={16} color={colors.chart1} />
          <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
            Test ledger mode is active. No Stripe account is created and no real payment, transfer, payout, or RedotPay obligation is available.
          </Typography>
        </View>}

        {/* ── Loading ── */}
        {walletQuery.isLoading && (
          <View style={s.loadingWrap} testID="finance-loading">
            <Spinner size="large" />
            <Typography variant="muted">Loading your wallet…</Typography>
          </View>
        )}

        {/* ── Error ── */}
        {walletQuery.isError && !walletQuery.isLoading && (
          <Empty testID="finance-error">
            <Ionicons name="warning-outline" size={32} color={colors.destructive} />
            <Typography variant="muted">Could not load wallet data.</Typography>
            <Button variant="outline" size="sm" onPress={() => walletQuery.refetch()} testID="finance-retry-btn">
              <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 13 }}>Retry</Text>
            </Button>
          </Empty>
        )}

        {wallet && (
          <>
            {/* ── Coin balance ── */}
            <SectionHeader title="COIN BALANCE" />
            <Card style={s.cardMx} testID="coin-balance-card">
              <View style={s.coinRow}>
                <View style={[s.coinIconWrap, { backgroundColor: colors.chart1 + '22' }]}>
                  <Ionicons name="logo-bitcoin" size={28} color={colors.chart1} />
                </View>
                <View>
                  <Text style={[s.coinAmount, { color: colors.foreground }]}>
                    {wallet.coinBalance.toLocaleString()}
                  </Text>
                  <Typography variant="muted">Arena coins</Typography>
                </View>
              </View>
            </Card>

            {/* ── Fiat wallet ── */}
            <SectionHeader title="FIAT WALLET" />
            <Card style={s.cardMx} testID="fiat-wallet-card">
              <FiatRow label="Available" minor={wallet.fiat.available} currency={wallet.fiat.currency} accent />
              <Divider />
              <FiatRow label="Pending" minor={wallet.fiat.pending} currency={wallet.fiat.currency} />
              <FiatRow label="Reserved" minor={wallet.fiat.reserved} currency={wallet.fiat.currency} />
              <FiatRow label="Paid out" minor={wallet.fiat.paid} currency={wallet.fiat.currency} />
              <Divider />
              <FiatRow label="Total income" minor={wallet.fiat.income} currency={wallet.fiat.currency} />
              <FiatRow label="Total expenses" minor={wallet.fiat.expense} currency={wallet.fiat.currency} />
            </Card>

            {/* ── Simulate a payment (only for registered beneficiaries) ── */}
            {beneficiary && simulation && (
              <View style={s.cardMx}>
                <Button
                  variant="outline"
                  onPress={() => setShowSimPayment(true)}
                  disabled={!isOnline}
                  testID="sim-payment-btn"
                  style={{ marginTop: 12 }}
                >
                  <Ionicons name="flask-outline" size={16} color={colors.foreground} style={{ marginRight: 6 }} />
                  <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 13 }}>
                    Simulate a payment (test)
                  </Text>
                </Button>
              </View>
            )}

            {/* ── Settlement account ── */}
            <SectionHeader title="SETTLEMENT ACCOUNT" />
            <Card style={s.cardMx} testID="beneficiary-card">
              <View style={s.beneficiaryRow}>
                <View style={{ flex: 1 }}>
                  <Typography variant="label">Beneficiary status</Typography>
                  {beneficiary?.displayName && (
                    <Typography variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {beneficiary.displayName}
                    </Typography>
                  )}
                  {beneficiary?.stripeAccountId && (
                    <Typography variant="muted" style={{ fontSize: 11, marginTop: 1 }}>
                      {beneficiary.stripeAccountId}
                    </Typography>
                  )}
                </View>
                <Badge
                  style={{ backgroundColor: beneficiaryStatusColor() + '22', borderColor: beneficiaryStatusColor() + '55' }}
                  testID="beneficiary-status-badge"
                >
                  <Text style={[s.simBadgeText, { color: beneficiaryStatusColor() }]}>
                    {beneficiaryStatusLabel()}
                  </Text>
                </Badge>
              </View>

              {moroccoRestricted && (
                <View style={[s.infoBox, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40' }]} testID="morocco-restriction-notice">
                  <Ionicons name="information-circle-outline" size={16} color={colors.chart1} />
                  <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
                    Payouts for Morocco are subject to Bank Al-Maghrib cross-border transfer rules. Eligibility will be confirmed by the platform before activation.
                  </Typography>
                </View>
              )}

              {beneficiary?.requirementsDue && beneficiary.requirementsDue.length > 0 && (
                <View style={[s.infoBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '40' }]}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                  <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
                    Action required: {beneficiary.requirementsDue.join(', ')}
                  </Typography>
                </View>
              )}

              {beneficiary?.restrictionReason && bStatus !== 'enabled' && (
                <View style={[s.infoBox, { backgroundColor: colors.mutedForeground + '15', borderColor: colors.mutedForeground + '40' }]}>
                  <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
                  <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
                    {beneficiary.restrictionReason}
                  </Typography>
                </View>
              )}

              {(bStatus === 'pending' || bStatus === 'onboarding' || bStatus === 'requirements_due' || bStatus === 'restricted') && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={handleResumeOnboarding}
                  loading={refreshOnboarding.isPending}
                  disabled={!isOnline}
                  style={{ marginTop: 12 }}
                  testID="resume-onboarding-btn"
                >
                  <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 13 }}>
                    Resume / refresh Stripe verification
                  </Text>
                </Button>
              )}

              {bStatus === 'none' && (
                <Button
                  size="sm"
                  onPress={() => router.push('/finance/onboarding')}
                  disabled={!isOnline}
                  style={{ marginTop: 12 }}
                  testID="start-onboarding-btn"
                >
                  <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 13 }}>
                    Register as organizer
                  </Text>
                </Button>
              )}

              {beneficiary?.termsVersion && (
                <Typography variant="muted" style={{ fontSize: 11, marginTop: 10 }} testID="terms-accepted-label">
                  Terms {beneficiary.termsVersion}
                  {beneficiary.termsAcceptedAt
                    ? ` accepted ${new Date(beneficiary.termsAcceptedAt).toLocaleDateString('fr-MA')}`
                    : ' — not yet accepted'}
                  {!beneficiary.termsAccepted && ' (outdated — re-acceptance required)'}
                </Typography>
              )}
            </Card>

            {/* ── Manual payout (for event/company beneficiaries, replaces /finance/payouts which returns 409 in simulation) ── */}
            {canManualPayout && (
              <>
                <SectionHeader title="MONTHLY PAYOUT REQUEST" />
                <Card style={s.cardMx} testID="manual-payout-card">
                  <View style={[s.infoBox, { backgroundColor: colors.chart1 + '15', borderColor: colors.chart1 + '40', marginBottom: 12 }]}>
                    <Ionicons name="information-circle-outline" size={14} color={colors.chart1} />
                    <Typography variant="muted" style={{ flex: 1, fontSize: 12 }}>
                      Automated Stripe payouts are disabled in simulation mode. Submit a monthly manual payout request; the platform processes your 70% net share via {beneficiary?.country === 'MA' ? 'manual transfer' : 'redotpay_manual'}.
                    </Typography>
                  </View>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => setShowPayoutDetails(true)}
                    disabled={!isOnline}
                    style={{ marginBottom: 8 }}
                    testID="edit-payout-details-btn"
                  >
                    <Text style={{ color: colors.foreground, fontFamily: nativeTheme.fonts.medium, fontSize: 13 }}>
                      Update bank details
                    </Text>
                  </Button>
                  <Button
                    size="sm"
                    onPress={handleManualPayout}
                    loading={requestManualPayout.isPending}
                    disabled={!isOnline}
                    testID="manual-payout-btn"
                  >
                    <Text style={{ color: colors.primaryForeground, fontFamily: nativeTheme.fonts.semibold, fontSize: 13 }}>
                      Request payout — {currentPeriod()}
                    </Text>
                  </Button>
                </Card>

                {/* Manual payout history */}
                {manualPayoutsList && manualPayoutsList.payouts.length > 0 && (
                  <>
                    <SectionHeader title="PAYOUT HISTORY" />
                    <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="manual-payouts-list">
                      {manualPayoutsList.payouts.map((p, i) => (
                        <ManualPayoutRow
                          key={p.id}
                          payout={p}
                          isLast={i === manualPayoutsList.payouts.length - 1}
                        />
                      ))}
                    </View>
                  </>
                )}
              </>
            )}

            {/* ── Recent ledger entries ── */}
            <SectionHeader title="RECENT ACTIVITY" />
            {wallet.entries.length === 0 ? (
              <Empty testID="entries-empty">
                <Ionicons name="receipt-outline" size={28} color={colors.mutedForeground} />
                <Typography variant="muted">No activity yet.</Typography>
              </Empty>
            ) : (
              <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="entries-list">
                {wallet.entries.slice(0, 20).map((entry, i) => (
                  <EntryRow key={entry.id} entry={entry} isLast={i === Math.min(wallet.entries.length, 20) - 1} />
                ))}
              </View>
            )}

            {/* ── Invoices ── */}
            <SectionHeader title="INVOICES" />
            {invoicesQuery.isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Spinner />
              </View>
            ) : invoiceList && invoiceList.invoices.length > 0 ? (
              <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="invoices-list">
                {invoiceList.invoices.map((inv, i) => (
                  <InvoiceRow key={inv.id} invoice={inv} isLast={i === invoiceList.invoices.length - 1} />
                ))}
              </View>
            ) : (
              <Empty testID="invoices-empty">
                <Ionicons name="document-text-outline" size={28} color={colors.mutedForeground} />
                <Typography variant="muted">No invoices yet.</Typography>
              </Empty>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Modals ── */}
      {beneficiary && showPayoutDetails && (
        <PayoutDetailsModal
          visible={showPayoutDetails}
          beneficiary={beneficiary}
          isOnline={isOnline}
          onClose={() => setShowPayoutDetails(false)}
          onSaved={() => { setShowPayoutDetails(false); Alert.alert('Saved', 'Payout details updated.'); }}
        />
      )}

      {beneficiary && showSimPayment && (
        <SimPaymentModal
          visible={showSimPayment}
          beneficiaryId={beneficiary.id}
          currency={wallet?.fiat.currency ?? 'usd'}
          isOnline={isOnline}
          onClose={() => setShowSimPayment(false)}
          onDone={({ beneficiaryMinor, platformMinor }) => {
            setShowSimPayment(false);
            Alert.alert(
              'Payment simulated',
              `70/30 split applied:\nYour share: ${formatMinor(beneficiaryMinor, wallet?.fiat.currency ?? 'usd')}\nPlatform: ${formatMinor(platformMinor, wallet?.fiat.currency ?? 'usd')}\n\nNo real money moved.`,
            );
          }}
        />
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16,
      paddingBottom: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    backBtn: { padding: 4, marginTop: 4 },
    scroll: { flex: 1 },
    simBadgeText: { fontSize: 9, fontFamily: nativeTheme.fonts.bold, letterSpacing: 0.8 },
    simBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12,
      marginHorizontal: 16, marginTop: 16, borderRadius: nativeTheme.radius, borderWidth: 1,
    },
    loadingWrap: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 60 },
    cardMx: { marginHorizontal: 16, marginTop: 0 },
    divider: { height: 1, marginVertical: 4 },
    fiatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
    coinRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    coinIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    coinAmount: { fontSize: 32, fontFamily: nativeTheme.fonts.bold },
    listCard: { marginHorizontal: 16, borderRadius: nativeTheme.radius * 2, borderWidth: 1, overflow: 'hidden' },
    beneficiaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    infoBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10,
      borderRadius: nativeTheme.radius, borderWidth: 1, marginTop: 12,
    },
  });
