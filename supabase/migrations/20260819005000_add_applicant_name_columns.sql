-- ========================================
-- MIGRATION: Sync applicant first/last name columns
-- ========================================
-- applications.first_name / last_name were added by hand in the Supabase
-- dashboard at some point (the frontend has sent them since Apply.tsx and
-- Admin.tsx both reference them), but no migration ever captured that
-- change, so the repo's schema silently drifted from what's actually live.
--
-- On production these columns already exist and are already populated, so
-- this migration is effectively a no-op there (IF NOT EXISTS / WHERE
-- first_name IS NULL guards make sure nothing gets overwritten). On a fresh
-- local/dev database it brings the schema in line with what the frontend
-- has always assumed.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Best-effort backfill for any row that predates these columns: split
-- applicant_name on the first space. Only touches rows where first_name is
-- still NULL, so already-populated (production) rows are left untouched.
UPDATE public.applications
SET
  first_name = COALESCE(NULLIF(split_part(applicant_name, ' ', 1), ''), applicant_name),
  last_name = NULLIF(substring(applicant_name FROM position(' ' IN applicant_name) + 1), '')
WHERE first_name IS NULL AND applicant_name IS NOT NULL;

ALTER TABLE public.applications
  ALTER COLUMN first_name SET NOT NULL;
