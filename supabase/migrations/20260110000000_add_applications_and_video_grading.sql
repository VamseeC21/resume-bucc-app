-- ========================================
-- MIGRATION: Add Applications and Video Grading
-- ========================================
-- This migration adds:
-- 1. Applications table (student submissions)
-- 2. Video grades table (grader scores for videos)
-- 3. Links resumes to applications
-- 4. Storage bucket for profile pictures
-- 5. RPC functions for application submission
-- 6. RLS policies for all new tables

-- Step 1: Create applications table (student submissions)
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  
  -- Personal Information
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  year TEXT NOT NULL, -- Freshman, Sophomore, Junior, Senior
  expected_graduation_year TEXT,
  gender TEXT, -- Male, Female, Nonbinary/Other, Prefer not to answer
  major TEXT,
  minor TEXT,
  college_of_primary_major TEXT,
  gpa TEXT,
  act_score TEXT, -- Optional
  sat_score TEXT, -- Optional
  military_affiliated TEXT, -- Yes, No, Prefer not to answer
  first_time_applying TEXT, -- Yes, No
  how_did_you_hear TEXT,
  
  -- Application Content
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  profile_picture_path TEXT, -- Stored in storage bucket
  video_youtube_url TEXT NOT NULL,
  video_question_2_choice TEXT, -- A or B (which prompt they chose)
  additional_info TEXT, -- Optional "anything else" field
  
  -- Metadata
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending', -- pending, reviewed, etc.
  
  -- Constraints
  CONSTRAINT unique_email_per_game UNIQUE (game_id, applicant_email),
  CONSTRAINT valid_year CHECK (year IN ('Freshman', 'Sophomore', 'Junior', 'Senior')),
  CONSTRAINT valid_video_choice CHECK (video_question_2_choice IS NULL OR video_question_2_choice IN ('A', 'B'))
);

-- Step 2: Create indexes for applications
CREATE INDEX IF NOT EXISTS idx_applications_game_id ON public.applications(game_id);
CREATE INDEX IF NOT EXISTS idx_applications_email ON public.applications(applicant_email);
CREATE INDEX IF NOT EXISTS idx_applications_resume_id ON public.applications(resume_id);

-- Step 3: Create video_grades table
CREATE TABLE IF NOT EXISTS public.video_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  grader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  
  -- Grading scores
  question_1_score INTEGER NOT NULL CHECK (question_1_score >= 1 AND question_1_score <= 5),
  question_2_choice TEXT, -- Which prompt (A or B) student answered
  question_2_score INTEGER NOT NULL CHECK (question_2_score >= 1 AND question_2_score <= 5),
  notes TEXT, -- Optional notes from grader
  
  -- Computed total score
  total_score NUMERIC GENERATED ALWAYS AS (question_1_score + question_2_score) STORED,
  
  -- Metadata
  graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT unique_grader_per_application UNIQUE (application_id, grader_id),
  CONSTRAINT valid_question_2_choice CHECK (question_2_choice IS NULL OR question_2_choice IN ('A', 'B'))
);

-- Step 4: Create indexes for video_grades
CREATE INDEX IF NOT EXISTS idx_video_grades_application_id ON public.video_grades(application_id);
CREATE INDEX IF NOT EXISTS idx_video_grades_grader_id ON public.video_grades(grader_id);
CREATE INDEX IF NOT EXISTS idx_video_grades_game_id ON public.video_grades(game_id);

-- Step 5: Add application_id column to resumes (optional, for direct linking)
-- Note: This allows us to optionally link resumes directly to applications
-- But resumes can still exist without applications (backwards compatible)
ALTER TABLE public.resumes 
ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resumes_application_id ON public.resumes(application_id);

-- Step 6: Enable RLS on new tables
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_grades ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies for applications table
-- Allow anyone to INSERT (for public application submission)
DROP POLICY IF EXISTS "Anyone can submit applications" ON public.applications;
CREATE POLICY "Anyone can submit applications"
  ON public.applications FOR INSERT
  WITH CHECK (true); -- Public access for submissions

