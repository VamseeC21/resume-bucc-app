-- ========================================
-- MIGRATION: Editable deliberation notes + essay-choice visibility
-- ========================================
-- 1. set_round_candidate_notes - lets the committee type a scratch note per
--    candidate directly in the deliberation table (the `notes` column on
--    round_candidates already existed but nothing ever wrote to it).
-- 2. Surface applications.video_question_2_choice (which of question 2's two
--    prompts the applicant answered) in both deliberation RPCs, so the
--    committee knows what they're about to watch before clicking the link.

CREATE OR REPLACE FUNCTION public.set_round_candidate_notes(p_id UUID, p_notes TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
BEGIN
  SELECT rc.game_id INTO v_game_id FROM round_candidates rc WHERE rc.id = p_id;

  IF v_game_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR v_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to add notes for this game';
  END IF;

  UPDATE round_candidates
  SET notes = NULLIF(p_notes, ''), updated_at = now()
  WHERE id = p_id AND game_id = v_game_id;
END;
$$;

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
      'video_question_2_choice', a.video_question_2_choice,
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

CREATE OR REPLACE FUNCTION public.get_round_deliberation(p_game_id UUID, p_round TEXT)
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
    SELECT (elem.value->>'application_id')::uuid AS application_id, elem.rank::int AS application_rank
    FROM json_array_elements(COALESCE(v_rankings, '[]'::json)) WITH ORDINALITY AS elem(value, rank)
  ),
  score_agg AS (
    SELECT
      ist.application_id,
      AVG(ist.total_score)::DOUBLE PRECISION AS avg_score,
      COUNT(*)::INTEGER AS score_count,
      json_agg(
        json_build_object(
          'interviewer_id', ist.interviewer_id,
          'interviewer_name', COALESCE(NULLIF(TRIM(p.first_name || ' ' || COALESCE(p.last_name, '')), ''), 'Unknown'),
          'co_interviewer_name', ist.co_interviewer_name,
          'room_label', ist.room_label,
          'section_scores', ist.section_scores,
          'section_totals', ist.section_totals,
          'total_score', ist.total_score,
          'recommendation', ist.recommendation,
          'overall_impression', ist.overall_impression,
          'availability', ist.availability,
          'candidate_phone', ist.candidate_phone,
          'presentation_path', ist.presentation_path,
          'glaring_concerns', ist.glaring_concerns
        )
      ) AS details
    FROM interview_scores ist
    LEFT JOIN profiles p ON p.id = ist.interviewer_id
    WHERE ist.game_id = p_game_id AND ist.round = p_round
    GROUP BY ist.application_id
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
      'video_question_2_choice', a.video_question_2_choice,
      'resume_id', a.resume_id,
      'application_ranking', rl.application_rank,
      'was_in_r1', EXISTS (SELECT 1 FROM round_candidates x WHERE x.game_id = p_game_id AND x.round = 'R1' AND x.application_id = a.id),
      'was_in_r2', EXISTS (SELECT 1 FROM round_candidates x WHERE x.game_id = p_game_id AND x.round = 'R2' AND x.application_id = a.id),
      'color', rc.color,
      'sort_order', rc.sort_order,
      'notes', rc.notes,
      'avg_score', sa.avg_score,
      'score_count', sa.score_count,
      'scores', sa.details
    )
    ORDER BY rc.sort_order, a.submitted_at
  )
  INTO v_result
  FROM round_candidates rc
  JOIN applications a ON a.id = rc.application_id
  LEFT JOIN ranking_lookup rl ON rl.application_id = a.id
  LEFT JOIN score_agg sa ON sa.application_id = a.id
  WHERE rc.game_id = p_game_id AND rc.round = p_round;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
