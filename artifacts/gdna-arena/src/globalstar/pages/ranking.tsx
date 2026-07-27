import { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { useGetGsRanking } from '@workspace/api-client-react';
import { useLanguage } from '@/globalstar/contexts/language-context';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { FigureAvatar } from '@/globalstar/components/figure-avatar';
import { RankBadge } from '@/globalstar/components/rank-badge';
import { VoteButton } from '@/globalstar/components/vote-button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { motion, AnimatePresence } from 'framer-motion';

export default function Ranking() {
  const { t } = useLanguage();
  const { data: rankingData, isLoading } = useGetGsRanking();
  const [activeTab, setActiveTab] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!rankingData?.ranking || rankingData.ranking.length === 0) return;

    const startRotation = () => {
      intervalRef.current = setInterval(() => {
        if (!isHovered) {
          setActiveTab((prev) => (prev + 1) % rankingData.ranking.length);
        }
      }, 6000);
    };

    startRotation();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [rankingData, isHovered]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <NewsTicker />
        <div className="container mx-auto px-4 py-12">
          <Skeleton className="h-12 w-64 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!rankingData?.ranking || rankingData.ranking.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <NewsTicker />
        <div className="container mx-auto px-4 py-12">
          <p className="text-center text-muted-foreground">No ranking data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl md:text-5xl font-bold" data-testid="ranking-title">
            {t('liveRankings')}
          </h1>
          <div className="text-sm text-muted-foreground">
            Last updated: {new Date(rankingData.updatedAt).toLocaleTimeString()}
          </div>
        </div>

        <Tabs
          value={activeTab.toString()}
          onValueChange={(val) => setActiveTab(parseInt(val))}
          className="w-full"
          data-testid="ranking-tabs"
        >
          <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <TabsList className="w-full grid grid-cols-5 md:grid-cols-10 mb-8 h-auto gap-2 bg-transparent">
              {rankingData.ranking.map((domain, idx) => (
                <TabsTrigger
                  key={domain.domain}
                  value={idx.toString()}
                  className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  data-testid={`tab-${domain.domain}`}
                >
                  <span className="text-2xl">{domain.icon}</span>
                  <span className="text-xs font-medium hidden md:block">{domain.domainLabel}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <AnimatePresence mode="wait">
            {rankingData.ranking.map((domain, idx) => (
              <TabsContent key={domain.domain} value={idx.toString()} className="mt-0">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="mb-6 text-center">
                    <h2 className="text-3xl font-bold mb-2">{domain.domainLabel}</h2>
                    <p className="text-muted-foreground">{domain.figures.length} ranked figures</p>
                  </div>

                  <div className="space-y-4">
                    {domain.figures.map((figure) => (
                      <Card
                        key={figure.id}
                        className="p-6 hover:border-primary transition-colors"
                        data-testid={`ranking-figure-${figure.id}`}
                      >
                        <div className="flex items-center gap-6">
                          <RankBadge rank={figure.rank} size="lg" />
                          
                          <FigureAvatar name={figure.name} imageUrl={figure.imageUrl} size="lg" />
                          
                          <div className="flex-1 min-w-0">
                            <Link href={`/globalstar/figures/${figure.id}`} className="hover:text-primary transition-colors">
                              <h3 className="text-xl font-bold mb-1">{figure.name}</h3>
                            </Link>
                            <p className="text-sm text-muted-foreground mb-2">{figure.nationality}</p>
                            <p className="text-sm text-foreground/80 line-clamp-2">{figure.bio}</p>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <div className="font-mono text-2xl font-bold text-primary">
                              {figure.votes.toLocaleString()}
                            </div>
                            <VoteButton figureId={figure.id} currentVotes={figure.votes} />
                          </div>
                        </div>

                        {/* Vote Progress Bar */}
                        <div className="mt-4">
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary to-blue-600 transition-all duration-500"
                              style={{
                                width: `${Math.min(100, (figure.votes / Math.max(...domain.figures.map((f) => f.votes))) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </motion.div>
              </TabsContent>
            ))}
          </AnimatePresence>
        </Tabs>
      </main>
    </div>
  );
}
