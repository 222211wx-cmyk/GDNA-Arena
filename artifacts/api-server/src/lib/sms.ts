import { logger } from "./logger";

/**
 * SMS provider abstraction. Pick a provider with SMS_PROVIDER=twilio|vonage|mock.
 * Without SMS_PROVIDER the provider is inferred from credentials; with none it is
 * "mock" in development/test (the code is logged to the console) and "none" in
 * production (no message is ever faked in production).
 */
export interface SmsProvider {
  name: string;
  send(toE164: string, text: string): Promise<void>;
}

export const mockOutbox: Array<{ to: string; text: string; at: number }> = [];

const mockProvider: SmsProvider = {
  name: "mock",
  async send(to, text) {
    mockOutbox.push({ to, text, at: Date.now() });
    if (mockOutbox.length > 50) mockOutbox.shift();
    logger.warn({ to }, `[SMS:mock] ${text}`);
    console.log(`[SMS:mock] to=${to} :: ${text}`);
  },
};

function twilioProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  return {
    name: "twilio",
    async send(to, text) {
      const body = new URLSearchParams({ To: to, Body: text });
      if (service) body.set("MessagingServiceSid", service);
      else body.set("From", from!);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Twilio SMS failed (${res.status})`);
    },
  };
}

function vonageProvider(): SmsProvider {
  const apiKey = process.env.VONAGE_API_KEY!;
  const apiSecret = process.env.VONAGE_API_SECRET!;
  const from = process.env.VONAGE_FROM ?? "GDNA";
  return {
    name: "vonage",
    async send(to, text) {
      const res = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, from, to: to.replace(/^\+/, ""), text }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ status: string }> };
      if (!res.ok || data.messages?.[0]?.status !== "0") throw new Error("Vonage SMS failed");
    },
  };
}

export function getSmsProvider(): SmsProvider | null {
    const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID));
  const hasVonage = !!(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET);
  const wanted = (process.env.SMS_PROVIDER ?? "").toLowerCase();
  if (wanted === "twilio" && hasTwilio) return twilioProvider();
  if (wanted === "vonage" && hasVonage) return vonageProvider();
  if (wanted === "mock") return mockProvider;
  if (!wanted && hasTwilio) return twilioProvider();
  if (!wanted && hasVonage) return vonageProvider();
  // No credentials: fall back to the mock (OTP goes to the server log) so the
  // flows keep working. Real delivery needs TWILIO_* or VONAGE_* variables.
  return mockProvider;
}

/** True only when messages really reach a handset. */
export function smsIsReal(): boolean {
  const p = getSmsProvider();
  return !!p && p.name !== "mock";
}


