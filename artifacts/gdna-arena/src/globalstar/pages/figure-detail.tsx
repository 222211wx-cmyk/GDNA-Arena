import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { useGetGsFigure } from '@workspace/api-client-react';
import { useLanguage } from '@/globalstar/contexts/language-context';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { FigureAvatar } from '@/globalstar/components/figure-avatar';
import { RankBadge } from '@/globalstar/components/rank-badge';
import { VoteButton } from '@/globalstar/components/vote-button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Activity,
  BookOpen, Play, Headphones, ChevronLeft, ChevronRight,
  X, Volume2, Crown, Medal, ArrowLeft,
} from 'lucide-react';

interface MediaItem {
  id: number; figureId: number; domain: string;
  type: 'story' | 'video' | 'audio';
  title: string; content: string;
  platform?: string; sortOrder: number;
}

// ── Story Viewer ──────────────────────────────────────────────────────────────
function StoryViewer({ stories, onClose }: { stories: MediaItem[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setProgress(0);
    timerRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          if (idx < stories.length - 1) { setIdx(i => i + 1); return 0; }
          else { onClose(); return 100; }
        }
        return p + 2;
      });
    }, 100);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [idx]);

  const s = stories[idx];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-sm bg-gradient-to-b from-gray-900 to-black rounded-3xl overflow-hidden shadow-2xl border border-white/10"
        onClick={e => e.stopPropagation()}>
        <div className="flex gap-1 p-3">
          {stories.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all"
                style={{ width: i < idx ? '100%' : i === idx ? `${progress}%` : '0%' }} />
            </div>
          ))}
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        <div className="px-6 py-8 min-h-72 flex flex-col justify-center space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono text-primary uppercase tracking-widest">Story {idx + 1}/{stories.length}</span>
          </div>
          <h3 className="text-xl font-black text-white leading-tight">{s.title}</h3>
          <p className="text-sm text-white/80 leading-relaxed">{s.content}</p>
        </div>
        <div className="flex border-t border-white/10">
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}
            className="flex-1 py-3 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-white disabled:opacity-20">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="w-px bg-white/10" />
          <button onClick={() => { if (idx < stories.length - 1) setIdx(idx + 1); else onClose(); }}
            className="flex-1 py-3 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-white">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Video Modal ───────────────────────────────────────────────────────────────
