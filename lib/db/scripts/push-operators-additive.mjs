import pg from "pg";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Development-only additive schema. Publish owns production schema.");
}
if (!process.env.DATABASE_URL) throw new Error("Development DATABASE_URL required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS operator_events (
    day TEXT NOT NULL, session_hash TEXT NOT NULL, kind TEXT NOT NULL, event_id UUID NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, surface TEXT, outcome TEXT,
    observed_bytes BIGINT NOT NULL DEFAULT 0, avoided_bytes BIGINT NOT NULL DEFAULT 0,
    comparison BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(day,session_hash,kind,event_id)
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS operator_events_user_day_idx ON operator_events(user_id,day)");
  await client.query(`CREATE TABLE IF NOT EXISTS operator_attributions (
    session_hash TEXT PRIMARY KEY, source TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS operator_quotas (
    day TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(day,scope,kind)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS partner_contacts (
    id SERIAL PRIMARY KEY, company TEXT NOT NULL, contact_email TEXT NOT NULL, message TEXT NOT NULL,
    consent BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS operator_audio_receipts (
    id UUID PRIMARY KEY, session_hash TEXT NOT NULL, clip_id INTEGER NOT NULL,
    original_bytes BIGINT NOT NULL, alternative_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS operator_audio_receipts_session_clip_idx ON operator_audio_receipts(session_hash,clip_id)");
  await client.query("COMMIT");
  console.log("Development operator schema applied additively; no existing data changed.");
} catch (e) { await client.query("ROLLBACK"); throw e; } finally { await client.end(); }