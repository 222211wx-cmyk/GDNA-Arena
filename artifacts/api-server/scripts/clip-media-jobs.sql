-- Reviewed additive development schema only. Publish owns production promotion.
CREATE TABLE IF NOT EXISTS clip_media_jobs (
  session_id uuid PRIMARY KEY REFERENCES r2_clip_uploads(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  token uuid,
  error text,
  output_object text,
  retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_media_jobs_claim_idx ON clip_media_jobs(retry_at,session_id)
WHERE state IN ('queued','processing');