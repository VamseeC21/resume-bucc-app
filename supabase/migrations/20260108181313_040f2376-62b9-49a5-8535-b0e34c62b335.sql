-- Drop overly permissive policy and create proper one
DROP POLICY IF EXISTS "System can update ratings" ON public.elo_ratings;

-- Only allow updates through RPC functions (security definer)
-- Direct table updates not allowed - updates happen via submit_comparison RPC
REVOKE UPDATE ON public.elo_ratings FROM authenticated;
REVOKE UPDATE ON public.elo_ratings FROM anon;