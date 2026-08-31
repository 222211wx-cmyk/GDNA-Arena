import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'wouter';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Coins, Eye, Upload, ArrowLeft, TrendingUp, Video, Music,
  Search, DollarSign, Banknote, Clock, CheckCircle2, XCircle,
  Hourglass, RefreshCw, ArrowDownCircle, AlertCircle, X,
} from 'lucide-react';

interface EarningsUpload {
  id: number;
  title: string;
  type: 'video' | 'audio';
  category: string;
  figure_tag?: string;
  file_name: string;
  views: number;
  earnings: string | number;
  created_at: string;
}

interface Withdrawal {
  id: number;
  amount_coins: string | number;
  amount_mad: string | number;
  amount_usd: string | number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  requested_at: string;
  paid_at?: string;
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  sport:     { label: 'الرياضة',  icon: '⚽' },
  press:     { label: 'الصحافة', icon: '📰' },
  art:       { label: 'الفن',    icon: '🎨' },
  knowledge: { label: 'المعرفة', icon: '📚' },
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: 'قيد المراجعة', color: '#FFD700', icon: <Hourglass className="w-3.5 h-3.5" /> },
  approved: { label: 'موافق عليه',   color: '#4ade80', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  paid:     { label: 'تم الدفع',     color: '#4ade80', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  rejected: { label: 'مرفوض',        color: '#f87171', icon: <XCircle className="w-3.5 h-3.5" /> },
};

// Animated counter
function AnimatedNumber({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const start = prev.current;
    const end = value;
    const duration = 800;
    const startTime = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + (end - start) * eased);
      if (t < 1) requestAnimationFrame(animate);
      else { setDisplay(end); prev.current = end; }
    };
    requestAnimationFrame(animate);
  }, [value]);

  return <>{display.toFixed(decimals)}</>;
}

