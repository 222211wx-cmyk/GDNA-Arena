import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── EMPIRE ETERNAL — Allowed content domains ──────────────────────────────────
// Only Education, Sports, Science, Art, Business, Debates are permitted.
const ALLOWED_DOMAINS = new Set([
  "education", "sport", "sports", "science", "art", "business",
  "debate", "debates", "achievement", "achievements", "tech",
  "music", "cinema", "culture", "lecture", "general",
]);

// Posts under this threshold are flagged as trivial
const MIN_MEANINGFUL_LENGTH = 15;

// Trivial spam patterns — blocked by the ANTI-TRIVIAL CONTENT FILTER
const TRIVIAL_PATTERNS = [
  /^(lol|lmao|haha|hehe|ok|yes|no|wow|omg|nice|good|great|cool|test|hi|hello|hey|sup|yo|yep|nope|true|false|sure|okay|k|kk|lol+|lmao+)\.?[!?]*$/i,
  /^(.)\1{4,}$/, // "aaaaa", ".....", "!!!!!!" etc.
  /^\W+$/,       // only symbols / emojis
  /^(first|first!|1st|gg|ez|wp|rekt|noob|based|cringe|mid|ratio|L|W)\.?!?$/i,
  /^.{1,4}$/,    // anything under 5 chars
];

// Meme/trash content patterns — hard blocked
const MEME_TRASH_PATTERNS = [
  /\b(meme|dank meme|bruh|sigma|alpha male|chad|soy|cope|seethe|rent free|touch grass|skill issue|sus|amogus|among us|based and|redpilled)\b/i,
  /\b(sheesh|no cap|fr fr|bussin|slay queen|ate that|understood the assignment|hits different|lowkey highkey|period\.?\s*bestie|it's giving)\b/i,
  /😂{3,}|💀{2,}|🤣{3,}/, // excessive laugh emojis = meme content
];

/**
 * ANTI-TRIVIAL CONTENT FILTER — EMPIRE ETERNAL GUARDIAN
 * OpenAI moderation + keyword block + trivial check + meme filter.
 * Returns { ok: true } if content passes, { ok: false, reason } if rejected.
 * Fails open (ok: true) when OpenAI is unreachable.
 */
export async function moderateText(
  text: string,
  options?: { allowTrivial?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  if (!text?.trim()) return { ok: false, reason: "Empty content" };

  const trimmed = text.trim();

  // Anti-trivial: minimum length
  if (!options?.allowTrivial && trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return { ok: false, reason: "Content too short — the Empire demands substance. Share something meaningful (15+ characters)." };
  }

  // Anti-trivial: pattern match
  if (!options?.allowTrivial && TRIVIAL_PATTERNS.some(p => p.test(trimmed))) {
    return { ok: false, reason: "Trivial content is not permitted in the Empire. Add depth to your message." };
  }

  // Anti-meme / anti-trash filter
  if (MEME_TRASH_PATTERNS.some(p => p.test(trimmed))) {
    return { ok: false, reason: "Meme/trash content is not allowed. The Empire only accepts Education, Sports, Science, Art, Business, and meaningful Debates." };
  }

  if (!process.env.OPENAI_API_KEY) return { ok: true };

  try {
    const resp = await openai.moderations.create({ input: trimmed.slice(0, 2000) });
    const result = resp.results[0];
    if (result?.flagged) {
      const cats = Object.entries(result.categories)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ");
      return { ok: false, reason: `Blocked by content guardian: ${cats}` };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // fail open — never block because of API downtime
  }
}

/**
 * Validate that a post belongs to an allowed domain.
 * Only Education, Sports, Science, Art, Business, Debates, Achievements are permitted.
 */
export function isDomainAllowed(domain: string): boolean {
  return ALLOWED_DOMAINS.has(domain.toLowerCase());
}

/**
 * Hardcoded keyword block list — checked before OpenAI, no exceptions.
 */
const BLOCKED_KEYWORDS = [
  // English
  "fuck", "shit", "bitch", "nigger", "faggot", "cunt", "whore", "slut",
  "terrorist", "kill yourself", "kys", "rape", "pedophile", "nazi",
  "sex tape", "porn", "onlyfans", "nude", "naked",
  // Arabic
  "كلب", "عاهرة", "شرموطة", "منيوك", "كس", "زب", "طيز", "حقير", "ابن الشرموطة",
  // French
  "putain", "salope", "enculé", "connard", "merde", "va te faire",
];

export function hasBlockedKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Full content validation — run all checks in one call.
 * Returns { ok, reason } — reason is user-facing.
 */
export async function validateContent(text: string, options?: { allowTrivial?: boolean }) {
  if (!text?.trim()) return { ok: false, reason: "Content cannot be empty." };
  if (hasBlockedKeyword(text)) return { ok: false, reason: "Prohibited content detected by the Empire Guardian." };
  return moderateText(text, options);
}
