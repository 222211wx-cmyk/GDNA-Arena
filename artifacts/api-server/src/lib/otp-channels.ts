import { logger } from "./logger";
import { getSmsProvider, mockOutbox, smsIsReal } from "./sms";

/** Delivery channels a citizen can pick each time a code is needed. Never remembered. */
export type OtpChannel = "sms" | "whatsapp" | "email";
export const OTP_CHANNELS: readonly OtpChannel[] = ["sms", "whatsapp", "email"];

export function isOtpChannel(value: unknown): value is OtpChannel {
  return typeof value === "string" && (OTP_CHANNELS as readonly string[]).includes(value);
}

const prod = () => process.env.NODE_ENV === "production";

function twilioCredentials(): { sid: string; token: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, token } : null;
}

/** Whether a channel can really deliver. Development always offers every channel (codes are logged). */
export function channelEnabled(channel: OtpChannel): boolean {
  if (!prod()) return true;
  if (channel === "sms") return smsIsReal();
  if (channel === "whatsapp") return !!twilioCredentials() && !!process.env.TWILIO_WHATSAPP_FROM;
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

/** Sends one code over the chosen channel. Throws when the provider call fails. */
export async function deliverOtp(channel: OtpChannel, destination: string, code: string): Promise<void> {
  const text = `GDNA Arena: ${code}`;
  const timeout = () => AbortSignal.timeout(10_000);
  if (channel === "sms") {
    const provider = getSmsProvider();
    if (!provider) throw new Error("no SMS provider");
    await provider.send(destination, text);
    return;
  }
  const twilio = twilioCredentials();
  if (channel === "whatsapp" && twilio && process.env.TWILIO_WHATSAPP_FROM) {
    const body = new URLSearchParams({
      To: `whatsapp:${destination}`, From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, Body: text,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${twilio.sid}:${twilio.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body, signal: timeout(),
    });
    if (!res.ok) throw new Error(`Twilio WhatsApp failed (${res.status})`);
    return;
  }
  if (channel === "email" && process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM, to: [destination],
        subject: "GDNA Arena verification code", text: `Your GDNA Arena code is ${code}. It expires in 10 minutes.`,
      }),
      signal: timeout(),
    });
    if (!res.ok) throw new Error(`Email delivery failed (${res.status})`);
    return;
  }
  // Only reachable outside production without credentials: the code goes to the mock outbox and the log.
  mockOutbox.push({ to: destination, text, at: Date.now() });
  if (mockOutbox.length > 50) mockOutbox.shift();
  logger.warn({ channel, to: destination }, `[OTP:mock:${channel}] ${text}`);
}

/** Emails a password-reset link. Returns false when email is not configured (nothing is sent). */
export async function sendResetEmail(to: string, link: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM, to: [to],
      subject: "GDNA Arena password reset",
      text: `Reset your GDNA Arena password with this link (valid 15 minutes):\n${link}\n\nIf you did not ask for this, ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Reset email failed (${res.status})`);
  return true;
}
