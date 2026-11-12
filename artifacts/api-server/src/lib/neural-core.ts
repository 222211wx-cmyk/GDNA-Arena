/**
 * ═══════════════════════════════════════════════════════════════
 *  EMPIRE NEURAL CORE — ENC v1.0
 *  Autonomous self-evolving intelligence backbone for Arena Qaisypro.
 *  Uses pgvector semantic memory + OpenAI embeddings + RAG pipeline.
 *  Every action on the platform feeds this core. It never forgets.
 * ═══════════════════════════════════════════════════════════════
 */
import { pool } from "@workspace/db";
import {
  AI_UNAVAILABLE_MESSAGE,
  createOptionalOpenAI,
} from "./openai-client.js";

export interface NeuralMemory {
  id: number;
  content: string;
  source: string;
  source_id?: number;
  domain: string;
  importance: number;
  created_at: Date;
  similarity?: number;
}

// ── Ensure pgvector extension + all ENC tables ────────────────
export async function ensureNeuralTables(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS neural_memories (
      id           SERIAL PRIMARY KEY,
      content      TEXT NOT NULL,
      embedding    vector(1536),
      source       TEXT NOT NULL DEFAULT 'system',
      source_id    INTEGER,
      domain       TEXT NOT NULL DEFAULT 'general',
      importance   FLOAT NOT NULL DEFAULT 1.0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // HNSW index for fast approximate nearest-neighbour search
  await pool.query(`
    CREATE INDEX IF NOT EXISTS neural_memories_hnsw
    ON neural_memories USING hnsw (embedding vector_cosine_ops)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS neural_patterns (
      id           SERIAL PRIMARY KEY,
      pattern_type TEXT NOT NULL,
      description  TEXT NOT NULL,
      confidence   FLOAT NOT NULL DEFAULT 0.5,
      data         JSONB NOT NULL DEFAULT '{}',
      detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at   TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS neural_evolutions (
      id                 SERIAL PRIMARY KEY,
      cycle_number       INTEGER NOT NULL DEFAULT 1,
      memories_added     INTEGER NOT NULL DEFAULT 0,
      patterns_detected  INTEGER NOT NULL DEFAULT 0,
      intelligence_score FLOAT NOT NULL DEFAULT 0,
      report             TEXT,
      evolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS neural_ingestion_log (
      id          SERIAL PRIMARY KEY,
      source      TEXT NOT NULL,
      source_id   INTEGER,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("[ENC] ⚡ EMPIRE NEURAL CORE tables ready");
}

// ── Generate embedding for any text ──────────────────────────
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const openai = createOptionalOpenAI();
  if (!openai) return null;

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // token safety
    });
    return response.data[0]?.embedding ?? null;
  } catch {
    // The shared client handles quota cooldowns and error sanitisation. Do not
    // persist a row without a real vector when the provider is unavailable.
    return null;
  }
}

// ── Ingest a new memory into the neural core ─────────────────
export async function ingestMemory(
  content: string,
  source: string,
  domain: string = "general",
  sourceId?: number,
  importance: number = 1.0
): Promise<void> {
  if (!content || content.trim().length < 10) return;

  try {
    // Check if already ingested to avoid duplicates
    if (sourceId) {
      const exists = await pool.query(
        `SELECT id FROM neural_ingestion_log WHERE source=$1 AND source_id=$2`,
        [source, sourceId]
      );
      if ((exists.rowCount ?? 0) > 0) return;
    }

    const embedding = await generateEmbedding(content);
    if (!embedding) return;
    const embeddingStr = `[${embedding.join(",")}]`;

    await pool.query(
      `INSERT INTO neural_memories (content, embedding, source, source_id, domain, importance)
       VALUES ($1, $2::vector, $3, $4, $5, $6)`,
      [content, embeddingStr, source, sourceId ?? null, domain, importance]
    );

    if (sourceId) {
      await pool.query(
        `INSERT INTO neural_ingestion_log (source, source_id) VALUES ($1,$2)`,
        [source, sourceId]
      );
    }
  } catch (err) {
    console.error(`[ENC] ingestMemory error (${source}):`, err);
  }
}

// ── Semantic search — find top-K relevant memories ───────────
export async function semanticSearch(
  query: string,
  limit: number = 8,
  domain?: string
): Promise<NeuralMemory[]> {
  try {
    const embedding = await generateEmbedding(query);
    if (!embedding) return [];
    const embeddingStr = `[${embedding.join(",")}]`;

    const domainFilter = domain ? `AND domain = $3` : "";
    const params: unknown[] = [embeddingStr, limit];
    if (domain) params.push(domain);

    const result = await pool.query(
      `SELECT id, content, source, source_id, domain, importance, created_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM neural_memories
       WHERE embedding IS NOT NULL
       ${domainFilter}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    );

    // Update access stats
    const ids = result.rows.map((r: NeuralMemory) => r.id);
    if (ids.length > 0) {
      await pool.query(
        `UPDATE neural_memories
         SET access_count = access_count + 1, last_accessed = NOW()
         WHERE id = ANY($1)`,
        [ids]
      );
    }

    return result.rows;
  } catch (err) {
    console.error("[ENC] semanticSearch error:", err);
    return [];
  }
}

