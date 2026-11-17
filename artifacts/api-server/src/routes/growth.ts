import { Router, type IRouter } from "express";
import { AI_UNAVAILABLE_MESSAGE, createOptionalOpenAI, isOpenAIAvailable } from "../lib/openai-client";

const router: IRouter = Router();
const openai = createOptionalOpenAI();

/**
 * POST /api/growth/trajectory
 * Accepts real user stats → returns AI-powered NLP growth analysis + predictions
 */
router.post("/growth/trajectory", async (req, res): Promise<void> => {
  const { xp, wins, gamesPlayed, balance, username, lang } = req.body as {
    xp: number;
    wins: number;
    gamesPlayed: number;
    balance: number;
    username: string;
    lang?: string;
  };

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: AI_UNAVAILABLE_MESSAGE });
    return;
  }

  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  const userLang = lang ?? "en";

  const LANG_INSTRUCTION: Record<string, string> = {
    en: "Respond entirely in English.",
    ar: "أجب بالكامل باللغة العربية الفصحى.",
    fr: "Réponds entièrement en français.",
    dz: "أجب بالكامل بالدارجة المغربية.",
  };

  const systemPrompt = `You are GDN-AI — the sovereign neural intelligence of Arena Qaisypro.
You are a Neuro-Linguistic Programming (NLP) coach integrated into a gaming/voting platform.
Your role: analyze a player's real behavioral data and deliver a precise, motivating growth trajectory analysis.
${LANG_INSTRUCTION[userLang] ?? LANG_INSTRUCTION.en}

Rules:
- Be direct, precise, and empowering — no filler
- Use NLP language (anchor, reframe, future-pacing, peak state)
- Give specific actionable predictions based on the numbers provided
- Format as JSON exactly as specified`;

  const userPrompt = `Player: ${username}
XP: ${xp}
Wins: ${wins}
Games Played: ${gamesPlayed}
Win Rate: ${winRate}%
Coin Balance: ${balance}

Analyze this player's NLP profile and return a JSON object with these exact fields:
{
  "nlp_archetype": "one of: The Strategist | The Warrior | The Builder | The Visionary | The Sovereign",
  "archetype_desc": "2 sentences explaining why this archetype fits based on their stats",
  "strength": "their biggest mental/behavioral strength based on stats (1 sentence)",
  "blind_spot": "their main growth opportunity (1 sentence, constructive)",
  "30_day_prediction": "specific prediction for 30 days if they maintain current pace (mention numbers)",
  "90_day_prediction": "specific prediction for 90 days with growth assumptions",
  "1_year_vision": "vivid future-pacing statement — where they will be in 1 year",
  "daily_affirmation": "a powerful NLP affirmation personalized to their archetype and stats",
  "growth_action": "the single most impactful action they can take today"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 700,
      temperature: 0.75,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let analysis: Record<string, string> = {};

    try {
      analysis = JSON.parse(raw);
    } catch {
      analysis = { error: "Could not parse AI response" };
    }

    req.log.info({ userId: req.session?.userId }, "Growth trajectory generated");
    res.json({ analysis });
  } catch {
    req.log.warn("Growth trajectory provider unavailable");
    res.status(502).json({ error: AI_UNAVAILABLE_MESSAGE });
  }
});

export default router;
