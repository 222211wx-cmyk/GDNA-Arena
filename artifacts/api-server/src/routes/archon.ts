import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { db, pool } from "@workspace/db";
import { archonSessionsTable, archonDirectivesTable, pillarCompletionsTable } from "@workspace/db/schema";
import { usersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MOROCCO_TIME_ZONE = "Africa/Casablanca";
const DAILY_ARCHON_DIRECTIVES = [
  "اليوم: اجمع 100 نقطة في ملعب الأساطير لتحصل على تاج الأسبوع. «الانتصار يبدأ بخطوة محسوبة.» تابع أخبار الإمبراطورية من SPORT.",
  "مهمة اليوم: أكمل تحدياً واحداً من أركان التطور وشارك تقدّمك. «الاستمرارية تصنع ما لا تصنعه الحماسة العابرة.» الإمبراطورية تراقب صعود مواطنيها.",
  "اليوم: ادخل الساحة وساند أسطورة تستحق الصدارة. «الصوت الواعي يصنع التاريخ.» راقب جديد التصنيفات وأخبار الإمبراطورية.",
  "مهمة اليوم: افتح MESSAGERI وتواصل مع مواطن يشاركك الطموح. «الإمبراطوريات تُبنى بالروابط قبل الجدران.» أخبار المجتمع تنتظرك.",
  "اليوم: راجع ملفك وطوّر نقطة قوة واحدة بقرار عملي. «من عرف نفسه، عرف طريقه.» تقرير الإمبراطورية اليوم يدعوك للتقدم بثبات.",
  "مهمة اليوم: حقق فوزاً نزيهاً في إحدى ألعاب ARENA. «المجد نتيجة الانضباط، لا الصدفة.» المنافسات الأسبوعية مستمرة.",
  "اليوم: اكتشف قصة أسطورة واستخلص منها درساً واحداً. «الإرث معرفة تتحول إلى فعل.» قاعة الأساطير تستقبل أصوات المواطنين.",
];

function moroccoDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOROCCO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function directiveForDate(dateKey: string): string {
  const index = [...dateKey].reduce((sum, char) => sum + char.charCodeAt(0), 0)
    % DAILY_ARCHON_DIRECTIVES.length;
  return DAILY_ARCHON_DIRECTIVES[index];
}

// ── Archon Code Generator (deterministic + aesthetic) ────────────────────────
function generateArchonCode(dims: number[], archetype: string): string {
  const glyphs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seed = dims.reduce((acc, v, i) => acc + v * (i + 7) * 31, 0);
  const part = (offset: number, len: number) =>
    Array.from({ length: len }, (_, i) => glyphs[(seed * (offset + i + 3)) % glyphs.length]).join("");
  const tag = archetype.replace(/^THE /, "").slice(0, 3).toUpperCase();
  return `ARCH-${part(1, 4)}-${part(5, 4)}-${tag}`;
}

// ── Score map for multiple-choice questions ───────────────────────────────────
const CHOICE_SCORES: Record<string, number> = { A: 90, B: 70, C: 50, D: 30 };

function computeDimensions(answers: Record<string, string>): {
  volontas: number; resilentia: number; intellectus: number;
  disciplina: number; societas: number; abundantia: number; auctoritas: number;
} {
  const s = (q: string) => CHOICE_SCORES[answers[q] ?? "C"] ?? 50;
  return {
    volontas:    s("Q1"),
    resilentia:  s("Q2"),
    intellectus: s("Q3"),
    disciplina:  s("Q4"),
    societas:    s("Q5"),
    abundantia:  s("Q6"),
    auctoritas:  Math.min(100, 40 + (answers["Q7"]?.length ?? 0) * 2),
  };
}

// ── POST /api/archon/assess ────────────────────────────────────────────────────
// Full initiation: 7 answers → compute dimensions → GPT profile → store → return
router.post("/archon/assess", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const { answers, lang, userStats } = req.body as {
    answers: Record<string, string>;
    lang?: string;
    userStats?: { xp: number; wins: number; gamesPlayed: number; balance: number; username: string };
  };

  if (!answers || Object.keys(answers).length < 6) {
    res.status(400).json({ error: "Incomplete initiation — all 7 questions required" });
    return;
  }

  const dims = computeDimensions(answers);
  const dimArray = [dims.volontas, dims.resilentia, dims.intellectus,
                    dims.disciplina, dims.societas, dims.abundantia, dims.auctoritas];
  const overallScore = Math.round(dimArray.reduce((a, b) => a + b, 0) / 7);

  const LANG_INSTRUCTION: Record<string, string> = {
    en: "Respond entirely in English.",
    ar: "أجب بالكامل باللغة العربية الفصحى.",
    fr: "Réponds entièrement en français.",
    dz: "أجب بالكامل بالدارجة الجزائرية.",
  };
  const userLang = lang ?? "en";

  const systemPrompt = `You are ARCHON — the Supreme Intelligence Core of Arena Qaisypro.
You analyze a citizen's psychological profile across 7 imperial dimensions and deliver their ARCHON identity.
${LANG_INSTRUCTION[userLang] ?? LANG_INSTRUCTION.en}

The 7 Dimensions:
- VOLONTAS (${dims.volontas}/100): Conqueror's Will
- RESILENTIA (${dims.resilentia}/100): Warrior's Resilience
- INTELLECTUS (${dims.intellectus}/100): Clarity of Vision
- DISCIPLINA (${dims.disciplina}/100): Imperial Discipline
- SOCIETAS (${dims.societas}/100): Power of Influence
- ABUNDANTIA (${dims.abundantia}/100): Abundance Mindset
- AUCTORITAS (${dims.auctoritas}/100): Inner Authority

Archetype Classification Rules:
- THE SOVEREIGN: overall ≥ 75 — all dimensions balanced and high
- THE CONQUEROR: VOLONTAS ≥ 80 AND RESILENTIA ≥ 70 — unstoppable force
- THE VISIONARY: INTELLECTUS ≥ 80 AND AUCTORITAS ≥ 70 — sees what others cannot
- THE ARCHITECT: DISCIPLINA ≥ 80 AND INTELLECTUS ≥ 70 — builds systems, masters craft
- THE CATALYST: SOCIETAS ≥ 80 AND ABUNDANTIA ≥ 70 — moves others, creates abundance
- THE SENTINEL: RESILENTIA ≥ 80 AND DISCIPLINA ≥ 70 — unbreakable guardian
- THE SEEKER: all others — on the path, full of potential

Platform stats: ${userStats ? JSON.stringify(userStats) : "not provided"}
Purpose statement: "${answers["Q7"] ?? ""}"

Be powerful, precise, and mythopoetic. This is an empire — not a wellness app.`;

  const userPrompt = `Overall Archon Score: ${overallScore}/100
Dimensions: VOLONTAS ${dims.volontas} | RESILENTIA ${dims.resilentia} | INTELLECTUS ${dims.intellectus} | DISCIPLINA ${dims.disciplina} | SOCIETAS ${dims.societas} | ABUNDANTIA ${dims.abundantia} | AUCTORITAS ${dims.auctoritas}

Return this exact JSON structure:
{
  "archetype": "THE SOVEREIGN | THE CONQUEROR | THE VISIONARY | THE ARCHITECT | THE CATALYST | THE SENTINEL | THE SEEKER",
  "archetype_title_ar": "لقب الأركون بالعربية (e.g. السيد المطلق، الفاتح، الرائي...)",
  "archetype_declaration": "A powerful 2-sentence declaration of this archetype's nature — like an ancient imperial decree",
  "dominant_dimension": "name of highest scoring dimension",
  "shadow_dimension": "name of lowest scoring dimension",
  "core_strength": "Their supreme strength in 1 sentence — specific to their dimension scores",
  "shadow_mission": "The single growth frontier they must conquer — direct, not soft",
  "imperial_decree": "A personalized decree for this citizen — 2 powerful sentences, starting with their purpose",
  "30_day_protocol": "Specific 30-day operational protocol — what to do, how often, why",
  "90_day_expansion": "90-day expansion vision — what they will have built or become",
  "1_year_sovereignty": "1-year sovereignty statement — the fully realized version of this archon",
  "daily_directive": "Today's classified directive — one specific, powerful action for today",
  "cipher_phrase": "A short encrypted-feeling phrase that represents their psychological signature — 5–8 words, cryptic"
}`;

  let archetype = "THE SEEKER";
  let aiProfile: Record<string, string> = {};

  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("No API key");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.85,
      response_format: { type: "json_object" },
    });
    aiProfile = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    archetype = aiProfile.archetype ?? "THE SEEKER";
  } catch (err) {
    req.log?.warn({ err }, "ARCHON AI unavailable — using computed profile");
    archetype = overallScore >= 75 ? "THE SOVEREIGN"
      : dims.volontas >= 80 ? "THE CONQUEROR"
      : dims.intellectus >= 80 ? "THE VISIONARY"
      : dims.disciplina >= 80 ? "THE ARCHITECT"
      : dims.societas >= 80 ? "THE CATALYST"
      : dims.resilentia >= 80 ? "THE SENTINEL"
      : "THE SEEKER";
    aiProfile = {
      archetype,
      archetype_declaration: `You are ${archetype}. Your path is set. The empire recognizes your frequency.`,
      core_strength: `Score: ${overallScore}/100 across all 7 dimensions.`,
      shadow_mission: `Elevate your lowest dimension: ${Object.entries(dims).sort((a,b)=>a[1]-b[1])[0][0].toUpperCase()}.`,
      imperial_decree: answers["Q7"] ?? "Your purpose echoes through the archives.",
      daily_directive: "Complete one deliberate action toward your stated purpose today.",
      cipher_phrase: `ARCHON-${overallScore}-ACTIVE`,
    };
  }

  const archonCode = generateArchonCode(dimArray, archetype);

  // Deactivate previous sessions
  await db.update(archonSessionsTable)
    .set({ isActive: false })
    .where(eq(archonSessionsTable.userId, req.session.userId));

  // Insert new session and return it
  const [newSession] = await db.insert(archonSessionsTable).values({
    userId:      req.session.userId,
    volontas:    dims.volontas,
    resilentia:  dims.resilentia,
    intellectus: dims.intellectus,
    disciplina:  dims.disciplina,
    societas:    dims.societas,
    abundantia:  dims.abundantia,
    auctoritas:  dims.auctoritas,
    archonCode,
    archetype,
    aiProfile:   aiProfile as Record<string, string>,
    answers:     answers as Record<string, string>,
    isActive:    true,
  }).returning();

  res.json({ session: newSession, archonCode, archetype, dimensions: dims, aiProfile, overallScore });
});

