-- ============================================================================
-- Galerie photos du restaurant : photos « comm » (plats, ambiance, événements),
-- séparées des justificatifs/factures. Sert à garder un album et à exporter les
-- photos plus tard pour des montages.
-- Les fichiers vont dans le bucket privé `documents`, dans <estab>/gallery/...
-- (les policies Storage existantes filtrent déjà sur le 1er dossier = estab).
-- ============================================================================

create table if not exists public.gallery_photos (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  storage_path     text not null,
  caption          text,
  taken_at         timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists gallery_estab_idx on public.gallery_photos(establishment_id);

alter table public.gallery_photos enable row level security;
create policy "gallery_all_same_estab" on public.gallery_photos
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

alter publication supabase_realtime add table public.gallery_photos;
