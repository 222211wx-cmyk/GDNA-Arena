import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { motion } from 'framer-motion';
import { Coins, Eye, Upload, ArrowLeft, TrendingUp, Video, Music, Search } from 'lucide-react';

interface EarningsUpload {
  id: number;
  title: string;
  type: 'video' | 'audio';
  category: string;
  file_name: string;
  views: number;
  earnings: string | number;
  created_at: string;
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  sport:     { label: 'الرياضة',  icon: '⚽' },
  press:     { label: 'الصحافة', icon: '📰' },
  art:       { label: 'الفن',    icon: '🎨' },
  knowledge: { label: 'المعرفة', icon: '📚' },
};

export default function EarningsPage() {
  const [name, setName] = useState(() => localStorage.getItem('empire_citizen_name') ?? '');
  const [searched, setSearched] = useState(false);
  const [uploads, setUploads] = useState<EarningsUpload[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [loading, setLoading] = useState(false);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  const fetchEarnings = async (n: string) => {
    if (!n.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/gs/earnings?name=${encodeURIComponent(n.trim())}`, { credentials: 'include' });
      const d = await r.json();
      setUploads(d.uploads ?? []);
      setTotalEarnings(d.totalEarnings ?? 0);
      setTotalViews(d.totalViews ?? 0);
      setSearched(true);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    const saved = localStorage.getItem('empire_citizen_name');
    if (saved) fetchEarnings(saved);
  }, []);

  const handleSearch = () => {
    localStorage.setItem('empire_citizen_name', name.trim());
    fetchEarnings(name);
  };

  const earningsToCoins = totalEarnings.toFixed(2);

  return (
    <div className="min-h-[100dvh]" style={{ background: '#0a0800' }}>
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Link href="/ranking">
          <button className="flex items-center gap-2 text-sm mb-6 transition-colors hover:opacity-80"
            style={{ color: 'rgba(255,215,0,0.6)' }}>
            <ArrowLeft className="w-4 h-4" /> العودة إلى التصنيفات
          </button>
        </Link>

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden mb-6"
          style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.1), rgba(255,165,0,0.05))', border: '1.5px solid rgba(255,215,0,0.35)' }}>
          <div className="p-6 md:p-8" dir="rtl">
            <div className="flex items-center gap-3 mb-2">
              <Coins className="w-8 h-8" style={{ color: '#FFD700' }} />
              <h1 className="text-3xl font-black text-white">أرباحي</h1>
            </div>
            <p className="text-sm" style={{ color: 'rgba(255,215,0,0.6)' }}>
              كل 100 مشاهدة = 1 عملة ذهبية · محسوبة تلقائياً على خوادم GDNA
            </p>
          </div>
        </motion.div>

        {/* Search */}
        <div className="rounded-2xl p-5 mb-6" style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)' }}>
          <p className="text-sm font-bold mb-3 text-right" dir="rtl" style={{ color: 'rgba(255,215,0,0.7)' }}>
            أدخل اسمك في الإمبراطورية
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSearch}
              disabled={loading || !name.trim()}
              className="px-5 py-3 rounded-xl font-black text-black transition-all hover:opacity-90 disabled:opacity-40 shrink-0 flex items-center gap-2"
              style={{ background: '#FFD700' }}
            >
              <Search className="w-4 h-4" />
              بحث
            </button>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="اسمك كمواطن في الإمبراطورية"
              className="flex-1 rounded-xl px-4 py-3 text-sm text-white text-right placeholder:text-white/30 outline-none"
              dir="rtl"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,215,0,0.25)' }}
            />
          </div>
        </div>

        {/* Stats */}
        {searched && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { icon: <Coins className="w-6 h-6" style={{ color: '#FFD700' }} />, value: earningsToCoins, label: 'عملة ذهبية', gold: true },
                { icon: <Eye className="w-6 h-6" style={{ color: 'rgba(255,215,0,0.6)' }} />, value: totalViews.toLocaleString(), label: 'إجمالي المشاهدات', gold: false },
                { icon: <Upload className="w-6 h-6" style={{ color: 'rgba(255,215,0,0.6)' }} />, value: uploads.length, label: 'محتوى مرفوع', gold: false },
              ].map((stat, i) => (
                <div key={i} className="rounded-2xl p-4 text-center"
                  style={{
                    background: stat.gold ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${stat.gold ? 'rgba(255,215,0,0.3)' : 'rgba(255,215,0,0.1)'}`,
                  }}>
                  <div className="flex justify-center mb-2">{stat.icon}</div>
                  <div className="text-2xl font-black" style={{ color: stat.gold ? '#FFD700' : 'white' }}>
                    {stat.value}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.5)' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Uploads list */}
            {uploads.length === 0 ? (
              <div className="text-center py-12">
                <TrendingUp className="w-12 h-12 mx-auto mb-3" style={{ color: 'rgba(255,215,0,0.15)' }} />
                <p className="text-sm" style={{ color: 'rgba(255,215,0,0.4)' }}>لا يوجد محتوى برفع هذا الاسم بعد</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,215,0,0.25)' }}>ارفع محتواك من صفحة التصنيفات</p>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="font-black text-white text-sm mb-3 text-right" dir="rtl">محتواك السيادي</h2>
                {uploads.map((u, i) => (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-xl p-4 flex items-center gap-4"
                    style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.15)' }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)' }}>
                      {u.type === 'video'
                        ? <Video className="w-5 h-5" style={{ color: '#FFD700' }} />
                        : <Music className="w-5 h-5" style={{ color: '#FFD700' }} />}
                    </div>
                    <div className="flex-1 min-w-0 text-right" dir="rtl">
                      <p className="font-black text-sm text-white truncate">{u.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 justify-end">
                        <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>
                          {CATEGORY_META[u.category]?.icon} {CATEGORY_META[u.category]?.label}
                        </span>
                        <span style={{ color: 'rgba(255,215,0,0.2)' }}>·</span>
                        <span className="text-xs" style={{ color: 'rgba(255,215,0,0.4)' }}>
                          {new Date(u.created_at).toLocaleDateString('ar')}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 justify-end mb-1">
                        <span className="text-sm font-black" style={{ color: '#FFD700' }}>
                          {u.views.toLocaleString()}
                        </span>
                        <Eye className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.5)' }} />
                      </div>
                      <div className="flex items-center gap-1 justify-end">
                        <span className="text-xs font-mono" style={{ color: 'rgba(255,215,0,0.5)' }}>
                          {parseFloat(String(u.earnings)).toFixed(2)} 🪙
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
