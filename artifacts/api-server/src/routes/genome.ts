/**
 * GDNA GENOME ENGINE — API Routes
 * /api/genome/*
 */
import { Router } from "express";
import { pool } from "../lib/db";
import { encodeCitizenDNA, encodeEmpireGenome } from "../lib/geno,me-engine.js";

const router = Router();

// ── GET /api/genome/empire — collective empire genome ─────────
router.get("/empire", async (_req, res): Promise<void> => {
  try {
    const latest = await pool.query(
      `SELECT * FROM empire_genome ORDER BY evolved_at DESC LIMIT 1`
    );
    if (latest.rows.length > 0) {
      res.json(latest.rows[0]);
    } else {
      const genome = await encodeEmpireGenome();
      res.json(genome);
    }
  } catch (err) {
    res.status(500).json({ error: "Empire genome unavailable", detail: String(err) });
  }
});

// ── GET /api/genome/citizen/:id — individual DNA ──────────────
router.get("/citizen/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    // Try cached first
    const cached = await pool.query(
      `SELECT cd.*
       FROM citizen_dna cd
       JOIN users u ON u.id = cd.citizen_id
       WHERE cd.citizen_id=$1
         AND u.password_hash <> 'DELETED'`, [id]
    );
    if (cached.rows.length > 0) {
      res.json(cached.rows[0]);
      return;
    }
    // Encode fresh
    const dna = await encodeCitizenDNA(id);
    if (!dna) { res.status(404).json({ error: "Citizen not found" }); return; }
    res.json(dna);
  } catch (err) {
    res.status(500).json({ error: "DNA encoding failed", detail: String(err) });
  }
});

// ── GET /api/genome/insights — self-generated content ─────────
router.get("/insights", async (req, res): Promise<void> => {
  const type = req.query.type as string | undefined;
  try {
    const r = await pool.query(
      `SELECT * FROM self_generated_content
       WHERE published = true ${type ? "AND content_type=$1" : ""}
       ORDER BY created_at DESC LIMIT 20`,
      type ? [type] : []
    );
    res.json({ insights: r.rows, count: r.rows.length });
  } catch (err) {
    res.status(500).json({ error: "Insights unavailable" });
  }
});

// ── GET /api/genome/crossovers — bred insights ────────────────
router.get("/crossovers", async (_req, res): Promise<void> => {
  try {
    const r = await pool.query(
      `SELECT gc.*, ma.content AS parent_a_content, mb.content AS parent_b_content
       FROM genome_crossovers gc
       LEFT JOIN neural_memories ma ON ma.id = gc.parent_a
       LEFT JOIN neural_memories mb ON mb.id = gc.parent_b
       ORDER BY gc.created_at DESC LIMIT 10`
    );
    res.json({ crossovers: r.rows });
  } catch (err) {
    res.status(500).json({ error: "Crossovers unavailable" });
  }
});

// ── GET /api/genome/leaderboard — top DNA citizens ────────────
router.get("/leaderboard", async (_req, res): Promise<void> => {
  try {
    const r = await pool.query(
      `SELECT cd.citizen_id, cd.username, cd.archetype, cd.traits,
              cd.generation, cd.evolved_at, u.xp, u.balance
        FROM citizen_dna cd
        JOIN users u ON u.id = cd.citizen_id
        WHERE u.password_hash <> 'DELETED'
       ORDER BY cd.generation DESC, u.xp DESC
       LIMIT 20`
    );
    res.json({ citizens: r.rows });
  } catch (err) {
    res.status(500).json({ error: "Leaderboard unavailable" });
  }
});

// ── POST /api/genome/evolve — manual trigger ──────────────────
router.post("/evolve", async (_req, res): Promise<void> => {
  try {
    const { runGenomeEvolutionCycle } = await import("../jobs/genome-evolution.js");
    runGenomeEvolutionCycle();
    res.json({ success: true, message: "Genome evolution cycle triggered" });
  } catch (err) {
    res.status(500).json({ error: "Evolution trigger failed" });
  }
});

export default router;
