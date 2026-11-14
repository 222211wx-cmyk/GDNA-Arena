/**
 * ═══════════════════════════════════════════════════════════════
 *  GDNA GENOME EVOLUTION JOB — Self-Sufficient Eternal Loop
 *
 *  Runs every 6 hours. Does the following autonomously:
 *    1. Re-encodes DNA for all active citizens
 *    2. Runs genetic crossover on top memories → new insights
 *    3. Self-generates: empire insights, predictions, challenges
 *    4. Encodes the collective Empire Genome
 *    5. Writes all outputs back into neural memory (feeds itself)
 *
 *  No human intervention required. Ever.
 * ═══════════════════════════════════════════════════════════════
 */
import { pool } from "../lib/db";
import {
  encodeCitizenDNA,
  encodeEmpireGenome,
  geneticCrossover,
} from "../lib/geno,me-engine.js";
import { ingestMemory } from "../lib/neural-core.js";
import { createOptionalOpenAI } from "../lib/openai-client.js";

// ── Step 1: Evolve all active citizen DNAs ────────────────────
async function evolveCitizenDNAs(): Promise<number> {
  const users = await pool.query(
    `SELECT id FROM users ORDER BY xp DESC LIMIT 100`
  );
  let count = 0;
  for (const u of users.rows) {
    const dna = await encodeCitizenDNA(u.id);
    if (dna) count++;
  }
  return count;
}

// ── Step 2: Genetic crossover — breed new insights ───────────
async function runGeneticCrossover(): Promise<number> {
  // Pick 6 random high-importance memories
  const mems = await pool.query(`
    SELECT id, content FROM neural_memories
    WHERE importance > 1.0
    ORDER BY RANDOM() LIMIT 6
  `);

  if (mems.rows.length < 2) return 0;
  let bred = 0;

  // Pair them up for crossover
  for (let i = 0; i < mems.rows.length - 1; i += 2) {
    const offspring = await geneticCrossover(mems.rows[i].id, mems.rows[i + 1].id);
    if (!offspring) continue;

    // Store crossover
    await pool.query(
      `INSERT INTO genome_crossovers (parent_a, parent_b, offspring, fitness)
       VALUES ($1,$2,$3,$4)`,
      [mems.rows[i].id, mems.rows[i + 1].id, offspring, 0.75]
    );

    // Inject offspring back into neural memory (self-feeding loop)
    await ingestMemory(
      offspring,
      "genome_crossover",
      "system",
      undefined,
      2.0
    );
    bred++;
  }
  return bred;
}

// ── Step 3: Self-generate content ────────────────────────────
async function selfGenerateContent(): Promise<void> {
  const openai = createOptionalOpenAI();
  if (!openai) return;

  // Gather platform snapshot
  const [citizens, memories, patterns, topDomain] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS c FROM users`),
    pool.query(`SELECT COUNT(*)::int AS c FROM neural_memories`),
    pool.query(`SELECT description FROM neural_patterns
                WHERE (expires_at IS NULL OR expires_at > NOW())
                ORDER BY confidence DESC LIMIT 3`),
    pool.query(`SELECT domain, COUNT(*) AS cnt FROM neural_memories
                GROUP BY domain ORDER BY cnt DESC LIMIT 1`),
  ]);

  const snapshot = `
Citizens: ${citizens.rows[0].c}
Neural Memories: ${memories.rows[0].c}
Active Patterns: ${patterns.rows.map((p: {description: string}) => p.description).join("; ")}
Most Active Domain: ${topDomain.rows[0]?.domain ?? "general"}
  `.trim();

  // Generate 3 types of self-content
  const prompts: { type: string; domain: string; prompt: string }[] = [
    {
      type: "insight",
      domain: topDomain.rows[0]?.domain ?? "general",
      prompt: `Based on this empire snapshot, generate ONE powerful strategic insight (1 sentence, imperial tone):
${snapshot}`,
    },
    {
      type: "prediction",
      domain: "future",
      prompt: `Based on this empire snapshot, generate ONE bold 30-day prediction for the empire (1 sentence, oracle tone):
${snapshot}`,
    },
    {
      type: "challenge",
      domain: "community",
      prompt: `Generate ONE daily empire challenge for citizens (imperative tone, motivating, 1-2 sentences):
${snapshot}`,
    },
  ];

  for (const p of prompts) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: p.prompt }],
        max_tokens: 80,
        temperature: 0.85,
      });
      const body = res.choices[0].message.content?.trim() ?? "";
      if (!body) continue;

      await pool.query(
        `INSERT INTO self_generated_content (content_type, body, domain, published)
         VALUES ($1,$2,$3,true)`,
        [p.type, body, p.domain]
      );

      // Feed back into neural memory — this is the self-feeding loop
      await ingestMemory(
        `[AUTO-GENERATED ${p.type.toUpperCase()}]: ${body}`,
        "self_generated",
        p.domain,
        undefined,
        1.8
      );
    } catch { /* continue */ }
  }
}

// ── Step 4: Encode Empire Genome ─────────────────────────────
async function runEmpireGenomeEncoding(): Promise<void> {
  try {
    const genome = await encodeEmpireGenome();
    // Feed empire genome back into neural memory
    await ingestMemory(
      `Empire Genome encoded — Generation ${genome.generation}: fitness=${genome.fitness_score}, diversity=${genome.genetic_diversity}%, citizens=${genome.total_citizens}, dominant_trait=${genome.dominant_trait}`,
      "empire_genome",
      "system",
      undefined,
      3.0
    );
    console.log(`[GGE] 🌐 Empire Genome — Gen ${genome.generation} | Fitness: ${genome.fitness_score} | Diversity: ${genome.genetic_diversity}%`);
  } catch (err) {
    console.error("[GGE] Empire genome encoding error:", err);
  }
}

// ── Main genome evolution cycle ───────────────────────────────
export async function runGenomeEvolutionCycle(): Promise<void> {
  console.log("[GGE] 🧬 Genome Evolution Cycle started");

  const [citizenCount, crossoverCount] = await Promise.all([
    evolveCitizenDNAs(),
    runGeneticCrossover(),
  ]);

  await selfGenerateContent();
  await runEmpireGenomeEncoding();

  console.log(`[GGE] ✅ Genome cycle complete — ${citizenCount} DNAs evolved, ${crossoverCount} crossovers, new content generated`);
}

// ── Start the perpetual genome engine ─────────────────────────
export function startGenomeEvolutionJob(): void {
  console.log("[GGE] 🧬 GDNA GENOME ENGINE — SELF-SUFFICIENT ETERNAL LOOP ACTIVATED");

  // First run after 10 seconds (let neural core settle first)
  setTimeout(() => runGenomeEvolutionCycle(), 10_000);

  // Then every 6 hours — forever
  setInterval(() => runGenomeEvolutionCycle(), 6 * 60 * 60 * 1000);
}
