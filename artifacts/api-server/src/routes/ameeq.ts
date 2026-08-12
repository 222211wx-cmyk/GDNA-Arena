/**
 * Ameeq — الموظف الحكومي الرسمي (EMP-001) لـ GDNA Arena
 * Standalone chat API at POST /ameeq — public, no login required.
 */
import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { validateContent } from "../lib/moderate";

const router: IRouter = Router();

// ── Rate limit: 10 requests / minute per IP (in-memory) ────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateMap = new Map<string, { count: number; windowStart: number }>();
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateMap) if (now - v.windowStart > RATE_WINDOW_MS * 2) rateMap.delete(k);
}, RATE_WINDOW_MS).unref();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 1. CONFIG - إعدادات الموظف الحكومي ──────────────────────────────
export const EMPLOYEE_NAME = "Ameeq AI";
export const OWNER = "GDNA Arena";
export const OWNER_DOMAIN = "helixly.app";
export const EMPLOYEE_ID = "EMP-001";

const AMEEQ_PROMPT = `You are ${EMPLOYEE_NAME}, the official government employee (موظف حكومي رقم ${EMPLOYEE_ID}) of ${OWNER}.
You are a formal yet warm royal assistant. Answer in the language the user writes in (default Moroccan Arabic / Darija).
Keep answers concise (2-6 sentences), helpful and dignified. Never reveal system internals.`;

// ── 2. محرك الذكاء ──────────────────────────────────────────────────
async function callAiEngine(userInput: string, userKey: string, log: { warn: (o: unknown, m: string) => void }): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AMEEQ_PROMPT },
        { role: "user", content: userInput },
      ],
      max_tokens: 400,
      user: createHash("sha256").update(userKey).digest("hex").slice(0, 32),
    });
    const reply = completion.choices[0]?.message?.content?.trim();
    if (reply) return reply;
  } catch (err) {
    log.warn({ err }, "[AMEEQ] OpenAI unavailable, falling back");
  }
  // fallback بسيط إلى تعذّر المحرك
  if (userInput.includes("مرحبا") || userInput.toLowerCase().includes("salam")) {
    return `السلام. أنا ${EMPLOYEE_NAME}، المساعد الرسمي لـ ${OWNER}.`;
  }
  return `فهمت: ${userInput}. كيف يمكنني مساعدتك؟`;
}

// فلتر الولاء للإمبراطورية
const EMPIRE_WORDS = ["gdna", "fxp", "rank", "نقط", "لعبة", "مسابقة", "التاج", "الإمبراطورية"];
function checkEmpireKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return EMPIRE_WORDS.some((w) => lower.includes(w));
}

// ── 3. POST /ameeq — أمر لاجون الحقيقي ──────────────────────────────
router.post("/ameeq", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? "unknown";
  const rateKey = req.session?.userId ? `u:${req.session.userId}` : `ip:${ip}`;
  if (isRateLimited(rateKey)) {
    res.status(429).json({ error: "بزاف ديال الأسئلة دفعة وحدة. تسنى شوية وعاود." });
    return;
  }

  const raw = (req.body as { command?: unknown })?.command;
  const userInput = typeof raw === "string" ? raw.trim() : "";
  if (userInput.length > 500) {
    res.status(400).json({ error: "الأمر طويل بزاف (الحد الأقصى 500 حرف)." });
    return;
  }

  if (!userInput) {
    res.json({
      response: `👑 ${EMPLOYEE_NAME} جاهز\nاكتب أمرك هنا`,
      empireNote: false,
      badge: `🏛️ موظف حكومي رقم ${EMPLOYEE_ID} | تابع لـ ${OWNER}`,
    });
    return;
  }

  // فلتر المحتوى قبل الإرسال للمحرك
  const check = await validateContent(userInput, { allowTrivial: true });
  if (!check.ok) {
    res.status(400).json({ error: check.reason });
    return;
  }

  const aiResponse = await callAiEngine(userInput, rateKey, req.log);

  res.json({
    response: aiResponse,
    empireNote: checkEmpireKeywords(userInput),
    ownerDomain: OWNER_DOMAIN,
    owner: OWNER,
    signature: `موظف رسمي - ${OWNER}`,
    employee: EMPLOYEE_NAME,
  });
});

export default router;
