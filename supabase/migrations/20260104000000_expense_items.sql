-- ============================================================================
-- Lignes d'articles des factures (extraites par l'IA).
-- Permet : stats produits récurrents, variation de prix, fréquence d'achat.
-- ============================================================================

create table public.expense_items (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  expense_id        uuid not null references public.expenses(id) on delete cascade,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  category_id       uuid references public.categories(id) on delete set null,
  expense_date      date not null,                        -- recopié pour requêtes rapides

  description       text not null,                        -- libellé brut tel que extrait
  -- libellé normalisé pour grouper "Coca-Cola 1L", "COCA COLA 1 L", etc.
  -- = lowercase + suppression accents + espaces simples + trim
  normalized_label  text not null,

  quantity          numeric,
  unit_price        numeric,                              -- € / unité
  line_total        numeric,                              -- quantity * unit_price si dispo

  created_at        timestamptz not null default now()
);
create index on public.expense_items(establishment_id);
create index on public.expense_items(expense_id);
create index on public.expense_items(supplier_id);
create index on public.expense_items(normalized_label);
create index on public.expense_items(expense_date);

alter table public.expense_items enable row level security;

create policy "expense_items_all_same_estab" on public.expense_items
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- ----------------------------------------------------------------------------
-- Aide à la déduplication : hash du fichier uploadé (calculé côté client SHA-256)
-- ----------------------------------------------------------------------------
alter table public.documents add column if not exists file_hash text;
create index if not exists documents_file_hash_idx on public.documents(establishment_id, file_hash);

-- ----------------------------------------------------------------------------
-- Aide au dedup : index unique souple sur (fournisseur + numéro facture).
-- Non strict (l'utilisateur peut avoir des doublons légitimes), juste pour
-- requêtes rapides depuis le code.
-- ----------------------------------------------------------------------------
create index if not exists expenses_supplier_invoice_idx
  on public.expenses(establishment_id, supplier_id, invoice_number)
  where invoice_number is not null;
