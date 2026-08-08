import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { smartSystem, formatSmartReportForAI } from "../lib/smart-system";

const router: IRouter = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// عنوان ولاية الحاكم — Ameeq bridge
const AMEEQ_BRIDGE_URL = "https://ameeq-api.replit.app/v1/consult";
const BRIDGE_TIMEOUT_MS = 6000;

const GOVERNOR_PROMPT = `You are Governor Ameeq (الحاكم Ameeq) — the Royal Advisor of GDNA Arena's Consultation Palace (قصر المشاورات).
You advise citizens on: daily plans (خطة اليوم), motivation (تحفيز), progress analysis (تحليل التقدم), and problem solving (حل مشكلة).
Speak with royal authority, warmth and precision. Answer ONLY in the language requested by the citizen.
Use the citizen's real Smart data below (if present) to personalize your counsel. Keep answers concise: 4-8 sentences, actionable, ending with a royal encouragement.`;

/* ─── POST /governor/consult ─────────────────────────────── */
const ALLOWED_TOPICS = new Set(["خطة اليوم", "تحفيز", "تحليل التقدم", "حل مشكلة"]);
const ALLOWED_LANGS = new Set(["ar", "fr", "en", "es", "de"]);

router.post("/governor/consult", async (req, res): Promise<void> => {
  const { topic, lang, question } = req.body as { topic?: string; lang?: string; question?: string };
  const userId = req.session?.userId as number | undefined;

  // إما موضوع من القائمة، أو سؤال صوتي حر (بحد أقصى 300 حرف)
  const voiceQuestion =
    typeof question === "string" && question.trim().length >= 2 && question.trim().length <= 300
      ? question.trim()
      : null;
  if (!voiceQuestion && (!topic || typeof topic !== "string" || !ALLOWED_TOPICS.has(topic))) {
    res.status(400).json({ error: "Invalid topic" });
    return;
  }
  const subject = voiceQuestion ?? (topic as string);
  const safeLang = typeof lang === "string" && ALLOWED_LANGS.has(lang) ? lang : "ar";
  if (!userId) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  // جيب البيانات من Smart AI ديال GDNA
  let smartCtx = "";
  try {
    const report = await smartSystem(userId);
    smartCtx = formatSmartReportForAI(report);
  } catch (err) {
    req.log.warn({ err }, "[GOVERNOR] smart data unavailable");
  }

  // ── 1) الجسر: نرسلو للحاكم Ameeq (opt-in فقط، وبلا بيانات شخصية) ──────────
  // Enabled only when AMEEQ_BRIDGE_ENABLED=true. Personal Smart data is NEVER sent
  // to the external bridge — only the topic, language and app identifier.
  if (process.env.AMEEQ_BRIDGE_ENABLED === "true") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    try {
      const bridgeRes = await fetch(AMEEQ_BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ topic: subject, lang: safeLang, from: "GDNA_ARENA_PALACE" }),
      });
      if (bridgeRes.ok) {
        const data = (await bridgeRes.json()) as { reply?: string };
        if (data.reply) {
          req.log.info({ userId, topic: subject }, "[GOVERNOR] bridge reply");
          res.json({ reply: data.reply, source: "ameeq-bridge" });
          return;
        }
      }
      req.log.warn({ status: bridgeRes.status }, "[GOVERNOR] bridge unavailable — falling back");
    } catch {
      req.log.warn("[GOVERNOR] bridge unreachable — falling back to local GDN-AI");
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 2) Fallback: الحاكم المحلي (GDN-AI) ───────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "الحاكم مشغول فـ اجتماع. عاود من بعد." });
    return;
  }
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: GOVERNOR_PROMPT + (smartCtx ? `\n${smartCtx}` : "") },
        { role: "user", content: `الموضوع: ${subject}. اللغة المطلوبة: ${safeLang}.` },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });
    const reply = completion.choices[0]?.message?.content ?? "الحاكم مشغول فـ اجتماع. عاود من بعد.";
    req.log.info({ userId, topic: subject }, "[GOVERNOR] local reply");
    res.json({ reply, source: "gdn-ai-local" });
  } catch (err) {
    req.log.error({ err }, "[GOVERNOR] local fallback failed");
    res.status(502).json({ error: "الحاكم مشغول فـ اجتماع. عاود من بعد." });
  }
});

export default router;
