-- ============================================================================
-- Suivi du coût IA : une ligne par appel à l'API Anthropic (classify-document).
-- Alimentée par l'Edge Function (service-role). Lecture réservée à l'établissement.
-- ============================================================================

create table public.ai_usage (
  id                  uuid primary key default gen_random_uuid(),
  establishment_id    uuid not null references public.establishments(id) on delete cascade,
  document_id         uuid references public.documents(id) on delete set null,
  model               text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  cost_usd            numeric(10,5) not null default 0,  -- coût estimé en USD (l'API facture en $)
  created_at          timestamptz not null default now()
);
create index on public.ai_usage(establishment_id);
create index on public.ai_usage(created_at);

alter table public.ai_usage enable row level security;

-- Lecture : membres du même établissement (pour le KPI "Coût IA ce mois").
create policy "ai_usage_select_same_estab" on public.ai_usage
for select using (establishment_id = public.current_establishment_id());

-- Pas de policy insert : seule l'Edge Function (clé service-role) écrit, et elle
-- contourne RLS. Les clients ne peuvent donc pas falsifier les coûts.
