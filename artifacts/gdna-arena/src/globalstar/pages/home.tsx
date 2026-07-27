import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { useGetGsDomains, useGetGsFigures } from '@workspace/api-client-react';
import { useLanguage } from '@/globalstar/contexts/language-context';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { FigureAvatar } from '@/globalstar/components/figure-avatar';
import { RankBadge } from '@/globalstar/components/rank-badge';
import { VoteButton } from '@/globalstar/components/vote-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

export default function Home() {
  const { t } = useLanguage();
  const { data: domainsData, isLoading: domainsLoading } = useGetGsDomains();
  const [activeDomainIndex, setActiveDomainIndex] = useState(0);

  const activeDomain = domainsData?.domains[activeDomainIndex];
  const { data: figuresData, isLoading: figuresLoading } = useGetGsFigures(
    activeDomain ? { domain: activeDomain.id, limit: 3 } : undefined
  );

  useEffect(() => {
    if (!domainsData?.domains || domainsData.domains.length === 0) return;
    
    const interval = setInterval(() => {
      setActiveDomainIndex((prev) => (prev + 1) % domainsData.domains.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [domainsData]);

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-6xl md:text-8xl font-bold mb-4 bg-gradient-to-r from-primary via-blue-400 to-primary bg-clip-text text-transparent" data-testid="hero-title">
            GlobalStar
          </h1>
          <p className="text-2xl md:text-3xl text-muted-foreground mb-8" data-testid="hero-subtitle">
            {t('whereTheWorldVotes')}
          </p>
          <p className="text-lg text-foreground/80 max-w-2xl mx-auto mb-8">
            {t('voteForYourFavorites')}
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/ranking">
              <Button size="lg" className="gap-2" data-testid="cta-view-rankings">
                {t('liveRankings')}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* AI Moderation Badge */}
        <Card className="max-w-3xl mx-auto mb-16 p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20" data-testid="ai-moderation-badge">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                {t('aiModerated')}
                <Sparkles className="w-4 h-4 text-primary" />
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('aiModeratedDesc')}
              </p>
            </div>
          </div>
        </Card>

        {/* Domain Spotlight */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold mb-8 text-center" data-testid="domain-spotlight-title">
            Live Domain Spotlight
          </h2>

          {domainsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <div className="grid md:grid-cols-3 gap-4">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
            </div>
          ) : activeDomain ? (
            <div>
              <div className="flex items-center justify-center gap-4 mb-8 p-6 bg-card rounded-lg border border-border" data-testid="active-domain-header">
                <span className="text-4xl">{activeDomain.icon}</span>
                <div>
                  <h3 className="text-2xl font-bold">{activeDomain.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    {activeDomain.figureCount} figures • {activeDomain.totalVotes.toLocaleString()} total votes
                  </p>
                </div>
              </div>

              {figuresLoading ? (
                <div className="grid md:grid-cols-3 gap-4">
                  <Skeleton className="h-64" />
                  <Skeleton className="h-64" />
                  <Skeleton className="h-64" />
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-6">
                  {figuresData?.figures.slice(0, 3).map((figure) => (
                    <Card key={figure.id} className="p-6 hover:border-primary transition-colors" data-testid={`figure-card-${figure.id}`}>
                      <div className="flex items-start gap-4 mb-4">
                        <FigureAvatar name={figure.name} imageUrl={figure.imageUrl} size="lg" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-bold text-lg truncate">{figure.name}</h3>
                            <RankBadge rank={figure.rank} size="md" />
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">{figure.nationality}</p>
                        </div>
                      </div>
                      
                      <p className="text-sm text-foreground/80 mb-4 line-clamp-3">{figure.bio}</p>
                      
                      <div className="flex gap-2">
                        <VoteButton figureId={figure.id} currentVotes={figure.votes} size="sm" />
                        <Link href={`/figures/${figure.id}`}>
                          <Button variant="outline" size="sm" data-testid={`view-profile-${figure.id}`}>
                            {t('viewProfile')}
                          </Button>
                        </Link>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Domain Navigation Dots */}
          {domainsData?.domains && domainsData.domains.length > 0 && (
            <div className="flex justify-center gap-2 mt-8" data-testid="domain-dots">
              {domainsData.domains.map((domain, idx) => (
                <button
                  key={domain.id}
                  onClick={() => setActiveDomainIndex(idx)}
                  className={`w-3 h-3 rounded-full transition-all ${
                    idx === activeDomainIndex ? 'bg-primary w-8' : 'bg-muted hover:bg-muted-foreground'
                  }`}
                  data-testid={`domain-dot-${idx}`}
                  aria-label={`View ${domain.label}`}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
