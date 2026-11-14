-- Reviewed additive development schema; Publish owns production promotion.
CREATE TABLE IF NOT EXISTS gdna_usage (
  day text NOT NULL, scope text NOT NULL, used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope)
);
CREATE TABLE IF NOT EXISTS gdna_memory (
  id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gdna_audit (
  id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent text NOT NULL, mode text NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gdna_evolution (
  id text PRIMARY KEY, agent text NOT NULL, summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);