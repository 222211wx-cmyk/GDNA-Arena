// ─── نظام المستويات — Empire Levels System ───────────────────────────────────
// Level is derived from XP (never stored, so it can never drift out of sync).
// Each level grants perks: a badge, exclusive GIF access, and an earnings
// multiplier applied on top of the admin-configured base rates.

import { pool } from "@workspace/db";

export interface EmpireLevel {
  level: number;
  name: string;        // Arabic name
  icon: string;        // badge symbol
  minXp: number;
  nextXp: number | null; // XP needed for next level (null = max level)
  multiplier: number;  // earnings multiplier (1.0 = base rate)
  gifLimit: number;    // GIF search results allowed
  gifExclusive: boolean; // access to exclusive (stickers) GIF collections
}

const LEVELS: Omit<EmpireLevel, "nextXp">[] = [
  { level: 1, name: "مبتدئ",  icon: "🌱", minXp: 0,    multiplier: 1.0,  gifLimit: 12, gifExclusive: false },
  { level: 2, name: "محترف",  icon: "⚔️", minXp: 101,  multiplier: 1.25, gifLimit: 18, gifExclusive: false },
  { level: 3, name: "خبير",   icon: "🏆", minXp: 501,  multiplier: 1.5,  gifLimit: 24, gifExclusive: true },
  { level: 4, name: "أسطورة", icon: "👑", minXp: 2001, multiplier: 2.0,  gifLimit: 36, gifExclusive: true },
];

export function getLevel(xp: number): EmpireLevel {
  const x = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let idx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (x >= LEVELS[i].minXp) { idx = i; break; }
  }
  const next = LEVELS[idx + 1] ?? null;
  return { ...LEVELS[idx], nextXp: next ? next.minXp : null };
}

export function allLevels(): EmpireLevel[] {
  return LEVELS.map((l, i) => ({ ...l, nextXp: LEVELS[i + 1]?.minXp ?? null }));
}

/** Earnings multiplier for a user id; falls back to 1.0 on any failure. */
export async function multiplierForUserId(userId: number): Promise<number> {
  try {
    const { rows } = await pool.query<{ xp: number }>(`SELECT xp FROM users WHERE id=$1`, [userId]);
    return rows[0] ? getLevel(rows[0].xp ?? 0).multiplier : 1.0;
  } catch { return 1.0; }
}

/** Earnings multiplier for a username; falls back to 1.0 on any failure. */
export async function multiplierForUsername(username: string): Promise<number> {
  try {
    const { rows } = await pool.query<{ xp: number }>(`SELECT xp FROM users WHERE username=$1`, [username]);
    return rows[0] ? getLevel(rows[0].xp ?? 0).multiplier : 1.0;
  } catch { return 1.0; }
}
