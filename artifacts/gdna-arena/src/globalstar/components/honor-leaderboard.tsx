import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Crown, Trophy, Eye, Coins, TrendingUp } from 'lucide-react';

interface HonorEntry {
  uploader_name: string;
  category: string;
  total_views: number;
  total_earnings: string | number;
  upload_count: number;
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  sport:     { label: 'الرياضة',  icon: '⚽' },
  press:     { label: 'الصحافة', icon: '📰' },
  art:       { label: 'الفن',    icon: '🎨' },
  knowledge: { label: 'المعرفة', icon: '📚' },
};

const ALL_CATS = ['sport', 'press', 'art', 'knowledge'];

function RankIcon({ rank }: { rank: number }) {
  if (rank === 0) return <Crown className="w-5 h-5" style={{ color: '#FFD700' }} />;
  if (rank === 1) return <Trophy className="w-4 h-4" style={{ color: '#C0C0C0' }} />;
  if (rank === 2) return <Trophy className="w-4 h-4" style={{ color: '#CD7F32' }} />;
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black"
      style={{ background: 'rgba(255,215,0,0.1)', color: 'rgba(255,215,0,0.5)', border: '1px solid rgba(255,215,0,0.2)' }}>
      {rank + 1}
    </div>
  );
}

export function HonorLeaderboard() {
  const [data, setData] = useState<Record<string, HonorEntry[]>>({});
  const [all, setAll] = useState<HonorEntry[]>([]);
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    fetch(`${BASE}/api/gs/honor-leaderboard`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setData(d.leaderboard ?? {}); setAll(d.all ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const displayRows: HonorEntry[] = activeTab === 'all'
    ? all.slice(0, 10)
    : (data[activeTab] ?? []).slice(0, 10);

  const isEmpty = displayRows.length === 0;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#0a0800', border: '1.5px solid rgba(255,215,0,0.25)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid rgba(255,215,0,0.15)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)' }}>
            <Crown className="w-4 h-4" style={{ color: '#FFD700' }} />
          </div>
          <div dir="rtl">
            <p className="font-black text-white text-sm">شرف القادة</p>
            <p className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>لوحة صانعي المحتوى السيادي</p>
          </div>
        </div>
        <TrendingUp className="w-4 h-4" style={{ color: 'rgba(255,215,0,0.4)' }} />
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto scrollbar-thin">
        <button
          onClick={() => setActiveTab('all')}
          className="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0"
          style={activeTab === 'all'
            ? { background: '#FFD700', color: '#000' }
            : { background: 'rgba(255,215,0,0.07)', color: 'rgba(255,215,0,0.6)', border: '1px solid rgba(255,215,0,0.2)' }}
        >
          🏆 الكل
        </button>
        {ALL_CATS.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0"
            style={activeTab === cat
              ? { background: '#FFD700', color: '#000' }
              : { background: 'rgba(255,215,0,0.07)', color: 'rgba(255,215,0,0.6)', border: '1px solid rgba(255,215,0,0.2)' }}
          >
            {CATEGORY_META[cat]?.icon} {CATEGORY_META[cat]?.label}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="px-4 pb-4 space-y-2">
        {loading && (
          <div className="py-8 text-center text-xs" style={{ color: 'rgba(255,215,0,0.4)' }}>
            جارٍ التحميل...
          </div>
        )}

        {!loading && isEmpty && (
          <div className="py-8 text-center">
            <Crown className="w-10 h-10 mx-auto mb-2" style={{ color: 'rgba(255,215,0,0.15)' }} />
            <p className="text-sm" style={{ color: 'rgba(255,215,0,0.4)' }}>
              لا يوجد محتوى في هذا التصنيف بعد
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.25)' }}>
              ارفع أول محتوى واحصل على المرتبة الأولى!
            </p>
          </div>
        )}

        {!loading && displayRows.map((entry, i) => (
          <motion.div
            key={`${entry.uploader_name}-${entry.category}-${i}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={{
              background: i === 0
                ? 'rgba(255,215,0,0.08)'
                : 'rgba(255,255,255,0.02)',
              border: i === 0
                ? '1px solid rgba(255,215,0,0.25)'
                : '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div className="shrink-0 w-7 flex justify-center">
              <RankIcon rank={i} />
            </div>

            <div className="flex-1 min-w-0" dir="rtl">
              <p className="font-black text-sm text-white truncate">{entry.uploader_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>
                  {CATEGORY_META[entry.category]?.icon} {CATEGORY_META[entry.category]?.label}
                </span>
                <span style={{ color: 'rgba(255,215,0,0.2)' }}>·</span>
                <span className="text-xs" style={{ color: 'rgba(255,215,0,0.4)' }}>
                  {entry.upload_count} محتوى
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 justify-end mb-0.5">
                <span className="text-sm font-black" style={{ color: '#FFD700' }}>
                  {Number(entry.total_views).toLocaleString()}
                </span>
                <Eye className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.5)' }} />
              </div>
              <div className="flex items-center gap-1 justify-end">
                <span className="text-xs font-mono" style={{ color: 'rgba(255,215,0,0.5)' }}>
                  {parseFloat(String(entry.total_earnings)).toFixed(1)}
                </span>
                <Coins className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.4)' }} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
