import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, TrendingUp, Zap, ExternalLink, ChevronRight, Play, Newspaper } from "lucide-react";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Card, CardContent } from "@workspace/gdna-ds/components/ui/card";
import { ScrollArea, ScrollBar } from "@workspace/gdna-ds/components/ui/scroll-area";

const CATEGORIES = ["All", "Gaming", "Crypto", "Esports", "Web3", "Tournaments"];

const categoryColors: Record<string, string> = {
  Gaming: "text-[#00d4ff] border-[#00d4ff] bg-[#00d4ff]/10 shadow-[0_0_10px_rgba(0,212,255,0.3)]",
  Crypto: "text-[#00ff88] border-[#00ff88] bg-[#00ff88]/10 shadow-[0_0_10px_rgba(0,255,136,0.3)]",
  Esports: "text-[#b400ff] border-[#b400ff] bg-[#b400ff]/10 shadow-[0_0_10px_rgba(180,0,255,0.3)]",
  Web3: "text-[#ff6b00] border-[#ff6b00] bg-[#ff6b00]/10 shadow-[0_0_10px_rgba(255,107,0,0.3)]",
  Tournaments: "text-[#ffd700] border-[#ffd700] bg-[#ffd700]/10 shadow-[0_0_10px_rgba(255,215,0,0.3)]",
};

interface Article {
  id: number;
  category: string;
  title: string;
  summary: string;
  readTime: string;
  date: string;
}

const FEATURED_ARTICLE: Article = {
  id: 0,
  category: "Web3",
  title: "The Great Migration: How Top AAA Studios Are Quietly Building The Next Generation Of On-Chain Economies",
  summary: "Behind closed doors, industry veterans from Blizzard, EA, and Riot are establishing a new paradigm for player-owned assets that doesn't sacrifice gameplay.",
  readTime: "8 min read",
  date: "Jul 25, 2026"
};

