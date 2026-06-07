-- ============================================================================
-- Active Supabase Realtime sur ai_usage et expenses : le tableau de bord
-- (coût IA, totaux) se met à jour en direct sans recharger l'écran.
-- La RLS s'applique toujours : chaque utilisateur ne reçoit que les
-- changements de son établissement.
-- ============================================================================

alter publication supabase_realtime add table public.ai_usage;
alter publication supabase_realtime add table public.expenses;
