CREATE TABLE IF NOT EXISTS royal_verifications (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  bank_holder_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  encrypted_bank_payload TEXT NOT NULL,
  masked_account TEXT NOT NULL,
  id_object_name TEXT NOT NULL,
  id_mime_type TEXT NOT NULL,
  name_matches BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  earnings_frozen BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS royal_verifications_status_idx ON royal_verifications(status, created_at DESC);