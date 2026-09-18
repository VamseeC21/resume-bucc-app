-- ========================================
-- MIGRATION: Backfill existing R2 scores onto the new weighting
-- ========================================
-- R2's total_score/section_totals used to be a flat unweighted sum of every
-- criterion (see the now-superseded comment on ROUND_CONFIGS.R2.computeTotal
-- in Interview.tsx). That formula changed to 40% Client Proposal (Presentation)
-- + 40% Case (framework+quant+brainstorm+conclusion) + 5% intro/"why BUCC"
-- (the remaining 15%, R1 performance, is layered on at read time in
-- get_round_deliberation, not stored here).
--
-- That change only affects submissions going forward -- interview_scores
-- rows written before it keep their old totals, since total_score/
-- section_totals are computed client-side and stored as-is, not derived at
-- read time. This recomputes both fields in place for every existing R2 row
-- from the raw per-criterion values already in section_scores (untouched by
-- this migration), so already-graded candidates reflect the new weighting
-- immediately instead of only after a grader edits/resubmits.
--
-- Idempotent: re-running this (or backfilling a row a fresh submission
-- already recomputed correctly) is a no-op.

CREATE OR REPLACE FUNCTION public._r2_section_raw_sum(p_scores JSONB, p_section TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  -- Sums only the numeric criterion values in a section, skipping the
  -- string-valued "<criterion>_variant" fields (e.g. which behavioral
  -- question wording was asked) that live alongside them.
  SELECT COALESCE(SUM((value)::numeric), 0)
  FROM jsonb_each(COALESCE(p_scores -> p_section, '{}'::jsonb)) AS kv(key, value)
  WHERE jsonb_typeof(value) = 'number';
$$;

UPDATE public.interview_scores
SET
  section_totals = jsonb_build_object(
    'behavioral', (public._r2_section_raw_sum(section_scores, 'behavioral') / 4) * 5,
    'client_proposal', (public._r2_section_raw_sum(section_scores, 'client_proposal') / 16) * 40,
    'case', (public._r2_section_raw_sum(section_scores, 'case') / 16) * 40,
    'case_quant', (public._r2_section_raw_sum(section_scores, 'case_quant') / 16) * 40,
    'case_brainstorm', (public._r2_section_raw_sum(section_scores, 'case_brainstorm') / 16) * 40,
    'case_conclusion', (public._r2_section_raw_sum(section_scores, 'case_conclusion') / 16) * 40
  ),
  total_score =
    (public._r2_section_raw_sum(section_scores, 'behavioral') / 4) * 5
    + (public._r2_section_raw_sum(section_scores, 'client_proposal') / 16) * 40
    + (public._r2_section_raw_sum(section_scores, 'case') / 16) * 40
    + (public._r2_section_raw_sum(section_scores, 'case_quant') / 16) * 40
    + (public._r2_section_raw_sum(section_scores, 'case_brainstorm') / 16) * 40
    + (public._r2_section_raw_sum(section_scores, 'case_conclusion') / 16) * 40
WHERE round = 'R2';

DROP FUNCTION public._r2_section_raw_sum(JSONB, TEXT);
