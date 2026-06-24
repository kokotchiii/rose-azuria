-- ============================================================================
-- Coffre à documents importants du restaurant (baux, prêt, statuts, expert,
-- avocat, assurances…), classés par catégorie, avec extraction IA.
-- + Réglages prévisionnel : overrides (loyer, prêt, assurance…) injectés depuis
--   les documents pour pré-remplir le budget prévisionnel.
-- ============================================================================

create table if not exists public.library_documents (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  title            text not null,
  category         text not null default 'autre',   -- juridique, banque, comptable, bail, assurance, rh, autre
  doc_type         text,                              -- bail, pret_bancaire, assurance, honoraires, statuts, kbis, bilan, autre
  storage_path     text not null,
  file_type        text,
  summary          text,                              -- résumé lisible (IA)
  extracted        jsonb,                             -- données structurées (IA)
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists library_estab_idx on public.library_documents(establishment_id);
create index if not exists library_category_idx on public.library_documents(category);

alter table public.library_documents enable row level security;
create policy "library_all_same_estab" on public.library_documents
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

alter publication supabase_realtime add table public.library_documents;

-- Réglages / overrides du prévisionnel (1 ligne par établissement).
create table if not exists public.previsionnel_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  overrides        jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

alter table public.previsionnel_settings enable row level security;
create policy "prev_settings_all_same_estab" on public.previsionnel_settings
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

alter publication supabase_realtime add table public.previsionnel_settings;
