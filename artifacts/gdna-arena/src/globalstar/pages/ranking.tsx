import { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { useGetGsRanking } from '@workspace/api-client-react';
import { useLanguage } from '@/globalstar/contexts/language-context';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { VoteButton } from '@/globalstar/components/vote-button';
import { EmpireMediaPopup, type EmpireUpload } from '@/globalstar/components/empire-media-popup';
import { UploadModal } from '@/globalstar/components/upload-modal';
import { HonorLeaderboard } from '@/globalstar/components/honor-leaderboard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Crown, Medal, Play, Headphones, BookOpen,
  ChevronLeft, ChevronRight, X, Upload, Coins, Eye,
  TrendingUp, Video, Music,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MediaItem {
  id: number; figureId: number; domain: string;
  type: 'story' | 'video' | 'audio';
  title: string; content: string;
  platform?: string; sortOrder: number;
}

// ─── Rank Medal ───────────────────────────────────────────────────────────────
function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-6 h-6 text-yellow-400" />;
  if (rank === 2) return <Medal className="w-6 h-6 text-slate-300" />;
  if (rank === 3) return <Medal className="w-6 h-6 text-orange-400" />;
  return (
    <div className="w-7 h-7 rounded-full bg-border/40 flex items-center justify-center">
      <span className="text-xs font-black text-muted-foreground">#{rank}</span>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'w-14 h-14 text-lg' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  const colors = ['bg-primary/20 border-primary/40','bg-purple-500/20 border-purple-500/40','bg-yellow-400/20 border-yellow-400/40','bg-green-500/20 border-green-500/40','bg-orange-500/20 border-orange-500/40'];
  const ci = name.charCodeAt(0) % colors.length;
  return (
    <div className={`${sz} rounded-full border-2 flex items-center justify-center font-black shrink-0 ${colors[ci]}`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Story Viewer ─────────────────────────────────────────────────────────────
function StoryViewer({ stories, onClose }: { stories: MediaItem[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setProgress(0);
    timerRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          if (idx < stories.length - 1) setIdx(i => i + 1);
          else onClose();
          return 0;
        }
        return p + 2;
      });
    }, 100);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [idx, stories.length]);

  const s = stories[idx];
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-sm bg-gradient-to-b from-gray-900 to-black rounded-3xl overflow-hidden shadow-2xl border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex gap-1 p-3">
          {stories.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full bg-white/20 overflow-hidden">
              <motion.div
                className="h-full bg-white rounded-full"
                style={{ width: i < idx ? '100%' : i === idx ? `${progress}%` : '0%' }}
              />
            </div>
          ))}
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white z-10">
          <X className="w-5 h-5" />
        </button>
        <div className="px-6 py-8 min-h-80 flex flex-col justify-center space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono text-primary uppercase tracking-widest">{s.type}</span>
            <span className="text-xs text-white/40 ml-auto">{idx + 1}/{stories.length}</span>
          </div>
          <h3 className="text-xl font-black text-white leading-tight">{s.title}</h3>
          <p className="text-sm text-white/80 leading-relaxed">{s.content}</p>
        </div>
        <div className="flex border-t border-white/10">
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}
            className="flex-1 py-3 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-white disabled:opacity-20 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="w-px bg-white/10" />
          <button onClick={() => { if (idx < stories.length - 1) setIdx(idx + 1); else onClose(); }}
            className="flex-1 py-3 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-white transition-colors">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Figure Row ───────────────────────────────────────────────────────────────
