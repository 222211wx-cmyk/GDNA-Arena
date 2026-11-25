// Connector: Telegram. Bot API accepts documents up to 50 MB (Telegram limit).
const LIMIT = 50 * 1024 * 1024;
export default {
  name: "telegram",
  envVars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  configured: () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  async send(ctx) {
    if (ctx.size > LIMIT) throw new Error("Telegram bot uploads are limited to 50 MB (Telegram limit)");
    const form = new FormData();
    form.set("chat_id", process.env.TELEGRAM_CHAT_ID);
    form.set("document", new Blob([await ctx.read()], { type: ctx.contentType || "application/octet-stream" }), ctx.fileName);
    const base = process.env.TELEGRAM_API_URL || "https://api.telegram.org";
    const r = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${r.status}: ${j.description ?? "send failed"}`);
    return { ok: true, messageId: j.result?.message_id };
  },
};
