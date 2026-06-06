-- ============================================================================
-- Recettes : saisie du CA par service (midi/soir/journée)
-- Permet stats CA, panier moyen, mix cash/CB, marge brute.
-- ============================================================================

create table public.revenues (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  revenue_date      date not null,
  service           text not null check (service in ('midi','soir','journee','autre')),

  amount_cash       numeric(12,2) not null default 0,
  amount_cb         numeric(12,2) not null default 0,
  amount_other      numeric(12,2) not null default 0,  -- chèque, ticket resto, virement…

  covers            integer,        -- nombre de couverts (clients servis)
  tables_count      integer,        -- nombre de tables servies
  note              text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),

  -- 1 saisie max par (date, service) pour éviter les doublons accidentels
  unique (establishment_id, revenue_date, service)
);
create index on public.revenues(establishment_id);
create index on public.revenues(revenue_date);

alter table public.revenues enable row level security;
create policy "revenues_all_same_estab" on public.revenues
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());