function VideoModal({ video, onClose }: { video: MediaItem; onClose: () => void }) {
  const url = video.platform === 'youtube'
    ? `https://www.youtube.com/embed/${video.content}?autoplay=1&rel=0`
    : video.content;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
        className="relative w-full max-w-3xl bg-black rounded-2xl overflow-hidden border border-white/10"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-red-400" />
            <span className="font-bold text-sm text-white">{video.title}</span>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="aspect-video">
          <iframe src={url} className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Audio Bar ─────────────────────────────────────────────────────────────────
function AudioBar({ audio, onClose }: { audio: MediaItem; onClose: () => void }) {
  const url = audio.platform === 'youtube'
    ? `https://www.youtube.com/embed/${audio.content}?autoplay=1&rel=0`
    : audio.content;
  return (
    <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="bg-gray-900 border border-primary/30 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-2">
          <Volume2 className="w-5 h-5 text-primary animate-pulse" />
          <p className="font-bold text-sm text-white flex-1 truncate">{audio.title}</p>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div style={{ height: 60 }} className="rounded-xl overflow-hidden opacity-0 pointer-events-none">
          <iframe src={url} className="w-full h-full" allow="autoplay" />
        </div>
        <p className="text-xs text-primary/60 font-mono text-center mt-1">▶ Now Playing</p>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function FigureDetail() {
  const { t } = useLanguage();
  const params = useParams();
  const figureId = params.id ? parseInt(params.id) : 0;
  const { data: figure, isLoading } = useGetGsFigure(figureId);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activeStory, setActiveStory] = useState(false);
  const [activeVideo, setActiveVideo] = useState<MediaItem | null>(null);
  const [activeAudio, setActiveAudio] = useState<MediaItem | null>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    if (!figureId) return;
    fetch(`${BASE}/api/gs/media?figureId=${figureId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setMedia(d.media ?? []))
      .catch(() => {});
  }, [figureId]);

  const stories = media.filter(m => m.type === 'story');
  const videos  = media.filter(m => m.type === 'video');
  const audios  = media.filter(m => m.type === 'audio');

  const getTrendIcon = () => {
    if (!figure) return null;
    if (figure.voteTrend > 0) return <TrendingUp className="w-5 h-5 text-green-400" />;
    if (figure.voteTrend < 0) return <TrendingDown className="w-5 h-5 text-red-400" />;
    return <Minus className="w-5 h-5 text-muted-foreground" />;
  };

  if (isLoading) return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar /><NewsTicker />
      <div className="container mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid md:grid-cols-3 gap-6">{[1,2,3].map(i=><Skeleton key={i} className="h-32 rounded-2xl"/>)}</div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );

  if (!figure) return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar /><NewsTicker />
      <div className="container mx-auto px-4 py-24 text-center text-muted-foreground">Figure not found</div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar /><NewsTicker />

      <AnimatePresence>
        {activeStory && stories.length > 0 && <StoryViewer stories={stories} onClose={() => setActiveStory(false)} />}
        {activeVideo && <VideoModal video={activeVideo} onClose={() => setActiveVideo(null)} />}
        {activeAudio && <AudioBar audio={activeAudio} onClose={() => setActiveAudio(null)} />}
      </AnimatePresence>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back */}
        <Link href="/ranking">
          <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Rankings
          </button>
        </Link>

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden border-primary/20 mb-6">
            <div className="h-2 bg-gradient-to-r from-primary via-purple-500 to-yellow-400" />
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                <FigureAvatar name={figure.name} imageUrl={figure.imageUrl} size="xl" />
                <div className="flex-1 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-3 flex-wrap mb-2">
                    <h1 className="text-3xl md:text-5xl font-black">{figure.name}</h1>
                    <RankBadge rank={figure.rank} size="lg" />
                  </div>
                  <div className="flex items-center justify-center md:justify-start gap-3 mb-4 flex-wrap">
                    <Badge variant="secondary">{figure.domainLabel}</Badge>
                    <span className="text-muted-foreground text-sm">{figure.nationality}</span>
                  </div>
                  <div className="flex items-center justify-center md:justify-start gap-4 mb-5">
                    <div>
                      <div className="text-4xl font-black text-primary font-mono">{figure.votes.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">{t('votes')}</div>
                    </div>
                    <VoteButton figureId={figure.id} currentVotes={figure.votes} size="lg" />
                  </div>
                  {/* Media action buttons */}
                  {(stories.length > 0 || videos.length > 0 || audios.length > 0) && (
                    <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                      {stories.length > 0 && (
                        <Button onClick={() => setActiveStory(true)} variant="outline"
                          className="border-purple-400/40 text-purple-400 hover:bg-purple-400/10 gap-2 font-bold">
                          <BookOpen className="w-4 h-4" /> {stories.length} Stories
                        </Button>
                      )}
                      {videos.map(v => (
                        <Button key={v.id} onClick={() => setActiveVideo(v)} variant="outline"
                          className="border-red-400/40 text-red-400 hover:bg-red-400/10 gap-2 font-bold">
                          <Play className="w-4 h-4" /> Watch
                        </Button>
                      ))}
                      {audios.map(a => (
                        <Button key={a.id} onClick={() => setActiveAudio(a)} variant="outline"
                          className="border-green-400/40 text-green-400 hover:bg-green-400/10 gap-2 font-bold">
                          <Headphones className="w-4 h-4" /> Listen
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="border-primary/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">
                {figure.rank === 1 ? <Crown className="w-6 h-6 text-yellow-400" /> :
                 figure.rank <= 3 ? <Medal className="w-6 h-6 text-orange-400" /> :
                 <RankBadge rank={figure.rank} size="md" />}
              </div>
              <div className="text-2xl font-black">#{figure.rank}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('rank')} in {figure.domainLabel}</div>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardContent className="p-4 text-center">
              <Activity className="w-6 h-6 text-primary mx-auto mb-2" />
              <div className="text-2xl font-black text-primary">{figure.recentVotes.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('recentActivity')}</div>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">{getTrendIcon()}</div>
              <div className={`text-2xl font-black ${figure.voteTrend > 0 ? 'text-green-400' : figure.voteTrend < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                {figure.voteTrend > 0 ? '+' : ''}{figure.voteTrend}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">{t('voteTrend')}</div>
            </CardContent>
          </Card>
        </div>

        {/* Biography */}
        {figure.bio && (
          <Card className="border-primary/20 mb-6">
            <CardContent className="p-6">
              <h2 className="text-lg font-black uppercase tracking-wider mb-3">{t('bio')}</h2>
              <p className="text-foreground/80 leading-relaxed">{figure.bio}</p>
            </CardContent>
          </Card>
        )}

        {/* Stories preview cards */}
        {stories.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-black uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-400" /> Stories
              </h2>
              <Button onClick={() => setActiveStory(true)} size="sm" variant="outline"
                className="border-purple-400/40 text-purple-400 hover:bg-purple-400/10 text-xs">
                Read All Stories
              </Button>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {stories.map((s, i) => (
                <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                  <Card onClick={() => setActiveStory(true)}
                    className="border-purple-400/20 bg-purple-400/5 hover:border-purple-400/50 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-purple-400/20 border border-purple-400/30 flex items-center justify-center">
                          <span className="text-xs font-black text-purple-400">{i + 1}</span>
                        </div>
                        <span className="text-xs font-mono text-purple-400 uppercase tracking-widest">Story</span>
                      </div>
                      <h3 className="font-black text-sm leading-tight">{s.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{s.content}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Video + Audio cards */}
        {(videos.length > 0 || audios.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {videos.map(v => (
              <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card onClick={() => setActiveVideo(v)}
                  className="border-red-400/20 bg-red-400/5 hover:border-red-400/50 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-red-400/20 border border-red-400/30 flex items-center justify-center shrink-0">
                      <Play className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <p className="text-xs font-mono text-red-400 uppercase tracking-widest mb-1">Watch</p>
                      <p className="font-black text-sm">{v.title}</p>
                      {v.platform === 'youtube' && <p className="text-xs text-muted-foreground mt-0.5">YouTube · Click to play</p>}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {audios.map(a => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card onClick={() => setActiveAudio(a)}
                  className="border-green-400/20 bg-green-400/5 hover:border-green-400/50 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-400/20 border border-green-400/30 flex items-center justify-center shrink-0">
                      <Headphones className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs font-mono text-green-400 uppercase tracking-widest mb-1">Listen</p>
                      <p className="font-black text-sm">{a.title}</p>
                      {a.platform === 'youtube' && <p className="text-xs text-muted-foreground mt-0.5">Audio · Click to play</p>}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