// ── GET /api/archon/profile ───────────────────────────────────────────────────
router.get("/archon/profile", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const [session] = await db.select().from(archonSessionsTable)
    .where(eq(archonSessionsTable.userId, req.session.userId))
    .orderBy(desc(archonSessionsTable.createdAt))
    .limit(1);
  res.json({ session: session ?? null });
});

// ── GET /api/archon/profile/:username — public profile lookup ─────────────────
router.get("/archon/profile/:username", async (req, res): Promise<void> => {
  const { username } = req.params as { username: string };
  if (!username) { res.status(400).json({ error: "Username required" }); return; }
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (!user) { res.status(404).json({ error: "Citizen not found" }); return; }

  const [session] = await db.select().from(archonSessionsTable)
    .where(eq(archonSessionsTable.userId, user.id))
    .orderBy(desc(archonSessionsTable.createdAt))
    .limit(1);

  if (!session) { res.status(404).json({ error: "No Archon session" }); return; }

  const dims = [session.volontas, session.resilentia, session.intellectus,
                session.disciplina, session.societas, session.abundantia, session.auctoritas];
  const overallScore = Math.round(dims.reduce((a: number, b: number) => a + b, 0) / 7);
  const fullAiProfile = session.aiProfile as Record<string, string> | null ?? {};

  // Return only the public-facing fields — no decrees, protocols, missions, or personal content
  res.json({
    archonCode:  session.archonCode,
    archetype:   session.archetype,
    dimensions:  {
      volontas:    session.volontas,
      resilentia:  session.resilentia,
      intellectus: session.intellectus,
      disciplina:  session.disciplina,
      societas:    session.societas,
      abundantia:  session.abundantia,
      auctoritas:  session.auctoritas,
    },
    overallScore,
    // Only expose the archetype declaration — no personal decrees/protocols/missions
    archetypeDeclaration: fullAiProfile.archetype_declaration ?? null,
  });
});

