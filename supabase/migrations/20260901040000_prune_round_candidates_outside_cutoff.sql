-- ========================================
-- MIGRATION: Prune round_candidates rows that no longer belong
-- ========================================
-- 20260901030000 stopped seed_round_candidates() from over-seeding R1/R2
-- going forward, but it's additive-only -- it never removes rows. Games
-- that were already over-seeded by the old (pre-030000) indiscriminate
-- version -- showing all 145 applicants on the R1 board instead of just the
-- ones who advanced -- stay wrong until something actually deletes those
-- extra rows. This migration adds that cleanup.
--
-- A round_candidates row is now pruned when BOTH are true:
-- 1. It's no longer within the prior round's current advance cutoff (or no
--    cutoff is set at all).
-- 2. It has no interview_scores for that round -- a candidate who's already
--    been graded is never removed, cutoff changes or not, so real
--    interview data/notes never silently disappear.
--
-- Net effect: the board (and its "of N" count) is always exactly "prior
-- round's current cutoff, plus anyone already graded here even if a later
-- cutoff change would otherwise exclude them." Ungraded-but-eligible
-- candidates still show up with no color until graded, same as before.

CREATE OR REPLACE FUNCTION public.seed_round_candidates(p_game_id UUID, p_round TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_order INTEGER;
  v_prior_round TEXT;
  v_advance_count INTEGER;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to seed candidates for this game';
  END IF;

  v_prior_round := CASE p_round WHEN 'R1' THEN 'RESUME' WHEN 'R2' THEN 'R1' ELSE NULL END;

  IF v_prior_round IS NULL THEN
    -- RESUME (or any round with no prior gate): every applicant is eligible.
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_order
    FROM round_candidates WHERE game_id = p_game_id AND round = p_round;

    INSERT INTO round_candidates (game_id, application_id, round, sort_order)
    SELECT p_game_id, a.id, p_round, v_next_order + (ROW_NUMBER() OVER (ORDER BY a.submitted_at)) - 1
    FROM applications a
    WHERE a.game_id = p_game_id
      AND NOT EXISTS (
        SELECT 1 FROM round_candidates rc
        WHERE rc.game_id = p_game_id AND rc.round = p_round AND rc.application_id = a.id
      );
    RETURN;
  END IF;

  SELECT advance_count INTO v_advance_count
  FROM round_cutoffs WHERE game_id = p_game_id AND round = v_prior_round;

  -- Prune rows that no longer qualify: not within the current cutoff (or no
  -- cutoff set at all) and never actually graded in this round.
  DELETE FROM round_candidates rc
  WHERE rc.game_id = p_game_id AND rc.round = p_round
    AND NOT EXISTS (
      SELECT 1 FROM interview_scores s
      WHERE s.game_id = p_game_id AND s.round = p_round AND s.application_id = rc.application_id
    )
    AND (
      v_advance_count IS NULL
      OR rc.application_id NOT IN (
        SELECT ranked.application_id FROM (
          SELECT rc2.application_id, ROW_NUMBER() OVER (ORDER BY rc2.sort_order) AS rnk
          FROM round_candidates rc2 WHERE rc2.game_id = p_game_id AND rc2.round = v_prior_round
        ) ranked WHERE ranked.rnk <= v_advance_count
      )
    );

  IF v_advance_count IS NOT NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_order
    FROM round_candidates WHERE game_id = p_game_id AND round = p_round;

    INSERT INTO round_candidates (game_id, application_id, round, sort_order)
    SELECT p_game_id, ranked.application_id, p_round,
           v_next_order + (ROW_NUMBER() OVER (ORDER BY ranked.rnk)) - 1
    FROM (
      SELECT rc.application_id, ROW_NUMBER() OVER (ORDER BY rc.sort_order) AS rnk
      FROM round_candidates rc
      WHERE rc.game_id = p_game_id AND rc.round = v_prior_round
    ) ranked
    WHERE ranked.rnk <= v_advance_count
      AND NOT EXISTS (
        SELECT 1 FROM round_candidates rc2
        WHERE rc2.game_id = p_game_id AND rc2.round = p_round AND rc2.application_id = ranked.application_id
      );
  END IF;
END;
$$;
