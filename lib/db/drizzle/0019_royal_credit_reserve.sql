CREATE TABLE royal_credit_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  paid_seconds BIGINT NOT NULL DEFAULT 0 CHECK (paid_seconds >= 0 AND paid_seconds <= 31536000),
  reserve_seconds BIGINT NOT NULL DEFAULT 0 CHECK (reserve_seconds >= 0 AND reserve_seconds <= 7200),
  reserve_expires_at TIMESTAMPTZ,
  debt_minor BIGINT NOT NULL DEFAULT 0 CHECK (debt_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE royal_credit_idempotency (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('reserve', 'repay')),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, action, idempotency_key)
);

CREATE TABLE debt_log (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_minor BIGINT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('reserve_granted', 'debt_repaid', 'call_usage')),
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX debt_log_user_created_idx ON debt_log(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_debt_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'debt_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER debt_log_no_update
BEFORE UPDATE OR DELETE ON debt_log
FOR EACH ROW EXECUTE FUNCTION reject_debt_log_mutation();