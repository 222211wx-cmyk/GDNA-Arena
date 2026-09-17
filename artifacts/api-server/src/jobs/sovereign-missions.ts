/**
 * ═══════════════════════════════════════════════════════════════
 *  SOVEREIGN MISSION ENGINE — GDN-AI Daily Mission Generator
 *
 *  Runs at midnight every day.
 *  Reads each active citizen's DNA + Archon profile,
 *  generates 3 personalized development missions via GPT-4o-mini,
 *  stores them in citizen_missions, and fires a notification.
 * ═══════════════════════════════════════════════════════════════
 */

import { pool } from "@workspace/db";
import { pushNotification } from "../routes/notifications.js";
import { createOptionalOpenAI } from "../lib/openai-client.js";

// ── Ensure citizen_missions table exists ──────────────────────
export async function ensureMissionsTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_missions (
      id           SERIAL PRIMARY KEY,
      citizen_id   INTEGER NOT NULL,
      mission_date DATE    NOT NULL DEFAULT CURRENT_DATE,
      title        TEXT    NOT NULL,
      title_ar     TEXT    NOT NULL,
      description  TEXT    NOT NULL,
      description_ar TEXT  NOT NULL,
      category     TEXT    NOT NULL DEFAULT 'growth',  -- growth|social|combat|legacy
      xp_reward    INTEGER NOT NULL DEFAULT 25,
      completed    BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (citizen_id, mission_date, title)
    )
  `);
  console.log("[MISSIONS] 🎯 citizen_missions table ready");
}

// ── Fetch active citizens with their DNA + Archon data ───────
async function fetchActiveCitizens() {
  const { rows } = await pool.query<{
    id: number;
    username: string;
    xp: number;
    balance: string;
    games_played: number;
    wins: number;
    posts: number;
    archetype: string | null;
    volontas: number | null;
    resilentia: number | null;
    intellectus: number | null;
    disciplina: number | null;
    societas: number | null;
    abundantia: number | null;
    auctoritas: number | null;
    shadow_dimension: string | null;
    dominant_dimension: string | null;
  }>(`
    SELECT
      u.id,
      u.username,
      u.xp,
      u.balance,
      COUNT(DISTINCT t.id)::int          AS games_played,
      COUNT(DISTINCT CASE WHEN t.amount > 0 THEN t.id END)::int AS wins,
      COUNT(DISTINCT pp.id)::int         AS posts,
      ars.archetype,
      ars.volontas,
      ars.resilentia,
      ars.intellectus,
      ars.disciplina,
      ars.societas,
      ars.abundantia,
      ars.auctoritas,
      (ars.ai_profile->>'shadow_dimension')  AS shadow_dimension,
      (ars.ai_profile->>'dominant_dimension') AS dominant_dimension
    FROM users u
    LEFT JOIN transactions t ON t.user_id = u.id AND t.type = 'game_win'
    LEFT JOIN pulse_posts pp ON pp.username = u.username
    LEFT JOIN LATERAL (
      SELECT archetype, volontas, resilentia, intellectus,
             disciplina, societas, abundantia, auctoritas, ai_profile
      FROM archon_sessions
      WHERE user_id = u.id
      ORDER BY created_at DESC
      LIMIT 1
    ) ars ON true
    WHERE u.last_seen_at > NOW() - INTERVAL '7 days'
    GROUP BY u.id, ars.archetype, ars.volontas, ars.resilentia,
             ars.intellectus, ars.disciplina, ars.societas,
             ars.abundantia, ars.auctoritas, ars.ai_profile
    ORDER BY u.xp DESC
  `);
  return rows;
}

// ── Build a compact citizen profile string for the prompt ────
function buildCitizenSummary(c: Awaited<ReturnType<typeof fetchActiveCitizens>>[0]): string {
  const winRate = c.games_played > 0 ? Math.round((c.wins / c.games_played) * 100) : 0;
  const dims = [
    `VOLONTAS:${c.volontas ?? 50}`,
    `RESILENTIA:${c.resilentia ?? 50}`,
    `INTELLECTUS:${c.intellectus ?? 50}`,
    `DISCIPLINA:${c.disciplina ?? 50}`,
    `SOCIETAS:${c.societas ?? 50}`,
    `ABUNDANTIA:${c.abundantia ?? 50}`,
    `AUCTORITAS:${c.auctoritas ?? 50}`,
  ].join(" | ");

  return `[${c.username}] archetype=${c.archetype ?? "UNKNOWN"} XP=${c.xp} games=${c.games_played} winRate=${winRate}% posts=${c.posts} dominant=${c.dominant_dimension ?? "?"} shadow=${c.shadow_dimension ?? "?"} dims=[${dims}]`;
}

// ── Generate missions for a batch of citizens (1 API call) ───
async function generateMissionsForBatch(citizens: Awaited<ReturnType<typeof fetchActiveCitizens>>) {
  const profiles = citizens.map(c => buildCitizenSummary(c)).join("\n");
  const openai = createOptionalOpenAI();
  if (!openai) return [];

  const prompt = `You are GDN-AI — the Sovereign Intelligence of Arena Qaisypro.
