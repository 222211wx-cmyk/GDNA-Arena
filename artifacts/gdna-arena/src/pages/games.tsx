import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

const GAMES = [
  {
    id: 1,
    title: "Neon Racer",
    description: "Race through glowing cyberpunk streets at breakneck speed",
    image: "/images/neon-racer.png",
    genre: "Racing",
    reward: "High"
  },
  {
    id: 2,
    title: "Crypto Clash",
    description: "Battle opponents in strategic card duels, earn coins with every win",
    image: "/images/crypto-clash.png",
    genre: "Strategy",
    reward: "Medium"
  },
  {
    id: 3,
    title: "Arena Strike",
    description: "First-person arena combat. Dominate and claim your crypto rewards",
    image: "/images/arena-strike.png",
    genre: "FPS",
    reward: "Very High"
  }
];

export default function Games() {
  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <div className="text-center space-y-4 pt-8">
        <motion.h1 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-6xl font-black uppercase tracking-wider neon-text-glow"
        >
          Select Arena
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-muted-foreground uppercase tracking-widest"
        >
          Compete. Win. Earn Crypto.
        </motion.p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {GAMES.map((game, index) => (
          <motion.div
            key={game.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.15 + 0.3 }}
          >
            <Card className="bg-card/40 border-primary/20 overflow-hidden group hover:border-primary/60 transition-colors duration-500 h-full flex flex-col">
              <div className="relative aspect-video overflow-hidden">
                <img 
                  src={game.image} 
                  alt={game.title} 
                  className="object-cover w-full h-full transform group-hover:scale-110 transition-transform duration-700 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
                <div className="absolute top-4 right-4 flex gap-2">
                  <span className="px-3 py-1 bg-background/80 backdrop-blur border border-primary/50 text-xs font-bold uppercase tracking-wider text-primary rounded-full">
                    {game.genre}
                  </span>
                </div>
              </div>
              
              <CardContent className="p-6 flex-1 flex flex-col justify-between relative z-10 -mt-6">
                <div>
                  <h3 className="text-2xl font-bold uppercase tracking-wider mb-2 group-hover:text-primary transition-colors">
                    {game.title}
                  </h3>
                  <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
                    {game.description}
                  </p>
                </div>
                
                <div className="space-y-6">
                  <div className="flex justify-between items-center text-xs uppercase tracking-widest border-t border-border/50 pt-4">
                    <span className="text-muted-foreground">Reward Pool</span>
                    <span className="text-primary font-bold">{game.reward}</span>
                  </div>
                  
                  <Button className="w-full h-12 font-bold uppercase tracking-wider group-hover:neon-glow bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300">
                    <Play className="w-4 h-4 mr-2" />
                    Play Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
