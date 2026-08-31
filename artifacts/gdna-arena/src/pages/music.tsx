import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Music, Flame, Star, ArrowRight, Crown, Radio, Globe2, ChevronRight } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Skeleton } from "@workspace/gdna-ds/components/ui/skeleton";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";

// ── Types ───────────────────────────────────────────────────────────────────
interface Legend {
  id: number | null;   // null = static display only (no DB row)
  rank: number;
  name: string;
  domain: string;
  score: number;
  nationality: string;
  imageUrl?: string;
  peakYear?: number;
  stats?: { clutch: number; legacy: number; style: number; impact: number; peak: number };
}

// ── Static image map (Wikipedia CDN) ────────────────────────────────────────
const MUSIC_IMAGES: Record<string, string> = {
  "Michael Jackson":  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Michael_Jackson_in_1988.jpg/400px-Michael_Jackson_in_1988.jpg",
  "Beyoncé":          "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Beyonc%C3%A9_at_The_Battle_of_Versailles_Fashion_Show_%28cropped%29.png/400px-Beyonc%C3%A9_at_The_Battle_of_Versailles_Fashion_Show_%28cropped%29.png",
  "Taylor Swift":     "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/191125_Taylor_Swift_at_the_2019_American_Music_Awards_%28cropped%29.jpg/400px-191125_Taylor_Swift_at_the_2019_American_Music_Awards_%28cropped%29.jpg",
  "Bob Marley":       "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Bob-Marley-in-Concert_Zurich_05-30-80.jpg/400px-Bob-Marley-in-Concert_Zurich_05-30-80.jpg",
  "Elvis Presley":    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Elvis_Presley_promoting_Jailhouse_Rock.jpg/400px-Elvis_Presley_promoting_Jailhouse_Rock.jpg",
  "Whitney Houston":  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Whitney_Houston_Welcome_Home_Heroes_1991.jpg/400px-Whitney_Houston_Welcome_Home_Heroes_1991.jpg",
  "Tupac Shakur":     "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Tupac_Shakur_photo.jpg/400px-Tupac_Shakur_photo.jpg",
};

const MUSIC_QUOTES: Record<string, string> = {
  "Michael Jackson":  "In a world full of ordinary, dare to be extraordinary.",
  "Beyoncé":          "Power means happiness. Power means hard work and sacrifice.",
  "Taylor Swift":     "Long story short, I survived.",
  "Bob Marley":       "One good thing about music — when it hits you, you feel no pain.",
  "Elvis Presley":    "Ambition is a dream with a V8 engine.",
  "Whitney Houston":  "I decided long ago never to walk in anyone's shadow.",
  "Tupac Shakur":     "Reality is wrong. Dreams are for real.",
};

const MUSIC_GENRES: Record<string, string[]> = {
  pop:    ["Michael Jackson", "Beyoncé", "Taylor Swift", "Elvis Presley"],
  rnb:    ["Beyoncé", "Whitney Houston"],
  hiphop: ["Tupac Shakur"],
  reggae: ["Bob Marley"],
};

const GENRE_LABELS: Record<string, string> = {
  pop: "Pop", rnb: "R&B", hiphop: "Hip-Hop", reggae: "Reggae",
};

const DNA_PILLARS = [
  { icon: "🎵", label: "RHYTHM DNA",    desc: "The pulse that moves the world" },
  { icon: "👁️", label: "VISION DNA",   desc: "Artistic foresight and originality" },
  { icon: "🌍", label: "INFLUENCE DNA", desc: "Cultural reach across generations" },
  { icon: "♾️", label: "TIMELESS DNA", desc: "Legacy that outlives the era" },
];

