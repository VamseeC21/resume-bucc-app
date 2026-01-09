-- ========================================
-- MIGRATION: Add Games System and User Names
-- ========================================
-- This migration adds:
-- 1. First/Last name to profiles
-- 2. Games/comparison_sessions table
-- 3. Game context to resumes and comparisons
-- 4. Updated functions and policies

-- Step 1: Add first_name and last_name to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Step 2: Create games/comparison_sessions table
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 3: Add game_id to resumes table
ALTER TABLE public.resumes 
ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE CASCADE;

-- Step 4: Add game_id to comparisons table
ALTER TABLE public.comparisons 
ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE CASCADE;

-- Step 5: Update elo_ratings to be game-specific
-- We'll keep resume_id as primary key but add game_id for filtering
-- Actually, elo_ratings is already linked via resume_id -> resumes -> game_id
-- So we can query through that relationship

-- Step 6: Create index for access_token lookups
CREATE INDEX IF NOT EXISTS idx_games_access_token ON public.games(access_token);
CREATE INDEX IF NOT EXISTS idx_resumes_game_id ON public.resumes(game_id);
CREATE INDEX IF NOT EXISTS idx_comparisons_game_id ON public.comparisons(game_id);

-- Step 7: Update unique constraint on comparisons to include game_id
ALTER TABLE public.comparisons 
DROP CONSTRAINT IF EXISTS unique_user_pair;

ALTER TABLE public.comparisons 
ADD CONSTRAINT unique_user_pair_game 
UNIQUE (user_id, pair_hash, game_id);

-- Step 8: Enable RLS on games table
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- Step 9: Create RLS policies for games
-- Simplified: Allow all authenticated users to read games
-- Access control is handled via access tokens, not RLS
-- This prevents infinite recursion from checking comparisons table
DROP POLICY IF EXISTS "Game creators can read their games" ON public.games;
DROP POLICY IF EXISTS "Admins can read all games" ON public.games;
DROP POLICY IF EXISTS "Users can read games they participate in" ON public.games;
DROP POLICY IF EXISTS "Authenticated users can read games" ON public.games;

CREATE POLICY "Authenticated users can read games"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins and game creators can create games" ON public.games;
CREATE POLICY "Admins and game creators can create games"
  ON public.games FOR INSERT
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Game creators can update their games" ON public.games;
CREATE POLICY "Game creators can update their games"
  ON public.games FOR UPDATE
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Step 10: Update resume policies to include game context
DROP POLICY IF EXISTS "Authenticated users can read active resumes in their games" ON public.resumes;
CREATE POLICY "Authenticated users can read active resumes in their games"
  ON public.resumes FOR SELECT
  TO authenticated
  USING (
    active = true AND (
      game_id IN (
        SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid()
      )
      OR game_id IN (
        SELECT id FROM public.games WHERE created_by = auth.uid()
      )
      OR public.has_role(auth.uid(), 'admin')
    )
  );

DROP POLICY IF EXISTS "Game creators can insert resumes in their games" ON public.resumes;
CREATE POLICY "Game creators can insert resumes in their games"
  ON public.resumes FOR INSERT
  WITH CHECK (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Step 11: Update comparison policies to include game context
DROP POLICY IF EXISTS "Users can insert comparisons in games they participate in" ON public.comparisons;
CREATE POLICY "Users can insert comparisons in games they participate in"
  ON public.comparisons FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND (
      game_id IN (
        SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid()
      )
      OR game_id IN (
        SELECT id FROM public.games WHERE created_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.resumes r 
        WHERE r.game_id = comparisons.game_id 
        LIMIT 1
      )
    )
  );

