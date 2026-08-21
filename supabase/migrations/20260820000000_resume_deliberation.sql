-- ========================================
-- MIGRATION: Resume deliberation
-- ========================================
-- Adds a third "RESUME" round to round_candidates so the committee can
-- color-code / drag-reorder / deliberate on the resume+video pool the same
-- way they already do for R1/R2 interview rounds, before anyone is invited
-- to interview. Sourced from get_combined_rankings (ELO + video) rather than
-- interview_scores, since there is no interview data at this stage.

-- Step 1: allow round = 'RESUME' alongside 'R1'/'R2'
ALTER TABLE public.round_candidates DROP CONSTRAINT IF EXISTS round_candidates_round_check;
ALTER TABLE public.round_candidates ADD CONSTRAINT round_candidates_round_check
  CHECK (round IN ('RESUME', 'R1', 'R2'));

-- Step 2: RPC to fetch the resume round's deliberation data in one call:
-- every applicant seeded into round_candidates for round='RESUME', their
-- color/order, and their ELO/video/combined ranking data.
CREATE OR REPLACE FUNCTION public.get_resume_deliberation(p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_rankings JSON;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RETURN json_build_object('error', 'Not authorized');
  END IF;

  v_rankings := public.get_combined_rankings(p_game_id);

  WITH ranking_lookup AS (
    SELECT
      (elem->>'application_id')::uuid AS application_id,
      (elem->>'elo_rating')::DOUBLE PRECISION AS elo_rating,
      (elem->>'video_avg_score')::DOUBLE PRECISION AS video_avg_score,
      (elem->>'video_grade_count')::INTEGER AS video_grade_count,
      (elem->>'elo_normalized')::DOUBLE PRECISION AS elo_normalized,
      (elem->>'video_normalized')::DOUBLE PRECISION AS video_normalized,
      (elem->>'combined_score')::DOUBLE PRECISION AS combined_score
    FROM json_array_elements(COALESCE(v_rankings, '[]'::json)) AS elem
  )
  SELECT json_agg(
    json_build_object(
      'round_candidate_id', rc.id,
      'application_id', a.id,
      'candidate_number', a.candidate_number,
      'first_name', a.first_name,
      'last_name', a.last_name,
      'applicant_email', a.applicant_email,
      'year', a.year,
      'major', a.major,
      'gender', a.gender,
      'video_youtube_url', a.video_youtube_url,
      'resume_id', a.resume_id,
      'color', rc.color,
      'sort_order', rc.sort_order,
      'notes', rc.notes,
      'elo_rating', rl.elo_rating,
      'video_avg_score', rl.video_avg_score,
      'video_grade_count', rl.video_grade_count,
      'elo_normalized', rl.elo_normalized,
      'video_normalized', rl.video_normalized,
      'combined_score', rl.combined_score
    )
    ORDER BY rc.sort_order, a.submitted_at
  )
  INTO v_result
  FROM round_candidates rc
  JOIN applications a ON a.id = rc.application_id
  LEFT JOIN ranking_lookup rl ON rl.application_id = a.id
  WHERE rc.game_id = p_game_id AND rc.round = 'RESUME';

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
