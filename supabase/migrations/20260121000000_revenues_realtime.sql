-- ============================================================================
-- Recettes en TEMPS RÉEL : diffuser les changements de la table revenues pour
-- que la saisie sur un appareil (mobile) se reflète en direct sur les autres (PC).
-- (Idempotent : ne fait rien si déjà membre de la publication.)
-- ============================================================================

do $$
begin
  alter publication supabase_realtime add table public.revenues;
exception
  when duplicate_object then null;
end $$;
