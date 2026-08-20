const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeBirthDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }

  const today = new Date();
  const todayIso = [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    String(today.getUTCDate()).padStart(2, "0"),
  ].join("-");

  if (value > todayIso || parsed.getUTCFullYear() < 1900) return null;
  return value;
}

export function ageFromBirthDate(birthDate: string | Date | null | undefined): number | null {
  if (!birthDate) return null;

  const parsed = birthDate instanceof Date
    ? birthDate
    : new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - parsed.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }

  return age;
}

export function isAdultForGames(birthDate: string | Date | null | undefined): boolean | null {
  const age = ageFromBirthDate(birthDate);
  return age === null ? null : age >= 18;
}