-- ============================================================================
-- Travaux & dépenses à prévoir : ce qu'on aimerait financer plus tard
-- (rénovation, matériel, gros achats…). Sert à estimer quand on pourra le faire
-- en fonction de l'épargne mensuelle (recettes − dépenses).
-- ============================================================================

create table public.planned_expenses (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  label             text not null,
  description       text,
  estimated_amount  numeric(12,2) not null default 0,
  category          text,                       -- libellé libre (travaux, matériel, véhicule…)
  priority          text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  target_date       date,                       -- échéance souhaitée (optionnel)
  status            text not null default 'idea' check (status in ('idea','planned','done')),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.planned_expenses(establishment_id);
create index on public.planned_expenses(status);

alter table public.planned_expenses enable row level security;
create policy "planned_all_same_estab" on public.planned_expenses
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- Trigger updated_at (fonction définie dans la migration tasks)
create trigger trg_planned_updated
before update on public.planned_expenses
for each row execute function public.touch_updated_at();

-- Temps réel : la liste se met à jour en direct entre appareils.
alter publication supabase_realtime add table public.planned_expenses;
