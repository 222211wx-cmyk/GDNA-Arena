import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Film, Flame, Star, ArrowRight, Crown, Clapperboard, Globe2, ChevronRight } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────
interface Legend {
  id: number;
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
const CINEMA_IMAGES: Record<string, string> = {
  "Stanley Kubrick":   "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Kubrick_cropped.jpg/400px-Kubrick_cropped.jpg",
  "Quentin Tarantino": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Quentin_Tarantino_by_Gage_Skidmore.jpg/400px-Quentin_Tarantino_by_Gage_Skidmore.jpg",
  "Martin Scorsese":   "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Martin_Scorsese_Sept_2018.jpg/400px-Martin_Scorsese_Sept_2018.jpg",
  "Akira Kurosawa":    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/twentytwo/Akira_Kurosawa.jpg/400px-Akira_Kurosawa.jpg",
  "Meryl Streep":      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Meryl_Streep_December_2018.jpg/400px-Meryl_Streep_December_2018.jpg",
  "Christopher Nolan": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Christopher_Nolan_Cannes_2018.jpg/400px-Christopher_Nolan_Cannes_2018.jpg",
};

const CINEMA_QUOTES: Record<string, string> = {
  "Stanley Kubrick":   "A film is — or should be — more like music than like fiction.",
  "Quentin Tarantino": "I steal from every single movie ever made.",
  "Martin Scorsese":   "Cinema is a mirror by which we often see ourselves.",
  "Akira Kurosawa":    "In order to gain anything, you must first lose everything.",
  "Meryl Streep":      "The great gift of human beings is that we have the power of empathy.",
  "Christopher Nolan": "I have a lot of respect for people who say: 'I will make this work.'",
};

const DNA_PILLARS = [
  { icon: "🎬", label: "DIRECTION DNA",    desc: "The art of orchestrating a vision" },
  { icon: "📖", label: "STORYTELLING DNA", desc: "Narrative depth and emotional truth" },
  { icon: "💥", label: "IMPACT DNA",       desc: "Cultural and societal resonance" },
  { icon: "🏆", label: "LEGACY DNA",       desc: "Their place in cinema history" },
];


const ERA_NAMES: Record<string, string> = {
  "golden-age":   "Golden Age",
  "new-hollywood": "New Hollywood",
  "modern":       "Modern",
  "independent":  "Independent",
};

// Map legends to eras by name
const ERA_MAP: Record<string, string[]> = {
  "golden-age":    ["Akira Kurosawa"],
  "new-hollywood": ["Stanley Kubrick", "Martin Scorsese"],
  "modern":        ["Christopher Nolan"],
  "independent":   ["Quentin Tarantino"],
};

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-yellow-400 font-bold">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-1000"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function LegendCard({ legend, index }: { legend: Legend; index: number }) {
  const img   = CINEMA_IMAGES[legend.name] ?? legend.imageUrl;
  const quote = CINEMA_QUOTES[legend.name];

  const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", "#60a5fa", "#a78bfa", "#34d399"];
  const rankColor   = RANK_COLORS[Math.min(legend.rank - 1, RANK_COLORS.length - 1)];

  return (
    <div
      className="group relative bg-gray-900/80 border border-gray-800 rounded-2xl overflow-hidden hover:border-yellow-400/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(255,215,0,0.12)]"
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
      <div className="absolute top-3 right-3 z-10 bg-black/70 border border-yellow-400/30 text-yellow-400 text-xs font-bold px-2 py-1 rounded-lg">
        {legend.score.toLocaleString()}
      </div>

      {/* Image */}
      <div className="relative h-56 overflow-hidden bg-gray-800">
        {img ? (
          <img
            src={img}
            alt={legend.name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={48} className="text-yellow-400/30" />
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/30 to-transparent" />
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-white font-black text-lg tracking-tight leading-tight">
            {legend.name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <Globe2 size={11} className="text-gray-500" />
            <span className="text-gray-400 text-xs">{legend.nationality}</span>
            {legend.peakYear && (
              <>
                <span className="text-gray-700">·</span>
                <Star size={11} className="text-yellow-500" />
                <span className="text-yellow-500/80 text-xs">Peak {legend.peakYear}</span>
              </>
            )}
          </div>
        </div>

        {/* Quote */}
        {quote && (
          <p className="text-gray-400 text-xs italic leading-relaxed border-l-2 border-yellow-400/30 pl-2">
            "{quote}"
          </p>
        )}

        {/* DNA Stats */}
        {legend.stats && (
          <div className="space-y-1.5 pt-1">
            <StatBar label="DIRECTION"    value={legend.stats.style}  />
            <StatBar label="IMPACT"       value={legend.stats.impact} />
            <StatBar label="LEGACY"       value={legend.stats.legacy} />
          </div>
        )}

        {/* CTA */}
        <Link
          href={`/legends/${legend.id}`}
          className="flex items-center justify-between w-full mt-2 px-3 py-2 bg-yellow-400/5 border border-yellow-400/20 rounded-xl text-yellow-400 text-xs font-bold hover:bg-yellow-400/10 hover:border-yellow-400/40 transition-all group/btn"
        >
          <span>VIEW LEGEND HUB</span>
          <ChevronRight size={14} className="group-hover/btn:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function CinemaPage() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"all" | "golden-age" | "new-hollywood" | "modern" | "independent">("all");

  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    fetch(`${base}/api/legends?domain=cinema&limit=50`)
      .then(r => r.json())
      .then(data => {
        const apiLegends: Legend[] = (data.legends ?? []).map((l: any) => ({
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
        setLegends(apiLegends);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const displayed = activeFilter === "all"
    ? legends
    : legends.filter(l => ERA_MAP[activeFilter]?.includes(l.name));

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px]"
            style={{ background: "radial-gradient(ellipse, rgba(255,215,0,0.08) 0%, transparent 70%)" }} />
          <div className="absolute bottom-0 w-full h-px bg-gradient-to-r from-transparent via-yellow-400/30 to-transparent" />
        </div>

        <div className="max-w-7xl mx-auto px-4 pt-14 pb-10 relative">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-gray-600 mb-6">
            <Link href="/" className="hover:text-gray-400 transition-colors">EMPIRE ETERNAL</Link>
            <ChevronRight size={12} />
            <span className="text-yellow-400">CINEMA</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              {/* Pillar tag */}
              <div className="inline-flex items-center gap-2 border border-yellow-400/30 bg-yellow-400/5 text-yellow-400 text-xs font-black tracking-widest px-3 py-1.5 rounded-full mb-4">
                <Clapperboard size={12} />
                PILLAR III — CINEMATIC DNA
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-none">
                <span className="text-white">CINEMA</span>
                <br />
                <span className="bg-gradient-to-r from-yellow-400 via-yellow-300 to-yellow-500 bg-clip-text text-transparent">
                  LEGENDS
                </span>
              </h1>

              <p className="mt-4 text-gray-400 max-w-xl leading-relaxed">
                The cinematic universe of greatness — every director, actor, and visionary here
                carries a complete <span className="text-yellow-400">DNA</span> of direction, storytelling, and legacy.
              </p>
            </div>

            {/* Live stats */}
            <div className="flex gap-4 lg:gap-6 shrink-0">
              <div className="text-center">
                <div className="text-3xl font-black text-yellow-400">{legends.length}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Legends</div>
              </div>
              <div className="w-px bg-gray-800" />
              <div className="text-center">
                <div className="text-3xl font-black text-yellow-400">4</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Eras</div>
              </div>
              <div className="w-px bg-gray-800" />
              <div className="text-center">
                <div className="text-3xl font-black text-yellow-400">∞</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Frames</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DNA Pillars strip ─────────────────────────────────────────────── */}
      <section className="border-t border-b border-gray-800/60">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-800/60">
            {DNA_PILLARS.map(p => (
              <div key={p.label} className="flex items-center gap-3 px-5 py-4">
                <span className="text-2xl">{p.icon}</span>
                <div>
                  <div className="text-yellow-400 text-xs font-black tracking-wider">{p.label}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{p.desc}</div>
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
          {(["all", "golden-age", "new-hollywood", "modern", "independent"] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase transition-all ${
                activeFilter === f
                  ? "bg-yellow-400 text-black"
                  : "border border-gray-700 text-gray-400 hover:border-yellow-400/30 hover:text-yellow-400"
              }`}
            >
              {f === "all" ? "🎬 ALL ERAS" : ERA_NAMES[f]}
            </button>
          ))}

          {/* Vote CTA */}
          <Link
            href="/games/globalstar"
            className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-yellow-400 text-black text-xs font-black tracking-wider rounded-full hover:bg-yellow-300 transition-all"
          >
            <Flame size={13} />
            VOTE NOW
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-80 bg-gray-900 border border-gray-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <Film size={48} className="mx-auto mb-3 opacity-20" />
            <p>No legends in this era yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayed.map((legend, i) => (
              <LegendCard key={legend.id} legend={legend} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* ── Director Showdown Banner ──────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 pb-14">
        <div className="relative rounded-2xl overflow-hidden border border-yellow-400/20 bg-gradient-to-r from-gray-900 via-black to-gray-900 p-8">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(255,215,0,0.05) 0%, transparent 70%)" }} />

          <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-yellow-400 text-xs font-black tracking-widest mb-2">
                <Crown size={14} />
                DIRECTOR SHOWDOWN — The Grand Debate
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Kubrick vs Tarantino — Vote in the Eternal Debate
              </h2>
              <p className="text-gray-400 text-sm mt-2 max-w-md">
                Two visions of cinema that changed the world forever. Who crafted the greater art?
                Your GlobalStar vote writes history.
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-yellow-400 mx-auto mb-1 bg-gray-800 flex items-center justify-center">
                  {CINEMA_IMAGES["Stanley Kubrick"] ? (
                    <img
                      src={CINEMA_IMAGES["Stanley Kubrick"]}
                      alt="Kubrick"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <Film size={24} className="text-yellow-400/60" />
                  )}
                </div>
                <div className="text-xs text-yellow-400 font-bold">KUBRICK</div>
              </div>
              <div className="text-yellow-400 font-black text-2xl">VS</div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-yellow-400 mx-auto mb-1 bg-gray-800 flex items-center justify-center">
                  {CINEMA_IMAGES["Quentin Tarantino"] ? (
                    <img
                      src={CINEMA_IMAGES["Quentin Tarantino"]}
                      alt="Tarantino"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <Film size={24} className="text-yellow-400/60" />
                  )}
                </div>
                <div className="text-xs text-yellow-400 font-bold">TARANTINO</div>
              </div>

              <Link
                href="/games/globalstar"
                className="flex items-center gap-2 px-5 py-3 bg-yellow-400 text-black font-black text-sm rounded-xl hover:bg-yellow-300 transition-all hover:shadow-[0_0_20px_rgba(255,215,0,0.3)]"
              >
                Vote Now
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
