-- ============================================================================
-- Rapprochement bancaire : on importe les opérations d'un relevé bancaire
-- (lues depuis un PDF par l'IA), puis on les pointe contre les dépenses saisies.
--   bank_transactions : une ligne = une opération du relevé.
--   expenses.reconciled : true quand la dépense a été pointée avec une opération.
-- ============================================================================

create table if not exists public.bank_transactions (
  id                 uuid primary key default gen_random_uuid(),
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  import_batch       uuid,                        -- regroupe les lignes d'un même import
  tx_date            date not null,               -- date de l'opération
  label              text not null,               -- libellé brut du relevé
  amount             numeric(12,2) not null,      -- négatif = débit, positif = crédit
  direction          text not null check (direction in ('debit','credit')),
  matched_expense_id uuid references public.expenses(id) on delete set null,
  status             text not null default 'unmatched'
                       check (status in ('unmatched','matched','ignored')),
  raw_json           jsonb,                       -- ligne brute extraite par l'IA (audit)
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists bank_tx_estab_idx   on public.bank_transactions(establishment_id);
create index if not exists bank_tx_date_idx    on public.bank_transactions(tx_date);
create index if not exists bank_tx_expense_idx on public.bank_transactions(matched_expense_id);
create index if not exists bank_tx_batch_idx   on public.bank_transactions(import_batch);

alter table public.bank_transactions enable row level security;
create policy "bank_tx_all_same_estab" on public.bank_transactions
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- Temps réel : le tableau de pointage se met à jour en direct entre appareils.
alter publication supabase_realtime add table public.bank_transactions;

-- Marqueur "pointée" sur la dépense (rapprochée avec une opération bancaire).
alter table public.expenses
  add column if not exists reconciled boolean not null default false;
create index if not exists expenses_reconciled_idx on public.expenses(reconciled);