export default function EarningsPage() {
  const [name, setName] = useState(() => localStorage.getItem('empire_citizen_name') ?? '');
  const [searched, setSearched] = useState(false);
  const [uploads, setUploads] = useState<EarningsUpload[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'withdraw'>('content');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [withdrawError, setWithdrawError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  const fetchAll = useCallback(async (_n?: string, silent = false) => {
    // Identity now comes from the login session — no name needed.
    if (!silent) setLoading(true);
    try {
      const [earnRes, wdRes] = await Promise.all([
        fetch(`${BASE}/api/gs/earnings`, { credentials: 'include' }),
        fetch(`${BASE}/api/gs/withdrawals`, { credentials: 'include' }),
      ]);
      if (earnRes.ok && wdRes.ok) {
        const earnData = await earnRes.json();
        const wdData = await wdRes.json();
        setUploads(earnData.uploads ?? []);
        setTotalEarnings(earnData.totalEarnings ?? 0);
        setTotalViews(earnData.totalViews ?? 0);
        setWithdrawals(wdData.withdrawals ?? []);
        if (earnData.uploaderName) setName(earnData.uploaderName);
        setSearched(true);
        setLastRefresh(new Date());
      }
    } catch {}
    if (!silent) setLoading(false);
  }, [BASE]);

  useEffect(() => {
    fetchAll();
  }, []);

  // Auto-refresh every 15 seconds if we have data
  useEffect(() => {
    if (!searched) return;
    const interval = setInterval(() => fetchAll(name, true), 15000);
    return () => clearInterval(interval);
  }, [searched, name, fetchAll]);

  const handleSearch = () => {
    localStorage.setItem('empire_citizen_name', name.trim());
    fetchAll(name);
  };

  // Calculate pending withdrawals
  const pendingWithdrawalTotal = withdrawals
    .filter(w => w.status === 'pending' || w.status === 'approved')
    .reduce((s, w) => s + parseFloat(String(w.amount_coins)), 0);
  const availableBalance = Math.max(0, totalEarnings - pendingWithdrawalTotal);

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) { setWithdrawError('أدخل مبلغاً صحيحاً'); return; }
    if (amount > availableBalance) { setWithdrawError('الرصيد غير كافٍ'); return; }
    if (amount < 10) { setWithdrawError('الحد الأدنى للسحب 10 عملات'); return; }

    setWithdrawStatus('loading');
    setWithdrawError('');
    try {
      const r = await fetch(`${BASE}/api/gs/withdrawals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amountCoins: amount }),
      });
      const payload: unknown = await r.json();
      const apiError =
        typeof payload === 'object' && payload !== null && 'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : undefined;
      if (!r.ok) { setWithdrawError(apiError ?? 'فشل الطلب'); setWithdrawStatus('error'); return; }
      setWithdrawStatus('success');
      setWithdrawAmount('');
      fetchAll(name, true);
      setTimeout(() => setWithdrawStatus('idle'), 3000);
    } catch {
      setWithdrawError('حدث خطأ في الاتصال');
      setWithdrawStatus('error');
    }
  };

  const madValue = totalEarnings.toFixed(2);
  const usdValue = (totalEarnings * 0.10).toFixed(2);

  return (
    <div className="min-h-[100dvh]" style={{ background: '#0a0800' }}>
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Back */}
        <Link href="/ranking">
          <button className="flex items-center gap-2 text-sm mb-6 transition-colors hover:opacity-80"
            style={{ color: 'rgba(255,215,0,0.6)' }}>
            <ArrowLeft className="w-4 h-4" /> العودة إلى التصنيفات
          </button>
        </Link>

        {/* ── HERO ──────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden mb-6"
          style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,140,0,0.05))', border: '1.5px solid rgba(255,215,0,0.4)' }}>
          <div className="p-6 md:p-8">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-3" dir="rtl">
                <Coins className="w-9 h-9" style={{ color: '#FFD700' }} />
                <div>
                  <h1 className="text-3xl font-black text-white">أرباحي</h1>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,215,0,0.5)' }}>
                    لوحة الأرباح · EMPIRE ETERNAL
                  </p>
                </div>
              </div>
              {lastRefresh && (
                <button onClick={() => fetchAll(name, true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-70"
                  style={{ border: '1px solid rgba(255,215,0,0.2)', color: 'rgba(255,215,0,0.5)' }}>
                  <RefreshCw className="w-3 h-3" />
                  {lastRefresh.toLocaleTimeString('ar')}
                </button>
              )}
            </div>
            <p className="text-xs mt-2 text-right" dir="rtl" style={{ color: 'rgba(255,215,0,0.45)' }}>
              كل 100 مشاهدة = 1 عملة ذهبية · 1 عملة = 1 درهم مغربي ≈ 0.10 دولار
            </p>
          </div>
        </motion.div>

        {/* ── SEARCH ────────────────────────────────────────────────────────── */}
        <div className="rounded-2xl p-5 mb-6"
          style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)' }}>
          <p className="text-sm font-bold mb-3 text-right" dir="rtl" style={{ color: 'rgba(255,215,0,0.7)' }}>
            أدخل اسمك في الإمبراطورية
          </p>
          <div className="flex gap-2">
            <button onClick={handleSearch} disabled={loading || !name.trim()}
              className="px-5 py-3 rounded-xl font-black text-black transition-all hover:opacity-90 disabled:opacity-40 shrink-0 flex items-center gap-2"
              style={{ background: '#FFD700' }}>
              <Search className="w-4 h-4" /> بحث
            </button>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="مثال: El Qaisy Abdelmalik"
              className="flex-1 rounded-xl px-4 py-3 text-sm text-white text-right placeholder:text-white/30 outline-none"
              dir="rtl"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,215,0,0.25)' }} />
          </div>
        </div>

        <AnimatePresence>
        {searched && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>

            {/* ── LIVE STATS ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {/* Coins */}
              <div className="col-span-2 rounded-2xl p-5"
                style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,165,0,0.08))', border: '1.5px solid rgba(255,215,0,0.4)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Coins className="w-5 h-5" style={{ color: '#FFD700' }} />
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,215,0,0.6)' }}>إجمالي الأرباح</span>
                </div>
                <div className="text-4xl font-black" style={{ color: '#FFD700', fontFamily: 'monospace' }}>
                  <AnimatedNumber value={totalEarnings} />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>عملة ذهبية</span>
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,215,0,0.4)' }}>
                    <Banknote className="w-3 h-3" />
                    <AnimatedNumber value={parseFloat(madValue)} /> MAD
                  </div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,215,0,0.4)' }}>
                    <DollarSign className="w-3 h-3" />
                    <AnimatedNumber value={parseFloat(usdValue)} /> USD
                  </div>
                </div>
              </div>

              {/* Views */}
              <div className="rounded-2xl p-4"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,215,0,0.15)' }}>
                <Eye className="w-5 h-5 mb-2" style={{ color: 'rgba(255,215,0,0.6)' }} />
                <div className="text-2xl font-black text-white font-mono">
                  <AnimatedNumber value={totalViews} decimals={0} />
                </div>
                <div className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.4)' }}>مشاهدة</div>
              </div>

              {/* Uploads */}
              <div className="rounded-2xl p-4"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,215,0,0.15)' }}>
                <Upload className="w-5 h-5 mb-2" style={{ color: 'rgba(255,215,0,0.6)' }} />
                <div className="text-2xl font-black text-white">{uploads.length}</div>
                <div className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.4)' }}>محتوى مرفوع</div>
              </div>
            </div>

            {/* Available balance banner */}
            <div className="rounded-xl px-5 py-3 mb-6 flex items-center justify-between"
              style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
              <div className="flex items-center gap-2" dir="rtl">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm font-bold text-green-400">
                  الرصيد المتاح للسحب: {availableBalance.toFixed(2)} عملة
                </span>
              </div>
              <span className="text-xs" style={{ color: 'rgba(74,222,128,0.6)' }}>
                ≈ {(availableBalance).toFixed(2)} MAD · {(availableBalance * 0.10).toFixed(2)} USD
              </span>
            </div>

            {/* ── TABS ──────────────────────────────────────────────────────── */}
            <div className="flex gap-2 mb-5">
              {[
                { key: 'content',  label: 'محتواي', icon: <Video className="w-4 h-4" /> },
                { key: 'withdraw', label: 'السحب',   icon: <ArrowDownCircle className="w-4 h-4" /> },
              ].map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key as typeof activeTab)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm transition-all"
                  style={activeTab === tab.key
                    ? { background: '#FFD700', color: '#000' }
                    : { background: 'rgba(255,215,0,0.06)', color: 'rgba(255,215,0,0.6)', border: '1px solid rgba(255,215,0,0.2)' }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* ── CONTENT TAB ───────────────────────────────────────────────── */}
            {activeTab === 'content' && (
              uploads.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3" style={{ color: 'rgba(255,215,0,0.15)' }} />
                  <p className="text-sm" style={{ color: 'rgba(255,215,0,0.4)' }}>لا يوجد محتوى برفع هذا الاسم بعد</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.25)' }}>ارفع محتواك من صفحة التصنيفات</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {uploads.map((u, i) => {
                    const earnPct = totalEarnings > 0 ? (parseFloat(String(u.earnings)) / totalEarnings) * 100 : 0;
                    return (
                      <motion.div key={u.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="rounded-xl overflow-hidden"
                        style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.15)' }}>
                        <div className="p-4 flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)' }}>
                            {u.type === 'video'
                              ? <Video className="w-5 h-5" style={{ color: '#FFD700' }} />
                              : <Music className="w-5 h-5" style={{ color: '#FFD700' }} />}
                          </div>
                          <div className="flex-1 min-w-0" dir="rtl">
                            <p className="font-black text-sm text-white truncate">{u.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>
                                {CATEGORY_META[u.category]?.icon} {CATEGORY_META[u.category]?.label}
                              </span>
                              {u.figure_tag && (
                                <>
                                  <span style={{ color: 'rgba(255,215,0,0.2)' }}>·</span>
                                  <span className="text-xs font-bold" style={{ color: '#FFD700' }}>
                                    📌 {u.figure_tag}
                                  </span>
                                </>
                              )}
                              <span style={{ color: 'rgba(255,215,0,0.2)' }}>·</span>
                              <span className="text-xs" style={{ color: 'rgba(255,215,0,0.35)' }}>
                                {new Date(u.created_at).toLocaleDateString('ar')}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end mb-1">
                              <span className="text-base font-black" style={{ color: '#FFD700', fontFamily: 'monospace' }}>
                                {parseFloat(String(u.earnings)).toFixed(2)}
                              </span>
                              <Coins className="w-4 h-4" style={{ color: '#FFD700' }} />
                            </div>
                            <div className="flex items-center gap-1 justify-end">
                              <span className="text-xs font-mono text-white">{u.views.toLocaleString()}</span>
                              <Eye className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.5)' }} />
                            </div>
                          </div>
                        </div>
                        {/* Per-content earnings bar */}
                        <div className="h-1" style={{ background: 'rgba(255,215,0,0.06)' }}>
                          <motion.div className="h-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${earnPct}%` }}
                            transition={{ duration: 0.8, delay: i * 0.04 + 0.3 }}
                            style={{ background: 'linear-gradient(90deg, #FFD700, #FFA500)' }} />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )
            )}

            {/* ── WITHDRAW TAB ──────────────────────────────────────────────── */}
            {activeTab === 'withdraw' && (
              <div className="space-y-4">
                {/* Rates info */}
                <div className="rounded-2xl p-4"
                  style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)' }}>
                  <p className="font-black text-sm text-white mb-3 text-right" dir="rtl">معدلات التحويل</p>
                  <div className="grid grid-cols-3 gap-3" dir="rtl">
                    {[
                      { icon: <Coins className="w-4 h-4" style={{ color: '#FFD700' }} />, from: '1 عملة', to: '= 1 درهم مغربي', color: '#FFD700' },
                      { icon: <DollarSign className="w-4 h-4 text-green-400" />, from: '1 عملة', to: '≈ 0.10 دولار', color: '#4ade80' },
                      { icon: <Clock className="w-4 h-4 text-blue-400" />, from: 'حد أدنى', to: '10 عملات', color: '#60a5fa' },
                    ].map((rate, i) => (
                      <div key={i} className="rounded-xl p-3 text-center"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,215,0,0.1)' }}>
                        <div className="flex justify-center mb-1">{rate.icon}</div>
                        <p className="text-xs font-bold" style={{ color: rate.color }}>{rate.from}</p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{rate.to}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Withdrawal form */}
                <div className="rounded-2xl p-5"
                  style={{ background: 'rgba(255,215,0,0.04)', border: '1.5px solid rgba(255,215,0,0.25)' }}>
                  <p className="font-black text-white mb-1 text-right" dir="rtl">طلب سحب</p>
                  <p className="text-xs mb-4 text-right" dir="rtl" style={{ color: 'rgba(255,215,0,0.5)' }}>
                    الرصيد المتاح: <span style={{ color: '#FFD700', fontWeight: 900 }}>{availableBalance.toFixed(2)}</span> عملة
                  </p>

                  <div className="flex gap-2 mb-3" dir="rtl">
                    <input
                      value={withdrawAmount}
                      onChange={e => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="أدخل المبلغ..."
                      className="flex-1 rounded-xl px-4 py-3 text-right text-sm text-white placeholder:text-white/30 outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,215,0,0.3)' }}
                    />
                    <button
                      onClick={() => setWithdrawAmount(availableBalance.toFixed(2))}
                      className="px-3 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                      style={{ border: '1px solid rgba(255,215,0,0.3)', color: '#FFD700', background: 'rgba(255,215,0,0.08)' }}>
                      الكل
                    </button>
                  </div>

                  {withdrawAmount && !isNaN(parseFloat(withdrawAmount)) && parseFloat(withdrawAmount) > 0 && (
                    <div className="rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between"
                      style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.15)' }}>
                      <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>ستحصل على:</span>
                      <div className="flex items-center gap-3 text-xs font-mono" dir="rtl">
                        <span style={{ color: '#4ade80' }}>{(parseFloat(withdrawAmount) * 0.10).toFixed(2)} USD</span>
                        <span style={{ color: 'rgba(255,215,0,0.4)' }}>·</span>
                        <span style={{ color: '#FFD700' }}>{parseFloat(withdrawAmount).toFixed(2)} MAD</span>
                      </div>
                    </div>
                  )}

                  {withdrawError && (
                    <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 mb-3"
                      style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)' }}>
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <p className="text-sm text-red-400">{withdrawError}</p>
                      <button onClick={() => { setWithdrawError(''); setWithdrawStatus('idle'); }} className="ml-auto">
                        <X className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  )}

                  {withdrawStatus === 'success' ? (
                    <div className="flex items-center justify-center gap-2 py-3 rounded-xl"
                      style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }}>
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <span className="font-bold text-green-400 text-sm">تم إرسال طلب السحب بنجاح!</span>
                    </div>
                  ) : (
                    <button onClick={handleWithdraw}
                      disabled={withdrawStatus === 'loading' || !withdrawAmount || availableBalance < 10}
                      className="w-full rounded-xl py-3.5 font-black text-black text-base transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: '#FFD700' }}>
                      <ArrowDownCircle className="w-5 h-5" />
                      {withdrawStatus === 'loading' ? 'جارٍ الإرسال...' : 'طلب سحب'}
                    </button>
                  )}
                </div>

                {/* Withdrawal history */}
                {withdrawals.length > 0 && (
                  <div>
                    <p className="font-black text-sm text-white mb-3 text-right" dir="rtl">
                      سجل الطلبات ({withdrawals.length})
                    </p>
                    <div className="space-y-2">
                      {withdrawals.map((w, i) => {
                        const meta = STATUS_META[w.status];
                        return (
                          <motion.div key={w.id}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                            className="rounded-xl p-4 flex items-center gap-4"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,215,0,0.1)' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                              style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}40`, color: meta.color }}>
                              {meta.icon}
                            </div>
                            <div className="flex-1 min-w-0" dir="rtl">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-white font-mono">
                                  {parseFloat(String(w.amount_coins)).toFixed(2)} عملة
                                </span>
                                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>·</span>
                                <span className="text-xs font-mono" style={{ color: 'rgba(255,215,0,0.5)' }}>
                                  {parseFloat(String(w.amount_mad)).toFixed(2)} MAD
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs font-bold" style={{ color: meta.color }}>
                                  {meta.label}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                                  {new Date(w.requested_at).toLocaleDateString('ar')}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono text-green-400">
                                {parseFloat(String(w.amount_usd)).toFixed(2)} $
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        )}
        </AnimatePresence>
      </main>
    </div>
  );
}
