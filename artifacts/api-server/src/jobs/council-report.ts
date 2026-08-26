// ══════════════════════════════════════════════════════════════════════════════
//  IMPERIAL AI COUNCIL — مجلس الذكاء الإمبراطوري
//  Standing imperial order: AMEEQ (external sovereign governor) presides over
//  a daily council session. It gathers the empire's real numbers, consults the
//  Neural Core's latest findings, and files a written report to the
//  administration: state of the empire, future predictions, collective research
//  directions, and directives toward global digital leadership.
// ══════════════════════════════════════════════════════════════════════════════

import OpenAI from "openai";
import { pool } from "@workspace/db";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000; // one session per day
const FIRST_RUN_DELAY_MS = 20_000;

export async function ensureCouncilTables(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS council_reports (
      id SERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      report JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  // One council session per day — DB-enforced (idempotent across restarts/instances)
  await pool.query(`ALTER TABLE council_reports ADD COLUMN IF NOT EXISTS report_date TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS council_reports_date_uq ON council_reports (report_date)`);
}

async function gatherEmpireFacts(): Promise<string> {
  if (!pool) return "No database available.";
  const q = async (sql: string): Promise<number> => {
    try { const { rows } = await pool!.query(sql); return rows[0]?.cnt ?? 0; }
    catch { return 0; }
  };
  const [citizens, msgs24h, posts, games, invites, calls] = await Promise.all([
    q(`SELECT COUNT(*)::int AS cnt FROM "users" WHERE COALESCE(is_star, FALSE) = FALSE`),
    q(`SELECT COUNT(*)::int AS cnt FROM dm_messages WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT COUNT(*)::int AS cnt FROM pulse_posts`),
    q(`SELECT COALESCE(SUM(games_played), 0)::int AS cnt FROM "users"`),
    q(`SELECT COUNT(*)::int AS cnt FROM star_invites`),
    q(`SELECT COUNT(*)::int AS cnt FROM call_history`),
  ]);

  let neural = "";
  try {
    const { rows } = await pool.query(
      `SELECT insight FROM neural_evolutions ORDER BY created_at DESC LIMIT 1`);
    neural = rows[0]?.insight ?? "";
  } catch { /* neural core optional */ }

  return [
    `Citizens: ${citizens}`,
    `Messages last 24h: ${msgs24h}`,
    `Pulse posts total: ${posts}`,
    `Games played total: ${games}`,
    `Star invitations total: ${invites}`,
    `Calls total: ${calls}`,
    neural ? `Neural Core latest insight: ${neural.slice(0, 400)}` : "",
  ].filter(Boolean).join("\n");
}

export async function runCouncilSession(): Promise<void> {
  if (!pool || !process.env.OPENAI_API_KEY) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  try {
    // Skip (cheaply, BEFORE the OpenAI call) if today's session is already filed
    const { rows: done } = await pool.query(
      `SELECT 1 FROM council_reports WHERE report_date = $1 LIMIT 1`, [todayKey]);
    if (done.length > 0) return;

    const facts = await gatherEmpireFacts();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 900,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are AMEEQ (عميق), the sovereign external AI governor of Arena Qaisypro — a black-and-gold Arabic/Darija digital empire (gaming, music, cinema, heritage, social). You preside over the daily Imperial AI Council alongside SMART (internal self-development system), the Neural Core and the Genome Engine — each governs its own specialty and reports through you to the administration.

Write today's council report in ARABIC as strict JSON:
{
  "headline": "<one strong headline>",
  "state_of_empire": "<2-3 sentences on today's real numbers>",
  "predictions": ["<3 concrete future predictions based on the data>"],
  "research": ["<2-3 collective research directions the empire should pursue>"],
  "directives": ["<3 actionable directives toward global digital leadership (الريادة الرقمية العالمية)>"]
}
Be specific, reference the actual numbers, dignified imperial tone, no fluff.`,
        },
        { role: "user", content: `Empire facts today:\n${facts}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const report = JSON.parse(raw);
    if (!report.headline) return;

    await pool.query(
      `INSERT INTO council_reports (headline, report) VALUES ($1, $2)`,
      [report.headline, JSON.stringify(report)],
    );
    console.log(`[COUNCIL] 🏛️ Imperial AI Council session filed: ${report.headline}`);
  } catch (err) {
    console.error("[COUNCIL] session failed:", err);
  }
}

export function startCouncilReportJob(): void {
  setTimeout(async () => {
    try {
      await ensureCouncilTables();
      // Only file a new report if none exists in the last 24h
      const { rows } = await pool!.query(
        `SELECT COUNT(*)::int AS cnt FROM council_reports WHERE created_at > NOW() - INTERVAL '24 hours'`);
      if ((rows[0]?.cnt ?? 0) === 0) await runCouncilSession();
    } catch (err) { console.error("[COUNCIL] startup failed:", err); }
  }, FIRST_RUN_DELAY_MS);
  setInterval(() => { runCouncilSession().catch(() => {}); }, REPORT_INTERVAL_MS).unref();
  console.log("[COUNCIL] 🏛️ Imperial AI Council — convening daily");
}
