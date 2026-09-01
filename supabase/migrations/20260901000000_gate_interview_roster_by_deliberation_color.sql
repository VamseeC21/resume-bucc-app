-- ========================================
-- MIGRATION: Gate interview roster by prior-round deliberation color
-- ========================================
-- Interview Scoring previously listed every applicant in the game for both
-- R1 and R2, with no notion of "did this person actually advance." That let
-- anyone be graded in R2 even if they were never passed out of R1 (or R1
-- even if never passed out of resume screening).
--
-- The deliberation board's color-coding is already the tool the committee
-- uses to record that decision (dark-green = guaranteed/accept, green =
-- leaning yes), so this reuses it as the gate rather than adding a new
-- status field: a candidate is eligible for R1 only if their RESUME-round
-- round_candidates.color is dark-green/green, and eligible for R2 only if
-- their R1-round color is dark-green/green.
--
-- get_interview_roster() is SECURITY DEFINER because round_candidates is
-- currently only readable by admins/game-creators (see
-- 20260819010000_interview_scoring_and_deliberation.sql), and interview
-- scoring needs to be usable by any game member, not just admins.

CREATE OR REPLACE FUNCTION public.get_interview_roster(p_game_id UUID, p_round TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_round TEXT;
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
  INTO v_result
  FROM applications a
  JOIN round_candidates rc
    ON rc.application_id = a.id
   AND rc.game_id = p_game_id
   AND rc.round = v_prior_round
   AND rc.color IN ('dark-green', 'green')
  WHERE a.game_id = p_game_id;

  RETURN v_result;
END;
$$;
