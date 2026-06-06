-- ============================================================================
-- Bucket Storage `documents` : factures, bons de livraison, tickets…
-- Privé (pas en lecture publique). On signe les URLs côté client si besoin.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Policies sur storage.objects : un user accède uniquement aux fichiers de
-- son établissement. On range les fichiers par dossier = establishment_id.
-- Exemple de chemin : "<establishment_id>/2026/01/abc.jpg".

create policy "documents_select_same_estab" on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = public.current_establishment_id()::text
);

create policy "documents_insert_same_estab" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = public.current_establishment_id()::text
);

create policy "documents_delete_same_estab" on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = public.current_establishment_id()::text
);
