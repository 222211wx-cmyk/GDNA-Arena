/**
 * ═══════════════════════════════════════════════════════════════
 *  EMPIRE NEURAL CORE — SELF-LEARNING JOB
 *  Runs every hour. Ingests ALL new platform activity.
 *  Runs full evolution report every 24 hours.
 *  Zero manual intervention required. Forever.
 * ═══════════════════════════════════════════════════════════════
 */
import { pool } from "../lib/db";
import { ingestMemory, getNeuralStatus } from "../lib/neural-core.js";
import { createOptionalOpenAI } from "../lib/openai-client.js";
import { logger } from "../lib/logger.js";

let cycleNumber = 0;
let lastFullEvolution = 0;

// ── Ingest all new platform content ──────────────────────────
async function ingestPlatformActivity(): Promise<number> {
  let count = 0;

  try {
    // 1 — Pulse posts (social feed)
    const posts = await pool.query(`
      SELECT p.id, p.content, p.username, p.domain, p.likes
      FROM pulse_posts p
      WHERE NOT EXISTS (
        SELECT 1 FROM neural_ingestion_log l
        WHERE l.source='pulse_post' AND l.source_id=p.id
      )
      ORDER BY p.id DESC LIMIT 50
    `);
    for (const p of posts.rows) {
      const text = `Citizen ${p.username} posted in ${p.domain}: "${p.content}" (${p.likes} likes)`;
      await ingestMemory(text, "pulse_post", p.domain || "social", p.id, 1.0 + Math.min(p.likes / 10, 2));
      count++;
    }

    // 2 — Legend debates
    const debates = await pool.query(`
      SELECT d.id, d.message, d.username, d.likes, l.name as legend_name
      FROM legend_debates d
      JOIN legends l ON l.id = d.legend_id
      WHERE NOT EXISTS (
        SELECT 1 FROM neural_ingestion_log il
        WHERE il.source='legend_debate' AND il.source_id=d.id
      )
      ORDER BY d.id DESC LIMIT 30
    `);
    for (const d of debates.rows) {
      const text = `Citizen ${d.username} debated about legend ${d.legend_name}: "${d.message}" (${d.likes} likes)`;
      await ingestMemory(text, "legend_debate", "sport", d.id, 1.2);
      count++;
    }

    // 3 — Game transactions (economy signals)
    const games = await pool.query(`
      SELECT t.id, t.user_id, t.amount, t.type, t.description, u.username
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM neural_ingestion_log il
        WHERE il.source='transaction' AND il.source_id=t.id
      )
      AND t.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY t.id DESC LIMIT 40
    `);
    for (const g of games.rows) {
      const text = `Citizen ${g.username} transaction: ${g.type} ${g.amount} coins — ${g.description}`;
      await ingestMemory(text, "transaction", "gaming", g.id, 0.8);
      count++;
    }

    // 4 — New citizens
    const citizens = await pool.query(`
      SELECT u.id, u.username, u.xp, u.honor_title, u.created_at
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM neural_ingestion_log il
        WHERE il.source='citizen' AND il.source_id=u.id
      )
      AND u.created_at > NOW() - INTERVAL '48 hours'
      ORDER BY u.id DESC LIMIT 20
    `);
    for (const c of citizens.rows) {
      const text = `New citizen joined the empire: ${c.username}, title: ${c.honor_title}, XP: ${c.xp}`;
      await ingestMemory(text, "citizen", "community", c.id, 1.5);
      count++;
    }

    // 5 — GlobalStar votes
    const votes = await pool.query(`
      SELECT v.id, v.username, v.candidate_name, v.category, v.score
      FROM gs_votes v
      WHERE NOT EXISTS (
        SELECT 1 FROM neural_ingestion_log il
        WHERE il.source='globalstar_vote' AND il.source_id=v.id
      )
      ORDER BY v.id DESC LIMIT 30
    `).catch(() => ({ rows: [] }));
    for (const v of votes.rows) {
      const text = `Citizen ${v.username} voted for ${v.candidate_name} in GlobalStar ${v.category} category with score ${v.score}`;
      await ingestMemory(text, "globalstar_vote", "sport", v.id, 1.3);
      count++;
    }

  } catch (err) {
    console.error("[ENC-LEARN] Ingestion error:", err);
  }

  return count;
}

// ── Full evolution cycle — generates intelligence report ──────
function isEvolutionEnabled(): boolean {
  return process.env.ENC_EVOLVE_ENABLED?.trim().toLowerCase() === "true";
}