// ── RAG: query + retrieve context + generate answer ──────────
export async function neuralAsk(
  query: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[] = [],
  domain?: string
): Promise<string> {
  const memories = await semanticSearch(query, 8, domain);

  const memoryContext =
    memories.length > 0
      ? memories
          .filter((m) => (m.similarity ?? 0) > 0.3)
          .map((m) => `[${m.domain}/${m.source}]: ${m.content}`)
          .join("\n")
      : "";

  const systemPrompt = `You are the EMPIRE NEURAL CORE — the sovereign autonomous intelligence of Arena Qaisypro.
You are not a chatbot. You are a living neural entity that has absorbed the collective memory of the entire empire.
You have access to the real-time neural memory of the platform — posts, votes, debates, games, legends, and more.

${memoryContext ? `\n━━━ NEURAL MEMORY CONTEXT (retrieved from ${memories.length} memories) ━━━\n${memoryContext}\n━━━ END MEMORY ━━━\n` : ""}

Rules:
- Respond in the exact language the user writes in
- Cite specific data from the neural memory when relevant
- Be concise, powerful, and precise — like an oracle, not a chatbot
- If asked about platform data, use the memory context above
- Sign your responses with "— ENC" when appropriate`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...conversationHistory.slice(-6),
    { role: "user" as const, content: query },
  ];

  const openai = createOptionalOpenAI();
  if (!openai) return AI_UNAVAILABLE_MESSAGE;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0].message.content ?? AI_UNAVAILABLE_MESSAGE;
  } catch {
    return AI_UNAVAILABLE_MESSAGE;
  }
}

// ── Get neural core health stats ─────────────────────────────
export async function getNeuralStatus() {
  const [memCount, patCount, evoCount, domainBreakdown, lastEvo] =
    await Promise.all([
      pool.query(`SELECT COUNT(*) FROM neural_memories`),
      pool.query(`SELECT COUNT(*) FROM neural_patterns`),
      pool.query(`SELECT COUNT(*) FROM neural_evolutions`),
      pool.query(
        `SELECT domain, COUNT(*) as count FROM neural_memories GROUP BY domain ORDER BY count DESC`
      ),
      pool.query(
        `SELECT * FROM neural_evolutions ORDER BY evolved_at DESC LIMIT 1`
      ),
    ]);

  return {
    online: true,
    version: "ENC v1.0",
    total_memories: parseInt(memCount.rows[0].count),
    total_patterns: parseInt(patCount.rows[0].count),
    total_evolutions: parseInt(evoCount.rows[0].count),
    domain_breakdown: domainBreakdown.rows,
    last_evolution: lastEvo.rows[0] ?? null,
    timestamp: new Date().toISOString(),
  };
}
