import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Run OpenAI moderation on any user-supplied text.
 * Returns { ok: true } if clean, { ok: false, reason } if flagged.
 * Fails open (ok: true) when OpenAI is unreachable so the app keeps running.
 */
export async function moderateText(
  text: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!process.env.OPENAI_API_KEY || !text?.trim()) return { ok: true };
  try {
    const resp = await openai.moderations.create({ input: text.slice(0, 2000) });
    const result = resp.results[0];
    if (result?.flagged) {
      const cats = Object.entries(result.categories)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ");
      return { ok: false, reason: cats };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // fail open — don't block the user if OpenAI is down
  }
}

/**
 * Block a list of keywords regardless of OpenAI availability.
 * Covers the most obvious offensive terms when the API is down.
 */
const BLOCKED_KEYWORDS = [
  "fuck", "shit", "bitch", "nigger", "faggot", "cunt", "whore", "slut",
  "terrorist", "kill yourself", "kys", "rape", "pedophile", "nazi",
  // Arabic
  "كلب", "عاهرة", "شرموطة", "منيوك", "كس", "زب", "طيز", "حقير",
  // French
  "putain", "salope", "enculé", "connard", "merde",
];

export function hasBlockedKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_KEYWORDS.some((kw) => lower.includes(kw));
}
