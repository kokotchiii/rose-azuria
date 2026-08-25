-- ============================================================================
-- Boîte de réception e-mail : les factures reçues par mail atterrissent ici en
-- « à valider ». Un robot (Google Apps Script) pousse les pièces jointes vers
-- l'Edge Function `ingest-email`, qui crée un `document` source='email' à valider.
-- ============================================================================

alter table public.documents
  add column if not exists source text not null default 'capture'
  check (source in ('capture', 'email'));

alter table public.documents
  add column if not exists review_status text
  check (review_status in ('pending', 'validated', 'ignored'));

alter table public.documents add column if not exists email_from       text;
alter table public.documents add column if not exists email_subject    text;
alter table public.documents add column if not exists email_message_id text;
alter table public.documents add column if not exists email_received_at timestamptz;

-- Lien vers la dépense créée à la validation (pour ne pas re-traiter).
alter table public.documents
  add column if not exists expense_id uuid references public.expenses(id) on delete set null;

-- Dédoublonnage : un même e-mail (message-id) + pièce jointe n'entre qu'une fois.
create unique index if not exists documents_email_msg_unique
  on public.documents(establishment_id, email_message_id, storage_path)
  where email_message_id is not null;

-- File de travail : les documents email en attente de validation.
create index if not exists documents_review_idx
  on public.documents(establishment_id, source, review_status);
