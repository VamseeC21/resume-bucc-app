-- ========================================
-- COMPLETE DATABASE SETUP FOR RESUME ARENA
-- ========================================
-- Just copy and paste ALL of this into Supabase SQL Editor and click "Run"

-- Create role enum type
CREATE TYPE public.app_role AS ENUM ('admin', 'grader');

-- Create profiles table (stores user roles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'grader',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create resumes table
CREATE TABLE IF NOT EXISTS public.resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade TEXT,
  pdf_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create elo_ratings table
CREATE TABLE IF NOT EXISTS public.elo_ratings (
  resume_id UUID PRIMARY KEY REFERENCES public.resumes(id) ON DELETE CASCADE,
  rating DOUBLE PRECISION NOT NULL DEFAULT 1500,
  games INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create comparisons table
CREATE TABLE IF NOT EXISTS public.comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_a_id UUID NOT NULL REFERENCES public.resumes(id),
  resume_b_id UUID NOT NULL REFERENCES public.resumes(id),
  winner_id UUID NOT NULL REFERENCES public.resumes(id),
  pair_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT different_resumes CHECK (resume_a_id <> resume_b_id),
  CONSTRAINT valid_winner CHECK (winner_id IN (resume_a_id, resume_b_id)),
  CONSTRAINT unique_user_pair UNIQUE (user_id, pair_hash)
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparisons ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = _role
  )
$$;

-- Create function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = _user_id
$$;

-- Drop existing policies if they exist (to avoid errors)
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read active resumes" ON public.resumes;
DROP POLICY IF EXISTS "Admins can read all resumes" ON public.resumes;
DROP POLICY IF EXISTS "Admins can insert resumes" ON public.resumes;
DROP POLICY IF EXISTS "Admins can update resumes" ON public.resumes;
DROP POLICY IF EXISTS "Admins can delete resumes" ON public.resumes;
DROP POLICY IF EXISTS "Admins can read all ratings" ON public.elo_ratings;
DROP POLICY IF EXISTS "Admins can insert ratings" ON public.elo_ratings;
DROP POLICY IF EXISTS "System can update ratings" ON public.elo_ratings;
DROP POLICY IF EXISTS "Users can insert own comparisons" ON public.comparisons;
DROP POLICY IF EXISTS "Admins can read all comparisons" ON public.comparisons;

-- Profiles policies
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Resumes policies
CREATE POLICY "Authenticated users can read active resumes"
  ON public.resumes FOR SELECT
  TO authenticated
  USING (active = true);

CREATE POLICY "Admins can read all resumes"
  ON public.resumes FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert resumes"
  ON public.resumes FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update resumes"
  ON public.resumes FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete resumes"
  ON public.resumes FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Elo ratings policies
CREATE POLICY "Admins can read all ratings"
  ON public.elo_ratings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert ratings"
  ON public.elo_ratings FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Comparisons policies
CREATE POLICY "Users can insert own comparisons"
  ON public.comparisons FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all comparisons"
  ON public.comparisons FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'grader')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger to auto-create elo_rating when resume is inserted
CREATE OR REPLACE FUNCTION public.handle_new_resume()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.elo_ratings (resume_id, rating, games)
  VALUES (NEW.id, 1500, 0)
  ON CONFLICT (resume_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_resume_created ON public.resumes;
CREATE TRIGGER on_resume_created
  AFTER INSERT ON public.resumes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_resume();

-- RPC: Get next pair for grading
CREATE OR REPLACE FUNCTION public.get_next_pair(p_user_id UUID)
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
  -- Get resume A: randomly from bottom 30 by games
  SELECT r.id, r.name, r.grade, r.pdf_path, e.games
  INTO v_resume_a
  FROM resumes r
  JOIN elo_ratings e ON e.resume_id = r.id
  WHERE r.active = true
  ORDER BY e.games ASC, random()
  LIMIT 1;

  IF v_resume_a IS NULL THEN
    RETURN json_build_object('error', 'No active resumes available');
  END IF;

  -- Find resume B that hasn't been compared by this user with resume A
  LOOP
    SELECT r.id, r.name, r.grade, r.pdf_path, e.games
    INTO v_resume_b
    FROM resumes r
    JOIN elo_ratings e ON e.resume_id = r.id
    WHERE r.active = true
      AND r.id <> v_resume_a.id
    ORDER BY e.games ASC, random()
    LIMIT 1 OFFSET (v_attempts % 10);

    IF v_resume_b IS NULL THEN
      RETURN json_build_object('error', 'Not enough resumes for comparison');
    END IF;

    -- Calculate pair hash
    IF v_resume_a.id < v_resume_b.id THEN
      v_pair_hash := v_resume_a.id::text || ':' || v_resume_b.id::text;
    ELSE
      v_pair_hash := v_resume_b.id::text || ':' || v_resume_a.id::text;
    END IF;

    -- Check if this pair already compared by user
    IF NOT EXISTS (
      SELECT 1 FROM comparisons
      WHERE user_id = p_user_id AND pair_hash = v_pair_hash
    ) THEN
      EXIT; -- Found valid pair
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts >= v_max_attempts THEN
      RETURN json_build_object('error', 'No more pairs available for you to grade');
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

-- RPC: Submit comparison and update Elo
CREATE OR REPLACE FUNCTION public.submit_comparison(
  p_user_id UUID,
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

  -- Calculate pair hash
  IF p_resume_a < p_resume_b THEN
    v_pair_hash := p_resume_a::text || ':' || p_resume_b::text;
  ELSE
    v_pair_hash := p_resume_b::text || ':' || p_resume_a::text;
  END IF;

  -- Insert comparison (will fail if duplicate due to unique constraint)
  INSERT INTO comparisons (user_id, resume_a_id, resume_b_id, winner_id, pair_hash)
  VALUES (p_user_id, p_resume_a, p_resume_b, p_winner, v_pair_hash);

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

  -- Update ratings (only through this function, not direct updates)
  UPDATE elo_ratings
  SET rating = v_new_rating_a, games = games + 1, updated_at = now()
  WHERE resume_id = p_resume_a;

  UPDATE elo_ratings
  SET rating = v_new_rating_b, games = games + 1, updated_at = now()
  WHERE resume_id = p_resume_b;

  -- Get user's total comparisons
  SELECT COUNT(*) INTO v_total_comparisons
  FROM comparisons WHERE user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'totalComparisons', v_total_comparisons
  );
END;
$$;

-- RPC: Get user comparison count
CREATE OR REPLACE FUNCTION public.get_user_comparison_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM comparisons WHERE user_id = p_user_id
$$;

-- Revoke direct updates on elo_ratings (only allow through RPC)
REVOKE UPDATE ON public.elo_ratings FROM authenticated;
REVOKE UPDATE ON public.elo_ratings FROM anon;

-- Create storage bucket for resumes (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Admins can upload resumes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view resumes" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete resumes" ON storage.objects;

-- Storage policies for resumes bucket
CREATE POLICY "Admins can upload resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes' 
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Authenticated users can view resumes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'resumes');

CREATE POLICY "Admins can delete resumes"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resumes' 
    AND public.has_role(auth.uid(), 'admin')
  );