function FigureRow({ figure, rank, media, onStory }: {
  figure: any; rank: number;
  media: MediaItem[];
  onStory: () => void;
}) {
  const stories = media.filter(m => m.type === 'story');
  const maxVotes = figure._maxVotes ?? figure.votes;
  const pct = maxVotes > 0 ? Math.min(100, (figure.votes / maxVotes) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (rank - 1) * 0.05 }}
    >
      <Card className={`border transition-all duration-200 hover:border-primary/40 ${
        rank === 1 ? 'border-yellow-400/30 bg-yellow-400/5' :
        rank === 2 ? 'border-slate-300/20 bg-slate-300/3' :
        rank === 3 ? 'border-orange-400/20 bg-orange-400/3' :
        'border-border/40 bg-card/40'
      }`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="w-8 flex justify-center pt-1 shrink-0">
              <RankMedal rank={rank} />
            </div>
            <Avatar name={figure.name} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <Link href={`/figures/${figure.id}`}>
                    <h3 className="font-black text-base hover:text-primary transition-colors leading-tight">
                      {figure.name}
                    </h3>
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">{figure.nationality}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black font-mono text-primary text-lg leading-none">
                    {figure.votes.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">votes</p>
                </div>
              </div>
              {figure.bio && (
                <p className="text-xs text-foreground/70 mt-1.5 line-clamp-2 leading-relaxed">{figure.bio}</p>
              )}
              <div className="h-1.5 bg-border/30 rounded-full overflow-hidden mt-2">
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: (rank - 1) * 0.05 + 0.3 }}
                  className={`h-full rounded-full ${
                    rank === 1 ? 'bg-gradient-to-r from-yellow-400 to-orange-400' :
                    rank === 2 ? 'bg-gradient-to-r from-slate-300 to-slate-400' :
                    rank === 3 ? 'bg-gradient-to-r from-orange-400 to-orange-500' :
                    'bg-gradient-to-r from-primary to-blue-500'
                  }`}
                />
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <VoteButton figureId={figure.id} currentVotes={figure.votes} />
                {stories.length > 0 && (
                  <Button onClick={onStory} size="sm" variant="outline"
                    className="h-7 px-2.5 text-xs border-purple-400/40 text-purple-400 hover:bg-purple-400/10 gap-1">
                    <BookOpen className="w-3 h-3" /> {stories.length} Stories
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Story Ring ───────────────────────────────────────────────────────────────
function StoryRing({ figure, hasStory, onClick }: { figure: any; hasStory: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!hasStory}
      className="flex flex-col items-center gap-1.5 shrink-0 group disabled:opacity-40">
      <div className={`rounded-full p-0.5 ${hasStory ? 'bg-gradient-to-tr from-yellow-400 via-primary to-purple-500' : 'bg-border/40'}`}>
        <div className="bg-background rounded-full p-0.5">
          <Avatar name={figure.name} size="sm" />
        </div>
      </div>
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors w-14 text-center line-clamp-1 leading-tight">
        {figure.name.split(' ')[0]}
      </span>
    </button>
  );
}

// ─── Sovereign Upload Card ────────────────────────────────────────────────────
function UploadCard({ upload, onClick }: { upload: EmpireUpload; onClick: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className="cursor-pointer rounded-xl p-4 flex items-center gap-4 transition-all"
      style={{
        background: 'rgba(10,8,0,0.9)',
        border: '1.5px solid rgba(255,215,0,0.2)',
      }}
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)' }}>
        {upload.type === 'video'
          ? <Video className="w-5 h-5" style={{ color: '#FFD700' }} />
          : <Music className="w-5 h-5" style={{ color: '#FFD700' }} />}
      </div>
      <div className="flex-1 min-w-0 text-right" dir="rtl">
        <p className="font-black text-sm text-white truncate">{upload.title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,215,0,0.55)' }}>
          {upload.uploader_name}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-center gap-1 justify-end mb-1">
          <span className="text-xs font-mono text-white">{upload.views.toLocaleString()}</span>
          <Eye className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.5)' }} />
        </div>
        <div className="flex items-center gap-1 justify-end">
          <span className="text-xs font-mono" style={{ color: 'rgba(255,215,0,0.5)' }}>
            {parseFloat(String(upload.earnings)).toFixed(2)}
          </span>
          <Coins className="w-3 h-3" style={{ color: 'rgba(255,215,0,0.4)' }} />
        </div>
      </div>
      <div className="shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: '#FFD700' }}>
          {upload.type === 'video'
            ? <Play className="w-4 h-4 fill-black text-black" />
            : <Headphones className="w-4 h-4 text-black" />}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function Ranking() {
  const { t } = useLanguage();
  const { data: rankingData, isLoading } = useGetGsRanking();
  const [activeDomain, setActiveDomain] = useState(0);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activeStory, setActiveStory] = useState<{ stories: MediaItem[] } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploads, setUploads] = useState<EmpireUpload[]>([]);
  const [activeUpload, setActiveUpload] = useState<EmpireUpload | null>(null);
  const [uploadTab, setUploadTab] = useState<'all' | 'video' | 'audio'>('all');
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  const fetchUploads = () => {
    fetch(`${BASE}/api/gs/uploads?limit=20`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUploads(d.uploads ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!rankingData?.ranking?.length) return;
    const domain = rankingData.ranking[activeDomain]?.domain;
    if (!domain) return;
    fetch(`${BASE}/api/gs/media?domain=${domain}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setMedia(d.media ?? []))
      .catch(() => {});
  }, [activeDomain, rankingData]);

  useEffect(() => { fetchUploads(); }, []);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <NewsTicker />
        <div className="container mx-auto px-4 py-12 space-y-4">
          <Skeleton className="h-12 w-64" />
          <div className="flex gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-16 rounded-full" />)}</div>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  const domains = rankingData?.ranking ?? [];
  const currentDomain = domains[activeDomain];
  const top10 = currentDomain?.figures?.slice(0, 10) ?? [];
  const maxVotes = top10[0]?.votes ?? 1;

  const getMedia = (figureId: number) => media.filter(m => m.figureId === figureId);

  const filteredUploads = uploads.filter(u =>
    uploadTab === 'all' ? true : u.type === uploadTab
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      <NewsTicker />

      {/* Overlays */}
      <AnimatePresence>
        {activeStory && (
          <StoryViewer stories={activeStory.stories} onClose={() => setActiveStory(null)} />
        )}
      </AnimatePresence>

      <EmpireMediaPopup upload={activeUpload} onClose={() => setActiveUpload(null)} />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => { fetchUploads(); setUploadOpen(false); }}
      />

      <main className="container mx-auto px-4 py-8 max-w-4xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight">
              {t('liveRankings')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-mono">
              Top 10 · {currentDomain?.domainLabel} · Updated {new Date(rankingData?.updatedAt ?? '').toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/10 text-primary border-primary/30 font-mono text-sm px-3 py-1">
              LIVE
            </Badge>
            <button
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-black text-sm transition-all hover:opacity-90 active:scale-[0.97]"
              style={{ background: '#FFD700', boxShadow: '0 4px 20px rgba(255,215,0,0.3)' }}
            >
              <Upload className="w-4 h-4" />
              رفع محتوى
            </button>
          </div>
        </div>

        {/* Domain Tab Strip */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
          {domains.map((d, i) => (
            <button
              key={d.domain}
              onClick={() => setActiveDomain(i)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap transition-all shrink-0 ${
                activeDomain === i
                  ? 'bg-primary text-black shadow-lg shadow-primary/30'
                  : 'bg-card/40 border border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground'
              }`}
            >
              <span className="text-lg">{d.icon}</span>
              <span className="hidden sm:block">{d.domainLabel}</span>
              <span className="text-xs opacity-70">({d.figures?.length ?? 0})</span>
            </button>
          ))}
        </div>

        {/* Story Rings */}
        {top10.length > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-3 mb-6 scrollbar-thin">
            {top10.map(figure => {
              const figMedia = getMedia(figure.id);
              const hasStory = figMedia.some(m => m.type === 'story');
              return (
                <StoryRing
                  key={figure.id}
                  figure={figure}
                  hasStory={hasStory}
                  onClick={() => {
                    const stories = figMedia.filter(m => m.type === 'story');
                    if (stories.length) setActiveStory({ stories });
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Domain Stats Banner */}
        {currentDomain && (
          <motion.div
            key={currentDomain.domain}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/8 to-card/30 p-4 mb-6 flex flex-wrap gap-4 items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-4xl">{currentDomain.icon}</span>
              <div>
                <h2 className="font-black text-xl">{currentDomain.domainLabel}</h2>
                <p className="text-xs text-muted-foreground font-mono">{currentDomain.figures?.length ?? 0} ranked figures</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-lg font-black text-primary font-mono">
                  {(currentDomain.figures?.reduce((s: number, f: any) => s + f.votes, 0) ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Total Votes</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-yellow-400 font-mono">
                  {top10[0]?.votes.toLocaleString() ?? '-'}
                </p>
                <p className="text-xs text-muted-foreground">#1 Votes</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Top 10 List */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeDomain}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-3 mb-8"
          >
            {top10.map((figure, i) => (
              <FigureRow
                key={figure.id}
                figure={{ ...figure, _maxVotes: maxVotes }}
                rank={i + 1}
                media={getMedia(figure.id)}
                onStory={() => {
                  const stories = getMedia(figure.id).filter(m => m.type === 'story');
                  if (stories.length) setActiveStory({ stories });
                }}
              />
            ))}
            {top10.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No figures in this domain yet.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── Sovereign Uploads ─────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)' }}>
                <Upload className="w-4 h-4" style={{ color: '#FFD700' }} />
              </div>
              <div dir="rtl">
                <p className="font-black text-white text-sm">المحتوى السيادي</p>
                <p className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>
                  {uploads.length} محتوى مرفوع · من خوادم GDNA
                </p>
              </div>
            </div>
            <Link href="/earnings">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                style={{ border: '1px solid rgba(255,215,0,0.3)', color: '#FFD700', background: 'rgba(255,215,0,0.06)' }}>
                <Coins className="w-3.5 h-3.5" /> أرباحي
              </button>
            </Link>
          </div>

          {/* Upload type filter */}
          <div className="flex gap-2 mb-4">
            {([['all', 'الكل'], ['video', 'فيديو'], ['audio', 'صوت']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setUploadTab(val)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={uploadTab === val
                  ? { background: '#FFD700', color: '#000' }
                  : { background: 'rgba(255,215,0,0.06)', color: 'rgba(255,215,0,0.6)', border: '1px solid rgba(255,215,0,0.2)' }}
              >
                {val === 'video' && <Video className="w-3 h-3 inline mr-1" />}
                {val === 'audio' && <Music className="w-3 h-3 inline mr-1" />}
                {label}
              </button>
            ))}
          </div>

          {filteredUploads.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: 'rgba(255,215,0,0.03)', border: '1.5px dashed rgba(255,215,0,0.2)' }}
            >
              <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,215,0,0.2)' }} />
              <p className="text-sm font-bold mb-1" style={{ color: 'rgba(255,215,0,0.5)' }}>
                لا يوجد محتوى بعد
              </p>
              <p className="text-xs mb-4" style={{ color: 'rgba(255,215,0,0.3)' }}>
                كن أول من يرفع محتوى سيادياً على الإمبراطورية
              </p>
              <button
                onClick={() => setUploadOpen(true)}
                className="px-5 py-2.5 rounded-xl font-black text-black text-sm transition-all hover:opacity-90"
                style={{ background: '#FFD700' }}
              >
                ارفع الآن
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUploads.map(u => (
                <UploadCard key={u.id} upload={u} onClick={() => setActiveUpload(u)} />
              ))}
            </div>
          )}
        </div>

        {/* ── Honor Leaderboard ──────────────────────────────────────────────── */}
        <HonorLeaderboard />

        {/* View all figures link */}
        {(currentDomain?.figures?.length ?? 0) > 10 && (
          <div className="text-center mt-6">
            <Link href={`/figures?domain=${currentDomain?.domain}`}>
              <Button variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 gap-2">
                <TrendingUp className="w-4 h-4" />
                View all {currentDomain?.figures?.length} figures
              </Button>
            </Link>
          </div>
        )}

      </main>
    </div>
  );
}
