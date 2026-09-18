-- ========================================
-- MIGRATION: Carry R1's average score into R2 deliberation data
-- ========================================
-- R2's total score is now weighted 40% Presentation / 40% Case / 5% intro /
-- 15% R1 performance (see ROUND_CONFIGS.R2.computeTotal in Interview.tsx).
-- The 15% R1 slice isn't known to an individual R2 grader, so it can't be
-- baked into interview_scores.total_score at submission time -- it's added
-- on top at read time by the deliberation board, which needs each
-- application's R1 average score alongside its R2 data to do that. This
-- just adds that one field to get_round_deliberation's existing output.

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
  ),
  r1_agg AS (
    SELECT application_id, AVG(total_score)::DOUBLE PRECISION AS r1_avg_score
    FROM interview_scores
    WHERE game_id = p_game_id AND round = 'R1'
    GROUP BY application_id
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
      'application_ranking', rl.application_rank,
      'was_in_r1', EXISTS (SELECT 1 FROM round_candidates x WHERE x.game_id = p_game_id AND x.round = 'R1' AND x.application_id = a.id),
      'was_in_r2', EXISTS (SELECT 1 FROM round_candidates x WHERE x.game_id = p_game_id AND x.round = 'R2' AND x.application_id = a.id),
      'color', rc.color,
      'sort_order', rc.sort_order,
      'notes', rc.notes,
      'avg_score', sa.avg_score,
      'score_count', sa.score_count,
      'scores', sa.details,
      'r1_avg_score', ra.r1_avg_score
    )
    ORDER BY rc.sort_order, a.submitted_at
  )
  INTO v_result
  FROM round_candidates rc
  JOIN applications a ON a.id = rc.application_id
  LEFT JOIN ranking_lookup rl ON rl.application_id = a.id
  LEFT JOIN score_agg sa ON sa.application_id = a.id
  LEFT JOIN r1_agg ra ON ra.application_id = a.id
  WHERE rc.game_id = p_game_id AND rc.round = p_round;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
