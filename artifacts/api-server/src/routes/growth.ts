import { Router, type IRouter } from "express";
import { smartSystem, formatSmartReportForAI } from "../lib/smart-system";
import { AI_UNAVAILABLE_MESSAGE, createOptionalOpenAI, isOpenAIAvailable } from "../lib/openai-client";

const router: IRouter = Router();
const openai = createOptionalOpenAI();

// عنوان ولاية الحاكم — optional external Ameeq bridge
const AMEEQ_BRIDGE_URL = process.env.AMEEQ_BRIDGE_URL;
const BRIDGE_TIMEOUT_MS = 6000;

const GOVERNOR_PROMPT = `You are Governor Ameeq (الحاكم Ameeq) — the Royal Advisor of Arena Qaisypro's Consultation Palace (قصر المشاورات).
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
  if (process.env.AMEEQ_BRIDGE_ENABLED === "true" && AMEEQ_BRIDGE_URL) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    try {
      const bridgeRes = await fetch(AMEEQ_BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ topic: subject, lang: safeLang, from: "ARENA_QAISYPRO_PALACE" }),
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
  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: AI_UNAVAILABLE_MESSAGE });
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
  } catch {
    req.log.warn("[GOVERNOR] local provider unavailable");
    res.status(502).json({ error: AI_UNAVAILABLE_MESSAGE });
  }
});

// ── GET /governor/council-reports — تقارير مجلس الذكاء للإدارة ────────────────
// Admin-only: council reports are internal administration intelligence.
router.get("/governor/council-reports", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const { pool } = await import("../lib/db");
  if (!pool) { res.json({ reports: [] }); return; }
  try {
    const { rows: adminRows } = await pool.query(
      `SELECT is_admin FROM users WHERE id=$1`, [userId]);
    if (adminRows[0]?.is_admin !== true) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, headline, report, created_at FROM council_reports ORDER BY created_at DESC LIMIT 30`);
    res.json({ reports: rows });
  } catch {
    res.json({ reports: [] });
  }
});

export default router;
