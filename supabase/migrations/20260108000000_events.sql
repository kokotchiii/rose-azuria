-- ============================================================================
-- Événements : regrouper des dépenses ET des recettes sous un même événement
-- (ex. « Mariage 12/06 »), pour suivre la rentabilité (recettes − dépenses).
-- Un item (dépense ou recette) appartient à au plus un événement ; null = aucun.
-- ============================================================================

create table public.events (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  event_date        date,
  note              text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.events(establishment_id);

alter table public.events enable row level security;
create policy "events_all_same_estab" on public.events
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- Rattachement des items existants (on delete set null = supprimer un événement
-- ne supprime pas les dépenses/recettes, ça les détache simplement).
alter table public.expenses add column event_id uuid references public.events(id) on delete set null;
alter table public.revenues add column event_id uuid references public.events(id) on delete set null;
create index on public.expenses(event_id);
create index on public.revenues(event_id);
