/**
 * Moteur de prévisionnel — Projet Rose
 * ------------------------------------
 * Logique PURE (aucune dépendance UI / framework). Portable JS/TS → facile à porter en Python.
 *
 * Idée directrice (la méthode qu'on a construite) :
 *   1. On part des VENTES RÉELLES saisies service par service / jour par jour.
 *   2. On en déduit un "CA moyen par service" (par catégorie : cuisine / boissons / alcool).
 *   3. On déduit des FACTURES réelles le COÛT MATIÈRE RÉEL (achats consommés ÷ CA).
 *   4. On projette : CA/service × services/semaine × semaines, avec montée en charge An1 puis croissance An2/An3.
 *   5. On construit le compte de résultat complet + le suivi réel vs projeté + les horizons semaine/mois/an.
 *
 * Tant qu'il n'y a pas (assez) de données réelles, le moteur utilise les hypothèses fournies.
 * Dès que des ventes/factures arrivent, il bascule sur le réel (coût matière, CA/service).
 */

// ───────────────────────────── Types ─────────────────────────────

export type CategorieVente = "cuisine" | "boissons" | "alcool";
export type CategorieFacture = "nourriture" | "boissons" | "alcool" | "materiel" | "autre";

/** Une vente = un service (midi/soir) ou une journée si on ne découpe pas les services. */
export interface VenteService {
  date: string;                 // ISO "2026-06-02"
  service?: "midi" | "soir";    // optionnel
  // Saisie par catégorie (préférée) — montants TTC encaissés :
  cuisineTTC?: number;
  boissonsTTC?: number;
  alcoolTTC?: number;
  // OU saisie globale si on ne ventile pas :
  totalTTC?: number;
  totalHT?: number;             // "net" si déjà connu
}

export interface Facture {
  date: string;
  categorie: CategorieFacture;
  montantHT: number;            // net (HT)
}

export interface Hypotheses {
  // TVA
  tvaCuisine: number;           // 0.10
  tvaBoissons: number;          // 0.10
  tvaAlcool: number;            // 0.20
  // Volume / régime
  servicesParSemaine: number;   // 11
  semainesParAn: number;        // 48
  monteeEnChargeAn1: number;    // 0.85
  croissanceAn2: number;        // 0.10
  croissanceAn3: number;        // 0.08
  // Coûts matière (% du CA de la catégorie) — utilisés tant qu'on n'a pas le réel
  coutMatiereCuisine: number;   // 0.28
  coutMatiereBoissons: number;  // 0.25
  coutMatiereAlcool: number;    // 0.30
  // Charges externes (base annuelle An1)
  loyerMensuelHC: number;       // 1432.56
  chargesLocMensuel: number;    // 133.33
  assurancePro: number;         // 1800
  eauElecGaz: number;           // 6074
  comptable: number;            // 2880
  telInternet: number;          // 400
  logiciels: number;            // 490
  entretien: number;            // 500
  hommeCleMensuel: number;      // 60
  commissionCB: number;         // 0.007  (% du CA)
  indexationLoyer: number;      // 0.02
  // Personnel
  serveuseNetMensuel: number;   // 1600
  ratioNetBrut: number;         // 0.78
  chargesPatServeuse: number;   // 0.30
  chefBrutMensuel: number;      // 616 (min retraite) ; SMIC = 1867 ; IJ complètes ≈ 2080
  chargesPatDG: number;         // 0.45 (mandataire, sans réduction Fillon)
  chefDesAnnee: number;         // 2  (le chef est rémunéré à partir de l'année N)
  // Amortissements
  materielHT: number;           // 16382
  dureeMateriel: number;        // 5
  fraisEtab: number;            // 6365
  dureeFrais: number;           // 5
  // Emprunts
  pretFonds: number; tauxFonds: number; moisFonds: number;   // 30000 / 0.035 / 84
  pretMateriel: number; tauxMat: number; moisMat: number;    // 16382 / 0.035 / 84
  // Impôt sociétés
  tauxISReduit: number;         // 0.15
  seuilIS: number;              // 42500
  tauxISNormal: number;         // 0.25
}

