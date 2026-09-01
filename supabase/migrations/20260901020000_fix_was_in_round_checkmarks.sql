-- ========================================
-- MIGRATION: Fix was_in_r1/was_in_r2 to mean "actually graded," not "seeded"
-- ========================================
-- get_round_deliberation() previously checked round_candidates existence for
-- was_in_r1/was_in_r2. But seed_round_candidates() seeds EVERY game
-- applicant into whichever round's board has ever been opened, regardless of
-- eligibility -- so on the R1 page, was_in_r1 was trivially true for every
-- row shown (you can't be on the R1 board without a round_candidates(R1)
-- row), and was_in_r2 became true for everyone, forever, the first time
-- anyone ever opened the R2 tab. Neither was useful signal.
--
-- Redefine both against interview_scores instead: did this candidate
-- actually get graded in that round, not just seeded into its board.

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
      'was_in_r1', EXISTS (SELECT 1 FROM interview_scores s WHERE s.game_id = p_game_id AND s.round = 'R1' AND s.application_id = a.id),
      'was_in_r2', EXISTS (SELECT 1 FROM interview_scores s WHERE s.game_id = p_game_id AND s.round = 'R2' AND s.application_id = a.id),
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
