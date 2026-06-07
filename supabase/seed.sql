-- ============================================================================
-- Seed de démonstration (à exécuter UNE fois, en local ou via Studio).
--
-- Pré-requis : avoir créé les 3 utilisateurs dans Supabase Auth (mail + mdp) :
--   Sacha, Mika et Azuria.
-- Le bloc « profils » plus bas résout leur UUID automatiquement par email.
-- ============================================================================

-- 1. Établissement
insert into public.establishments (id, name, siret)
values ('11111111-1111-1111-1111-111111111111', 'Le Restaurant Démo', '00000000000000')
on conflict (id) do nothing;

-- 2. Profils des 3 users : Sacha, Mika, Zuria.
-- Pré-requis : les 3 comptes existent dans Supabase Auth (Authentication → Users).
-- On résout l'UUID automatiquement par email — remplace juste les 3 emails ci-dessous
-- par les vrais emails de connexion (plus simple qu'un UUID à recopier).
insert into public.profiles (id, establishment_id, full_name, role)
select u.id, '11111111-1111-1111-1111-111111111111', m.full_name, 'owner'
from (values
  ('sdanguin@gmail.com',            'Sacha'),
  ('michaelherrera762@gmail.com',   'Mika'),
  ('bonjour@rose-marseille.fr',     'Azuria')
) as m(email, full_name)
join auth.users u on u.email = m.email
on conflict (id) do nothing;

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
