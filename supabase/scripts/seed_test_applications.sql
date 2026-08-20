-- Run this AFTER you've created at least one Application Period from the
-- Admin UI on your local stack. Inserts 8 fake candidates into whichever
-- game was created most recently, so Interview Scoring / Deliberation have
-- something to work with. Local dev only -- never run against production.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/scripts/seed_test_applications.sql

INSERT INTO public.applications (
  game_id, applicant_name, first_name, last_name, applicant_email,
  year, major, video_youtube_url, video_question_2_choice
)
SELECT
  (SELECT id FROM public.games ORDER BY created_at DESC LIMIT 1),
  t.first_name || ' ' || t.last_name,
  t.first_name,
  t.last_name,
  lower(t.first_name || '.' || t.last_name || '@osu.edu'),
  t.year,
  t.major,
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  t.q2
FROM (VALUES
  ('Ava',     'Chen',      'Sophomore', 'Finance',           'A'),
  ('Liam',    'Nguyen',    'Junior',    'Computer Science',  'B'),
  ('Maya',    'Patel',     'Freshman',  'Economics',         'A'),
  ('Noah',    'Garcia',    'Senior',    'Accounting',        'B'),
  ('Sophia',  'Kim',       'Sophomore', 'Finance',           'A'),
  ('Ethan',   'Brooks',    'Junior',    'Computer Science',  'B'),
  ('Isabella','Rossi',     'Freshman',  'Marketing',         'A'),
  ('Mason',   'Ali',       'Senior',    'Finance',           'B')
) AS t(first_name, last_name, year, major, q2)
WHERE EXISTS (SELECT 1 FROM public.games)
ON CONFLICT (game_id, applicant_email) DO NOTHING;
