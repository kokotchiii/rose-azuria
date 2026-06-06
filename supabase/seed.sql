-- ============================================================================
-- Seed de démonstration (à exécuter UNE fois, en local ou via Studio).
--
-- Pré-requis : avoir créé 2 utilisateurs dans Supabase Auth (mail + mdp)
--   p.ex. patron@resto.fr et associe@resto.fr
-- Puis remplacer les UUID ci-dessous par leurs vrais auth.users.id
-- (visibles dans Authentication → Users dans le Studio).
-- ============================================================================

-- 1. Établissement
insert into public.establishments (id, name, siret)
values ('11111111-1111-1111-1111-111111111111', 'Le Restaurant Démo', '00000000000000')
on conflict (id) do nothing;

-- 2. Profils des 3 users (REMPLACER les UUID par ceux d'auth.users)
-- insert into public.profiles (id, establishment_id, full_name, role) values
--   ('AUTH_USER_ID_1', '11111111-1111-1111-1111-111111111111', 'Sacha', 'owner'),
--   ('AUTH_USER_ID_2', '11111111-1111-1111-1111-111111111111', 'Mika',  'owner'),
--   ('AUTH_USER_ID_3', '11111111-1111-1111-1111-111111111111', 'Zuria', 'owner')
-- on conflict (id) do nothing;

-- 3. Catégories par défaut
insert into public.categories (establishment_id, label) values
  ('11111111-1111-1111-1111-111111111111', 'Matières premières (food)'),
  ('11111111-1111-1111-1111-111111111111', 'Boissons'),
  ('11111111-1111-1111-1111-111111111111', 'Loyer'),
  ('11111111-1111-1111-1111-111111111111', 'Énergie / fluides'),
  ('11111111-1111-1111-1111-111111111111', 'Équipement / entretien'),
  ('11111111-1111-1111-1111-111111111111', 'Fournitures'),
  ('11111111-1111-1111-1111-111111111111', 'Marketing'),
  ('11111111-1111-1111-1111-111111111111', 'Frais bancaires'),
  ('11111111-1111-1111-1111-111111111111', 'Transport / déplacements'),
  ('11111111-1111-1111-1111-111111111111', 'Honoraires (comptable…)'),
  ('11111111-1111-1111-1111-111111111111', 'Taxes'),
  ('11111111-1111-1111-1111-111111111111', 'Autres')
on conflict do nothing;

-- 4. Quelques fournisseurs
insert into public.suppliers (establishment_id, name, contact) values
  ('11111111-1111-1111-1111-111111111111', 'Metro Toulon',       'metro.fr'),
  ('11111111-1111-1111-1111-111111111111', 'Promocash',          'promocash.com'),
  ('11111111-1111-1111-1111-111111111111', 'EDF Pro',            'edf.fr'),
  ('11111111-1111-1111-1111-111111111111', 'Maison du Café',     '');

-- 5. Quelques extras (personnel)
insert into public.extra_workers (establishment_id, full_name, default_type, default_rate) values
  ('11111111-1111-1111-1111-111111111111', 'Julie M.',  'salle',   90),
  ('11111111-1111-1111-1111-111111111111', 'Karim B.',  'cuisine', 110),
  ('11111111-1111-1111-1111-111111111111', 'Léa T.',    'plonge',  70);

-- Note : laissez les expenses/orders vides au début, ils se créeront via l'app.
