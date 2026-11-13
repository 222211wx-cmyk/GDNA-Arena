import { Router, type IRouter } from "express";
import { AI_UNAVAILABLE_MESSAGE, createOptionalOpenAI, isOpenAIAvailable } from "../lib/openai-client";

const router: IRouter = Router();
const openai = createOptionalOpenAI();

/**
 * POST /api/chronicle/predictions
 * Returns AI-powered future predictions for Arena Qaisypro timeline
 */
router.post("/chronicle/predictions", async (req, res): Promise<void> => {
  const { lang } = req.body as { lang?: string };

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: AI_UNAVAILABLE_MESSAGE });
    return;
  }

  const userLang = lang ?? "en";

  const LANG_INSTRUCTION: Record<string, string> = {
    en: "Respond entirely in English.",
    ar: "أجب بالكامل باللغة العربية الفصحى.",
    fr: "Réponds entièrement en français.",
    dz: "أجب بالكامل بالدارجة الجزائرية.",
  };

  const systemPrompt = `You are GDN-AI — the sovereign neural intelligence and timeline oracle of Arena Qaisypro, a play-to-earn gaming and global voting platform built as a digital empire.
${LANG_INSTRUCTION[userLang] ?? LANG_INSTRUCTION.en}

Your tone: visionary, precise, mythic — like a digital prophet speaking across timelines.
Keep each prediction concise (2-3 sentences max), specific, and inspiring.`;

  const userPrompt = `Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.

Generate future predictions for the Arena Qaisypro platform timeline. Return a JSON object:
{
  "q3_2026": "Prediction for Q3 2026 — what milestone Arena Qaisypro will reach (games, users, voting, AI features)",
  "q4_2026": "Prediction for Q4 2026 — expansion, new features, partnerships, or ecosystem growth",
  "q1_2027": "Prediction for Q1 2027 — major evolution of the platform (mobile, sovereignty, global reach)",
  "q2_2027": "Prediction for Q2 2027 — peak vision of the empire",
  "oracle_quote": "A single powerful oracle statement about the future of digital sovereignty and gaming — under 20 words",
  "confidence_score": "A number between 85 and 97 representing AI confidence in these predictions"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.85,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let predictions: Record<string, string> = {};

    try {
      predictions = JSON.parse(raw);
    } catch {
      predictions = { error: "Could not parse predictions" };
    }

    req.log.info({}, "Chronicle predictions generated");
    res.json({ predictions });
  } catch {
    req.log.warn("Chronicle predictions provider unavailable");
    res.status(502).json({ error: AI_UNAVAILABLE_MESSAGE });
  }
});

export default router;
