-- ============================================================================
-- TVA collectée saisie manuellement (en €) sur une recette.
-- Sur un ticket, la TVA n'est pas un taux unique : selon les catégories vendues
-- (plats 10 %, alcool 20 %, à emporter 5,5 %…) elle varie. On permet donc de
-- saisir directement le montant de TVA collectée.
-- Si tva_amount est renseigné, il prime sur tva_rate :
--   TVA = tva_amount ; HT = TTC − tva_amount.
-- Sinon on retombe sur le taux (tva_rate ou taux par défaut).
-- ============================================================================

alter table public.revenues
  add column if not exists tva_amount numeric(12,2);

comment on column public.revenues.tva_amount is
  'Montant de TVA collectée saisi manuellement (€). NULL = calculé depuis tva_rate.';
