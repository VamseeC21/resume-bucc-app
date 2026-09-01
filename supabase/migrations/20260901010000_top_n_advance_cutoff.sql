-- ========================================
-- MIGRATION: Configurable top-N advance cutoff, replacing the color gate
-- ========================================
-- get_interview_roster() (see 20260901000000) gated eligibility on
-- dark-green/green deliberation color. The committee wants something more
-- direct instead: type a number on each deliberation page ("top N advance"),
-- and whoever sits in the top N of that round's CURRENT order
-- (round_candidates.sort_order -- i.e. whatever the committee last dragged
-- it to, or the score sort if untouched) advances. Color-coding stays as a
-- free-form bucketing/notes tool for the committee; it no longer gates
-- anything.

CREATE TABLE IF NOT EXISTS public.round_cutoffs (
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  round TEXT NOT NULL CHECK (round IN ('RESUME', 'R1', 'R2')),
  advance_count INTEGER CHECK (advance_count IS NULL OR advance_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, round)
);

ALTER TABLE public.round_cutoffs ENABLE ROW LEVEL SECURITY;

-- All reads/writes go through the SECURITY DEFINER RPCs below (same
-- convention as round_candidates), so this SELECT policy just lets the
-- dashboard query the table directly too if that's ever useful.
DROP POLICY IF EXISTS "Admins and game creators can read round cutoffs" ON public.round_cutoffs;
CREATE POLICY "Admins and game creators can read round cutoffs"
  ON public.round_cutoffs FOR SELECT
  USING (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.get_round_cutoffs(p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RETURN json_build_object('error', 'Not authorized');
  END IF;

  SELECT COALESCE(json_object_agg(round, advance_count), '{}'::json)
  INTO v_result
  FROM round_cutoffs
  WHERE game_id = p_game_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_round_advance_count(p_game_id UUID, p_round TEXT, p_count INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to set the advance count for this game';
  END IF;

  IF p_round NOT IN ('RESUME', 'R1', 'R2') THEN
    RAISE EXCEPTION 'Unknown round: %', p_round;
  END IF;

  INSERT INTO round_cutoffs (game_id, round, advance_count, updated_at)
  VALUES (p_game_id, p_round, p_count, now())
  ON CONFLICT (game_id, round) DO UPDATE
    SET advance_count = EXCLUDED.advance_count, updated_at = now();
END;
$$;

-- Replace the color-based gate with a rank-based one: eligible = sits within
-- the top advance_count of the prior round's current sort_order. No cutoff
-- configured yet -> nobody eligible (forces the admin to set N first, same
-- "not decided yet" behavior the color gate had for uncolored candidates).
CREATE OR REPLACE FUNCTION public.get_interview_roster(p_game_id UUID, p_round TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_round TEXT;
  v_advance_count INTEGER;
  v_result JSON;
BEGIN
  IF NOT (
    p_game_id IN (SELECT game_id FROM game_members WHERE user_id = auth.uid())
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RETURN json_build_object('error', 'Not authorized');
  END IF;

  v_prior_round := CASE p_round WHEN 'R1' THEN 'RESUME' WHEN 'R2' THEN 'R1' ELSE NULL END;
  IF v_prior_round IS NULL THEN
    RETURN json_build_object('error', 'Unknown round');
  END IF;

  SELECT advance_count INTO v_advance_count
  FROM round_cutoffs WHERE game_id = p_game_id AND round = v_prior_round;

  IF v_advance_count IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    WITH ranked AS (
      SELECT rc.application_id, ROW_NUMBER() OVER (ORDER BY rc.sort_order) AS rnk
      FROM round_candidates rc
      WHERE rc.game_id = p_game_id AND rc.round = v_prior_round
    )
    SELECT COALESCE(json_agg(
      json_build_object(
        'id', a.id,
        'candidate_number', a.candidate_number,
        'first_name', a.first_name,
        'last_name', a.last_name,
        'applicant_name', a.applicant_name,
        'applicant_email', a.applicant_email,
        'year', a.year,
        'major', a.major,
        'resume_id', a.resume_id
      )
      ORDER BY a.candidate_number
    ), '[]'::json)
    FROM applications a
    JOIN ranked r ON r.application_id = a.id AND r.rnk <= v_advance_count
    WHERE a.game_id = p_game_id
  );
END;
$$;
