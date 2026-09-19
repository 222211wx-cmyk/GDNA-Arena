export const CITIZEN_CITIES = ["Casablanca", "Rabat", "Marrakech", "Fes", "Tangier", "Agadir", "Meknes", "Oujda", "Tetouan", "Kenitra", "Safi", "El Jadida", "Nador", "Beni Mellal", "Taza", "Laayoune", "Dakhla", "Essaouira", "Ouarzazate", "Al Hoceima", "Ifrane", "Chefchaouen"];
export const CITIZEN_INTERESTS = ["Technology", "Music", "Sport", "Art", "Travel", "Reading", "Gaming", "Cooking", "Business", "Education", "Photography", "Volunteering", "Cinema", "Nature", "Culture"];
export const CITIZEN_FIELDS = ["city", "age", "bio", "interests", "avatarUrl", "coverUrl", "videos"];
export function canSeeCitizen(visibility: string, self: boolean, friend: boolean, blocked = false): boolean {
  return !blocked && (self || visibility === "everyone" || (visibility === "friends" && friend));
}
export function citizenFieldVisible(visibility: string, fieldVisibility: string | undefined, self: boolean, friend: boolean, blocked = false): boolean {
  return canSeeCitizen(visibility, self, friend, blocked) && canSeeCitizen(fieldVisibility ?? "everyone", self, friend, blocked);
}
export function citizenCompatibility(a: { city: string | null; interests: string[] }, b: { city: string | null; interests: string[] }) {
  const shared = a.interests.filter(i => b.interests.includes(i));
  const union = new Set([...a.interests, ...b.interests]).size;
  const sameCity = Boolean(a.city && a.city === b.city);
  return {
    percent: Math.round((union ? shared.length / union * 80 : 0) + (sameCity ? 20 : 0)),
    explanation: `${shared.length} shared interests (${union ? Math.round(shared.length / union * 80) : 0}/80 points); ${sameCity ? "same visible city (20/20)" : "no shared visible city (0/20)"}. A simple heuristic, not AI inference or a prediction of a relationship.`,
    method: "shared-interests-city-heuristic" as const,
  };
}
export function assistantConsentAllowed(savedConsent: boolean, requestConsent: boolean, section: string, text?: string) {
  return savedConsent && requestConsent && (!["translate", "auto-reply"].includes(section) || Boolean(text?.trim()));
}
export function citizenImageType(bytes: Buffer): string | null {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) return "image/webp";
  return null;
}