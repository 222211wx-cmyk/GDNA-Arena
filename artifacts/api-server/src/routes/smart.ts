/**
 * ═══════════════════════════════════════════════════════════════
 *  GDNA SMART SYSTEM — Intelligence Engine v1.0
 *  Aggregates real data from ALL modules, feeds OpenAI, returns
 *  personalised Arabic/French recommendations per citizen.
 * ═══════════════════════════════════════════════════════════════
 */
import { Router, type IRouter } from "express";
import { db, pool } from "../lib/db";
import { usersTable } from "../lib/db-schema";
import { eq } from "drizzle-orm";
import { createOptionalOpenAI, isOpenAIAvailable } from "../lib/openai-client";

const router: IRouter = Router();
const openai = createOptionalOpenAI();

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── GET /api/smart/status — fast module status snapshot ───────────────────────
router.get("/smart/status", requireAuth, async (req: any, res): Promise<void> => {
  const userId = req.session.userId as number;
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Parallel queries across all modules
    const [
      gamesRow,
      archonRow,
      pulseRow,
      learnRow,
      transRow,
      celebRow,
      followRow,
      postRow,
    ] = await Promise.all([
      // Games stats
      pool.query(
        `SELECT games_played, wins FROM users WHERE id = $1`,
        [userId]
      ),
      // Archon profile
      pool.query(
        `SELECT archetype, archon_code FROM archon_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      ),
      // Pulse posts count
      pool.query(
        `SELECT COUNT(*) as cnt FROM pulse_posts WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      // Learn modules completed
      pool.query(
        `SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed = true`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      // Wallet transactions
      pool.query(
        `SELECT COUNT(*) as cnt, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as earned FROM transactions WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0, earned: 0 }] })),
      // Celebrations entered
      pool.query(
        `SELECT COUNT(*) as cnt FROM celebration_entries WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      // Following count
      pool.query(
        `SELECT COUNT(*) as cnt FROM social_follows WHERE follower_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      // Total posts (pulse)
      pool.query(
        `SELECT COUNT(*) as cnt FROM pulse_posts WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    const gamesPlayed   = parseInt(gamesRow.rows[0]?.games_played ?? 0);
    const wins          = parseInt(gamesRow.rows[0]?.wins ?? 0);
    const archetype     = archonRow.rows[0]?.archetype ?? null;
    const archonCode    = archonRow.rows[0]?.archon_code ?? null;
    const pulsePosts    = parseInt(pulseRow.rows[0]?.cnt ?? 0);
    const lessonsComp   = parseInt(learnRow.rows[0]?.cnt ?? 0);
    const txCount       = parseInt(transRow.rows[0]?.cnt ?? 0);
    const coinsEarned   = parseFloat(transRow.rows[0]?.earned ?? 0);
    const compEntered   = parseInt(celebRow.rows[0]?.cnt ?? 0);
    const followCount   = parseInt(followRow.rows[0]?.cnt ?? 0);

    const level = Math.floor(Math.sqrt((user.xp ?? 0) / 100)) + 1;
    const xpToNext = Math.pow(level, 2) * 100 - (user.xp ?? 0);

    const modules = [
      {
        id: "games",
        name: "🎮 Jeux",
        status: gamesPlayed > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, gamesPlayed * 5 + wins * 10),
        stats: { gamesPlayed, wins, winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0 },
        badge: gamesPlayed >= 10 ? "🏆 Joueur Pro" : gamesPlayed >= 3 ? "⚡ En progression" : "🌱 Débutant",
        link: "/games",
      },
      {
        id: "education",
        name: "📚 Éducation",
        status: lessonsComp > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, lessonsComp * 20),
        stats: { lessonsCompleted: lessonsComp },
        badge: lessonsComp >= 5 ? "🎓 Savant" : lessonsComp >= 1 ? "📖 Étudiant" : "📝 Non commencé",
        link: "/learn",
      },
      {
        id: "business",
        name: "💼 Business",
        status: txCount > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, Math.floor(coinsEarned / 10)),
        stats: { transactions: txCount, coinsEarned: Math.floor(coinsEarned), balance: user.balance ?? 0 },
        badge: (user.balance ?? 0) >= 1000 ? "💰 Riche" : (user.balance ?? 0) >= 500 ? "💵 Actif" : "🪙 Débutant",
        link: "/wallet",
      },
      {
        id: "social",
        name: "🌍 Social",
        status: followCount > 0 || pulsePosts > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, followCount * 5 + pulsePosts * 10),
        stats: { posts: pulsePosts, following: followCount },
        badge: pulsePosts >= 10 ? "⭐ Influenceur" : pulsePosts >= 3 ? "💬 Actif" : "👤 Silencieux",
        link: "/social",
      },
      {
        id: "competitions",
        name: "🏅 Compétitions",
        status: compEntered > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, compEntered * 25),
        stats: { entered: compEntered },
        badge: compEntered >= 3 ? "🥇 Compétiteur" : compEntered >= 1 ? "🎯 Participant" : "🔕 Passif",
        link: "/celebrations",
      },
      {
        id: "xp",
        name: "⚡ XP & Niveau",
        status: (user.xp ?? 0) > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, Math.floor(((user.xp ?? 0) % (level * level * 100)) / (level * level))),
        stats: { xp: user.xp ?? 0, level, xpToNext: Math.max(0, xpToNext) },
        badge: level >= 10 ? "👑 Légende" : level >= 5 ? "🔥 Elite" : level >= 2 ? "⚡ Montée" : "🌟 Niveau 1",
        link: "/leaderboard",
      },
      {
        id: "stream",
        name: "📡 Stream & Live",
        status: pulsePosts > 0 ? "ACTIF" : "INACTIF",
        score: Math.min(100, pulsePosts * 8),
        stats: { posts: pulsePosts },
        badge: pulsePosts >= 5 ? "📺 Créateur" : "📡 Prêt",
        link: "/pulse",
      },
      {
        id: "job",
        name: "🧬 Archon DNA",
        status: archetype ? "ACTIF" : "INACTIF",
        score: archetype ? 100 : 0,
        stats: { archetype: archetype ?? "Non évalué", archonCode: archonCode ?? "—" },
        badge: archetype ? `🔮 ${archetype}` : "❓ Non initialisé",
        link: "/growth",
      },
    ];

    const activeCount = modules.filter(m => m.status === "ACTIF").length;
    const overallScore = Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length);

    res.json({
      citizen: {
        username: user.username,
        level,
        xp: user.xp ?? 0,
        balance: user.balance ?? 0,
        gamesPlayed,
        wins,
      },
      modules,
      overallScore,
      activeModules: activeCount,
      totalModules: modules.length,
      systemStatus: activeCount >= 6 ? "OPTIMAL" : activeCount >= 4 ? "ACTIF" : activeCount >= 2 ? "PARTIEL" : "INACTIF",
    });
  } catch (err) {
    console.error("[SMART] status error:", err);
    res.status(500).json({ error: "Smart system error" });
  }
});

