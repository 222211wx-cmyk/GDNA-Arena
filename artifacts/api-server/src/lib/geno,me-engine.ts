/**
 * ═══════════════════════════════════════════════════════════════
 *  GDNA GENOME ENGINE — GGE v1.0
 *
 *  G = Genetic   D = Digital   N = Neural   A = Architecture
 *
 *  Every citizen has a unique Digital DNA — a 64-char genetic
 *  code derived entirely from their behaviour on the platform.
 *  The empire itself has a collective Genome that evolves daily.
 *
 *  Genetic operations implemented:
 *    - ENCODING     : behavior → DNA string
 *    - SELECTION    : fittest patterns survive
 *    - CROSSOVER    : two memories breed a new insight
 *    - MUTATION     : patterns drift based on new data
 *    - EXPRESSION   : DNA → personality archetype + traits
 * ═══════════════════════════════════════════════════════════════
 */

import { pool } from "./db";
import { createOptionalOpenAI } from "./openai-client.js";

// ── DNA alphabet (base-64, URL-safe) ─────────────────────────
const DNA_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encode a number 0-N to a DNA segment of given length */
function encodeGene(value: number, max: number, length: number): string {
  const normalised = Math.min(Math.max(value / Math.max(max, 1), 0), 1);
  let result = "";
  let seed = Math.floor(normalised * (DNA_CHARS.length ** length - 1));
  for (let i = 0; i < length; i++) {
    result = DNA_CHARS[seed % DNA_CHARS.length] + result;
    seed = Math.floor(seed / DNA_CHARS.length);
  }
  return result;
}

/** XOR two gene strings to produce a mutation */
function mutateGene(gene: string, entropy: string): string {
  return gene
    .split("")
    .map((c, i) => {
      const idx =
        (DNA_CHARS.indexOf(c) + DNA_CHARS.indexOf(entropy[i % entropy.length] ?? "A")) %
        DNA_CHARS.length;
      return DNA_CHARS[idx];
    })
    .join("");
}

export interface CitizenDNA {
  citizen_id: number;
  username: string;
  dna_string: string;          // 64 chars
  genes: {
    action: string;            // games played
    victory: string;           // win rate
    growth: string;            // XP
    abundance: string;         // coins
    social: string;            // pulse engagement
    sport_pillar: string;      // legend / sport activity
    vision: string;            // combined trajectory
    sovereignty: string;       // unique identity hash
  };
  archetype: string;
  traits: string[];
  generation: number;
  evolved_at: string;
}

export interface EmpireGenome {
  dna_string: string;
  total_citizens: number;
  dominant_trait: string;
  genetic_diversity: number;   // 0-100
  generation: number;
  fitness_score: number;
  evolved_at: string;
}