const ARTICLES: Article[] = [
  {
    id: 1,
    category: "Gaming",
    title: "Epic Games Announces $50M Web3 Gaming Fund for Indie Developers",
    summary: "New grant program aims to lower the barrier to entry for studios integrating blockchain mechanics into Unreal Engine 5 projects.",
    readTime: "3 min read",
    date: "Jul 24, 2026"
  },
  {
    id: 2,
    category: "Crypto",
    title: "Ethereum Layer 2 Cuts Gaming Transaction Fees by 94% — What It Means for Play-to-Earn",
    summary: "The latest rollup upgrade finally makes micro-transactions viable for high-frequency trading in blockchain economies.",
    readTime: "5 min read",
    date: "Jul 23, 2026"
  },
  {
    id: 3,
    category: "Esports",
    title: "GDNA Arena Season 2 Tournament: $100,000 Prize Pool Opens Registration",
    summary: "The highly anticipated second season brings new maps, balanced character rosters, and a massive prize pool.",
    readTime: "2 min read",
    date: "Jul 22, 2026"
  },
  {
    id: 4,
    category: "Web3",
    title: "Axie Infinity 2.0 Beta Launches with Full PvP Economy Overhaul",
    summary: "Sky Mavis responds to community feedback with a redesigned combat system that emphasizes skill over pay-to-win mechanics.",
    readTime: "4 min read",
    date: "Jul 21, 2026"
  },
  {
    id: 5,
    category: "Crypto",
    title: "Bitcoin Gaming Wallets Cross 10 Million Users for First Time",
    summary: "Lightning network adoption in casual mobile games drives unprecedented growth in non-custodial gaming wallets.",
    readTime: "3 min read",
    date: "Jul 20, 2026"
  },
  {
    id: 6,
    category: "Gaming",
    title: "Unreal Engine 6 Preview Showcases Real-Time Ray Tracing for Mobile",
    summary: "Epic's next engine iteration promises to bridge the visual gap between mobile and console gaming.",
    readTime: "6 min read",
    date: "Jul 19, 2026"
  },
  {
    id: 7,
    category: "Tournaments",
    title: "South Korea Tops Global Esports Rankings; GDNA Teams in Top 20",
    summary: "Following dominant performances in regional qualifiers, South Korean orgs solidify their position at the pinnacle of competitive gaming.",
    readTime: "2 min read",
    date: "Jul 18, 2026"
  },
  {
    id: 8,
    category: "Web3",
    title: "NFT Gaming Items Now Tradeable Across 15 Platforms Via New Protocol",
    summary: "Cross-chain interoperability takes a major step forward as leading marketplaces adopt a unified standard for in-game assets.",
    readTime: "4 min read",
    date: "Jul 17, 2026"
  }
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export default function NewsPage() {
  const [activeCategory, setActiveCategory] = useState("All");

  const filteredArticles = activeCategory === "All" 
    ? ARTICLES 
    : ARTICLES.filter(a => a.category === activeCategory);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Live Ticker */}
      <div className="w-full bg-primary/10 border-b border-primary/20 flex items-center overflow-hidden h-10">
        <div className="bg-primary text-primary-foreground font-bold px-4 py-2 flex items-center gap-2 z-10 relative whitespace-nowrap shadow-[0_0_15px_rgba(0,212,255,0.5)]">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          LIVE
        </div>
        <div className="flex-1 overflow-hidden relative">
          <div className="flex whitespace-nowrap animate-[ticker_30s_linear_infinite] group-hover:[animation-play-state:paused]">
            <span className="text-sm font-mono tracking-tight text-white/80 mx-4">
              🔴 LIVE: Tournament brackets updated • Bitcoin ETF volume surges • New Web3 game launches • GDNA Arena Season 2 announced • Epic Games $50M Fund • 
            </span>
            <span className="text-sm font-mono tracking-tight text-white/80 mx-4">
              🔴 LIVE: Tournament brackets updated • Bitcoin ETF volume surges • New Web3 game launches • GDNA Arena Season 2 announced • Epic Games $50M Fund • 
            </span>
            <span className="text-sm font-mono tracking-tight text-white/80 mx-4">
              🔴 LIVE: Tournament brackets updated • Bitcoin ETF volume surges • New Web3 game launches • GDNA Arena Season 2 announced • Epic Games $50M Fund • 
            </span>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white neon-text-glow mb-4 uppercase">
            GDNA NEWS
          </h1>
          <p className="text-xl text-primary font-mono flex items-center gap-2">
            <Zap className="w-5 h-5" />
            TRUSTED INTEL. NO NOISE.
          </p>
        </div>

        {/* Category Filters */}
        <ScrollArea className="w-full whitespace-nowrap mb-12 pb-4">
          <div className="flex w-max space-x-2">
            {CATEGORIES.map(category => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`px-6 py-2.5 rounded-full font-medium transition-all duration-300 border ${
                  activeCategory === category 
                    ? category === "All" 
                      ? "bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                      : categoryColors[category]
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-white"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="invisible" />
        </ScrollArea>

        {/* Featured Article */}
        <div className="mb-16">
          <div className="group relative rounded-xl overflow-hidden border border-primary/20 bg-card hover:border-primary/50 transition-all duration-500">
            <div className="grid md:grid-cols-2 gap-0">
              <div className="relative aspect-video md:aspect-auto overflow-hidden bg-gradient-to-br from-primary/20 via-background to-accent/20 flex items-center justify-center p-8">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
                <TrendingUp className="w-32 h-32 text-primary/30 group-hover:scale-110 group-hover:text-primary/50 transition-all duration-700" />
                
                {/* Decorative Elements */}
                <div className="absolute top-4 left-4 w-16 h-16 border-l-2 border-t-2 border-primary/30" />
                <div className="absolute bottom-4 right-4 w-16 h-16 border-r-2 border-b-2 border-primary/30" />
              </div>
              
              <div className="p-8 md:p-12 flex flex-col justify-center">
                <div className="flex items-center gap-4 mb-6">
                  <Badge variant="outline" className={`px-3 py-1 font-mono uppercase tracking-wider ${categoryColors[FEATURED_ARTICLE.category]}`}>
                    {FEATURED_ARTICLE.category}
                  </Badge>
                  <span className="text-muted-foreground text-sm font-mono flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {FEATURED_ARTICLE.readTime}
                  </span>
                </div>
                
                <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight text-white group-hover:text-primary transition-colors">
                  {FEATURED_ARTICLE.title}
                </h2>
                
                <p className="text-muted-foreground text-lg mb-8 line-clamp-2">
                  {FEATURED_ARTICLE.summary}
                </p>
                
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-sm text-muted-foreground font-mono">{FEATURED_ARTICLE.date}</span>
                  <Button className="gap-2 bg-white text-black hover:bg-primary hover:text-black transition-all shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:shadow-[0_0_20px_rgba(0,212,255,0.5)]">
                    READ STORY
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Article Grid */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          variants={containerVariants}
          initial="hidden"
          animate="show"
          key={activeCategory} // re-trigger animation on filter change
        >
          {filteredArticles.map(article => (
            <motion.div key={article.id} variants={itemVariants}>
              <Card className="h-full bg-card/50 border-border hover:border-primary/40 transition-all duration-300 group flex flex-col hover:bg-card">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-4">
                    <Badge variant="outline" className={`px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${categoryColors[article.category]}`}>
                      {article.category}
                    </Badge>
                    <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all" />
                  </div>
                  
                  <h3 className="text-xl font-bold mb-3 text-white/90 group-hover:text-white line-clamp-3">
                    {article.title}
                  </h3>
                  
                  <p className="text-muted-foreground text-sm mb-6 line-clamp-2">
                    {article.summary}
                  </p>
                  
                  <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-mono">{article.date}</span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {article.readTime}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          
          {filteredArticles.length === 0 && (
            <div className="col-span-full py-20 text-center border border-dashed border-border rounded-xl bg-card/30">
              <Newspaper className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-white mb-2">No intel found</h3>
              <p className="text-muted-foreground">Try selecting a different frequency channel.</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
