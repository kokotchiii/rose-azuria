# Resto Dépenses

Gestion des dépenses & factures d'un restaurant, avec **classement automatique par IA** (Claude vision).
- App **PC** Windows → installeur `.exe` (Electron)
- App **iPhone** (Expo / React Native)
- **Supabase** : base PostgreSQL, Auth, Storage, Edge Function qui appelle l'API Anthropic

> ⚠️ Cet outil sert au suivi interne des paiements (dépenses, factures, extras, espèces, notes de frais). Ce n'est PAS une caisse et PAS un logiciel de comptabilité.

---

## 1. Prérequis (à installer une seule fois)

Sur ton PC Windows :

1. **Node.js 20+** — https://nodejs.org → "LTS"
2. **pnpm** (gestionnaire de paquets monorepo) :
   ```powershell
   npm install -g pnpm
   ```
3. **Git** — https://git-scm.com
4. **Supabase CLI** — https://supabase.com/docs/guides/cli
   - Méthode rapide via Scoop :
     ```powershell
     scoop install supabase
     ```
   - Sinon : télécharger l'archive Windows depuis https://github.com/supabase/cli/releases et la mettre dans le PATH.
5. Compte **Anthropic** + clé API (`sk-ant-...`) : https://console.anthropic.com
6. Compte **Apple Developer** (pour publier l'app iPhone plus tard) — tu l'as déjà.

---

## 2. Installer le projet

Ouvre **PowerShell** dans `C:\Users\kokot\Desktop\resto-depenses` puis :

```powershell
pnpm install
```

Ça installe les dépendances des 3 packages : `apps/desktop`, `apps/mobile`, `packages/shared`.

---

## 3. Créer le projet Supabase

1. Va sur https://supabase.com → **New project**
   - Nom : `resto-depenses`
   - Région : `eu-west-3` (Paris) ou `eu-central-1` (Francfort) — le plus proche
   - Mot de passe DB : garde-le bien
2. Quand le projet est prêt, **Project Settings → API**, note :
   - `Project URL` (`https://xxxxx.supabase.co`)
   - `anon public` (commence par `eyJ...`)
3. Copie `.env.example` vers `.env` à la racine et remplis les 4 variables :

```powershell
Copy-Item .env.example .env
notepad .env
```

---

## 4. Lier le projet local au projet cloud + appliquer les migrations

```powershell
supabase login
supabase link --project-ref <REF_DU_PROJET>
# (REF_DU_PROJET = la partie xxxxx de l'URL https://xxxxx.supabase.co)

supabase db push
```

Ça crée toutes les tables, RLS et le bucket Storage `documents`.

### Créer les 2 utilisateurs

Dans Supabase Studio → **Authentication → Users → Add user** :
- `patron@resto.fr` + mdp
- `associe@resto.fr` + mdp

Note les 2 UUID affichés.

### Charger le seed (catégories, fournisseurs, extras)

Ouvre `supabase/seed.sql`, **décommente** le bloc `insert into public.profiles ...` et remplace `AUTH_USER_ID_1` / `AUTH_USER_ID_2` par les UUID des 2 users. Puis dans Studio → **SQL editor** → colle le contenu de `seed.sql` → Run.

---

## 5. Déployer l'Edge Function `classify-document` + ajouter le secret IA

```powershell
# Ajouter ta clé Anthropic en secret (jamais committée, jamais dans le client)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# Déployer la fonction
supabase functions deploy classify-document --no-verify-jwt
```

> Le flag `--no-verify-jwt` peut être enlevé une fois qu'on s'assure que l'app envoie bien le JWT du user. Pour la phase 0 c'est plus simple sans.

Tester rapidement :
```powershell
supabase functions invoke classify-document --body '{"storage_path":"test/inexistant.jpg"}'
# Doit répondre 404 download_failed → preuve que la fonction tourne et lit Storage.
```

---

## 6. Lancer l'app **PC** en dev

```powershell
pnpm dev:desktop
```

Une fenêtre Electron s'ouvre. Connecte-toi avec `patron@resto.fr`. Tu dois voir « Connecté ✅ ».

### Construire l'installeur `.exe`

```powershell
pnpm build:desktop:exe
```

Le fichier est dans `apps/desktop/release/Resto Dépenses Setup x.y.z.exe`. Double-clic = installation Windows classique.

---

## 7. Lancer l'app **iPhone** en dev

Sur ton Mac (ou PC, mais l'iPhone doit être sur le même Wi-Fi) :

```powershell
pnpm dev:mobile
```

Sur ton iPhone, installe **Expo Go** depuis l'App Store, scanne le QR code affiché dans le terminal. L'app s'ouvre.

### Builder l'IPA pour App Store / TestFlight

```powershell
cd apps/mobile
npx eas login
npx eas build:configure
pnpm build:ios
```

Suis les instructions EAS (il utilise ton compte Apple Developer).

---

## 8. Structure du projet

```
resto-depenses/
├── apps/
│   ├── desktop/        # Electron + Vite + React + TS  → .exe
│   └── mobile/         # Expo + React Native + TS      → iOS
├── packages/
│   └── shared/         # Types, client Supabase, helper IA
└── supabase/
    ├── config.toml
    ├── migrations/     # Schéma SQL + RLS + Storage
    ├── seed.sql        # Données de démo
    └── functions/
        └── classify-document/   # Edge Function → API Anthropic
```

---

## 9. Sécurité (rappels importants)

- La clé **ANTHROPIC_API_KEY** vit UNIQUEMENT dans les secrets Supabase. Jamais dans le code, jamais dans un `.env` client, jamais committée.
- Le `.env` racine est dans `.gitignore`. Vérifie avant chaque `git push`.
- Toutes les tables ont **Row Level Security** : un user ne voit que les données de son `establishment_id`. Idem pour le bucket Storage (dossier = `establishment_id`).
- Les 2 users partagent le même `establishment_id`, donc voient les mêmes données — c'est voulu.

---

## 10. Prochaines phases

- **Phase 1** : finaliser l'auth (gestion d'invitation 2e user, écran d'établissement).
- **Phase 2** : *(déjà fait en phase 0)* — Edge Function testée.
- **Phase 3** : parcours complet PC « capturer/uploader un justificatif → IA → dépense validée », liste dépenses, dashboard.
- **Phase 4** : même parcours sur mobile, optimisé photo.
- **Phase 5** : notes de frais, sorties d'espèces, extras, commandes & rapprochement BL/facture.
- **Phase 6** : stats avancées, import CSV CB, export comptable, polish UI + packaging final.

**Valide la phase 0** (lance `pnpm dev:desktop`, connecte-toi, vois « Connecté ✅ ») avant qu'on passe à la phase 3.
