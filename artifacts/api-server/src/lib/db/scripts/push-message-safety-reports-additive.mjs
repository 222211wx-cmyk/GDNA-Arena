import pg from "pg";

// Manual development-only additive application. Replit Publish owns production.
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Development-only schema script: set NODE_ENV=development outside deployments. Publish owns production schema.");
}
if (!process.env.DATABASE_URL) throw new Error("Development DATABASE_URL is required.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS public.dm_safety_reports (
    id BIGSERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES public.dm_rooms(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(room_id, reporter_id)
  )`);
  await client.query("COMMIT");
  console.log("Development dm_safety_reports additive schema applied; no other tables changed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}