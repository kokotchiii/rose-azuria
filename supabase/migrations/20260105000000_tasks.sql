-- ============================================================================
-- To-do list partagée (tâches du restaurant).
-- ============================================================================

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  title             text not null,
  description       text,
  status            text not null default 'todo' check (status in ('todo','doing','done')),
  priority          text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date          date,
  assignee_id       uuid references public.profiles(id) on delete set null, -- null = à faire par n'importe qui
  created_by        uuid references public.profiles(id) on delete set null,
  completed_at      timestamptz,
  completed_by      uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.tasks(establishment_id);
create index on public.tasks(status);
create index on public.tasks(due_date);

alter table public.tasks enable row level security;
create policy "tasks_all_same_estab" on public.tasks
for all using (establishment_id = public.current_establishment_id())
with check     (establishment_id = public.current_establishment_id());

-- Trigger updated_at automatique
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_tasks_updated
before update on public.tasks
for each row execute function public.touch_updated_at();
