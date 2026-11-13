import { Router, type IRouter } from "express";
import { GDNA_CORE } from "../lib/gdna";
import { gdnaAuth, gdnaLimited } from "./gdna";

const router: IRouter = Router();
// Preserve legacy JSON/SSE envelopes, but never accept caller-provided roles/history.
for (const path of ["/chat", "/chat/stream"]) {
  router.post(path, gdnaAuth, gdnaLimited, async (req, res) => {
    if (typeof req.body?.message !== "string" || !req.body.message.trim() || req.body.message.length > 4000) {
      res.status(400).json({ error: "Message must be 1–4000 characters" }); return;
    }
    try {
      const answer = await GDNA_CORE.ask(req.body.message, { section: "hisn", user: req.session.userId! });
      if (path === "/chat") { res.json(answer); return; }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.write(`data: ${JSON.stringify({ delta: answer.reply, mode: answer.mode, usage: answer.usage })}\n\n`);
      res.end("data: [DONE]\n\n");
    } catch { res.status(503).json({ error: "GDNA knowledge or storage unavailable" }); }
  });
}
export default router;
