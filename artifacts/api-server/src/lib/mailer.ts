import { logger } from "./logger";

// ── Email delivery for verification codes ────────────────────────────────
// Provider-agnostic: when an email connector (e.g. Resend) is connected,
// wire it inside `deliver()`. Until then, dev mode logs the code so the
// flow stays fully testable; production returns sent:false and the API
// tells the citizen delivery is temporarily unavailable.

export interface SendResult {
  sent: boolean;
}

async function deliver(_to: string, _subject: string, _text: string): Promise<boolean> {
  // No email provider connected yet.
  return false;
}

// True once a real provider is wired into deliver(). While false, the auth
// routes skip email verification in production entirely (accounts register
// as verified, like before) so citizens can never get locked out by an
// unsendable code.
export function isMailerConfigured(): boolean {
  return false;
}

export async function sendVerificationEmail(to: string, code: string): Promise<SendResult> {
  const subject = "👑 GDNA Arena — كود التحقق ديالك | Votre code de vérification";
  const text =
    `كود التحقق ديالك هو: ${code}\n` +
    `Votre code de vérification est : ${code}\n\n` +
    `الكود صالح لمدة 10 دقائق — Ce code expire dans 10 minutes.\n\n— GDNA Arena 👑`;

  const ok = await deliver(to, subject, text).catch((err) => {
    logger.error(err, "Verification email delivery failed");
    return false;
  });

  if (!ok && process.env.NODE_ENV !== "production") {
    // Dev fallback: surface the code in server logs so the flow is testable.
    logger.info({ to, code }, "[DEV ONLY] Email verification code");
    return { sent: true };
  }
  return { sent: ok };
}