For each citizen below, generate exactly 3 personalized daily development missions.
Each mission must target a SPECIFIC weakness (shadow dimension) or amplify a strength.
Reference actual platform activities: games (Neon Racer, Archon Arena, etc.), debates, posts, Archon pillars.

CITIZENS:
${profiles}

Rules:
- Mission 1: Combat/Games — targets win rate or discipline
- Mission 2: Social/Growth — targets posts, debates, societas or intellectus
- Mission 3: Legacy/XP — targets long-term archon dimension or abundantia

Return STRICT JSON array — one object per citizen in the SAME ORDER as input:
[
  {
    "username": "...",
    "missions": [
      {
        "title": "Mission title in English (max 8 words)",
        "title_ar": "عنوان المهمة بالعربية",
        "description": "Specific mission order (2 sentences, imperial tone, EN)",
        "description_ar": "وصف المهمة بالعربية (جملتان، نبرة إمبراطورية)",
        "category": "combat|social|growth|legacy",
        "xp_reward": 25
      }
    ]
  }
]`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3000,
    temperature: 0.75,
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    // Handle both { missions: [...] } and direct array
    return Array.isArray(parsed) ? parsed : (parsed.missions ?? parsed.citizens ?? []);
  } catch {
    return [];
  }
}

// ── Fallback missions when AI is unavailable ──────────────────
function fallbackMissions(archetype: string | null) {
  const arch = archetype ?? "THE SEEKER";
  return [
    {
      title: "Sharpen Your Combat Edge",
      title_ar: "صقل حدّتك القتالية",
      description: "Play 2 rounds in the arena today — focus on decision speed, not just wins. Precision over power.",
      description_ar: "العب جولتين في الساحة اليوم — ركز على سرعة القرار، ليس فقط الانتصارات. الدقة قبل القوة.",
      category: "combat",
      xp_reward: 25,
    },
    {
      title: "Leave a Mark in the Empire",
      title_ar: "اترك أثراً في الإمبراطورية",
      description: "Post one insight in the Social Hub that challenges the empire's dominant narrative. Your voice is power.",
      description_ar: "انشر فكرة في المحور الاجتماعي تتحدى السردية السائدة في الإمبراطورية. صوتك قوة.",
      category: "social",
      xp_reward: 25,
    },
    {
      title: `${arch} Ascension Protocol`,
      title_ar: "بروتوكول صعود الأركون",
      description: "Complete today's Archon pillar challenge without delay. Every day of discipline compounds into destiny.",
      description_ar: "أتمم تحدي ركيزة الأركون اليوم دون تأجيل. كل يوم من الانضباط يُراكم في المصير.",
      category: "growth",
      xp_reward: 25,
    },
  ];
}

// ── Main job ──────────────────────────────────────────────────
export async function runSovereignMissions(): Promise<{ generated: number; notified: number; errors: number }> {
  console.log("[MISSIONS] 🎯 Sovereign Mission Engine — STARTING");

  const citizens = await fetchActiveCitizens();
  console.log(`[MISSIONS] Found ${citizens.length} active citizens`);

  if (citizens.length === 0) return { generated: 0, notified: 0, errors: 0 };

  const todayStr = new Date().toISOString().slice(0, 10);
  let generated = 0;
  let notified = 0;
  let errors = 0;

  // Process in batches of 10 to keep prompts manageable
  const BATCH_SIZE = 10;
  for (let i = 0; i < citizens.length; i += BATCH_SIZE) {
    const batch = citizens.slice(i, i + BATCH_SIZE);

    let batchResults: { username: string; missions: { title: string; title_ar: string; description: string; description_ar: string; category: string; xp_reward: number }[] }[] = [];

    try {
      batchResults = await generateMissionsForBatch(batch);
    } catch {
      console.warn("[MISSIONS] ⚠️ AI batch unavailable, using deterministic missions");
    }

    // Match results back to citizens by username
    const resultMap = new Map(batchResults.map(r => [r.username, r.missions ?? []]));

    for (const citizen of batch) {
      try {
        const rawMissions = resultMap.get(citizen.username) ?? [];

        // Validate each AI mission is usable (non-empty title + description)
        const usable = rawMissions.filter(
          (m): m is typeof rawMissions[0] =>
            typeof m === "object" && m !== null &&
            typeof m.title === "string" && m.title.trim().length > 0 &&
            typeof m.description === "string" && m.description.trim().length > 0
        );

        // Fall back to static missions if AI returned fewer than 3 usable ones
        const missions = usable.length >= 3 ? usable.slice(0, 3) : fallbackMissions(citizen.archetype);
        const validMissions = missions.slice(0, 3);

        // Skip if already generated today
        const { rows: existing } = await pool.query(
          `SELECT id FROM citizen_missions WHERE citizen_id=$1 AND mission_date=$2 LIMIT 1`,
          [citizen.id, todayStr]
        );
        if (existing.length > 0) {
          console.log(`[MISSIONS] ⏭️ ${citizen.username} — missions already exist for today`);
          continue;
        }

        // Insert missions — all AI-provided values are validated before persist
        const VALID_CATEGORIES = new Set(["combat", "social", "growth", "legacy"]);
        for (const m of validMissions) {
          // Validate and bound every AI-derived field
          const title        = (typeof m.title === "string" && m.title.trim()) ? m.title.slice(0, 120) : "Daily Mission";
          const title_ar     = (typeof m.title_ar === "string" && m.title_ar.trim()) ? m.title_ar.slice(0, 120) : "مهمة يومية";
          const description  = (typeof m.description === "string" && m.description.trim()) ? m.description.slice(0, 500) : "Complete your empire duties today.";
          const description_ar = (typeof m.description_ar === "string" && m.description_ar.trim()) ? m.description_ar.slice(0, 500) : "أدِّ واجباتك الإمبراطورية اليوم.";
          const category     = VALID_CATEGORIES.has(m.category) ? m.category : "growth";
          // Clamp xp_reward to [10, 100] — never trust raw model output for economy values
          const rawXp        = typeof m.xp_reward === "number" ? m.xp_reward : 25;
          const xp_reward    = Math.min(100, Math.max(10, Math.round(rawXp)));

          await pool.query(
            `INSERT INTO citizen_missions
               (citizen_id, mission_date, title, title_ar, description, description_ar, category, xp_reward)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (citizen_id, mission_date, title) DO NOTHING`,
            [citizen.id, todayStr, title, title_ar, description, description_ar, category, xp_reward]
          );
        }
        generated += validMissions.length;

        // Send notification
        await pushNotification({
          userId: citizen.id,
          type: "sovereign_mission",
          title: "♔ مهامك الإمبراطورية جاهزة",
          body: "مهامك الإمبراطورية اليوم جاهزة — اختار الأصعب",
          icon: "♔",
          linkPath: "/growth",
        });
        notified++;

        console.log(`[MISSIONS] ✅ ${citizen.username} — ${validMissions.length} missions generated`);
      } catch (err) {
        console.warn(`[MISSIONS] ⚠️ ${citizen.username} failed:`, err);
        errors++;
      }
    }
  }

  console.log(`[MISSIONS] 🏁 Done — ${generated} missions generated | ${notified} notified | ${errors} errors`);
  return { generated, notified, errors };
}

// ── Schedule: run at midnight daily ──────────────────────────
export function startSovereignMissionsJob(): void {
  console.log("[MISSIONS] 🌙 Sovereign Mission Engine — ONLINE (midnight schedule)");

  // Run once at startup with a delay (after tables are ready)
  setTimeout(async () => {
    await runSovereignMissions();
  }, 20_000);

  // Schedule midnight run
  function scheduleNextMidnight() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 30, 0); // 00:00:30 next day
    const msUntilMidnight = next.getTime() - now.getTime();
    console.log(`[MISSIONS] ⏰ Next run in ${Math.round(msUntilMidnight / 60000)} minutes`);
    setTimeout(async () => {
      await runSovereignMissions();
      scheduleNextMidnight(); // reschedule for the following day
    }, msUntilMidnight);
  }

  scheduleNextMidnight();
}