export const HYPOTHESES_DEFAUT: Hypotheses = {
  tvaCuisine: 0.10, tvaBoissons: 0.10, tvaAlcool: 0.20,
  servicesParSemaine: 11, semainesParAn: 48,
  monteeEnChargeAn1: 0.85, croissanceAn2: 0.10, croissanceAn3: 0.08,
  coutMatiereCuisine: 0.28, coutMatiereBoissons: 0.25, coutMatiereAlcool: 0.30,
  loyerMensuelHC: 1432.56, chargesLocMensuel: 133.33, assurancePro: 1800,
  eauElecGaz: 6074, comptable: 2880, telInternet: 400, logiciels: 490,
  entretien: 500, hommeCleMensuel: 60, commissionCB: 0.007, indexationLoyer: 0.02,
  serveuseNetMensuel: 1600, ratioNetBrut: 0.78, chargesPatServeuse: 0.30,
  chefBrutMensuel: 616, chargesPatDG: 0.45, chefDesAnnee: 2,
  materielHT: 16382, dureeMateriel: 5, fraisEtab: 6365, dureeFrais: 5,
  pretFonds: 30000, tauxFonds: 0.035, moisFonds: 84,
  pretMateriel: 16382, tauxMat: 0.035, moisMat: 84,
  tauxISReduit: 0.15, seuilIS: 42500, tauxISNormal: 0.25,
};

// ─────────────────────────── Utilitaires ───────────────────────────

const htDepuisTTC = (ttc: number, tva: number) => ttc / (1 + tva);

export interface CaCategorieHT { cuisine: number; boissons: number; alcool: number; total: number; }

/** Convertit une vente en CA HT par catégorie (gère saisie ventilée OU globale). */
function venteEnHT(v: VenteService, h: Hypotheses): CaCategorieHT {
  const aDesCategories = v.cuisineTTC != null || v.boissonsTTC != null || v.alcoolTTC != null;
  if (aDesCategories) {
    const cuisine = htDepuisTTC(v.cuisineTTC ?? 0, h.tvaCuisine);
    const boissons = htDepuisTTC(v.boissonsTTC ?? 0, h.tvaBoissons);
    const alcool = htDepuisTTC(v.alcoolTTC ?? 0, h.tvaAlcool);
    return { cuisine, boissons, alcool, total: cuisine + boissons + alcool };
  }
  // saisie globale : on prend totalHT s'il existe, sinon on déduit du TTC avec la TVA cuisine
  const total = v.totalHT ?? htDepuisTTC(v.totalTTC ?? 0, h.tvaCuisine);
  return { cuisine: total, boissons: 0, alcool: 0, total };
}

// ──────────────────── 1) CA réel moyen par service ────────────────────

/** Moyenne du CA HT par service à partir des ventes réelles saisies. */
export function caHTParService(ventes: VenteService[], h: Hypotheses): CaCategorieHT {
  const n = ventes.length;
  if (n === 0) return { cuisine: 0, boissons: 0, alcool: 0, total: 0 };
  const s = ventes.reduce<CaCategorieHT>((acc, v) => {
    const ht = venteEnHT(v, h);
    acc.cuisine += ht.cuisine; acc.boissons += ht.boissons; acc.alcool += ht.alcool; acc.total += ht.total;
    return acc;
  }, { cuisine: 0, boissons: 0, alcool: 0, total: 0 });
  return { cuisine: s.cuisine / n, boissons: s.boissons / n, alcool: s.alcool / n, total: s.total / n };
}

// ──────────────────── 2) Coût matière RÉEL ────────────────────

export interface CoutMatiere { ratioGlobal: number; achatsHT: number; caHT: number; suffisant: boolean; }

/**
 * Coût matière réel = achats consommés (nourriture+boissons+alcool, HORS matériel) ÷ CA HT.
 * NB : approximation "achats ÷ CA". Le vrai coût matière = (achats + stock initial − stock final) ÷ CA.
 * Tant que peu de données, "suffisant=false" → mieux vaut garder l'hypothèse.
 */
export function coutMatiereReel(factures: Facture[], ventes: VenteService[], h: Hypotheses): CoutMatiere {
  const achatsHT = factures
    .filter(f => f.categorie === "nourriture" || f.categorie === "boissons" || f.categorie === "alcool")
    .reduce((s, f) => s + f.montantHT, 0);
  const caHT = ventes.reduce((s, v) => s + venteEnHT(v, h).total, 0);
  const ratioGlobal = caHT > 0 ? achatsHT / caHT : 0;
  return { ratioGlobal, achatsHT, caHT, suffisant: ventes.length >= 6 && achatsHT > 0 };
}

