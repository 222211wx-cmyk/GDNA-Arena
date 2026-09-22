-- Reviewed additive DEVELOPMENT schema only. Publish manages production.
CREATE TABLE IF NOT EXISTS clip_lite_media (
  clip_id integer NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL DEFAULT now(),
  source_object text,
  output_object text,
  mirror_object text,
  sha256 text,
  size_bytes integer,
  mime text,
  duration_sec double precision,
  mirror_verified_at timestamptz,
  error text,
  PRIMARY KEY (clip_id,kind)
);
CREATE INDEX IF NOT EXISTS clip_lite_media_due ON clip_lite_media(retry_at,clip_id);