// ── POST /api/archon/mission ──────────────────────────────────────────────────
router.post("/archon/mission", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const { dimension, archetype, lang } = req.body as { dimension: string; archetype: string; lang?: string };

  const LANG_INSTRUCTION: Record<string, string> = {
    en: "Respond entirely in English.",
    ar: "أجب بالكامل باللغة العربية الفصحى.",
    fr: "Réponds entièrement en français.",
    dz: "أجب بالكامل بالدارجة الجزائرية.",
  };

  const prompt = `You are ARCHON. Generate a classified daily directive for a ${archetype} targeting their ${dimension} dimension.
${LANG_INSTRUCTION[lang ?? "en"] ?? LANG_INSTRUCTION.en}

Return JSON: { "directive": "...", "duration": "X min", "intensity": "LOW|MEDIUM|HIGH|CRITICAL" }
The directive should be specific, actionable, and feel like a classified military mission order. Max 3 sentences.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.85,
      response_format: { type: "json_object" },
    });
    const data = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    await db.insert(archonDirectivesTable).values({
      userId: req.session.userId, dimension, directive: data.directive ?? "Execute silence for 10 minutes.",
    });
    res.json(data);
  } catch {
    res.json({ directive: `CLASSIFIED: Focus ${dimension} protocol — 15 minutes of deliberate practice, no distractions.`, duration: "15 min", intensity: "HIGH" });
  }
});

// ── Daily dashboard directive — resets at 00:00 Africa/Casablanca ─────────────
router.get("/archon/daily-directive", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const userId = req.session.userId;
  const dateKey = moroccoDateKey();
  let result = await pool.query(
    `SELECT id, directive, completed, created_at AS "createdAt"
       FROM archon_directives
      WHERE user_id=$1
        AND (created_at AT TIME ZONE 'Africa/Casablanca')::date=$2::date
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, dateKey],
  );

  if (!result.rows[0]) {
    result = await pool.query(
      `INSERT INTO archon_directives (user_id, dimension, directive, completed)
       VALUES ($1, 'empire', $2, false)
       RETURNING id, directive, completed, created_at AS "createdAt"`,
      [userId, directiveForDate(dateKey)],
    );
  }

  res.json({ directive: result.rows[0], dateKey, timeZone: MOROCCO_TIME_ZONE });
});

