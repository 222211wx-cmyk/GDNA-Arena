/**
 * LEGAL CONSENT API
 * POST /api/legal/consent — persist user's country + consent level
 * GET  /api/legal/consent — retrieve current user's consent record
 */
import { Router } from "express";
import { pool } from "../lib/db";

const router = Router();

// Ensure table exists on first use
async function ensureLegalTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_legal_consents (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER,          -- NULL for anonymous users
      session_id    TEXT,             -- for non-logged-in users
      country_code  TEXT NOT NULL DEFAULT 'INT',
      consent_level TEXT NOT NULL DEFAULT 'none',  -- none | essential | full
      ip_country    TEXT,             -- country detected from IP
      restriction   TEXT,             -- allowed | restricted | blocked
      consented_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_legal_consents_user
    ON user_legal_consents(user_id) WHERE user_id IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_legal_consents_session
    ON user_legal_consents(session_id) WHERE session_id IS NOT NULL
  `);
}

ensureLegalTable().catch(console.error);

// ── POST /api/legal/consent ───────────────────────────────────
router.post("/consent", async (req, res): Promise<void> => {
  const { countryCode, consentLevel, ipCountry, restriction } = req.body as {
    countryCode?: string;
    consentLevel?: string;
    ipCountry?: string;
    restriction?: string;
  };

  if (!countryCode || !consentLevel) {
    res.status(400).json({ error: "countryCode and consentLevel are required" });
    return;
  }

  const validLevels = ["none", "essential", "full"];
  if (!validLevels.includes(consentLevel)) {
    res.status(400).json({ error: "Invalid consentLevel" });
    return;
  }

  const userId: number | null = (req.session as { userId?: number }).userId ?? null;
  const sessionId = req.sessionID ?? null;

  try {
    if (userId) {
      // Upsert by user_id
      await pool.query(`
        INSERT INTO user_legal_consents (user_id, session_id, country_code, consent_level, ip_country, restriction, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET country_code  = EXCLUDED.country_code,
              consent_level = EXCLUDED.consent_level,
              ip_country    = EXCLUDED.ip_country,
              restriction   = EXCLUDED.restriction,
              updated_at    = NOW()
      `, [userId, sessionId, countryCode, consentLevel, ipCountry ?? null, restriction ?? null]);
    } else {
      // Upsert by session_id
      await pool.query(`
        INSERT INTO user_legal_consents (user_id, session_id, country_code, consent_level, ip_country, restriction, updated_at)
        VALUES (NULL, $1, $2, $3, $4, $5, NOW())
        ON CONFLICT (session_id) DO UPDATE
          SET country_code  = EXCLUDED.country_code,
              consent_level = EXCLUDED.consent_level,
              ip_country    = EXCLUDED.ip_country,
              restriction   = EXCLUDED.restriction,
              updated_at    = NOW()
      `, [sessionId, countryCode, consentLevel, ipCountry ?? null, restriction ?? null]);
    }

    res.json({ ok: true, saved: { countryCode, consentLevel, restriction } });
  } catch {
    // Non-fatal — consent is also stored client-side in localStorage
    res.json({ ok: true, saved: { countryCode, consentLevel }, note: "DB write skipped" });
  }
});

// ── GET /api/legal/consent ────────────────────────────────────
router.get("/consent", async (req, res): Promise<void> => {
  const userId: number | null = (req.session as { userId?: number }).userId ?? null;
  const sessionId = req.sessionID ?? null;

  try {
    const result = userId
      ? await pool.query(`SELECT * FROM user_legal_consents WHERE user_id = $1 LIMIT 1`, [userId])
      : await pool.query(`SELECT * FROM user_legal_consents WHERE session_id = $1 LIMIT 1`, [sessionId]);

    res.json(result.rows[0] ?? null);
  } catch {
    res.json(null);
  }
});

export default router;
