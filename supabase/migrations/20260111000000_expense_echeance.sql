-- ============================================================================
-- Échéances de paiement des factures.
-- - due_date : date d'échéance lue sur la facture (« à régler avant le… »).
-- - paid / paid_at : suivi de ce qui a été réglé.
-- L'échéancier « À payer » = dépenses avec une due_date NON réglées.
-- ============================================================================

alter table public.expenses add column if not exists due_date date;
alter table public.expenses add column if not exists paid boolean not null default false;
alter table public.expenses add column if not exists paid_at timestamptz;

create index if not exists expenses_due_date_idx on public.expenses(due_date);
create index if not exists expenses_paid_idx on public.expenses(paid);