// ── Encode a single citizen's Digital DNA ────────────────────
export async function encodeCitizenDNA(userId: number): Promise<CitizenDNA | null> {
  try {
    const r = await pool.query(`
      SELECT u.id, u.username, u.xp, u.balance, u.honor_count,
             COUNT(DISTINCT t.id)::int AS games_played,
             COUNT(DISTINCT CASE WHEN t.amount > 0 THEN t.id END)::int AS wins,
             COUNT(DISTINCT pp.id)::int AS posts,
             COUNT(DISTINCT ld.id)::int AS debates,
             u.created_at
      FROM users u
      LEFT JOIN transactions t ON t.user_id = u.id AND t.type='game_win'
      LEFT JOIN pulse_posts pp ON pp.username = u.username
      LEFT JOIN legend_debates ld ON ld.username = u.username
      WHERE u.id = $1
         AND u.password_hash <> 'DELETED'
      GROUP BY u.id
    `, [userId]);

    if (!r.rows[0]) return null;
    const c = r.rows[0];

    // Gene encoding (each gene = 8 chars = 64-bit segment)
    const actionGene     = encodeGene(c.games_played, 500, 8);
    const victoryGene    = encodeGene(c.wins, c.games_played || 1, 8);
    const growthGene     = encodeGene(c.xp, 50000, 8);
    const abundanceGene  = encodeGene(parseFloat(c.balance), 100000, 8);
    const socialGene     = encodeGene(c.posts + c.debates, 200, 8);
    const sportGene      = encodeGene(c.debates, 100, 8);

    // Vision = combined vector
    const visionScore = (c.xp / 50000) * 0.3 + (parseFloat(c.balance) / 100000) * 0.3 +
                        ((c.wins / Math.max(c.games_played, 1)) * 0.2) +
                        ((c.posts + c.debates) / 200) * 0.2;
    const visionGene = encodeGene(visionScore, 1, 8);

    // Sovereignty = unique hash from username + creation date
    const sovereigntyBase = `${c.username}-${c.created_at}`;
    const sovereigntyGene = sovereigntyBase
      .split("")
      .reduce((acc: string, ch: string) => {
        const idx = (acc.length + ch.charCodeAt(0)) % DNA_CHARS.length;
        return acc + DNA_CHARS[idx];
      }, "")
      .slice(0, 8)
      .padEnd(8, "A");

    const dnaString = actionGene + victoryGene + growthGene + abundanceGene +
                      socialGene + sportGene + visionGene + sovereigntyGene;

    // Determine archetype from dominant gene
    const scores: [string, number][] = [
      ["WARRIOR",   c.games_played],
      ["CHAMPION",  c.wins],
      ["SAGE",      c.xp / 100],
      ["MERCHANT",  parseFloat(c.balance) / 1000],
      ["HERALD",    c.posts * 5],
      ["ORACLE",    c.debates * 3],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    const archetype = scores[0][0];

    const traits: string[] = [];
    if (c.games_played > 10) traits.push("ACTION-DRIVEN");
    if (c.wins / Math.max(c.games_played, 1) > 0.6) traits.push("VICTOR");
    if (c.xp > 1000) traits.push("HIGH-GROWTH");
    if (parseFloat(c.balance) > 5000) traits.push("ABUNDANT");
    if (c.posts > 5) traits.push("SOCIAL-FORCE");
    if (c.debates > 3) traits.push("ANALYST");
    if (traits.length === 0) traits.push("EMERGING");

    // Get or assign generation number
    const genR = await pool.query(
      `SELECT generation FROM citizen_dna WHERE citizen_id=$1`, [userId]
    ).catch(() => ({ rows: [] }));
    const generation = genR.rows[0] ? genR.rows[0].generation + 1 : 1;

    // Upsert to DB
    await pool.query(`
      INSERT INTO citizen_dna (citizen_id, username, dna_string, archetype, traits, generation, evolved_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT (citizen_id) DO UPDATE
      SET dna_string=$3, archetype=$4, traits=$5, generation=$6, evolved_at=NOW()
    `, [userId, c.username, dnaString, archetype, JSON.stringify(traits), generation]);

    return {
      citizen_id: userId,
      username:   c.username,
      dna_string: dnaString,
      genes: {
        action: actionGene, victory: victoryGene, growth: growthGene,
        abundance: abundanceGene, social: socialGene, sport_pillar: sportGene,
        vision: visionGene, sovereignty: sovereigntyGene,
      },
      archetype,
      traits,
      generation,
      evolved_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[GGE] encodeCitizenDNA error:", err);
    return null;
  }
}

// ── Genetic Crossover — two memories breed a new insight ─────
export async function geneticCrossover(memIdA: number, memIdB: number): Promise<string | null> {
  try {
    const r = await pool.query(
      `SELECT content FROM neural_memories WHERE id = ANY($1)`, [[memIdA, memIdB]]
    );
    if (r.rows.length < 2) return null;
    const [a, b] = r.rows.map((x: {content: string}) => x.content);

    const prompt = `You are the GDNA Genome Engine performing genetic crossover.
Combine the following two platform memories to generate ONE new synthetic insight.
The result must be a single sentence that captures a truth neither memory contains alone.

Memory A: ${a}
Memory B: ${b}

Output ONLY the new insight sentence. No explanation.`;

    const openai = createOptionalOpenAI();
    if (!openai) return null;

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.9,
    });

    return res.choices[0].message.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Encode the collective Empire Genome ──────────────────────
export async function encodeEmpireGenome(): Promise<EmpireGenome> {
  const [citizenStats, memStats, topDNA] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, AVG(xp)::float AS avg_xp,
                       AVG(balance)::float AS avg_balance
                FROM users
                WHERE password_hash <> 'DELETED'`),
    pool.query(`SELECT COUNT(*)::int AS total_mem,
                       COUNT(DISTINCT domain)::int AS domains FROM neural_memories`),
    pool.query(`
      SELECT cd.dna_string
      FROM citizen_dna cd
      JOIN users u ON u.id = cd.citizen_id
      WHERE u.password_hash <> 'DELETED'
      ORDER BY cd.generation DESC
      LIMIT 10
    `),
  ]);

  const stats = citizenStats.rows[0];
  const mem   = memStats.rows[0];

  // Empire DNA = XOR mutation of top 10 citizen DNAs
  let empireDNA = "A".repeat(64);
  for (const row of topDNA.rows) {
    empireDNA = mutateGene(empireDNA, row.dna_string);
  }

  // Genetic diversity = unique DNA chars / possible chars
  const uniqueChars = new Set(empireDNA.split("")).size;
  const diversity   = Math.round((uniqueChars / DNA_CHARS.length) * 100);

  // Fitness = memories × citizen_count × avg_xp (normalised)
  const fitness = Math.min(
    ((mem.total_mem * 0.1) + (stats.total * 0.5) + ((stats.avg_xp ?? 0) / 1000)) / 10,
    100
  );

  // Dominant trait
  const domainR = await pool.query(
    `SELECT domain, COUNT(*) AS cnt FROM neural_memories GROUP BY domain ORDER BY cnt DESC LIMIT 1`
  );
  const dominant = domainR.rows[0]?.domain ?? "general";

  const genR = await pool.query(`SELECT MAX(cycle_number) AS max FROM neural_evolutions`);
  const generation = genR.rows[0]?.max ?? 1;

  // Persist empire genome
  await pool.query(`
    INSERT INTO empire_genome (dna_string, total_citizens, dominant_trait, genetic_diversity, generation, fitness_score, evolved_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
  `, [empireDNA, stats.total, dominant, diversity, generation, fitness.toFixed(2)]);

  return {
    dna_string:        empireDNA,
    total_citizens:    stats.total,
    dominant_trait:    dominant,
    genetic_diversity: diversity,
    generation,
    fitness_score:     parseFloat(fitness.toFixed(2)),
    evolved_at:        new Date().toISOString(),
  };
}

// ── Ensure genome tables ──────────────────────────────────────
export async function ensureGenomeTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_dna (
      citizen_id   INTEGER PRIMARY KEY REFERENCES users(id),
      username     TEXT NOT NULL,
      dna_string   CHAR(64) NOT NULL,
      archetype    TEXT NOT NULL DEFAULT 'EMERGING',
      traits       JSONB NOT NULL DEFAULT '[]',
      generation   INTEGER NOT NULL DEFAULT 1,
      evolved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empire_genome (
      id                SERIAL PRIMARY KEY,
      dna_string        CHAR(64) NOT NULL,
      total_citizens    INTEGER NOT NULL DEFAULT 0,
      dominant_trait    TEXT NOT NULL DEFAULT 'general',
      genetic_diversity INTEGER NOT NULL DEFAULT 0,
      generation        INTEGER NOT NULL DEFAULT 1,
      fitness_score     FLOAT NOT NULL DEFAULT 0,
      evolved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS genome_crossovers (
      id           SERIAL PRIMARY KEY,
      parent_a     INTEGER REFERENCES neural_memories(id),
      parent_b     INTEGER REFERENCES neural_memories(id),
      offspring    TEXT NOT NULL,
      fitness      FLOAT NOT NULL DEFAULT 0.5,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS self_generated_content (
      id           SERIAL PRIMARY KEY,
      content_type TEXT NOT NULL,  -- 'insight','prediction','challenge','report'
      title        TEXT,
      body         TEXT NOT NULL,
      domain       TEXT NOT NULL DEFAULT 'general',
      source       TEXT NOT NULL DEFAULT 'genome_engine',
      published    BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("[GGE] 🧬 GENOME ENGINE tables ready");
}