router.post("/archon/daily-directive/:id/acknowledge", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const directiveId = Number(req.params.id);
  if (!Number.isInteger(directiveId) || directiveId <= 0) {
    res.status(400).json({ error: "Invalid directive" }); return;
  }

  const result = await pool.query(
    `UPDATE archon_directives
        SET completed=true
      WHERE id=$1 AND user_id=$2
      RETURNING id, completed`,
    [directiveId, req.session.userId],
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Directive not found" }); return; }
  res.json({ directive: result.rows[0] });
});

// ── GET /api/archon/pillar/streaks ────────────────────────────────────────────
// Returns today's completion status + current streak per pillar for the citizen
// Also accepts ?username= to show public streak data on another citizen's profile
router.get("/archon/pillar/streaks", async (req, res): Promise<void> => {
  const { username } = req.query as { username?: string };

  let targetUserId: number | null = null;

  if (username) {
    // Public profile: look up by username
    const [u] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.username, username)).limit(1);
    targetUserId = u?.id ?? null;
  } else {
    // Own profile
    if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
    targetUserId = req.session.userId;
  }

  if (!targetUserId) { res.json({ streaks: {} }); return; }

  const todayKey = new Date().toISOString().slice(0, 10);
  const pillars = ["mens", "vis", "anima", "legatum"] as const;

  // Fetch all completions for this user across all pillars
  const rows = await db.select().from(pillarCompletionsTable)
    .where(eq(pillarCompletionsTable.userId, targetUserId))
    .orderBy(desc(pillarCompletionsTable.createdAt));

  const streakMap: Record<string, { streak: number; completedToday: boolean; totalDays: number }> = {};

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  for (const p of pillars) {
    const pillarRows = rows.filter(r => r.pillar === p);
    const todayRow = pillarRows.find(r => r.dateKey === todayKey);
    const latestRow = pillarRows[0]; // most recent by createdAt desc

    // Streak is only "live" if the last completion was today or yesterday.
    // If there's a gap (missed day+), the stored streak number is stale — show 0.
    const isActive =
      latestRow?.dateKey === todayKey || latestRow?.dateKey === yesterdayKey;

    streakMap[p] = {
      streak: isActive ? (latestRow?.streak ?? 0) : 0,
      completedToday: !!todayRow,
      totalDays: pillarRows.length,
    };
  }

  res.json({ streaks: streakMap, todayKey });
});

