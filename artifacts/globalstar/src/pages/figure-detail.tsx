import { useParams } from 'wouter';
import { useGetGsFigure } from '@workspace/api-client-react';
import { useLanguage } from '@/contexts/language-context';
import { Navbar } from '@/components/navbar';
import { NewsTicker } from '@/components/news-ticker';
import { FigureAvatar } from '@/components/figure-avatar';
import { RankBadge } from '@/components/rank-badge';
import { VoteButton } from '@/components/vote-button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';

export default function FigureDetail() {
  const { t } = useLanguage();
  const params = useParams();
  const figureId = params.id ? parseInt(params.id) : 0;
  const { data: figure, isLoading } = useGetGsFigure(figureId);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <NewsTicker />
        <div className="container mx-auto px-4 py-12">
          <Skeleton className="h-64 w-full mb-8" />
          <div className="grid md:grid-cols-2 gap-8">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </div>
    );
  }

  if (!figure) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <NewsTicker />
        <div className="container mx-auto px-4 py-12">
          <p className="text-center text-muted-foreground">Figure not found</p>
        </div>
      </div>
    );
  }

  const getTrendIcon = () => {
    if (figure.voteTrend > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (figure.voteTrend < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <Card className="p-8 mb-8 bg-gradient-to-br from-card to-card/50" data-testid="figure-hero">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
            <FigureAvatar name={figure.name} imageUrl={figure.imageUrl} size="xl" />
            
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-4 mb-4">
                <h1 className="text-4xl md:text-5xl font-bold" data-testid="figure-name">
                  {figure.name}
                </h1>
                <RankBadge rank={figure.rank} size="lg" />
              </div>
              
              <div className="flex items-center justify-center md:justify-start gap-4 mb-6">
                <Badge variant="secondary" data-testid="figure-domain">
                  {figure.domainLabel}
                </Badge>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground" data-testid="figure-nationality">
                  {figure.nationality}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-4">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary font-mono" data-testid="figure-votes">
                    {figure.votes.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">{t('votes')}</div>
                </div>

                <VoteButton figureId={figure.id} currentVotes={figure.votes} size="lg" />
              </div>
            </div>
          </div>
        </Card>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Stats Cards */}
          <Card className="p-6" data-testid="card-rank">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{t('rank')}</h3>
              <RankBadge rank={figure.rank} size="md" />
            </div>
            <div className="text-3xl font-bold">#{figure.rank}</div>
            <p className="text-sm text-muted-foreground mt-2">in {figure.domainLabel}</p>
          </Card>

          <Card className="p-6" data-testid="card-recent-activity">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{t('recentActivity')}</h3>
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="text-3xl font-bold">{figure.recentVotes.toLocaleString()}</div>
            <p className="text-sm text-muted-foreground mt-2">votes in last 24h</p>
          </Card>

          <Card className="p-6" data-testid="card-trend">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{t('voteTrend')}</h3>
              {getTrendIcon()}
            </div>
            <div className={`text-3xl font-bold ${
              figure.voteTrend > 0 ? 'text-green-500' : figure.voteTrend < 0 ? 'text-red-500' : 'text-muted-foreground'
            }`}>
              {figure.voteTrend > 0 ? '+' : ''}{figure.voteTrend}%
            </div>
            <p className="text-sm text-muted-foreground mt-2">compared to average</p>
          </Card>
        </div>

        {/* Biography */}
        <Card className="p-8 mt-8" data-testid="card-bio">
          <h2 className="text-2xl font-bold mb-4">{t('bio')}</h2>
          <p className="text-foreground/90 leading-relaxed whitespace-pre-line">
            {figure.bio}
          </p>
        </Card>
      </main>
    </div>
  );
}