// ── Stat bar ─────────────────────────────────────────────────────────────────
function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-primary font-bold">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-1000"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ── Legend Card ───────────────────────────────────────────────────────────────
function LegendCard({ legend, index }: { legend: Legend; index: number }) {
  const img   = MUSIC_IMAGES[legend.name] ?? legend.imageUrl;
  const quote = MUSIC_QUOTES[legend.name];

  const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", "#60a5fa", "#a78bfa", "#34d399"];
  const rankColor   = RANK_COLORS[Math.min(legend.rank - 1, RANK_COLORS.length - 1)];

  return (
    <div
      className="group relative bg-card/80 border border-border rounded-2xl overflow-hidden hover:border-primary/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(255,215,0,0.12)]"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      {/* Rank badge */}
      <div
        className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2"
        style={{ borderColor: rankColor, color: rankColor, background: "rgba(0,0,0,0.8)" }}
      >
        #{legend.rank}
      </div>

      {/* Score badge */}
      <Badge className="absolute top-3 right-3 z-10 bg-background/70 border border-primary/30 text-primary text-xs font-bold">
        {legend.score.toLocaleString()}
      </Badge>

      {/* Image */}
      <div className="relative h-56 overflow-hidden bg-muted">
        {img ? (
          <img
            src={img}
            alt={legend.name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={48} className="text-primary/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/30 to-transparent" />
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-foreground font-black text-lg tracking-tight leading-tight">
            {legend.name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <Globe2 size={11} className="text-muted-foreground" />
            <span className="text-muted-foreground text-xs">{legend.nationality}</span>
            {legend.peakYear && (
              <>
                <span className="text-muted-foreground">·</span>
                <Star size={11} className="text-primary" />
                <span className="text-primary/80 text-xs">Peak {legend.peakYear}</span>
              </>
            )}
          </div>
        </div>

        {quote && (
          <p className="text-muted-foreground text-xs italic leading-relaxed border-l-2 border-primary/30 pl-2">
            "{quote}"
          </p>
        )}

        {legend.stats && (
          <div className="space-y-1.5 pt-1">
            <StatBar label="LEGACY"    value={legend.stats.legacy} />
            <StatBar label="PEAK"      value={legend.stats.peak}   />
            <StatBar label="INFLUENCE" value={legend.stats.impact} />
          </div>
        )}

        {/* CTA — only navigable when we have a real DB id */}
        {legend.id !== null ? (
          <Link
            href={`/legends/${legend.id}`}
            className="flex items-center justify-between w-full mt-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-primary text-xs font-bold hover:bg-primary/10 hover:border-primary/40 transition-all group/btn"
          >
            <span>VIEW LEGEND HUB</span>
            <ChevronRight size={14} className="group-hover/btn:translate-x-0.5 transition-transform" />
          </Link>
        ) : (
          <div className="flex items-center justify-between w-full mt-2 px-3 py-2 bg-muted/50 border border-border rounded-xl text-muted-foreground text-xs font-bold cursor-default select-none">
            <span>COMING SOON</span>
            <ChevronRight size={14} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton card ────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-card/80 border border-border rounded-2xl overflow-hidden">
      <Skeleton className="h-56 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-8 w-full rounded-xl" />
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function MusicPage() {
  const [legends, setLegends]           = useState<Legend[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeFilter, setActiveFilter] = useState<"all" | "pop" | "rnb" | "hiphop" | "reggae">("all");

  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    fetch(`${base}/api/legends?domain=music&limit=50`)
      .then(r => r.json())
      .then(data => {
        const fromApi: Legend[] = (data.legends ?? []).map((l: any) => ({
          id:          l.id,
          rank:        l.rank,
          name:        l.name,
          domain:      l.domain,
          score:       l.score,
          nationality: l.nationality ?? "",
          imageUrl:    l.image_url ?? l.imageUrl,
          peakYear:    l.peak_year ?? l.peakYear,
          stats:       l.stats,
        }));
        setLegends(fromApi);
      })
      .catch(() => setLegends([]))
      .finally(() => setLoading(false));
  }, []);

  const displayed = activeFilter === "all"
    ? legends
    : legends.filter(l => MUSIC_GENRES[activeFilter]?.includes(l.name));

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px]"
            style={{ background: "radial-gradient(ellipse, rgba(255,215,0,0.08) 0%, transparent 70%)" }} />
          <div className="absolute bottom-0 w-full h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        </div>

        <div className="max-w-7xl mx-auto px-4 pt-14 pb-10 relative">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link href="/" className="hover:text-foreground transition-colors">EMPIRE ETERNAL</Link>
            <ChevronRight size={12} />
            <span className="text-primary">MUSIC</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              {/* Pillar tag */}
              <div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/5 text-primary text-xs font-black tracking-widest px-3 py-1.5 rounded-full mb-4">
                <Radio size={12} />
                PILLAR II — RHYTHM DNA
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-none">
                <span className="text-foreground">MUSIC</span>
                <br />
                <span className="bg-gradient-to-r from-yellow-400 via-yellow-300 to-yellow-500 bg-clip-text text-transparent">
                  LEGENDS
                </span>
              </h1>

              <p className="mt-4 text-muted-foreground max-w-xl leading-relaxed">
                The rhythm of the empire — every legend here transcends a genre, carrying a complete{" "}
                <span className="text-primary">DNA</span> of vision, influence, and timeless legacy.
              </p>
            </div>

            {/* Live stats */}
            <div className="flex gap-4 lg:gap-6 shrink-0">
              <div className="text-center">
                <div className="text-3xl font-black text-primary">
                  {loading ? "—" : legends.length}
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Legends</div>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-black text-primary">4</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Genres</div>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-black text-primary">∞</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Legacy</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DNA Pillars strip ─────────────────────────────────────────────── */}
      <section className="border-t border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
            {DNA_PILLARS.map(p => (
              <div key={p.label} className="flex items-center gap-3 px-5 py-4">
                <span className="text-2xl">{p.icon}</span>
                <div>
                  <div className="text-primary text-xs font-black tracking-wider">{p.label}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Filter + Grid ─────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 py-10">

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-8">
          {(["all", "pop", "rnb", "hiphop", "reggae"] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase transition-all ${
                activeFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-primary/30 hover:text-primary"
              }`}
            >
              {f === "all" ? "🎵 ALL GENRES" : GENRE_LABELS[f]}
            </button>
          ))}

          {/* Vote CTA */}
          <Link href="/games/globalstar" className="ml-auto">
            <Button size="sm" className="flex items-center gap-2 bg-primary text-primary-foreground font-black text-xs tracking-wider rounded-full hover:bg-primary/90">
              <Flame size={13} />
              VOTE NOW
              <ArrowRight size={13} />
            </Button>
          </Link>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Music size={48} className="mx-auto mb-3 opacity-20" />
            <p>No legends in this genre yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayed.map((legend, i) => (
              <LegendCard key={legend.id ?? legend.name} legend={legend} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* ── GOAT Showdown Banner ──────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 pb-14">
        <div className="relative rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-r from-gray-900 via-black to-gray-900 p-8">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(255,215,0,0.05) 0%, transparent 70%)" }} />

          <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-primary text-xs font-black tracking-widest mb-2">
                <Crown size={14} />
                RHYTHM SHOWDOWN — The Eternal Battle
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-foreground">
                MJ vs Beyoncé — Vote in the Music GOAT Debate
              </h2>
              <p className="text-muted-foreground text-sm mt-2 max-w-md">
                Two icons, one throne. The greatest music rivalry is still unsettled.
                Your GlobalStar vote writes history.
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-center">
                <img
                  src={MUSIC_IMAGES["Michael Jackson"]}
                  alt="MJ"
                  className="w-16 h-16 rounded-full object-cover object-top border-2 border-primary mx-auto mb-1"
                />
                <div className="text-xs text-primary font-bold">MJ</div>
              </div>
              <div className="text-primary font-black text-2xl">VS</div>
              <div className="text-center">
                <img
                  src={MUSIC_IMAGES["Beyoncé"]}
                  alt="Beyoncé"
                  className="w-16 h-16 rounded-full object-cover object-top border-2 border-primary mx-auto mb-1"
                />
                <div className="text-xs text-primary font-bold">BEYONCÉ</div>
              </div>

              <Link href="/games/globalstar">
                <Button className="flex items-center gap-2 bg-primary text-primary-foreground font-black text-sm rounded-xl hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(255,215,0,0.3)]">
                  Vote Now
                  <ArrowRight size={16} />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
