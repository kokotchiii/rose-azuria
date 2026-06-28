-- ============================================================================
-- Événements : recette avec la FACTURE ÉMISE (document client).
--  - revenues.document_id : la facture émise pour cette recette d'événement.
-- (Ajout additif : ne casse aucune version existante de l'app.)
-- ============================================================================

alter table public.revenues
  add column if not exists document_id uuid references public.documents(id) on delete set null;
