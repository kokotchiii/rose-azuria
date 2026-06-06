-- ============================================================================
-- Row Level Security : un user ne voit QUE les données de son établissement.
-- Le lien user → establishment passe par `profiles`.
-- ============================================================================

-- Helper SQL : retourne l'establishment_id du user courant.
create or replace function public.current_establishment_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select establishment_id from public.profiles where id = auth.uid();
$$;

-- Activation RLS sur toutes les tables métier
alter table public.establishments     enable row level security;
alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.suppliers           enable row level security;
alter table public.documents           enable row level security;
alter table public.expenses            enable row level security;
alter table public.cash_withdrawals    enable row level security;
alter table public.extra_workers       enable row level security;
alter table public.extras              enable row level security;
alter table public.orders              enable row level security;
alter table public.order_lines         enable row level security;
alter table public.order_documents     enable row level security;

-- ---------------------------------------------------------------------------
-- profiles : un user voit son propre profil ET ceux de son établissement
-- ---------------------------------------------------------------------------
create policy "profiles_select_self_or_same_estab" on public.profiles
for select using (
  id = auth.uid()
  or establishment_id = public.current_establishment_id()
);

create policy "profiles_update_self" on public.profiles
for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- establishments : un user voit son établissement
-- ---------------------------------------------------------------------------
create policy "establishments_select_own" on public.establishments
for select using (id = public.current_establishment_id());

-- ---------------------------------------------------------------------------
-- Policy générique pour les tables "métier" (CRUD sur son establishment)
-- Helper inline : on duplique le pattern (SQL ne fait pas de policy générique).
-- ---------------------------------------------------------------------------

-- categories
create policy "categories_all_same_estab" on public.categories
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- suppliers
create policy "suppliers_all_same_estab" on public.suppliers
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- documents
create policy "documents_all_same_estab" on public.documents
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- expenses
create policy "expenses_all_same_estab" on public.expenses
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- cash_withdrawals
create policy "cash_withdrawals_all_same_estab" on public.cash_withdrawals
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- extra_workers
create policy "extra_workers_all_same_estab" on public.extra_workers
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- extras
create policy "extras_all_same_estab" on public.extras
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- orders
create policy "orders_all_same_estab" on public.orders
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- order_lines (rattachées via order_id)
create policy "order_lines_all_same_estab" on public.order_lines
for all using (
  exists (
    select 1 from public.orders o
    where o.id = order_lines.order_id
      and o.establishment_id = public.current_establishment_id()
  )
)
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_lines.order_id
      and o.establishment_id = public.current_establishment_id()
  )
);

-- order_documents
create policy "order_documents_all_same_estab" on public.order_documents
for all using (
  exists (
    select 1 from public.orders o
    where o.id = order_documents.order_id
      and o.establishment_id = public.current_establishment_id()
  )
)
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_documents.order_id
      and o.establishment_id = public.current_establishment_id()
  )
);
