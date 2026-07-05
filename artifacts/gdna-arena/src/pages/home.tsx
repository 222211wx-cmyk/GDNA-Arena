import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center z-10 space-y-8 px-4 max-w-4xl"
      >
        <h1 className="text-6xl md:text-8xl font-black text-white uppercase tracking-tighter neon-text-glow leading-tight">
          GDNA Arena
        </h1>
        
        <p className="text-xl md:text-2xl text-muted-foreground font-medium uppercase tracking-widest">
          Play & Earn Crypto
        </p>

        <div className="pt-8">
          <Link href="/games">
            <Button size="lg" className="h-16 px-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300 hover:scale-105 active:scale-95">
              Play Now
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