// ──────────────────── 3) Projection du CA ────────────────────

export interface ProjectionCA { regimeAnnuel: number; an1: number; an2: number; an3: number; }

/** CA/service (HT) → régime annuel puis An1 (montée en charge), An2, An3. */
export function projeterCA(caServiceHT: number, h: Hypotheses): ProjectionCA {
  const regimeAnnuel = caServiceHT * h.servicesParSemaine * h.semainesParAn;
  const an1 = regimeAnnuel * h.monteeEnChargeAn1;
  const an2 = an1 * (1 + h.croissanceAn2);
  const an3 = an2 * (1 + h.croissanceAn3);
  return { regimeAnnuel, an1, an2, an3 };
}

// ──────────────────── Emprunts ────────────────────

export interface LigneAmort { mois: number; interet: number; capital: number; solde: number; }
export interface TableauEmprunt {
  mensualite: number;
  echeancier: LigneAmort[];
  interetsParAnnee: number[];   // [An1, An2, An3]
  annuite: number;              // mensualité × 12
}

export function tableauEmprunt(montant: number, tauxAnnuel: number, mois: number): TableauEmprunt {
  const r = tauxAnnuel / 12;
  const mensualite = r === 0 ? montant / mois : (montant * r) / (1 - Math.pow(1 + r, -mois));
  const echeancier: LigneAmort[] = [];
  let solde = montant;
  for (let m = 1; m <= mois; m++) {
    const interet = solde * r;
    const capital = mensualite - interet;
    solde = Math.max(0, solde - capital);
    echeancier.push({ mois: m, interet, capital, solde });
  }
  const interetsAnnee = (an: number) =>
    echeancier.slice((an - 1) * 12, an * 12).reduce((s, l) => s + l.interet, 0);
  return { mensualite, echeancier, interetsParAnnee: [interetsAnnee(1), interetsAnnee(2), interetsAnnee(3)], annuite: mensualite * 12 };
}

// ──────────────────── Personnel & IS ────────────────────

export function coutPersonnel(h: Hypotheses, annee: number): number {
  const serveuse = (h.serveuseNetMensuel / h.ratioNetBrut) * (1 + h.chargesPatServeuse) * 12;
  const chef = annee >= h.chefDesAnnee ? h.chefBrutMensuel * (1 + h.chargesPatDG) * 12 : 0;
  return serveuse + chef;
}

export function impotSocietes(resultatAvantImpot: number, h: Hypotheses): number {
  if (resultatAvantImpot <= 0) return 0;
  const reduit = Math.min(resultatAvantImpot, h.seuilIS) * h.tauxISReduit;
  const normal = Math.max(0, resultatAvantImpot - h.seuilIS) * h.tauxISNormal;
  return reduit + normal;
}

// ──────────────────── Compte de résultat ────────────────────

export interface AnneeResultat {
  ca: number; achats: number; margeBrute: number; tauxMarge: number;
  chargesExternes: number; valeurAjoutee: number; personnel: number;
  ebe: number; dotations: number; resultatExploitation: number;
  chargesFinancieres: number; resultatAvantImpot: number; is: number;
  resultatNet: number; caf: number; annuite: number; cafMoinsAnnuite: number;
  chargesFixes: number; seuilRentabilite: number;
}

export interface CompteResultat3Ans { an1: AnneeResultat; an2: AnneeResultat; an3: AnneeResultat; }

// `fraction` proratise les charges fixes pour un exercice partiel (ex. 7/12 si
// ouverture en juin et clôture en décembre). La commission CB reste % du CA réel.
function chargesExternesAnnee(ca: number, indiceAnnee: number, h: Hypotheses, fraction = 1): number {
  const loyer = h.loyerMensuelHC * 12 * Math.pow(1 + h.indexationLoyer, indiceAnnee);
  const fixes = loyer + h.chargesLocMensuel * 12 + h.assurancePro + h.eauElecGaz + h.comptable
    + h.telInternet + h.logiciels + h.entretien + h.hommeCleMensuel * 12;
  return fixes * fraction + h.commissionCB * ca;
}

