-- ============================================================================
-- Vérification des justificatifs (notes de frais) : pointer qu'on a bien le
-- justificatif papier en main pour une dépense perso à rembourser.
-- ============================================================================

alter table public.expenses
  add column if not exists justif_verified boolean not null default false;
alter table public.expenses
  add column if not exists justif_verified_at timestamptz;