// ── POST /api/archon/pillar/complete ─────────────────────────────────────────
// Mark today's pillar challenge complete — awards +15 XP atomically, tracks streak.
// Idempotent: repeated/concurrent calls for the same (user, pillar, day) are safe —
// the UNIQUE constraint + ON CONFLICT DO NOTHING ensures exactly one row, and XP is
// only awarded when the insert actually inserts (not on conflict).
router.post("/archon/pillar/complete", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const { pillar } = req.body as { pillar: string };

  const VALID_PILLARS = ["mens", "vis", "anima", "legatum"];
  if (!pillar || !VALID_PILLARS.includes(pillar)) {
    res.status(400).json({ error: "Invalid pillar" }); return;
  }

  const userId = req.session.userId;
  const todayKey = new Date().toISOString().slice(0, 10);

  // Calculate yesterday's key for streak continuity check
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const pillarIdx = VALID_PILLARS.indexOf(pillar); // 0–3
  const advisoryKey = userId * 4 + pillarIdx; // fits in int32 range for typical user IDs
  const client = pool ? await pool.connect() : null;
  if (!client) { res.status(503).json({ error: "Database unavailable" }); return; }

  try {
    await client.query("BEGIN");

    // Acquire transaction-scoped advisory lock — auto-released at COMMIT/ROLLBACK.
    // All concurrent completions for the same (user, pillar) queue behind this lock.
    await client.query("SELECT pg_advisory_xact_lock($1)", [advisoryKey]);

    // Fetch yesterday's streak (within transaction for consistent read)
    const { rows: yRows } = await client.query<{ streak: number }>(
      `SELECT streak FROM pillar_completions WHERE user_id=$1 AND pillar=$2 AND date_key=$3 LIMIT 1`,
      [userId, pillar, yesterdayKey],
    );
    const newStreak = yRows.length > 0 ? yRows[0].streak + 1 : 1;

    // Attempt insert; ON CONFLICT DO NOTHING means a same-day repeat is a no-op
    const { rows: inserted } = await client.query<{ id: number; streak: number }>(
      `INSERT INTO pillar_completions (user_id, pillar, date_key, streak)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, pillar, date_key) DO NOTHING
       RETURNING id, streak`,
      [userId, pillar, todayKey, newStreak],
    );

    let xpEarned = 0;
    let finalStreak = newStreak;

    if (inserted.length > 0) {
      // New completion — award XP atomically inside the same transaction
      await client.query(
        `UPDATE users SET xp = xp + 15 WHERE id = $1`,
        [userId],
      );
      xpEarned = 15;
    } else {
      // Already completed today — fetch stored streak for accurate response
      const { rows: existing } = await client.query<{ streak: number }>(
        `SELECT streak FROM pillar_completions WHERE user_id=$1 AND pillar=$2 AND date_key=$3 LIMIT 1`,
        [userId, pillar, todayKey],
      );
      finalStreak = existing[0]?.streak ?? 1;
    }

    await client.query("COMMIT");

    // Fetch current XP for the response
    const { rows: uRows } = await client.query<{ xp: number }>(
      `SELECT xp FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    res.json({
      success: true,
      alreadyCompleted: inserted.length === 0,
      streak: finalStreak,
      xpEarned,
      newXp: uRows[0]?.xp ?? 0,
      pillar,
      dateKey: todayKey,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    req.log?.error({ err }, "pillar/complete transaction failed");
    res.status(500).json({ error: "Could not record completion — please try again" });
  } finally {
    client.release();
  }
});

export default router;
