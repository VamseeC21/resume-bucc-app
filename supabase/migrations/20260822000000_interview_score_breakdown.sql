-- ========================================
-- MIGRATION: Per-candidate interview score breakdown for the Interview
-- scoring page
-- ========================================
-- Lets an interviewer click a candidate in the roster and see every score
-- already submitted for them this round (e.g. a co-interviewer's scores).
-- Needs a SECURITY DEFINER RPC rather than a plain client-side join because
-- `profiles` is locked down to admins/self, so a regular interviewer can't
-- resolve another interviewer's name via RLS alone -- get_round_deliberation
-- already works around this the same way, this mirrors that for a single
-- candidate and opens it up to any game member (not just admins).

CREATE OR REPLACE FUNCTION public.get_application_interview_scores(p_application_id UUID, p_round TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_result JSON;
BEGIN
  SELECT game_id INTO v_game_id FROM applications WHERE id = p_application_id;
  IF v_game_id IS NULL THEN
    RETURN json_build_object('error', 'Application not found');
  END IF;

  IF NOT (
    v_game_id IN (SELECT game_id FROM game_members WHERE user_id = auth.uid())
    OR v_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RETURN json_build_object('error', 'Not authorized');
  END IF;

  SELECT json_agg(
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
      'glaring_concerns', ist.glaring_concerns,
      'submitted_at', ist.submitted_at
    ) ORDER BY ist.submitted_at
  )
  INTO v_result
  FROM interview_scores ist
  LEFT JOIN profiles p ON p.id = ist.interviewer_id
  WHERE ist.application_id = p_application_id AND ist.round = p_round;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