// ── GET /api/smart/analysis — full AI analysis with recommendations ────────────
router.get("/smart/analysis", requireAuth, async (req: any, res): Promise<void> => {
  const userId = req.session.userId as number;
  try {
    // Reuse status data
    const statusRes = await fetch(`http://localhost:${process.env.PORT ?? 8080}/api/smart/status`, {
      headers: { cookie: req.headers.cookie ?? "" },
    });
    const statusData = await statusRes.json() as any;

    if (!statusData?.citizen) {
      res.status(500).json({ error: "Failed to fetch status data" });
      return;
    }

    const { citizen, modules, overallScore, systemStatus } = statusData;

    // Build context for AI
    const moduleContext = modules.map((m: any) =>
      `- ${m.name}: ${m.status} (score ${m.score}/100) | ${m.badge} | stats: ${JSON.stringify(m.stats)}`
    ).join("\n");

    const prompt = `Tu es GDN-SMART, le système d'intelligence de l'empire Arena Qaisypro.
Tu analyses le profil d'un citoyen et génères des recommandations personnalisées EN ARABE ET FRANÇAIS.

PROFIL DU CITOYEN: ${citizen.username}
- Niveau: ${citizen.level} | XP: ${citizen.xp} | Balance: ${citizen.balance} pièces
- Parties jouées: ${citizen.gamesPlayed} | Victoires: ${citizen.wins}
- Score global: ${overallScore}/100 | Statut système: ${systemStatus}

MODULES ACTIFS:
${moduleContext}

Génère un JSON EXACT avec cette structure (sans markdown, juste le JSON):
{
  "headline": "Une phrase percutante en arabe sur le statut du citoyen (max 80 chars)",
  "overallMessage": "2-3 phrases en arabe et français sur l'état global de l'empire du citoyen",
  "recommendations": [
    {
      "moduleId": "games|education|business|social|competitions|xp|stream|job",
      "priority": "HIGH|MEDIUM|LOW",
      "title": "Titre court en arabe",
      "action": "Action concrète en arabe (max 100 chars)",
      "reward": "Récompense potentielle (coins/XP)",
      "icon": "emoji"
    }
  ],
  "strengths": ["force1 en arabe", "force2 en arabe"],
  "weaknesses": ["faiblesse1 en arabe", "faiblesse2 en arabe"],
  "dailyMission": {
    "title": "Mission du jour en arabe",
    "tasks": ["tâche1 en arabe", "tâche2 en arabe", "tâche3 en arabe"],
    "totalReward": "nombre de coins/XP"
  }
}`;

    const fallbackAnalysis = () => ({
      headline: "نظامك الذكي نشط ويراقبك",
      overallMessage: "مرحباً بك في النظام الذكي — GDNA SMART يحلل بياناتك ويقدم توصيات شخصية.",
      recommendations: modules
        .filter((m: any) => m.status === "INACTIF")
        .slice(0, 3)
        .map((m: any) => ({
          moduleId: m.id,
          priority: "HIGH",
          title: `فعّل ${m.name}`,
          action: `انتقل إلى ${m.name} وابدأ نشاطك`,
          reward: "+50 XP",
          icon: "🚀",
        })),
      strengths: ["لديك حضور في المنصة"],
      weaknesses: ["بعض الوحدات غير مفعّلة"],
      dailyMission: {
        title: "مهمة اليوم",
        tasks: ["العب لعبة واحدة", "انشر منشوراً", "اشترك بمسابقة"],
        totalReward: "+150 XP +100 coins",
      },
    });

    let analysis: any;
    if (!isOpenAIAvailable()) {
      analysis = fallbackAnalysis();
    } else {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 1000,
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        analysis = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        req.log.warn("[SMART] AI provider unavailable — using deterministic analysis");
        analysis = fallbackAnalysis();
      }
    }

    res.json({ ...statusData, analysis, generatedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "AI analysis failed" });
  }
});

export default router;