DROP POLICY IF EXISTS "Users can read comparisons in their games" ON public.comparisons;
CREATE POLICY "Users can read comparisons in their games"
  ON public.comparisons FOR SELECT
  USING (
    user_id = auth.uid()
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Step 12: Update handle_new_user trigger to accept names (we'll handle this in the app)
-- The trigger stays the same, but we'll update profiles from the app

-- Step 13: Create function to generate unique access token
CREATE OR REPLACE FUNCTION public.generate_access_token()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
$$;

-- Step 14: Create function to create a game
CREATE OR REPLACE FUNCTION public.create_game(p_name TEXT, p_created_by UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_access_token TEXT;
BEGIN
  -- Generate unique access token
  LOOP
    v_access_token := generate_access_token();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM games WHERE access_token = v_access_token);
  END LOOP;

  -- Create game
  INSERT INTO games (name, access_token, created_by)
  VALUES (p_name, v_access_token, p_created_by)
  RETURNING id INTO v_game_id;

  RETURN json_build_object(
    'id', v_game_id,
    'name', p_name,
    'access_token', v_access_token,
    'created_by', p_created_by
  );
END;
$$;

-- Step 15: Update get_next_pair function to include game_id
CREATE OR REPLACE FUNCTION public.get_next_pair(p_user_id UUID, p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resume_a RECORD;
  v_resume_b RECORD;
  v_pair_hash TEXT;
  v_attempts INTEGER := 0;
  v_max_attempts INTEGER := 50;
BEGIN
  -- Get resume A: randomly from bottom by games, within the specified game
  SELECT r.id, r.name, r.grade, r.pdf_path, e.games
  INTO v_resume_a
  FROM resumes r
  JOIN elo_ratings e ON e.resume_id = r.id
  WHERE r.active = true AND r.game_id = p_game_id
  ORDER BY e.games ASC, random()
  LIMIT 1;

  IF v_resume_a IS NULL THEN
    RETURN json_build_object('error', 'No active resumes available in this game');
  END IF;

  -- Find resume B that hasn't been compared by this user with resume A in this game
  LOOP
    SELECT r.id, r.name, r.grade, r.pdf_path, e.games
    INTO v_resume_b
    FROM resumes r
    JOIN elo_ratings e ON e.resume_id = r.id
    WHERE r.active = true 
      AND r.game_id = p_game_id
      AND r.id <> v_resume_a.id
    ORDER BY e.games ASC, random()
    LIMIT 1 OFFSET (v_attempts % 10);

    IF v_resume_b IS NULL THEN
      RETURN json_build_object('error', 'Not enough resumes for comparison in this game');
    END IF;

    -- Calculate pair hash
    IF v_resume_a.id < v_resume_b.id THEN
      v_pair_hash := v_resume_a.id::text || ':' || v_resume_b.id::text;
    ELSE
      v_pair_hash := v_resume_b.id::text || ':' || v_resume_a.id::text;
    END IF;

    -- Check if this pair already compared by user in this game
    IF NOT EXISTS (
      SELECT 1 FROM comparisons
      WHERE user_id = p_user_id 
        AND pair_hash = v_pair_hash 
        AND game_id = p_game_id
    ) THEN
      EXIT; -- Found valid pair
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts >= v_max_attempts THEN
      RETURN json_build_object('error', 'No more pairs available for you to grade in this game');
    END IF;
  END LOOP;

  RETURN json_build_object(
    'resumeA', json_build_object(
      'id', v_resume_a.id,
      'name', v_resume_a.name,
      'grade', v_resume_a.grade,
      'pdfPath', v_resume_a.pdf_path
    ),
    'resumeB', json_build_object(
      'id', v_resume_b.id,
      'name', v_resume_b.name,
      'grade', v_resume_b.grade,
      'pdfPath', v_resume_b.pdf_path
    ),
    'pairHash', v_pair_hash
  );
END;
$$;

-- Step 16: Update submit_comparison to include game_id
CREATE OR REPLACE FUNCTION public.submit_comparison(
  p_user_id UUID,
  p_game_id UUID,
  p_resume_a UUID,
  p_resume_b UUID,
  p_winner UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pair_hash TEXT;
  v_rating_a DOUBLE PRECISION;
  v_rating_b DOUBLE PRECISION;
  v_expected_a DOUBLE PRECISION;
  v_expected_b DOUBLE PRECISION;
  v_score_a DOUBLE PRECISION;
  v_score_b DOUBLE PRECISION;
  v_new_rating_a DOUBLE PRECISION;
  v_new_rating_b DOUBLE PRECISION;
  v_k DOUBLE PRECISION := 24;
  v_total_comparisons INTEGER;
BEGIN
  -- Validate winner
  IF p_winner NOT IN (p_resume_a, p_resume_b) THEN
    RETURN json_build_object('error', 'Winner must be one of the two resumes');
  END IF;

  -- Validate resumes belong to the game
  IF NOT EXISTS (
    SELECT 1 FROM resumes 
    WHERE id = p_resume_a AND game_id = p_game_id
  ) OR NOT EXISTS (
    SELECT 1 FROM resumes 
    WHERE id = p_resume_b AND game_id = p_game_id
  ) THEN
    RETURN json_build_object('error', 'Resumes do not belong to this game');
  END IF;

  -- Calculate pair hash
  IF p_resume_a < p_resume_b THEN
    v_pair_hash := p_resume_a::text || ':' || p_resume_b::text;
  ELSE
    v_pair_hash := p_resume_b::text || ':' || p_resume_a::text;
  END IF;

  -- Insert comparison (will fail if duplicate due to unique constraint)
  INSERT INTO comparisons (user_id, game_id, resume_a_id, resume_b_id, winner_id, pair_hash)
  VALUES (p_user_id, p_game_id, p_resume_a, p_resume_b, p_winner, v_pair_hash);

  -- Get current ratings
  SELECT rating INTO v_rating_a FROM elo_ratings WHERE resume_id = p_resume_a;
  SELECT rating INTO v_rating_b FROM elo_ratings WHERE resume_id = p_resume_b;

  -- Calculate expected scores
  v_expected_a := 1.0 / (1.0 + power(10.0, (v_rating_b - v_rating_a) / 400.0));
  v_expected_b := 1.0 - v_expected_a;

  -- Actual scores
  IF p_winner = p_resume_a THEN
    v_score_a := 1.0;
    v_score_b := 0.0;
  ELSE
    v_score_a := 0.0;
    v_score_b := 1.0;
  END IF;

  -- New ratings
  v_new_rating_a := v_rating_a + v_k * (v_score_a - v_expected_a);
  v_new_rating_b := v_rating_b + v_k * (v_score_b - v_expected_b);

  -- Update ratings
  UPDATE elo_ratings
  SET rating = v_new_rating_a, games = games + 1, updated_at = now()
  WHERE resume_id = p_resume_a;

  UPDATE elo_ratings
  SET rating = v_new_rating_b, games = games + 1, updated_at = now()
  WHERE resume_id = p_resume_b;

  -- Get user's total comparisons for this game
  SELECT COUNT(*) INTO v_total_comparisons
  FROM comparisons 
  WHERE user_id = p_user_id AND game_id = p_game_id;

  RETURN json_build_object(
    'success', true,
    'totalComparisons', v_total_comparisons
  );
END;
$$;

-- Step 17: Update get_user_comparison_count to include game_id
CREATE OR REPLACE FUNCTION public.get_user_comparison_count(p_user_id UUID, p_game_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER 
  FROM comparisons 
  WHERE user_id = p_user_id AND game_id = p_game_id
$$;

-- Step 18: Create function to join a game by access token
CREATE OR REPLACE FUNCTION public.join_game_by_token(p_access_token TEXT, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
BEGIN
  -- Find game by access token
  SELECT id, name, access_token, created_by, created_at
  INTO v_game
  FROM games
  WHERE access_token = UPPER(p_access_token);

  IF v_game IS NULL THEN
    RETURN json_build_object('error', 'Invalid access token');
  END IF;

  RETURN json_build_object(
    'id', v_game.id,
    'name', v_game.name,
    'access_token', v_game.access_token,
    'created_by', v_game.created_by,
    'created_at', v_game.created_at
  );
END;
$$;