async function runEvolutionCycle(): Promise<void> {
  if (!isEvolutionEnabled()) return;
  try {
    const openai = createOptionalOpenAI();
    if (!openai) return;
    const status = await getNeuralStatus();

    // Ask GPT-4o-mini to analyse the neural core state
    const domainSummary = status.domain_breakdown
      .map((d: { domain: string; count: number }) => `${d.domain}: ${d.count} memories`)
      .join(", ");

    const prompt = `You are the EMPIRE NEURAL CORE evolution engine.
Analyse the following platform intelligence snapshot and generate a brief evolution report:

Total memories: ${status.total_memories}
Domain breakdown: ${domainSummary}
Total evolutions so far: ${status.total_evolutions}
Cycle: ${cycleNumber}

Generate a 3-sentence intelligence report covering:
1. What the empire is most active in
2. A detected trend or pattern
3. A strategic prediction for the next 30 days

Be precise and imperial in tone.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.8,
    });

    const report = response.choices[0].message.content ?? "Evolution complete.";

    // Calculate intelligence score (memories × patterns × 0.01, capped at 100)
    const score = Math.min(
      (status.total_memories * 0.3 + status.total_patterns * 2) / 10,
      100
    );

    await pool.query(
      `INSERT INTO neural_evolutions (cycle_number, memories_added, patterns_detected, intelligence_score, report)
       VALUES ($1, $2, $3, $4, $5)`,
      [cycleNumber, status.total_memories, status.total_patterns, score, report]
    );

    // Auto-ingest the evolution report itself as a memory
    await ingestMemory(
      `Empire Neural Core Evolution Report — Cycle ${cycleNumber}: ${report}`,
      "evolution_report",
      "system",
      undefined,
      3.0 // highest importance
    );

    console.log(`[ENC] 🧬 Evolution cycle ${cycleNumber} complete — IQ: ${score.toFixed(1)}`);
    console.log(`[ENC] 📋 ${report.slice(0, 100)}...`);
  } catch {
    console.warn("[ENC-EVOLVE] Evolution unavailable; no report filed");
  }
}

// ── Detect and store patterns ─────────────────────────────────
async function detectPatterns(): Promise<void> {
  try {
    // Most active domain in last 24h
    const domainActivity = await pool.query(`
      SELECT domain, COUNT(*) as cnt
      FROM neural_memories
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY domain ORDER BY cnt DESC LIMIT 1
    `);

    if (domainActivity.rows.length > 0) {
      const top = domainActivity.rows[0];
      await pool.query(
        `INSERT INTO neural_patterns (pattern_type, description, confidence, data, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
        [
          "trend",
          `Most active domain in last 24h: ${top.domain} (${top.cnt} new memories)`,
          0.9,
          JSON.stringify({ domain: top.domain, count: top.cnt }),
        ]
      );
    }

    // Citizen count growth
    const citizenGrowth = await pool.query(`
      SELECT COUNT(*) as new_citizens
      FROM users WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    if (parseInt(citizenGrowth.rows[0].new_citizens) > 0) {
      await pool.query(
        `INSERT INTO neural_patterns (pattern_type, description, confidence, data, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '3 days')`,
        [
          "growth",
          `${citizenGrowth.rows[0].new_citizens} new citizens joined in the last 24 hours`,
          1.0,
          JSON.stringify({ new_citizens: citizenGrowth.rows[0].new_citizens }),
        ]
      );
    }
  } catch (err) {
    console.error("[ENC-PATTERNS] Detection error:", err);
  }
}

// ── Main learning loop ────────────────────────────────────────
export async function runNeuralLearningCycle(): Promise<void> {
  // GDNA's separately approved proxy credentials never authorize legacy ingestion.
  if (!process.env.OPENAI_API_KEY?.trim()) return;
  cycleNumber++;
  console.log(`[ENC] 🔄 Learning cycle #${cycleNumber} started`);

  const ingested = await ingestPlatformActivity();
  console.log(`[ENC] 📥 ${ingested} new memories ingested`);

  await detectPatterns();

  // Full evolution every 24 cycles (≈ every 24 hours at hourly cadence)
  const now = Date.now();
  if (isEvolutionEnabled() &&
      (cycleNumber === 1 || now - lastFullEvolution > 24 * 60 * 60 * 1000)) {
    await runEvolutionCycle();
    lastFullEvolution = now;
  }

  console.log(`[ENC] ✅ Cycle #${cycleNumber} complete`);
}

// ── Start the perpetual learning engine ──────────────────────
export function startNeuralLearningJob(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logger.info("Legacy neural learning disabled: no legacy OpenAI credentials");
    return;
  }
  if (!isEvolutionEnabled()) console.log("[ENC-EVOLVE] Disabled by configuration");
  console.log("[ENC] 🧠 EMPIRE NEURAL CORE — SELF-LEARNING ENGINE ACTIVATED");

  // First cycle immediately (with slight delay to let DB settle)
  setTimeout(() => runNeuralLearningCycle(), 5000);

  // Then every hour — forever
  setInterval(() => runNeuralLearningCycle(), 60 * 60 * 1000);
}
