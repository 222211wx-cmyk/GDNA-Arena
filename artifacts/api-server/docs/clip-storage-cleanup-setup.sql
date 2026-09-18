-- Optional, manual provisioning for separately reviewed orphan cleanup.
-- Run this file as the owner of public.clips with every API and worker replica
-- quiesced. The application does not run this file at startup.

BEGIN;

-- Fail rather than installing the publication guard against a moving table.
LOCK TABLE public.clips IN ACCESS EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.clip_storage_owner (
  singleton boolean PRIMARY KEY CHECK (singleton = true),
  database_id uuid UNIQUE NOT NULL,
  database_name text NOT NULL,
  bucket text NOT NULL,
  prefix text NOT NULL,
  marker_name text NOT NULL,
  marker_generation text NOT NULL,
  approval_public_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.clip_orphan_cleanup (
  object_name text PRIMARY KEY,
  generation text NOT NULL,
  approval_sha256 text NOT NULL,
  report_sha256 text NOT NULL,
  approval jsonb NOT NULL,
  expected jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'deleted', 'rejected')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_outcome text
);

CREATE TABLE IF NOT EXISTS public.clip_orphan_cleanup_audit (
  id bigserial PRIMARY KEY,
  object_name text,
  approval_sha256 text NOT NULL,
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  db_actor text NOT NULL DEFAULT session_user
);

CREATE INDEX IF NOT EXISTS clip_orphan_cleanup_due_idx
  ON public.clip_orphan_cleanup (retry_at, object_name)
  WHERE state = 'pending';

CREATE OR REPLACE FUNCTION public.reject_clip_orphan_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.clip_orphan_cleanup AS tombstone
    WHERE tombstone.object_name = NEW.object_name
       OR tombstone.object_name = NEW.thumbnail_object_name
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'clip object name is reserved by reviewed orphan cleanup';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_clip_orphan_tombstone() FROM PUBLIC;

DROP TRIGGER IF EXISTS clips_reject_orphan_tombstone ON public.clips;
CREATE TRIGGER clips_reject_orphan_tombstone
BEFORE INSERT OR UPDATE OF object_name, thumbnail_object_name
ON public.clips
FOR EACH ROW
EXECUTE FUNCTION public.reject_clip_orphan_tombstone();
ALTER TABLE public.clips ENABLE ALWAYS TRIGGER clips_reject_orphan_tombstone;

-- Defaults grant PUBLIC no table DML, but make that invariant explicit.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.clip_storage_owner FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.clip_orphan_cleanup FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.clip_orphan_cleanup_audit FROM PUBLIC;
REVOKE USAGE, UPDATE
  ON SEQUENCE public.clip_orphan_cleanup_audit_id_seq FROM PUBLIC;

COMMIT;
