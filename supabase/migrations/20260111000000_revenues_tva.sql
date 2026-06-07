-- ============================================================================
-- TVA sur les recettes : taux applicable à une saisie de CA.
-- En restauration (France) : 10 % sur place, 5,5 % à emporter (vente à
-- consommation différée), 20 % sur l'alcool. On stocke un taux par recette
-- (null = utiliser le taux par défaut de l'app au moment du calcul).
-- HT = TTC / (1 + taux/100) ; TVA collectée = TTC − HT.
-- ============================================================================

alter table public.revenues
  add column if not exists tva_rate numeric(5,2);

comment on column public.revenues.tva_rate is
  'Taux de TVA (%) applicable à cette recette. NULL = taux par défaut de l''app.';