/** Construit une année de compte de résultat. `fraction` = part d'année (1 = année pleine). */
function anneeResultat(ca: number, coutMatierePct: number, indiceAnnee: number, annee: number,
                       interetsFonds: number, interetsMat: number, annuite: number, h: Hypotheses, fraction = 1): AnneeResultat {
  const achats = ca * coutMatierePct;
  const margeBrute = ca - achats;
  const chargesExternes = chargesExternesAnnee(ca, indiceAnnee, h, fraction);
  const valeurAjoutee = margeBrute - chargesExternes;
  const personnel = coutPersonnel(h, annee) * fraction;
  const ebe = valeurAjoutee - personnel;
  const dotations = (h.materielHT / h.dureeMateriel + h.fraisEtab / h.dureeFrais) * fraction;
  const resultatExploitation = ebe - dotations;
  const chargesFinancieres = interetsFonds + interetsMat; // déjà bornés à la bonne période
  const resultatAvantImpot = resultatExploitation - chargesFinancieres;
  const is = impotSocietes(resultatAvantImpot, h);
  const resultatNet = resultatAvantImpot - is;
  const caf = resultatNet + dotations;
  const annuiteEff = annuite * fraction;
  const chargesFixes = chargesExternes + personnel + dotations + chargesFinancieres;
  const tauxMarge = ca > 0 ? margeBrute / ca : 0;
  const seuilRentabilite = tauxMarge > 0 ? chargesFixes / tauxMarge : 0;
  return {
    ca, achats, margeBrute, tauxMarge, chargesExternes, valeurAjoutee, personnel, ebe,
    dotations, resultatExploitation, chargesFinancieres, resultatAvantImpot, is, resultatNet,
    caf, annuite: annuiteEff, cafMoinsAnnuite: caf - annuiteEff, chargesFixes, seuilRentabilite,
  };
}

/**
 * Compte de résultat 3 ans.
 * @param coutMatierePct  coût matière global à appliquer (réel si dispo, sinon moyenne pondérée des hypothèses)
 * @param fractionAn1     part d'année du 1er exercice (1 = année pleine ; ex. 7/12 si ouverture en juin,
 *                        clôture en décembre). Les charges fixes/dotations/intérêts de l'An1 sont proratisés,
 *                        et les exercices suivants décalent d'autant sur l'échéancier d'emprunt.
 */
export function compteResultat3Ans(projCA: ProjectionCA, coutMatierePct: number, h: Hypotheses, fractionAn1 = 1): CompteResultat3Ans {
  const empFonds = tableauEmprunt(h.pretFonds, h.tauxFonds, h.moisFonds);
  const empMat = tableauEmprunt(h.pretMateriel, h.tauxMat, h.moisMat);
  const annuite = empFonds.annuite + empMat.annuite;
  const moisAn1 = Math.max(1, Math.round(fractionAn1 * 12));
  const interetSur = (emp: TableauEmprunt, from: number, count: number) =>
    emp.echeancier.slice(from, from + count).reduce((s, l) => s + l.interet, 0);
  const mk = (ca: number, idx: number, annee: number, from: number, count: number, fraction: number) =>
    anneeResultat(ca, coutMatierePct, idx, annee, interetSur(empFonds, from, count), interetSur(empMat, from, count), annuite, h, fraction);
  return {
    an1: mk(projCA.an1, 0, 1, 0, moisAn1, fractionAn1),
    an2: mk(projCA.an2, 1, 2, moisAn1, 12, 1),
    an3: mk(projCA.an3, 2, 3, moisAn1 + 12, 12, 1),
  };
}

/** Coût matière "hypothèse" pondéré par la structure de CA d'un service. */
export function coutMatiereHypothese(caService: CaCategorieHT, h: Hypotheses): number {
  if (caService.total <= 0) return h.coutMatiereCuisine;
  const achats = caService.cuisine * h.coutMatiereCuisine
    + caService.boissons * h.coutMatiereBoissons
    + caService.alcool * h.coutMatiereAlcool;
  return achats / caService.total;
}

// ──────────────────── Horizons & suivi temps réel ────────────────────

export interface Horizons { parService: number; parJour: number; parSemaine: number; parMois: number; parAn: number; }

