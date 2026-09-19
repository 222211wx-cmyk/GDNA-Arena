-- Reviewed, targeted constraint widening: no data/columns/tables/sequences removed.
-- Development only. Replit Publish owns production schema promotion.
BEGIN;
ALTER TABLE r2_clip_uploads DROP CONSTRAINT IF EXISTS r2_clip_uploads_size_bytes_check;
ALTER TABLE r2_clip_uploads ADD CONSTRAINT r2_clip_uploads_size_bytes_check
  CHECK (size_bytes > 0 AND size_bytes <= 10737418240);
COMMIT;