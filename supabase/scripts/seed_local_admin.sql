-- Creates a ready-to-use local admin login and one test "Local Test Cycle"
-- application period. Local dev only -- never run against production.
-- Re-run after `supabase db reset` to recreate both.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/scripts/seed_local_admin.sql
--
-- Login:  admin@local.test / localtest123

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
)
SELECT
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'admin@local.test', crypt('localtest123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"first_name":"Local","last_name":"Admin"}',
  now(), now(), '', '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@local.test');

UPDATE public.profiles SET role = 'admin', first_name = 'Local', last_name = 'Admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@local.test');

INSERT INTO public.games (name, access_token, created_by)
SELECT 'Local Test Cycle', 'LOCAL123', id FROM auth.users WHERE email = 'admin@local.test'
ON CONFLICT (access_token) DO NOTHING;
