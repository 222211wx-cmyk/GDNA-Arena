import { useLanguage } from '@/globalstar/contexts/language-context';
import { Navbar } from '@/globalstar/components/navbar';
import { NewsTicker } from '@/globalstar/components/news-ticker';
import { Card } from '@workspace/gdna-ds/components/ui/card';
import { ShieldCheck, Sparkles, Globe, Users, Vote, TrendingUp } from 'lucide-react';

export default function About() {
  const { t } = useLanguage();

  const features = [
    {
      icon: Vote,
      title: 'Real-Time Voting',
      description: 'Cast your vote and watch rankings update instantly as millions participate worldwide.',
    },
    {
      icon: Globe,
      title: '10 Global Domains',
      description: 'From football to archaeology, vote across diverse fields that shape our world.',
    },
    {
      icon: ShieldCheck,
      title: 'AI Moderation',
      description: 'OpenAI-powered content filtering ensures quality and safety across all submissions.',
    },
    {
      icon: TrendingUp,
      title: 'Live Rankings',
      description: 'Rankings shift in real-time as votes pour in, creating electric competition.',
    },
    {
      icon: Users,
      title: 'Global Community',
      description: 'Join millions of voters celebrating excellence across cultures and disciplines.',
    },
    {
      icon: Sparkles,
      title: 'Fair & Transparent',
      description: 'Every vote counts equally. No bias, no manipulation—just pure recognition.',
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      <NewsTicker />

      <main className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6" data-testid="about-title">
            {t('aboutPlatform')}
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            {t('missionStatement')}
          </p>
        </div>

        {/* AI Moderation Highlight */}
        <Card className="max-w-4xl mx-auto mb-16 p-8 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20" data-testid="ai-moderation-section">
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-3 flex items-center gap-2">
                {t('aiModerated')}
                <Sparkles className="w-5 h-5 text-primary" />
              </h2>
              <p className="text-foreground/90 mb-4">
                {t('aiModeratedDesc')}
              </p>
              <p className="text-sm text-muted-foreground">
                Our AI moderation system analyzes all user-submitted content in real-time, filtering spam, 
                inappropriate material, and ensuring factual accuracy. This keeps GlobalStar a trusted 
                platform where quality content rises to the top.
              </p>
            </div>
          </div>
        </Card>

        {/* How It Works */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold mb-8 text-center" data-testid="how-it-works-title">
            {t('howItWorks')}
          </h2>
          <p className="text-lg text-muted-foreground text-center max-w-3xl mx-auto mb-12">
            {t('howItWorksDesc')}
          </p>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">1</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Choose a Domain</h3>
              <p className="text-sm text-muted-foreground">
                Browse 10 global domains from football to archaeology and find figures you admire.
              </p>
            </Card>

            <Card className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">2</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Cast Your Vote</h3>
              <p className="text-sm text-muted-foreground">
                Click the vote button to support your favorite public figures and watch the numbers rise.
              </p>
            </Card>

            <Card className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">3</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Watch Rankings Shift</h3>
              <p className="text-sm text-muted-foreground">
                Rankings update live as votes pour in from around the world, creating real-time competition.
              </p>
            </Card>
          </div>
        </div>

        {/* Features Grid */}
        <div>
          <h2 className="text-3xl font-bold mb-8 text-center">Platform Features</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <Card key={idx} className="p-6 hover:border-primary transition-colors" data-testid={`feature-${idx}`}>
                  <Icon className="w-10 h-10 text-primary mb-4" />
                  <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Footer Stats */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="text-4xl font-bold text-primary mb-2">10</div>
            <div className="text-sm text-muted-foreground">Global Domains</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-primary mb-2">24/7</div>
            <div className="text-sm text-muted-foreground">Live Updates</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-primary mb-2">100%</div>
            <div className="text-sm text-muted-foreground">AI Moderated</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-primary mb-2">∞</div>
            <div className="text-sm text-muted-foreground">Votes Welcome</div>
          </div>
        </div>
      </main>
    </div>
  );
}