/**
 * Projection "run-rate" à partir du réel saisi à ce jour.
 * Utilise le CA moyen/service observé et le rythme cible (services/semaine).
 */
export function projeterHorizons(caServiceHT: number, h: Hypotheses): Horizons {
  const parSemaine = caServiceHT * h.servicesParSemaine;
  const joursOuvresParSemaine = 6; // lun→sam
  return {
    parService: caServiceHT,
    parJour: parSemaine / joursOuvresParSemaine,
    parSemaine,
    parMois: parSemaine * (h.semainesParAn / 12),
    parAn: parSemaine * h.semainesParAn,
  };
}

export interface SuiviProgression {
  nbServices: number;
  caReelCumuleHT: number;
  caMoyenService: number;
  coutMatiereReel: CoutMatiere;
  horizons: Horizons;             // extrapolation du rythme réel
  ecartVsObjectifService: number; // % vs CA/service objectif (régime hypothèses)
}

/** Suivi vivant : ce que l'app affiche jour après jour / semaine après semaine. */
export function suiviProgression(ventes: VenteService[], factures: Facture[], h: Hypotheses): SuiviProgression {
  const moyen = caHTParService(ventes, h);
  const caReelCumuleHT = ventes.reduce((s, v) => s + venteEnHT(v, h).total, 0);
  const cm = coutMatiereReel(factures, ventes, h);
  const objectifService = (h /* régime */ && moyen.total) ? moyen.total : 0;
  return {
    nbServices: ventes.length,
    caReelCumuleHT,
    caMoyenService: moyen.total,
    coutMatiereReel: cm,
    horizons: projeterHorizons(moyen.total, h),
    ecartVsObjectifService: 0, // à comparer à un objectif si tu en stockes un
  };
}

// ──────────────────── Point d'entrée global ────────────────────

export interface ResultatComplet {
  caServiceHT: CaCategorieHT;
  coutMatiereUtilise: number;
  coutMatiereSource: "reel" | "hypothese";
  projectionCA: ProjectionCA;
  compteResultat: CompteResultat3Ans;
  horizons: Horizons;
}

/**
 * Génère tout le prévisionnel à partir des données réelles + hypothèses.
 * Bascule automatiquement sur le coût matière RÉEL dès qu'il y a assez de données.
 */
export function genererPrevisionnel(ventes: VenteService[], factures: Facture[], h: Hypotheses = HYPOTHESES_DEFAUT): ResultatComplet {
  const caServiceHT = caHTParService(ventes, h);
  const cmReel = coutMatiereReel(factures, ventes, h);
  const coutMatiereSource = cmReel.suffisant ? "reel" : "hypothese";
  const coutMatiereUtilise = cmReel.suffisant ? cmReel.ratioGlobal : coutMatiereHypothese(caServiceHT, h);
  const projectionCA = projeterCA(caServiceHT.total, h);
  const compteResultat = compteResultat3Ans(projectionCA, coutMatiereUtilise, h);
  return {
    caServiceHT, coutMatiereUtilise, coutMatiereSource, projectionCA, compteResultat,
    horizons: projeterHorizons(caServiceHT.total, h),
  };
}

/* ──────────────────── Exemple (semaine 1 réelle) ────────────────────
import { genererPrevisionnel, HYPOTHESES_DEFAUT } from "./moteur-previsionnel";

const ventesSemaine1: VenteService[] = [
  // 8 services ayant fait 2 482 € TTC au total — ici réparti pour l'exemple :
  { date: "2026-06-02", service: "soir", cuisineTTC: 254, boissonsTTC: 15, alcoolTTC: 41 },
  // ... (saisir chaque service réel)
];
const factures: Facture[] = [
  { date: "2026-06-02", categorie: "nourriture", montantHT: 560 },
  { date: "2026-06-03", categorie: "boissons", montantHT: 90 },
];
const res = genererPrevisionnel(ventesSemaine1, factures, HYPOTHESES_DEFAUT);
console.log(res.projectionCA);            // { regimeAnnuel, an1, an2, an3 }
console.log(res.compteResultat.an1);      // résultat net, EBE, CAF, seuil...
console.log(res.coutMatiereSource);       // "reel" dès ≥ 6 services avec factures
─────────────────────────────────────────────────────────────────── */
