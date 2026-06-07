# Moteur de prévisionnel — intégration dans l'app Rose

Module **logique pure** (`moteur-previsionnel.ts`), sans dépendance UI. À brancher entre vos
données saisies (factures + ventes) et votre affichage (suivi jour/semaine/mois + projection).

## La méthode (ce qu'on veut reproduire)

1. **On part du réel.** Chaque service (ou journée) saisi avec son CA net (HT) et brut (TTC),
   idéalement ventilé en cuisine / boissons / alcool.
2. **CA moyen par service** = moyenne des ventes réelles saisies (`caHTParService`).
3. **Coût matière réel** = achats consommés (factures nourriture+boissons+alcool, HORS matériel)
   ÷ CA HT (`coutMatiereReel`). Dès qu'il y a assez de données, on remplace l'hypothèse (28 %)
   par ce ratio réel — c'est le cœur du pilotage.
4. **Projection du CA** = CA/service × services/semaine × semaines, avec montée en charge An1
   (85 %) puis croissance An2/An3 (`projeterCA`).
5. **Compte de résultat 3 ans** complet (marge, charges, personnel, EBE, amortissements,
   intérêts d'emprunt, résultat net, CAF, seuil de rentabilité) via `compteResultat3Ans`.
6. **Horizons & suivi** : extrapolation du rythme réel à la semaine / mois / an
   (`projeterHorizons`, `suiviProgression`).

## Branchements types

```ts
import {
  genererPrevisionnel, suiviProgression, projeterHorizons,
  coutMatiereReel, HYPOTHESES_DEFAUT, type VenteService, type Facture, type Hypotheses
} from "./moteur-previsionnel";

// 1) Les données viennent de votre base (saisie utilisateur)
const ventes: VenteService[] = await db.ventes.findAll();      // services/jours
const factures: Facture[]   = await db.factures.findAll();     // achats

// 2) Vos hypothèses (modifiables par l'utilisateur, sinon défaut)
const h: Hypotheses = { ...HYPOTHESES_DEFAUT, ...reglagesUtilisateur };

// 3) Prévisionnel complet (bascule auto sur coût matière réel)
const prev = genererPrevisionnel(ventes, factures, h);
// -> prev.projectionCA, prev.compteResultat.an1/an2/an3, prev.coutMatiereSource

// 4) Tableau de bord "vivant" jour après jour
const suivi = suiviProgression(ventes, factures, h);
// -> suivi.caMoyenService, suivi.coutMatiereReel, suivi.horizons (semaine/mois/an)
```

## Points d'attention

- **Saisie ventilée recommandée** (cuisine/boissons/alcool TTC). Sinon, saisie globale
  (`totalTTC` ou `totalHT`) acceptée, mais le coût matière par catégorie n'est plus calculable.
- **TVA** : cuisine/boissons 10 %, alcool 20 % (paramétrable). Le net (HT) est déduit du brut (TTC).
- **Coût matière** : approximation `achats ÷ CA`. Pour le vrai coût matière, intégrez la variation
  de stock : `(achats + stock_initial − stock_final) ÷ CA`. À ajouter si vous gérez un inventaire.
- **`coutMatiereSource`** vaut `"reel"` dès ≥ 6 services saisis avec des factures, sinon `"hypothese"`.
  Affichez-le pour que l'utilisateur sache sur quoi repose la projection.
- **Matériel** dans les factures = investissement, **exclu** du coût matière (il alimente les
  amortissements, pas la marge).
- Toutes les fonctions sont **pures et testées** : mêmes chiffres que le tableau Excel de référence
  (An1 CA 125 175 € / RN 16 479 €, etc.).

## Réglages clés (objet `Hypotheses`)

| Levier | Champ | Valeur de base |
|---|---|---|
| Services / semaine | `servicesParSemaine` | 11 |
| Semaines / an | `semainesParAn` | 48 |
| Montée en charge An1 | `monteeEnChargeAn1` | 0.85 |
| Croissance An2 / An3 | `croissanceAn2/3` | 0.10 / 0.08 |
| Coût matière cuisine/boissons/alcool | `coutMatiere*` | 0.28 / 0.25 / 0.30 |
| Salaire chef (brut/mois) | `chefBrutMensuel` | 616 (min retraite) |
| Année de démarrage salaire chef | `chefDesAnnee` | 2 |
| Prêts (montant/taux/mois) | `pret*` | 30000 & 16382 / 3.5 % / 84 |

Changer un levier → tout le compte de résultat se recalcule.
