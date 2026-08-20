-- ========================================
-- MIGRATION: Interview scoring + deliberation view
-- ========================================
-- Adds:
-- 1. game_members - real cycle membership (fixes join_game_by_token, which
--    today only validates a token and never records that the user joined;
--    access to a game's applications/video_grades currently depends on
--    having made at least one resume Elo comparison in that game, which is
--    wrong for interviewers who may never touch resume grading)
-- 2. applications.candidate_number - the "10XX" candidate ID used throughout
--    the R1/R2 interview process, auto-assigned per game
-- 3. interview_scores - replaces the R1 and R2 Google Forms. Each room
--    submits ONE consolidated row per candidate per round (two named
--    interviewers, one agreed-upon set of scores) rather than one row per
--    interviewer -- this matches how the real forms work.
--    Scoring criteria are stored as JSONB rather than fixed columns because
--    R1 and R2 use structurally different rubrics, and the rubric is
--    expected to change between cycles -- only the frontend config needs to
--    change next year, not this schema.
-- 4. round_candidates - backs the deliberation view: per-round manual
--    color-coding and drag-to-reorder position for a game's applicants
-- 5. presentations storage bucket - R2 requires uploading the candidate's
--    client-proposal presentation file

-- Step 1: game_members
CREATE TABLE IF NOT EXISTS public.game_members (
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

-- Backfill from existing activity so current graders/committee don't lose access
INSERT INTO public.game_members (game_id, user_id)
SELECT DISTINCT game_id, user_id FROM public.comparisons
ON CONFLICT DO NOTHING;

INSERT INTO public.game_members (game_id, user_id)
SELECT DISTINCT game_id, grader_id FROM public.video_grades
ON CONFLICT DO NOTHING;

ALTER TABLE public.game_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read their own membership rows" ON public.game_members;
CREATE POLICY "Members can read their own membership rows"
  ON public.game_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Users can add themselves as members" ON public.game_members;
CREATE POLICY "Users can add themselves as members"
  ON public.game_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Make join_game_by_token actually record membership instead of just
-- validating the token (previous version was look-up only).
CREATE OR REPLACE FUNCTION public.join_game_by_token(p_access_token TEXT, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
BEGIN
  SELECT id, name, access_token, created_by, created_at
  INTO v_game
  FROM games
  WHERE access_token = UPPER(p_access_token);

  IF v_game IS NULL THEN
    RETURN json_build_object('error', 'Invalid access token');
  END IF;

  INSERT INTO game_members (game_id, user_id)
  VALUES (v_game.id, p_user_id)
  ON CONFLICT (game_id, user_id) DO NOTHING;

  RETURN json_build_object(
    'id', v_game.id,
    'name', v_game.name,
    'access_token', v_game.access_token
  );
END;
$$;

-- Step 2: candidate_number ("10XX" ID used on the interview forms/spreadsheets)
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS candidate_number INTEGER;

CREATE OR REPLACE FUNCTION public.assign_candidate_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.candidate_number IS NULL THEN
    SELECT COALESCE(MAX(candidate_number), 1000) + 1 INTO NEW.candidate_number
    FROM applications WHERE game_id = NEW.game_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_candidate_number ON public.applications;
CREATE TRIGGER trg_assign_candidate_number
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.assign_candidate_number();

-- Backfill existing rows in submission order, per game, starting at 1001
WITH numbered AS (
  SELECT id, 1000 + ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY submitted_at) AS n
  FROM public.applications WHERE candidate_number IS NULL
)
UPDATE public.applications a SET candidate_number = numbered.n
FROM numbered WHERE a.id = numbered.id;

ALTER TABLE public.applications
  ADD CONSTRAINT unique_candidate_number_per_game UNIQUE (game_id, candidate_number);

-- Step 3: presentations storage bucket (R2 client-proposal file upload)
INSERT INTO storage.buckets (id, name, public)
VALUES ('presentations', 'presentations', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Members can upload presentations" ON storage.objects;
CREATE POLICY "Members can upload presentations"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'presentations' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Members can view presentations" ON storage.objects;
CREATE POLICY "Members can view presentations"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'presentations' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can delete presentations" ON storage.objects;
CREATE POLICY "Admins can delete presentations"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'presentations' AND public.has_role(auth.uid(), 'admin'));

-- Step 4: interview_scores (replaces the R1 and R2 Google Forms)
CREATE TABLE IF NOT EXISTS public.interview_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  interviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  co_interviewer_name TEXT,
  round TEXT NOT NULL CHECK (round IN ('R1', 'R2')),
  room_label TEXT,
  section_scores JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "<section_key>": { "<criterion_key>": <0-4>, ... }, ... }
  section_totals JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "<section_key>": <weighted total>, ... }
  total_score NUMERIC NOT NULL,
  recommendation TEXT,          -- e.g. 'yes' | 'maybe' | 'no' | 'juniors_yes' | 'juniors_no' (round-defined, not DB-enforced -- see frontend rubric config)
  overall_impression TEXT,
  availability JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { "cep": true, "gbm": false }
  candidate_phone TEXT,
  presentation_path TEXT,       -- R2 only: storage key in 'presentations' bucket
  glaring_concerns TEXT,        -- R2 client-proposal free-text note
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_interviewer_per_round_application UNIQUE (round, application_id, interviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_scores_game_round ON public.interview_scores(game_id, round);
CREATE INDEX IF NOT EXISTS idx_interview_scores_application ON public.interview_scores(application_id);

ALTER TABLE public.interview_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can insert their own interview scores" ON public.interview_scores;
CREATE POLICY "Members can insert their own interview scores"
  ON public.interview_scores FOR INSERT
  WITH CHECK (
    interviewer_id = auth.uid()
    AND (
      game_id IN (SELECT game_id FROM public.game_members WHERE user_id = auth.uid())
      OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  );

DROP POLICY IF EXISTS "Members can read interview scores in their games" ON public.interview_scores;
CREATE POLICY "Members can read interview scores in their games"
  ON public.interview_scores FOR SELECT
  USING (
    game_id IN (SELECT game_id FROM public.game_members WHERE user_id = auth.uid())
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Interviewers can update their own scores" ON public.interview_scores;
CREATE POLICY "Interviewers can update their own scores"
  ON public.interview_scores FOR UPDATE
  USING (interviewer_id = auth.uid())
  WITH CHECK (interviewer_id = auth.uid());

-- Step 5: round_candidates (backs the deliberation view: color + drag order)
CREATE TABLE IF NOT EXISTS public.round_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  round TEXT NOT NULL CHECK (round IN ('R1', 'R2')),
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_round_candidate UNIQUE (game_id, round, application_id)
);

CREATE INDEX IF NOT EXISTS idx_round_candidates_game_round ON public.round_candidates(game_id, round, sort_order);

ALTER TABLE public.round_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and game creators can read round candidates" ON public.round_candidates;
CREATE POLICY "Admins and game creators can read round candidates"
  ON public.round_candidates FOR SELECT
  USING (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Admins and game creators can upsert round candidates" ON public.round_candidates;
CREATE POLICY "Admins and game creators can upsert round candidates"
  ON public.round_candidates FOR INSERT
  WITH CHECK (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Admins and game creators can update round candidates" ON public.round_candidates;
CREATE POLICY "Admins and game creators can update round candidates"
  ON public.round_candidates FOR UPDATE
  USING (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Step 6: RPC to bulk-reorder in one round trip (drag-and-drop persistence)
-- SECURITY DEFINER bypasses RLS, so permission is checked explicitly below
-- rather than relying on the table's row policies.
CREATE OR REPLACE FUNCTION public.reorder_round_candidates(p_updates JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
BEGIN
  SELECT rc.game_id INTO v_game_id
  FROM round_candidates rc
  WHERE rc.id = ((p_updates->0)->>'id')::UUID;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'No matching round_candidates row';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR v_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to reorder candidates for this game';
  END IF;

  UPDATE round_candidates rc
  SET sort_order = (u->>'sort_order')::INTEGER,
      updated_at = now()
  FROM jsonb_array_elements(p_updates) AS u
  WHERE rc.id = (u->>'id')::UUID
    AND rc.game_id = v_game_id;
END;
$$;

-- Step 7: RPC to bulk-assign a color to a set of round_candidates
CREATE OR REPLACE FUNCTION public.set_round_candidate_color(p_ids UUID[], p_color TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
BEGIN
  SELECT DISTINCT rc.game_id INTO v_game_id
  FROM round_candidates rc
  WHERE rc.id = ANY(p_ids);

  IF v_game_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR v_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to color candidates for this game';
  END IF;

  UPDATE round_candidates
  SET color = p_color, updated_at = now()
  WHERE id = ANY(p_ids)
    AND game_id = v_game_id;
END;
$$;

-- Step 8: RPC to submit (or update) one consolidated interview score for one candidate
CREATE OR REPLACE FUNCTION public.submit_interview_score(
  p_application_id UUID,
  p_interviewer_id UUID,
  p_round TEXT,
  p_co_interviewer_name TEXT,
  p_room_label TEXT,
  p_section_scores JSONB,
  p_section_totals JSONB,
  p_total_score NUMERIC,
  p_recommendation TEXT,
  p_overall_impression TEXT,
  p_availability JSONB,
  p_candidate_phone TEXT,
  p_presentation_path TEXT,
  p_glaring_concerns TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_id UUID;
BEGIN
  SELECT game_id INTO v_game_id FROM applications WHERE id = p_application_id;
  IF v_game_id IS NULL THEN
    RETURN json_build_object('error', 'Application not found');
  END IF;

  IF NOT (
    p_interviewer_id = auth.uid()
    AND (
      v_game_id IN (SELECT game_id FROM game_members WHERE user_id = auth.uid())
      OR v_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  ) THEN
    RETURN json_build_object('error', 'Not authorized to submit a score for this candidate');
  END IF;

  INSERT INTO interview_scores (
    game_id, application_id, interviewer_id, co_interviewer_name, round, room_label,
    section_scores, section_totals, total_score, recommendation, overall_impression,
    availability, candidate_phone, presentation_path, glaring_concerns
  )
  VALUES (
    v_game_id, p_application_id, p_interviewer_id, p_co_interviewer_name, p_round, p_room_label,
    p_section_scores, p_section_totals, p_total_score, p_recommendation, p_overall_impression,
    p_availability, p_candidate_phone, p_presentation_path, p_glaring_concerns
  )
  ON CONFLICT (round, application_id, interviewer_id)
  DO UPDATE SET
    co_interviewer_name = EXCLUDED.co_interviewer_name,
    room_label = EXCLUDED.room_label,
    section_scores = EXCLUDED.section_scores,
    section_totals = EXCLUDED.section_totals,
    total_score = EXCLUDED.total_score,
    recommendation = EXCLUDED.recommendation,
    overall_impression = EXCLUDED.overall_impression,
    availability = EXCLUDED.availability,
    candidate_phone = EXCLUDED.candidate_phone,
    presentation_path = EXCLUDED.presentation_path,
    glaring_concerns = EXCLUDED.glaring_concerns,
    submitted_at = now()
  RETURNING id INTO v_id;

  -- Make sure this application has a round_candidates row so it shows up
  -- in deliberation as soon as the first score comes in.
  INSERT INTO round_candidates (game_id, application_id, round, sort_order)
  VALUES (v_game_id, p_application_id, p_round, 0)
  ON CONFLICT (game_id, round, application_id) DO NOTHING;

  RETURN json_build_object('success', true, 'id', v_id);
END;
$$;

-- Step 9: RPC to fetch a round's deliberation data in one call: every
-- applicant seeded into round_candidates for the round, their color/order,
-- application-wide info (candidate number, gender, video, resume, whether
-- they were also present in the other round this cycle), their pre-interview
-- combined ranking, and their interview score(s).
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

-- Step 10: RPC to seed round_candidates for every application in a game that
-- doesn't have a row for the given round yet (called once when the
-- deliberation view is first opened for a round).
CREATE OR REPLACE FUNCTION public.seed_round_candidates(p_game_id UUID, p_round TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_order INTEGER;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR p_game_id IN (SELECT id FROM games WHERE created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to seed candidates for this game';
  END IF;

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
END;
$$;

-- Step 11: extend applications/resumes SELECT access to game_members too.
-- These previously only checked "has made an Elo comparison in this game",
-- which is wrong for an interviewer who joined via access token to do
-- interview scoring and has never touched resume grading.
DROP POLICY IF EXISTS "Authenticated users can read applications in their games" ON public.applications;
CREATE POLICY "Authenticated users can read applications in their games"
  ON public.applications FOR SELECT
  TO authenticated
  USING (
    game_id IN (SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid())
    OR game_id IN (SELECT game_id FROM public.game_members WHERE user_id = auth.uid())
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Authenticated users can read active resumes in their games" ON public.resumes;
CREATE POLICY "Authenticated users can read active resumes in their games"
  ON public.resumes FOR SELECT
  TO authenticated
  USING (
    game_id IN (SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid())
    OR game_id IN (SELECT game_id FROM public.game_members WHERE user_id = auth.uid())
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
