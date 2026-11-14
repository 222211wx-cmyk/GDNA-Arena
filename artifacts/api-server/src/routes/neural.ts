/**
 * EMPIRE NEURAL CORE — API Routes
 * /api/neural/*
 */
import { Router } from "express";
import { pool } from "../lib/db";
import {
  ingestMemory,
  semanticSearch,
  neuralAsk,
  getNeuralStatus,
} from "../lib/neural-core.js";

const router = Router();

// ── GET /api/neural/status — system health ────────────────────
router.get("/status", async (_req, res): Promise<void> => {
  try {
    const status = await getNeuralStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Neural core offline", detail: String(err) });
  }
});

// ── POST /api/neural/ask — RAG-powered query ─────────────────
router.post("/ask", async (req, res): Promise<void> => {
  const { query, history, domain } = req.body as {
    query: string;
    history?: { role: "user" | "assistant"; content: string }[];
    domain?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query required" });
    return;
  }

  try {
    const answer = await neuralAsk(query, history ?? [], domain);
    res.json({ answer, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Neural query failed", detail: String(err) });
  }
});

// ── POST /api/neural/ingest — add knowledge manually ─────────
router.post("/ingest", async (req, res): Promise<void> => {
  const { content, source, domain, sourceId, importance } = req.body as {
    content: string;
    source: string;
    domain?: string;
    sourceId?: number;
    importance?: number;
  };

  if (!content || !source) {
    res.status(400).json({ error: "content and source required" });
    return;
  }

  try {
    await ingestMemory(content, source, domain ?? "general", sourceId, importance ?? 1.0);
    res.json({ success: true, message: "Memory ingested into the neural core" });
  } catch (err) {
    res.status(500).json({ error: "Ingestion failed", detail: String(err) });
  }
});

// ── GET /api/neural/insights — latest intelligence ───────────
router.get("/insights", async (_req, res): Promise<void> => {
  try {
    const [evolutions, patterns, recentMemories] = await Promise.all([
      pool.query(
        `SELECT * FROM neural_evolutions ORDER BY evolved_at DESC LIMIT 5`
      ),
      pool.query(
        `SELECT * FROM neural_patterns
         WHERE (expires_at IS NULL OR expires_at > NOW())
         ORDER BY detected_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT domain, source, content, created_at
         FROM neural_memories
         ORDER BY created_at DESC LIMIT 10`
      ),
    ]);

    res.json({
      recent_evolutions: evolutions.rows,
      active_patterns: patterns.rows,
      recent_memories: recentMemories.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Insights retrieval failed" });
  }
});

// ── GET /api/neural/search — semantic search ─────────────────
router.get("/search", async (req, res): Promise<void> => {
  const { q, domain, limit } = req.query as {
    q: string;
    domain?: string;
    limit?: string;
  };

  if (!q) {
    res.status(400).json({ error: "q parameter required" });
    return;
  }

  try {
    const results = await semanticSearch(q, parseInt(limit ?? "8"), domain);
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// ── POST /api/neural/evolve — manual evolution trigger ────────
router.post("/evolve", async (_req, res): Promise<void> => {
  try {
    const { runNeuralLearningCycle } = await import(
      "../jobs/neural-learning.js"
    );
    runNeuralLearningCycle(); // fire and forget
    res.json({ success: true, message: "Neural evolution cycle triggered" });
  } catch (err) {
    res.status(500).json({ error: "Evolution trigger failed" });
  }
});

export default router;
