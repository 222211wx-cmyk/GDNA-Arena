import pg from "pg";
if (process.env.NODE_ENV === "production") throw new Error("Development only. Publish owns production schema.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  // Reviewed additive statements only: no drops, no unrelated objects, no startup replay.
  await client.query(`
    CREATE TABLE IF NOT EXISTS citizen_profiles (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name text NOT NULL DEFAULT '', bio text NOT NULL DEFAULT '', city text,
      interests jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'private',
      visibility text NOT NULL DEFAULT 'everyone', field_visibility jsonb NOT NULL DEFAULT '{}',
      avatar_url text, cover_url text, map_discoverable boolean NOT NULL DEFAULT false,
      ai_consent boolean NOT NULL DEFAULT false, views integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS citizen_listings (
      id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL, title text NOT NULL, description text NOT NULL,
      price numeric(12,2) NOT NULL, city text, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query("COMMIT");
  process.stdout.write("Citizen additive development schema applied.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { await client.end(); }