-- Allow authenticated users to read applications in games they have access to
DROP POLICY IF EXISTS "Authenticated users can read applications in their games" ON public.applications;
CREATE POLICY "Authenticated users can read applications in their games"
  ON public.applications FOR SELECT
  TO authenticated
  USING (
    game_id IN (
      SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid()
    )
    OR game_id IN (
      SELECT id FROM public.games WHERE created_by = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- Allow admins and game creators to update applications
DROP POLICY IF EXISTS "Admins and game creators can update applications" ON public.applications;
CREATE POLICY "Admins and game creators can update applications"
  ON public.applications FOR UPDATE
  USING (
    game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Step 8: Create RLS policies for video_grades table
-- Allow authenticated users to insert their own grades
DROP POLICY IF EXISTS "Authenticated users can insert their own grades" ON public.video_grades;
CREATE POLICY "Authenticated users can insert their own grades"
  ON public.video_grades FOR INSERT
  WITH CHECK (
    grader_id = auth.uid()
    AND (
      game_id IN (
        SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid()
      )
      OR game_id IN (
        SELECT id FROM public.games WHERE created_by = auth.uid()
      )
      OR public.has_role(auth.uid(), 'admin')
    )
  );

-- Allow users to read grades they made or in games they created/admin
DROP POLICY IF EXISTS "Users can read grades in their games" ON public.video_grades;
CREATE POLICY "Users can read grades in their games"
  ON public.video_grades FOR SELECT
  USING (
    grader_id = auth.uid()
    OR game_id IN (SELECT id FROM public.games WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Allow users to update their own grades
DROP POLICY IF EXISTS "Users can update their own grades" ON public.video_grades;
CREATE POLICY "Users can update their own grades"
  ON public.video_grades FOR UPDATE
  USING (
    grader_id = auth.uid()
    AND (
      game_id IN (
        SELECT DISTINCT game_id FROM public.comparisons WHERE user_id = auth.uid()
      )
      OR game_id IN (
        SELECT id FROM public.games WHERE created_by = auth.uid()
      )
      OR public.has_role(auth.uid(), 'admin')
    )
  );

-- Step 9: Create storage bucket for profile pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', false)
ON CONFLICT (id) DO NOTHING;

-- Step 10: Create storage policies for profile pictures
-- Allow anyone to upload profile pictures (for application submission)
DROP POLICY IF EXISTS "Anyone can upload profile pictures" ON storage.objects;
CREATE POLICY "Anyone can upload profile pictures"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-pictures'
  );

-- Allow authenticated users to view profile pictures
DROP POLICY IF EXISTS "Authenticated users can view profile pictures" ON storage.objects;
CREATE POLICY "Authenticated users can view profile pictures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-pictures');

-- Allow admins to delete profile pictures
DROP POLICY IF EXISTS "Admins can delete profile pictures" ON storage.objects;
CREATE POLICY "Admins can delete profile pictures"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'profile-pictures'
    AND public.has_role(auth.uid(), 'admin')
  );

-- Step 11: Create RPC function to validate access token (public, no auth required)
CREATE OR REPLACE FUNCTION public.validate_access_token(p_access_token TEXT)
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
    'valid', true,
    'id', v_game.id,
    'name', v_game.name,
    'access_token', v_game.access_token
  );
END;
$$;

-- Step 12: Create RPC function to submit application (public, no auth required)
CREATE OR REPLACE FUNCTION public.submit_application(
  p_access_token TEXT,
  p_applicant_name TEXT,
  p_applicant_email TEXT,
  p_year TEXT,
  p_expected_graduation_year TEXT,
  p_gender TEXT,
  p_major TEXT,
  p_minor TEXT,
  p_college_of_primary_major TEXT,
  p_gpa TEXT,
  p_act_score TEXT,
  p_sat_score TEXT,
  p_military_affiliated TEXT,
  p_first_time_applying TEXT,
  p_how_did_you_hear TEXT,
  p_resume_path TEXT,
  p_profile_picture_path TEXT,
  p_video_youtube_url TEXT,
  p_video_question_2_choice TEXT,
  p_additional_info TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_resume_id UUID;
  v_application_id UUID;
BEGIN
  -- Validate access token and get game_id
  SELECT id INTO v_game_id
  FROM games
  WHERE access_token = UPPER(p_access_token);

  IF v_game_id IS NULL THEN
    RETURN json_build_object('error', 'Invalid access token');
  END IF;

  -- Check if email already submitted for this game
  IF EXISTS (
    SELECT 1 FROM applications
    WHERE game_id = v_game_id AND applicant_email = LOWER(p_applicant_email)
  ) THEN
    RETURN json_build_object('error', 'You have already submitted an application for this period');
  END IF;

  -- Create resume record if resume_path provided
  IF p_resume_path IS NOT NULL THEN
    INSERT INTO resumes (name, pdf_path, game_id)
    VALUES (
      p_applicant_name || ' - Resume',
      p_resume_path,
      v_game_id
    )
    RETURNING id INTO v_resume_id;
  END IF;

  -- Create application record
  INSERT INTO applications (
    game_id,
    applicant_name,
    applicant_email,
    year,
    expected_graduation_year,
    gender,
    major,
    minor,
    college_of_primary_major,
    gpa,
    act_score,
    sat_score,
    military_affiliated,
    first_time_applying,
    how_did_you_hear,
    resume_id,
    profile_picture_path,
    video_youtube_url,
    video_question_2_choice,
    additional_info
  )
  VALUES (
    v_game_id,
    p_applicant_name,
    LOWER(p_applicant_email),
    p_year,
    p_expected_graduation_year,
    p_gender,
    p_major,
    p_minor,
    p_college_of_primary_major,
    p_gpa,
    p_act_score,
    p_sat_score,
    p_military_affiliated,
    p_first_time_applying,
    p_how_did_you_hear,
    v_resume_id,
    p_profile_picture_path,
    p_video_youtube_url,
    p_video_question_2_choice,
    p_additional_info
  )
  RETURNING id INTO v_application_id;

  -- Link resume to application if resume was created
  IF v_resume_id IS NOT NULL THEN
    UPDATE resumes
    SET application_id = v_application_id
    WHERE id = v_resume_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'application_id', v_application_id,
    'message', 'Application submitted successfully'
  );
END;
$$;

-- Step 13: Create RPC function to get applications for grading
CREATE OR REPLACE FUNCTION public.get_applications_for_grading(
  p_game_id UUID,
  p_grader_id UUID,
  p_graded_only BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF p_graded_only THEN
    -- Get only graded applications
    SELECT json_agg(
      json_build_object(
        'id', a.id,
        'applicant_name', a.applicant_name,
        'applicant_email', a.applicant_email,
        'year', a.year,
        'major', a.major,
        'profile_picture_path', a.profile_picture_path,
        'video_youtube_url', a.video_youtube_url,
        'video_question_2_choice', a.video_question_2_choice,
        'submitted_at', a.submitted_at,
        'graded', EXISTS (
          SELECT 1 FROM video_grades vg
          WHERE vg.application_id = a.id AND vg.grader_id = p_grader_id
        )
      )
      ORDER BY a.submitted_at DESC
    )
    INTO v_result
    FROM applications a
    WHERE a.game_id = p_game_id
      AND EXISTS (
        SELECT 1 FROM video_grades vg
        WHERE vg.application_id = a.id AND vg.grader_id = p_grader_id
      );
  ELSE
    -- Get all applications with graded status
    SELECT json_agg(
      json_build_object(
        'id', a.id,
        'applicant_name', a.applicant_name,
        'applicant_email', a.applicant_email,
        'year', a.year,
        'major', a.major,
        'profile_picture_path', a.profile_picture_path,
        'video_youtube_url', a.video_youtube_url,
        'video_question_2_choice', a.video_question_2_choice,
        'submitted_at', a.submitted_at,
        'graded', EXISTS (
          SELECT 1 FROM video_grades vg
          WHERE vg.application_id = a.id AND vg.grader_id = p_grader_id
        )
      )
      ORDER BY 
        CASE WHEN EXISTS (
          SELECT 1 FROM video_grades vg
          WHERE vg.application_id = a.id AND vg.grader_id = p_grader_id
        ) THEN 1 ELSE 0 END,
        a.submitted_at DESC
    )
    INTO v_result
    FROM applications a
    WHERE a.game_id = p_game_id;
  END IF;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Step 14: Create RPC function to get single application with all details
CREATE OR REPLACE FUNCTION public.get_application_details(p_application_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', a.id,
    'game_id', a.game_id,
    'applicant_name', a.applicant_name,
    'applicant_email', a.applicant_email,
    'year', a.year,
    'expected_graduation_year', a.expected_graduation_year,
    'gender', a.gender,
    'major', a.major,
    'minor', a.minor,
    'college_of_primary_major', a.college_of_primary_major,
    'gpa', a.gpa,
    'act_score', a.act_score,
    'sat_score', a.sat_score,
    'military_affiliated', a.military_affiliated,
    'first_time_applying', a.first_time_applying,
    'how_did_you_hear', a.how_did_you_hear,
    'resume_id', a.resume_id,
    'profile_picture_path', a.profile_picture_path,
    'video_youtube_url', a.video_youtube_url,
    'video_question_2_choice', a.video_question_2_choice,
    'additional_info', a.additional_info,
    'submitted_at', a.submitted_at,
    'status', a.status
  )
  INTO v_result
  FROM applications a
  WHERE a.id = p_application_id;

  RETURN v_result;
END;
$$;

-- Step 15: Create RPC function to submit video grade
CREATE OR REPLACE FUNCTION public.submit_video_grade(
  p_application_id UUID,
  p_grader_id UUID,
  p_question_1_score INTEGER,
  p_question_2_choice TEXT,
  p_question_2_score INTEGER,
  p_notes TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_grade_id UUID;
BEGIN
  -- Get game_id from application
  SELECT game_id INTO v_game_id
  FROM applications
  WHERE id = p_application_id;

  IF v_game_id IS NULL THEN
    RETURN json_build_object('error', 'Application not found');
  END IF;

  -- Validate scores
  IF p_question_1_score < 1 OR p_question_1_score > 5 THEN
    RETURN json_build_object('error', 'Question 1 score must be between 1 and 5');
  END IF;

  IF p_question_2_score < 1 OR p_question_2_score > 5 THEN
    RETURN json_build_object('error', 'Question 2 score must be between 1 and 5');
  END IF;

  -- Insert or update grade (UPSERT)
  INSERT INTO video_grades (
    application_id,
    grader_id,
    game_id,
    question_1_score,
    question_2_choice,
    question_2_score,
    notes
  )
  VALUES (
    p_application_id,
    p_grader_id,
    v_game_id,
    p_question_1_score,
    p_question_2_choice,
    p_question_2_score,
    p_notes
  )
  ON CONFLICT (application_id, grader_id)
  DO UPDATE SET
    question_1_score = EXCLUDED.question_1_score,
    question_2_choice = EXCLUDED.question_2_choice,
    question_2_score = EXCLUDED.question_2_score,
    notes = EXCLUDED.notes,
    graded_at = now()
  RETURNING id INTO v_grade_id;

  RETURN json_build_object(
    'success', true,
    'grade_id', v_grade_id,
    'total_score', p_question_1_score + p_question_2_score
  );
END;
$$;

