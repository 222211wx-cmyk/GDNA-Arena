import { randomBytes } from "node:crypto";
import { pool as nullablePool } from "@workspace/db";
import { logger } from "./logger";

const pool = nullablePool!;

/**
 * The Developer particle. Same family as the seven Archon dimensions
 * (volontas, resilentia, ...), but stored in its own table so it can never
 * disturb archon_sessions, which production keeps additive-only.
 */
export const DEVELOPER_PARTICLE = {
  key: "fabrica",
  label: "FABRICA",
  ar: "قوة البناء",
  fr: "Puissance de construction",
  en: "Power to build",
  value: 100,
} as const;

export interface DeveloperParticle {
  key: string; label: string; ar: string; fr: string; en: string; value: number; grantedAt: string;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS developer_particles (
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    particle   text NOT NULL,
    value      integer NOT NULL DEFAULT 100,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, particle)
  );
  CREATE TABLE IF NOT EXISTS auth_pending_signups (
    challenge_id  text PRIMARY KEY,
    email         text NOT NULL,
    username      text NOT NULL,
    password_hash text NOT NULL,
    phone_e164    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS auth_pending_signups_email_idx ON auth_pending_signups (LOWER(email));
`;

/**
 * Idempotent, additive-only. Created lazily on first use and retried after a
 * failure, so it works whether it runs before or after the base tables exist.
 */
let schemaPromise: Promise<void> | null = null;
export function developerSchemaReady(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool.query(SCHEMA_SQL).then(() => undefined, err => {
      schemaPromise = null;
      logger.error({ err }, "developer schema bootstrap failed");
      throw err;
    });
  }
  return schemaPromise;
}

export async function getDeveloperParticle(userId: number): Promise<DeveloperParticle | null> {
  await developerSchemaReady();
  const r = await pool.query(
    `SELECT particle, value, granted_at FROM developer_particles WHERE user_id=$1 AND particle=$2`,
    [userId, DEVELOPER_PARTICLE.key]);
  if (!r.rows[0]) return null;
  const { key, label, ar, fr, en } = DEVELOPER_PARTICLE;
  return { key, label, ar, fr, en, value: r.rows[0].value, grantedAt: new Date(r.rows[0].granted_at).toISOString() };
}

/**
 * Baseline Archon row for a new citizen (the seven dimensions start at their
 * column defaults and are filled in by the initiation assessment). Best effort:
 * the account is already created, so a legacy table shape must not undo it.
 */
export async function createBaselineArchonSession(userId: number): Promise<void> {
  try {
    const exists = await pool.query(`SELECT 1 FROM archon_sessions WHERE user_id=$1 LIMIT 1`, [userId]);
    if (exists.rowCount) return;
    const code = `ARCH-DEV${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}-NEW`;
    await pool.query(
      `INSERT INTO archon_sessions (user_id, archon_code, archetype, is_active) VALUES ($1,$2,'THE SEEKER',true)`,
      [userId, code]);
  } catch (err) {
    logger.error({ err, userId }, "baseline archon session failed (account kept)");
  }
}
