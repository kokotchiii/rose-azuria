-- ============================================================================
-- Schéma initial : gestion des dépenses & factures restaurant
-- Toutes les tables sont rattachées à `establishment_id` pour isoler les
-- données via Row Level Security (cf. migration suivante).
-- ============================================================================

-- (Pas besoin d'extension : gen_random_uuid() est natif Postgres 13+ sur Supabase)

-- ---------------------------------------------------------------------------
-- Établissements (1 restaurant = 1 ligne)
-- ---------------------------------------------------------------------------
create table public.establishments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  siret        text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profils utilisateurs (étend auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  full_name         text,
  role              text not null default 'owner' check (role in ('owner','member')),
  created_at        timestamptz not null default now()
);
create index on public.profiles(establishment_id);

-- ---------------------------------------------------------------------------
-- Catégories de dépense (paramétrables par établissement)
-- ---------------------------------------------------------------------------
create table public.categories (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  label             text not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (establishment_id, label)
);
create index on public.categories(establishment_id);

-- ---------------------------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id                   uuid primary key default gen_random_uuid(),
  establishment_id     uuid not null references public.establishments(id) on delete cascade,
  name                 text not null,
  siret                text,
  default_category_id  uuid references public.categories(id) on delete set null,
  contact              text,
  created_at           timestamptz not null default now()
);
create index on public.suppliers(establishment_id);

-- ---------------------------------------------------------------------------
-- Documents (justificatifs uploadés : factures, BL, tickets…)
-- `storage_path` pointe vers un fichier du bucket `documents`.
-- ---------------------------------------------------------------------------
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  storage_path      text not null,
  file_type         text,                  -- 'image/jpeg', 'application/pdf'…
  uploaded_by       uuid references public.profiles(id) on delete set null,
  ai_status         text not null default 'pending' check (ai_status in ('pending','done','failed')),
  ai_raw_json       jsonb,                 -- réponse brute de l'IA
  created_at        timestamptz not null default now()
);
create index on public.documents(establishment_id);
create index on public.documents(ai_status);

-- ---------------------------------------------------------------------------
-- Commandes fournisseurs (créées avant la facture)
-- ---------------------------------------------------------------------------
create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  order_date        date not null,
  status            text not null default 'brouillon'
                    check (status in ('brouillon','envoyee','livree_partielle','livree','facturee')),
  category_id       uuid references public.categories(id) on delete set null,
  note              text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.orders(establishment_id);

create table public.order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  description  text not null,
  quantity     numeric,
  unit_price   numeric
);
create index on public.order_lines(order_id);

create table public.order_documents (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  kind         text not null check (kind in ('bon_livraison','facture')),
  unique (order_id, document_id)
);

-- ---------------------------------------------------------------------------
-- Dépenses (cœur de l'app)
-- `reimbursable` est mis à true automatiquement par trigger si la source est
-- une carte/espèces perso (cf. plus bas).
-- ---------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  expense_date      date not null,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  category_id       uuid references public.categories(id) on delete set null,
  amount_ttc        numeric(12,2) not null,
  tva_rate          numeric(5,2),
  amount_tva        numeric(12,2),
  payer_id          uuid references public.profiles(id) on delete set null,
  payment_source    text not null check (payment_source in ('cb_pro','cb_perso','especes','virement')),
  invoice_number    text,
  document_id       uuid references public.documents(id) on delete set null,
  order_id          uuid references public.orders(id) on delete set null,
  note              text,
  reimbursable      boolean not null default false,
  reimbursed        boolean not null default false,
  reimbursed_at     timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.expenses(establishment_id);
create index on public.expenses(expense_date);
create index on public.expenses(category_id);
create index on public.expenses(payer_id);

-- Trigger : si payée en cb_perso → reimbursable = true par défaut
create or replace function public.set_reimbursable_flag()
returns trigger language plpgsql as $$
begin
  if new.payment_source = 'cb_perso' then
    new.reimbursable := true;
  end if;
  return new;
end;
$$;

create trigger trg_expenses_reimbursable
before insert or update on public.expenses
for each row execute function public.set_reimbursable_flag();

-- ---------------------------------------------------------------------------
-- Sorties d'espèces (retraits caisse / dépenses cash diverses)
-- ---------------------------------------------------------------------------
create table public.cash_withdrawals (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  withdrawal_date   date not null,
  amount            numeric(12,2) not null,
  reason            text,
  user_id           uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.cash_withdrawals(establishment_id);

-- ---------------------------------------------------------------------------
-- Personnel extra
-- `extra_workers` = répertoire des personnes
-- `extras`        = chaque vacation payée
-- ---------------------------------------------------------------------------
create table public.extra_workers (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  full_name         text not null,
  default_type      text check (default_type in ('salle','cuisine','plonge','bar','commis','autre')),
  default_rate      numeric(10,2),
  contact           text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index on public.extra_workers(establishment_id);

create table public.extras (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  worker_id         uuid not null references public.extra_workers(id) on delete restrict,
  extra_date        date not null,
  service           text check (service in ('midi','soir','journee')),
  extra_type        text not null check (extra_type in ('salle','cuisine','plonge','bar','commis','autre')),
  hours             numeric(5,2),
  amount_paid       numeric(12,2) not null,
  payment_source    text not null check (payment_source in ('especes','cb','virement')),
  document_id       uuid references public.documents(id) on delete set null,
  note              text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.extras(establishment_id);
create index on public.extras(extra_date);
create index on public.extras(worker_id);
