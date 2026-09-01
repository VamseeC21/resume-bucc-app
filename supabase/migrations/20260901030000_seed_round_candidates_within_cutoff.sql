-- ========================================
-- MIGRATION: R1/R2 deliberation boards only seed candidates within the
-- prior round's advance cutoff
-- ========================================
-- seed_round_candidates() previously seeded EVERY game applicant into
-- whichever round's board was ever opened. That meant the R1 board showed
-- all applicants (e.g. 145) instead of just the ones who actually advanced
-- (e.g. the top 90 from Resume), and the "Advance top ___ of N" denominator
-- on the frontend (driven by row count) was wrong for the same reason.
--
-- Fix: for R1/R2, only seed candidates who rank within the prior round's
-- current round_cutoffs.advance_count (RESUME -> R1, R1 -> R2) -- the same
-- rule get_interview_roster() already uses, so the deliberation board and
-- the interview roster stay in agreement. RESUME itself has no prior gate,
-- so it keeps seeding every applicant, unchanged. Still additive-only (only
-- inserts missing rows) -- if a cutoff is later *lowered*, candidates
-- already seeded/graded under the old cutoff are not removed; raising the
-- cutoff picks up newly-eligible candidates on the next visit as before.
-- Candidates within the cutoff but not yet graded in this round still show
-- up with no color, same as any other ungraded candidate.
--
-- (Superseded by 20260901040000, which adds pruning of already-over-seeded
-- rows on top of this -- see that file. Left as-is here since this version
-- is what's actually been applied; migrations don't get rewritten in place
-- after the fact.)

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

  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_order
  FROM round_candidates WHERE game_id = p_game_id AND round = p_round;

  v_prior_round := CASE p_round WHEN 'R1' THEN 'RESUME' WHEN 'R2' THEN 'R1' ELSE NULL END;

  IF v_prior_round IS NULL THEN
    -- RESUME (or any round with no prior gate): every applicant is eligible.
    INSERT INTO round_candidates (game_id, application_id, round, sort_order)
    SELECT p_game_id, a.id, p_round, v_next_order + (ROW_NUMBER() OVER (ORDER BY a.submitted_at)) - 1
    FROM applications a
    WHERE a.game_id = p_game_id
      AND NOT EXISTS (
        SELECT 1 FROM round_candidates rc
        WHERE rc.game_id = p_game_id AND rc.round = p_round AND rc.application_id = a.id
      );
  ELSE
    SELECT advance_count INTO v_advance_count
    FROM round_cutoffs WHERE game_id = p_game_id AND round = v_prior_round;

    IF v_advance_count IS NOT NULL THEN
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
  END IF;
END;
$$;
