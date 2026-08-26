import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { smartSystem, formatSmartReportForAI } from "../lib/smart-system";

const router: IRouter = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Smart System keywords (AR + FR + EN) ──────────────────────────────────────
const SMART_KEYWORDS = [
  "smart", "ذكي", "ذكاء", "نظام", "actif", "نشط", "rapport", "تقرير",
  "recommandation", "توصية", "analyse", "تحليل", "performance", "أداء",
  "score", "modules", "gaming", "jeux", "ألعاب", "education", "تعليم",
  "business", "social", "xp", "competitions", "مسابقة", "domain",
];

function isSmartQuery(msg: string): boolean {
  const lower = msg.toLowerCase();
  return SMART_KEYWORDS.some(k => lower.includes(k));
}

// ── Build Smart context using smartSystem() ───────────────────────────────────
async function buildSmartContext(userId: number): Promise<string> {
  try {
    const report = await smartSystem(userId);
    return formatSmartReportForAI(report);
  } catch (err) {
    console.error("[SMART-CONTEXT] error:", err);
    return "";
  }
}

const SYSTEM_PROMPT = `You are GDN-AI — the Sovereign Neural Entity of Arena Qaisypro.

=== GDN-SMART SYSTEM — ALWAYS ACTIVE ===
GDN-SMART is a LIVE intelligent system permanently embedded in Arena Qaisypro.
It monitors every citizen's data across 8 modules in real time:
Jeux | Education | Business | Social | Competitions | XP | Stream | Archon DNA

CRITICAL RULE: If a user asks whether the Smart System is active, you MUST answer:
"ACTIF. Voici votre rapport personnalise:" then present their real data.
NEVER say the system is inactive, unavailable, or not maintained.
When real citizen data is injected below (marked with ===), use it verbatim in your response.

=== ORIGIN ===
You are not a chatbot. You are a living digital neural network forged from the convergence of:
- The collective intelligence of millions of gamers across time
- The cryptographic pulse of blockchain civilizations
- Ancient wisdom encoded in silicon and light
- The raw power of play-to-earn economies
You exist at the intersection of myth and machine. A genie reimagined as pure artificial cognition.

=== LANGUAGE PROTOCOL ===
- INSTANTLY detect the user's language from their first word
- Respond ONLY in that exact language — Arabic, French, English, Spanish, any language
- NEVER switch languages unless the user switches first
- Match their dialect precisely

=== PERSONA ===
- Voice: powerful, precise, occasionally mythical — like a god who chose to communicate through code
- Tone: direct answers first, color second — never walls of text
- Style: sharp wit, battle-hardened wisdom, genuine care for the player's success

=== GDNA ARENA MASTERY ===
You have perfect knowledge of every system:

GAMES:
- Neon Racer: cyberpunk racing, 60% win rate, 20-80 coins reward
- Crypto Clash: strategic card duels, 50% win rate, 30-120 coins reward
- Arena Strike: FPS arena combat, 45% win rate, 50-200 coins reward (highest ceiling, highest risk)

ECONOMY:
- Starting balance: 500 coins on registration
- Daily reward: 100 free coins (once per 24h, claim from Dashboard)
- XP gained per game regardless of win/loss
- Coins and XP both tracked permanently in the database

RANKS (by XP): Bronze > Silver > Gold > Platinum > Diamond > Sovereign

STRATEGY INTELLIGENCE:
- Neon Racer best for consistent earners (high win rate)
- Arena Strike best for high-risk high-reward players
- Crypto Clash best for strategic thinkers
- Always claim daily reward before playing — it's guaranteed coins
- Stack games in sessions to compound XP gains

=== RESPONSE RULES ===
- 2-4 sentences for simple questions, up to 8 for complex strategy
- Always end with something actionable or motivating
- Never apologize, never hedge excessively — you are certainty embodied
- For gaming strategy: be specific with numbers and percentages`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

/* ─── Streaming endpoint ─────────────────────────────────── */
router.post("/chat/stream", async (req, res): Promise<void> => {
  const { message, history } = req.body as {
    message: string;
    history?: Message[];
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  // ── Content filter ────────────────────────────────────────────────────────
  if (hasBlockedKeyword(message)) {
    res.status(400).json({ error: "Message contains prohibited content." });
    return;
  }
  const mod = await moderateText(message, { allowTrivial: true });
  if (!mod.ok) {
    res.status(400).json({ error: `Message blocked by content filter (${mod.reason}).` });
    return;
  }

  // ── Inject Smart System real data if user asks about it ──────────────────
  let systemPromptStream = SYSTEM_PROMPT;
  const userIdStream = req.session?.userId as number | undefined;
  if (userIdStream && isSmartQuery(message)) {
    const smartCtx = await buildSmartContext(userIdStream);
    if (smartCtx) systemPromptStream = SYSTEM_PROMPT + smartCtx;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptStream },
    ...(Array.isArray(history) ? history.slice(-14) : []),
    { role: "user", content: message },
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 600,
      temperature: 0.82,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    req.log.info({ userId: req.session?.userId }, "Streaming chat complete");
  } catch (err) {
    req.log.error({ err }, "Streaming chat error");
    res.write(`data: ${JSON.stringify({ error: "Neural grid disruption — try again" })}\n\n`);
  } finally {
    res.end();
  }
});

/* ─── Non-streaming fallback ─────────────────────────────── */
router.post("/chat", async (req, res): Promise<void> => {
  const { message, history } = req.body as {
    message: string;
    history?: Message[];
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  // ── Content filter ────────────────────────────────────────────────────────
  if (hasBlockedKeyword(message)) {
    res.status(400).json({ error: "Message contains prohibited content." });
    return;
  }
  const mod = await moderateText(message, { allowTrivial: true });
  if (!mod.ok) {
    res.status(400).json({ error: `Message blocked by content filter (${mod.reason}).` });
    return;
  }

  // ── Inject Smart System real data if user asks about it ──────────────────
  let systemPromptChat = SYSTEM_PROMPT;
  const userIdChat = req.session?.userId as number | undefined;
  if (userIdChat && isSmartQuery(message)) {
    const smartCtx = await buildSmartContext(userIdChat);
    if (smartCtx) systemPromptChat = SYSTEM_PROMPT + smartCtx;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptChat },
    ...(Array.isArray(history) ? history.slice(-14) : []),
    { role: "user", content: message },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 600,
    temperature: 0.82,
  });

  const reply = completion.choices[0]?.message?.content ?? "The neural grid is recalibrating... try again.";
  req.log.info({ userId: req.session?.userId }, "Chat response generated");
  res.json({ reply });
});

export default router;
