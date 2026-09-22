export const OPERATOR_SOURCES = ["inwi", "orange", "itissalat", "star6"] as const;
export type OperatorSource = typeof OPERATOR_SOURCES[number];
/** Each nonempty subgroup must meet k, preventing small-group disclosure. */
export function operatorAggregateThreshold(citizens: number, anonymous: number, k = 10): boolean {
  if (![citizens, anonymous, k].every(n => Number.isSafeInteger(n) && n >= 0) || k < 1) return false;
  return citizens + anonymous >= k && [citizens, anonymous].every(n => n === 0 || n >= k);
}
export const OPERATOR_DISCLAIMER = "Indicative user-supplied prices and *6# are unverified. Check the operator's official terms. No signed partnership and no claim that GDNA is included in any restricted bundle. Pay the operator directly. Affiliate revenue only under an actual agreement; no recruitment rewards or levels.";
export const OPERATOR_PRIVACY = "An HttpOnly SameSite session cookie deduplicates referrals and request samples. Analytics retain a hashed session identifier for 90 days; contact inquiries for 180 days. Public statistics are thresholded aggregates, never citizen names or contact details.";
export const OPERATOR_PACKS = [
  { id: "inwi", name: "inwi", priceMad: 20, officialUrl: "https://inwi.ma" },
  { id: "orange", name: "Orange", priceMad: 29, officialUrl: "https://orange.ma" },
  { id: "itissalat", name: "Maroc Telecom", priceMad: 25, officialUrl: "https://iam.ma" },
].map(pack => ({ ...pack, priceStatus: "unverified" as const, dialCode: "*6#", dialCodeVerified: false as const, partnershipStatus: "not_signed" as const }));

export const SCIENCE_SURFACES = ["lite", "clips", "citizens", "market", "profile", "chat"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unexpected fields");
  return value as Record<string, unknown>;
}
function eventId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("eventId must be a UUID");
  return value.toLowerCase();
}
export function parseOperatorReferral(value: unknown) {
  const v = object(value, ["source", "eventId"]);
  if (!OPERATOR_SOURCES.includes(v.source as OperatorSource)) throw new Error("Invalid source");
  return { source: v.source as OperatorSource, eventId: eventId(v.eventId) };
}
export function parseOperatorMeasurement(value: unknown) {
  const v = object(value, ["eventId", "surface", "outcome", "observedBytes", "clipId"]);
  if (!SCIENCE_SURFACES.includes(v.surface as typeof SCIENCE_SURFACES[number])) throw new Error("Invalid surface");
  if (!["success", "failure", "cache"].includes(v.outcome as string)) throw new Error("Invalid outcome");
  if (typeof v.observedBytes !== "number" || !Number.isSafeInteger(v.observedBytes) || v.observedBytes < 0 || v.observedBytes > 52_428_800) throw new Error("Invalid observedBytes");
  if (v.clipId !== undefined && (typeof v.clipId !== "number" || !Number.isInteger(v.clipId) || v.clipId < 1 || v.clipId > 2147483647)) throw new Error("Invalid clipId");
  if (v.clipId !== undefined && !["lite", "clips"].includes(v.surface as string)) throw new Error("clipId requires a clip surface");
  return { eventId: eventId(v.eventId), surface: v.surface as typeof SCIENCE_SURFACES[number], outcome: v.outcome as "success" | "failure" | "cache", observedBytes: v.observedBytes, clipId: v.clipId as number | undefined };
}
export function parsePartnerContact(value: unknown) {
  const v = object(value, ["company", "contactEmail", "message", "consent", "website"]);
  function text(key: string, min: number, max: number) {
    if (typeof v[key] !== "string") throw new Error(`Invalid ${key}`);
    const t = (v[key] as string).trim();
    if (t.length < min || t.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) throw new Error(`Invalid ${key}`);
    return t;
  }
  const company = text("company", 2, 120), contactEmail = text("contactEmail", 3, 254), message = text("message", 10, 3000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) || v.consent !== true || (v.website !== undefined && v.website !== "")) throw new Error("Consent, email or honeypot invalid");
  return { company, contactEmail, message };
}