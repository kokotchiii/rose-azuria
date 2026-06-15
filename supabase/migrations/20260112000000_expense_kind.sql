-- ============================================================================
-- Type de dépense : distinguer les FACTURES FOURNISSEURS des ACHATS DE DÉPANNAGE
-- (petits achats à droite à gauche, tickets, notes de frais…).
--   'facture'   : facture/bon de livraison d'un fournisseur référencé.
--   'depannage' : petit achat ponctuel, ticket, note de frais.
-- ============================================================================

alter table public.expenses
  add column if not exists kind text not null default 'facture'
  check (kind in ('facture', 'depannage'));

create index if not exists expenses_kind_idx on public.expenses(kind);
