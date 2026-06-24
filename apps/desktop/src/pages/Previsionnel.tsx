// Page Prévisionnel : branche le moteur @resto/previsionnel sur les données réelles.
//  - "initial" : business plan cible (hypothèses par défaut, années pleines).
//  - "live"    : temps réel d'après recettes + dépenses (coût matière réel), 1er exercice PARTIEL.

import { useEffect, useMemo, useState } from "react";
import {
  caHTParService,
  compteResultat3Ans,
  coutMatiereHypothese,
  coutMatiereReel,
  genererPrevisionnel,
  HYPOTHESES_DEFAUT,
  projeterHorizons,
  type AnneeResultat,
  type CategorieFacture,
  type CompteResultat3Ans,
  type Facture,
  type Horizons,
  type ProjectionCA,
  type VenteService,
} from "@resto/previsionnel";
import {
  expenseHT,
  fetchExpenses,
  fetchPrevisionnelOverrides,
  revenueHT,
  serviceUnits,
  type ExpenseListItem,
} from "../lib/queries";
import { fetchRevenues, type RevenueRow } from "../lib/revenues";
import { fmtEUR, fmtDate } from "../lib/format";

type Mode = "initial" | "live" | "compare";

// --- Réglages (équivalent desktop des settings mobile ; valeurs par défaut). ---
const TVA_DEFAULT = 10;
const DEFAULT_OPENING_DATE = "2026-06-01";
// midi+soir lun→ven, samedi soir, dimanche fermé = 11 services / semaine.
const DEFAULT_SVC_PER_WEEKDAY = [2, 2, 2, 2, 2, 1, 0];

// CA HT/service de référence du business plan → An1 ≈ 125 175 €.
const CA_SERVICE_CIBLE_HT = 278.91;

function mapCategorie(label?: string | null): CategorieFacture {
  const l = (label ?? "").toLowerCase();
  if (/(alcool|vin|bi[eè]re|spiritueux|champagne)/.test(l)) return "alcool";
  if (/(boisson|soft|caf[eé]|eau|jus)/.test(l)) return "boissons";
  if (/(food|mati[eè]res?\s*premi|aliment|nourrit|cuisine|[ée]picerie|primeur|boucher|poisson)/.test(l)) return "nourriture";
  if (/([ée]quip|mat[eé]riel|mobilier|travaux|entretien)/.test(l)) return "materiel";
  return "autre";
}

const fmt0 = (n: number) => fmtEUR(Math.round(n));
const pct = (n: number) => `${Math.round(n * 100)} %`;

// Nb de mois de l'ouverture jusqu'à décembre inclus (1er exercice).
function moisJusquaDecembre(openingISO: string): number {
  const m = Number(openingISO.slice(5, 7)) || 1;
  return Math.min(12, Math.max(1, 12 - m + 1));
}
// Nb de services planifiés de l'ouverture au 31/12 de l'année d'ouverture.
function servicesOuvertureAFinAnnee(openingISO: string, svcPerWeekday: number[]): number {
  const parts = openingISO.slice(0, 10).split("-").map(Number);
  const y = parts[0] ?? 2026;
  const day = new Date(y, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  const end = new Date(y, 11, 31);
  let n = 0;
  while (day <= end) {
    const wd = (day.getDay() + 6) % 7; // lundi = 0
    n += svcPerWeekday[wd] ?? 0;
    day.setDate(day.getDate() + 1);
  }
  return n;
}

interface Model {
  pc: ProjectionCA;
  cr: CompteResultat3Ans;
  caService: number;
  cmPct: number;
  cmSource: "reel" | "hypothese";
  horizons: Horizons;
  fractionAn1: number;
  servicesAn1: number;
}

interface ModelParams {
  revenues: RevenueRow[];
  expenses: ExpenseListItem[];
  rate: number;
  svcPerWeek: number;
  svcPerWeekday: number[];
  openingDate: string;
  hyp: typeof HYPOTHESES_DEFAUT;   // hypothèses (défaut + overrides depuis le coffre)
}

// Construit un modèle prévisionnel (business plan "initial" ou "live" temps réel).
function buildModel(mode: "initial" | "live", p: ModelParams): Model {
  if (mode === "initial") {
    const res = genererPrevisionnel([{ date: "2026-01-01", totalHT: CA_SERVICE_CIBLE_HT }], [], p.hyp);
    return {
      pc: res.projectionCA, cr: res.compteResultat, caService: res.caServiceHT.total,
      cmPct: res.coutMatiereUtilise, cmSource: res.coutMatiereSource, horizons: res.horizons,
      fractionAn1: 1, servicesAn1: 0,
    };
  }
  // --- mode temps réel ---
  const h = { ...p.hyp, servicesParSemaine: p.svcPerWeek };
  const ventes: VenteService[] = p.revenues.flatMap((r) => {
    const units = Math.max(1, serviceUnits(r.service));
    const htPer = revenueHT(r, p.rate) / units;
    return Array.from({ length: units }, () => ({ date: r.revenue_date, totalHT: htPer }));
  });
  const factures: Facture[] = p.expenses.map((e) => ({
    date: e.expense_date,
    categorie: mapCategorie(e.category?.label),
    montantHT: expenseHT(e) ?? Number(e.amount_ttc),
  }));
  const caService = caHTParService(ventes, h);
  const cm = coutMatiereReel(factures, ventes, h);
  const cmSource: "reel" | "hypothese" = cm.suffisant ? "reel" : "hypothese";
  const cmPct = cm.suffisant ? cm.ratioGlobal : coutMatiereHypothese(caService, h);

  const regimeAnnuel = caService.total * h.servicesParSemaine * h.semainesParAn;
  const servicesAn1 = servicesOuvertureAFinAnnee(p.openingDate, p.svcPerWeekday);
  const fractionAn1 = moisJusquaDecembre(p.openingDate) / 12;
  const pc: ProjectionCA = {
    regimeAnnuel,
    an1: caService.total * servicesAn1,
    an2: regimeAnnuel,
    an3: regimeAnnuel * (1 + h.croissanceAn3),
  };
  const cr = compteResultat3Ans(pc, cmPct, h, fractionAn1);
  return { pc, cr, caService: caService.total, cmPct, cmSource, horizons: projeterHorizons(caService.total, h), fractionAn1, servicesAn1 };
}

export function Previsionnel() {
  const [mode, setMode] = useState<Mode>("live");
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const rate = TVA_DEFAULT;
  const openingDate = DEFAULT_OPENING_DATE;
  const svcPerWeekday = DEFAULT_SVC_PER_WEEKDAY;

  useEffect(() => {
    Promise.all([fetchRevenues(), fetchExpenses({}), fetchPrevisionnelOverrides().catch(() => ({}))])
      .then(([rev, exp, ov]) => {
        setRevenues(rev);
        setExpenses(exp);
        setOverrides(ov as Record<string, number>);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const svcPerWeek = useMemo(() => {
    const n = svcPerWeekday.reduce((a, b) => a + b, 0);
    return n > 0 ? n : HYPOTHESES_DEFAUT.servicesParSemaine;
  }, [svcPerWeekday]);

  const hyp = useMemo(() => ({ ...HYPOTHESES_DEFAUT, ...overrides }), [overrides]);
  const params: ModelParams = useMemo(
    () => ({ revenues, expenses, rate, svcPerWeek, svcPerWeekday, openingDate, hyp }),
    [revenues, expenses, rate, svcPerWeek, svcPerWeekday, openingDate, hyp],
  );
  const initialModel = useMemo(() => buildModel("initial", params), [params]);
  const liveModel = useMemo(() => buildModel("live", params), [params]);
  const model: Model = mode === "initial" ? initialModel : liveModel;
  const [caOnly, setCaOnly] = useState(false);

  // Données de comparaison Réel vs Budget, sur deux bases comparables :
  //  - "premiere" : 1re année partielle (de l'ouverture en juin au 31/12), budget
  //    proraté sur le MÊME nombre de services → comparaison juste du démarrage.
  //  - "pleine"   : année de croisière (12 mois pleins).
  const compare = useMemo(() => {
    const servicesAn1 = liveModel.servicesAn1;
    const fractionAn1 = liveModel.fractionAn1;
    // Budget « 1re année » = CA/service cible × services réellement planifiés juin→déc,
    // avec charges fixes proratées sur la même fraction d'année.
    const budgetPcPartial: ProjectionCA = {
      regimeAnnuel: initialModel.pc.regimeAnnuel,
      an1: CA_SERVICE_CIBLE_HT * servicesAn1,
      an2: initialModel.pc.an2,
      an3: initialModel.pc.an3,
    };
    const budgetCrPartial = compteResultat3Ans(budgetPcPartial, initialModel.cmPct, HYPOTHESES_DEFAUT, fractionAn1);
    return {
      premiere: { budget: budgetCrPartial.an1, reel: liveModel.cr.an1 },
      pleine:   { budget: initialModel.cr.an2, reel: liveModel.cr.an2 },
      servicesAn1,
    };
  }, [initialModel, liveModel]);

  if (loading) return <div className="previsionnel-page"><h1>Prévisionnel</h1><p className="muted">Chargement…</p></div>;

  const live = mode === "live";
  const noData = (live || mode === "compare") && revenues.length === 0;
  const reel = model.cmSource === "reel";
  const moisAn1 = Math.round(model.fractionAn1 * 12);

  return (
    <div className="previsionnel-page">
      <h1>Prévisionnel</h1>

      <div className="tabs">
        <button className={`tab ${mode === "initial" ? "active" : ""}`} onClick={() => setMode("initial")}>
          Prévisionnel initial
        </button>
        <button className={`tab ${mode === "live" ? "active" : ""}`} onClick={() => setMode("live")}>
          Temps réel
        </button>
        <button className={`tab ${mode === "compare" ? "active" : ""}`} onClick={() => setMode("compare")}>
          Réel vs Budget
        </button>
      </div>

      {noData ? (
        <p className="muted">
          Aucune recette saisie. Vois le « Prévisionnel initial », ou saisis des recettes pour comparer au budget.
        </p>
      ) : mode === "compare" ? (
        <CompareView compare={compare} moisAn1={moisAn1} openingDate={openingDate} caOnly={caOnly} onToggleCaOnly={setCaOnly} />
      ) : (
        <>
          {/* Base de calcul */}
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <span className={`badge ${reel ? "ok" : "warn"}`}>
              {live
                ? reel ? "Coût matière RÉEL (d'après tes dépenses)" : "Coût matière : hypothèse (≥ 6 services + factures pour le réel)"
                : "Business plan — hypothèses de référence"}
            </span>
            <div className="supplier-kpis">
              <div><div className="muted">CA moyen / service (HT)</div><b>{fmtEUR(model.caService)}</b></div>
              <div><div className="muted">Coût matière</div><b className="warn-text">{pct(model.cmPct)}</b></div>
            </div>
            <div className="hint">
              {svcPerWeek} services/semaine · 48 semaines/an{live ? "" : " · montée en charge 85 % (An1)"}.
            </div>
            {live && (
              <div className="hint">
                1er exercice partiel : {model.servicesAn1} services du {fmtDate(openingDate)} au 31/12 ({moisAn1} mois).
                An2/An3 = années pleines.
              </div>
            )}
          </div>

          {/* Projection CA */}
          <h2>Projection du chiffre d'affaires (HT)</h2>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="supplier-kpis">
              <div><div className="muted">{live ? `An 1 (${moisAn1} mois)` : "An 1"}</div><b>{fmt0(model.pc.an1)}</b></div>
              <div><div className="muted">An 2</div><b>{fmt0(model.pc.an2)}</b></div>
              <div><div className="muted">An 3</div><b>{fmt0(model.pc.an3)}</b></div>
            </div>
            <div className="hint">Régime annuel plein (run-rate) : {fmt0(model.pc.regimeAnnuel)}.</div>
          </div>

          {/* Compte de résultat 3 ans */}
          <h2>Compte de résultat 3 ans</h2>
          <div className="table-wrap" style={{ marginBottom: "1.25rem" }}>
            <PnlTable cr={model.cr} live={live} moisAn1={moisAn1} />
          </div>

          {/* Run-rate */}
          <h2>Rythme réel extrapolé</h2>
          <div className="kpis">
            <div className="kpi"><div className="kpi-label">CA HT / semaine</div><div className="kpi-value">{fmt0(model.horizons.parSemaine)}</div></div>
            <div className="kpi"><div className="kpi-label">CA HT / mois</div><div className="kpi-value">{fmt0(model.horizons.parMois)}</div></div>
            <div className="kpi"><div className="kpi-label">CA HT / an (run-rate)</div><div className="kpi-value">{fmt0(model.horizons.parAn)}</div></div>
          </div>
        </>
      )}
    </div>
  );
}

function PnlTable({ cr, live, moisAn1 }: { cr: CompteResultat3Ans; live: boolean; moisAn1: number }) {
  const rows: { label: string; pick: (a: AnneeResultat) => number; strong?: boolean }[] = [
    { label: "CA (HT)", pick: (a) => a.ca },
    { label: "Coût matière", pick: (a) => -a.achats },
    { label: "Marge brute", pick: (a) => a.margeBrute },
    { label: "Charges externes", pick: (a) => -a.chargesExternes },
    { label: "Personnel", pick: (a) => -a.personnel },
    { label: "EBE", pick: (a) => a.ebe },
    { label: "Amortissements", pick: (a) => -a.dotations },
    { label: "Résultat exploitation", pick: (a) => a.resultatExploitation },
    { label: "Charges financières", pick: (a) => -a.chargesFinancieres },
    { label: "Résultat avant impôt", pick: (a) => a.resultatAvantImpot },
    { label: "Impôt sociétés (IS)", pick: (a) => -a.is },
    { label: "Résultat net", pick: (a) => a.resultatNet, strong: true },
    { label: "CAF", pick: (a) => a.caf },
    { label: "Seuil de rentabilité", pick: (a) => a.seuilRentabilite },
  ];
  const cols: AnneeResultat[] = [cr.an1, cr.an2, cr.an3];
  const heads = [live ? `An 1 (${moisAn1} m.)` : "An 1", "An 2", "An 3"];

  return (
    <table className="exp-table">
      <thead>
        <tr>
          <th>€</th>
          {heads.map((h) => <th key={h} className="num">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.strong ? <b>{r.label}</b> : r.label}</td>
            {cols.map((a, i) => {
              const v = r.pick(a);
              return (
                <td key={i} className="num" style={{ color: v < 0 ? "var(--muted)" : undefined }}>
                  {r.strong ? <b>{fmt0(v)}</b> : fmt0(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Comparaison Réel projeté vs Budget. Deux bases comparables :
//  - "premiere" : 1re année partielle (juin → 31/12), budget proraté même période.
//  - "pleine"   : année de croisière (12 mois pleins).
interface CompareData {
  premiere: { budget: AnneeResultat; reel: AnneeResultat };
  pleine: { budget: AnneeResultat; reel: AnneeResultat };
  servicesAn1: number;
}

function CompareView({
  compare, moisAn1, openingDate, caOnly, onToggleCaOnly,
}: {
  compare: CompareData; moisAn1: number; openingDate: string;
  caOnly: boolean; onToggleCaOnly: (v: boolean) => void;
}) {
  const [basis, setBasis] = useState<"premiere" | "pleine">("premiere");
  const { budget, reel } = basis === "premiere" ? compare.premiere : compare.pleine;
  const year = openingDate.slice(0, 4);

  const allRows: { label: string; pick: (a: AnneeResultat) => number; strong?: boolean; cost?: boolean }[] = [
    { label: "CA (HT)", pick: (a) => a.ca, strong: true },
    { label: "Coût matière", pick: (a) => a.achats, cost: true },
    { label: "Marge brute", pick: (a) => a.margeBrute },
    { label: "Charges externes", pick: (a) => a.chargesExternes, cost: true },
    { label: "Personnel", pick: (a) => a.personnel, cost: true },
    { label: "EBE", pick: (a) => a.ebe },
    { label: "Résultat net", pick: (a) => a.resultatNet, strong: true },
  ];
  const rows = caOnly ? allRows.filter((r) => r.label === "CA (HT)") : allRows;

  const caBudget = budget.ca;
  const caReel = reel.ca;
  const caEcart = caReel - caBudget;
  const caPct = caBudget ? Math.round((caReel / caBudget) * 100) : 0;

  const premiereLabel = `1re année (juin → déc ${year}, ${moisAn1} mois)`;
  const budgetLabel = basis === "premiere" ? `Budget proraté (${moisAn1} mois)` : "CA budget (an plein)";

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="tabs" style={{ marginBottom: "0.75rem" }}>
          <button className={`tab ${basis === "premiere" ? "active" : ""}`} onClick={() => setBasis("premiere")}>
            {premiereLabel}
          </button>
          <button className={`tab ${basis === "pleine" ? "active" : ""}`} onClick={() => setBasis("pleine")}>
            Année pleine (croisière)
          </button>
        </div>
        <div className="supplier-kpis">
          <div><div className="muted">{budgetLabel}</div><b>{fmt0(caBudget)}</b></div>
          <div><div className="muted">CA réel projeté</div><b>{fmt0(caReel)}</b></div>
          <div>
            <div className="muted">Écart</div>
            <b style={{ color: caEcart >= 0 ? "var(--primary)" : "var(--error)" }}>
              {caEcart >= 0 ? "+" : ""}{fmt0(caEcart)} ({caPct} %)
            </b>
          </div>
        </div>
        <div className="hint">
          {basis === "premiere"
            ? `Ta 1re année commence en juin : ${compare.servicesAn1} services planifiés jusqu'au 31/12. Le budget est proraté sur la même période pour une comparaison juste.`
            : "Rythme de croisière sur 12 mois pleins. Budget An1 de référence du business plan : ~125 175 € (1re année avec montée en charge)."}
        </div>
        <label className="toggle-line" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input type="checkbox" checked={caOnly} onChange={(e) => onToggleCaOnly(e.target.checked)} />
          CA seulement (sans la partie achats / coûts)
        </label>
      </div>

      <div className="table-wrap" style={{ marginBottom: "1.25rem" }}>
        <table className="exp-table">
          <thead>
            <tr>
              <th>€ (année pleine)</th>
              <th className="num">Budget</th>
              <th className="num">Réel projeté</th>
              <th className="num">Écart</th>
              <th className="num">% du budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = r.pick(budget);
              const v = r.pick(reel);
              const ecart = v - b;
              const p = b ? Math.round((v / b) * 100) : 0;
              // Pour un coût, dépasser le budget est défavorable → on inverse la couleur.
              const favorable = r.cost ? ecart <= 0 : ecart >= 0;
              return (
                <tr key={r.label}>
                  <td>{r.strong ? <b>{r.label}</b> : r.label}</td>
                  <td className="num">{r.strong ? <b>{fmt0(b)}</b> : fmt0(b)}</td>
                  <td className="num">{r.strong ? <b>{fmt0(v)}</b> : fmt0(v)}</td>
                  <td className="num" style={{ color: favorable ? "var(--primary)" : "var(--error)" }}>
                    {ecart >= 0 ? "+" : ""}{fmt0(ecart)}
                  </td>
                  <td className="num">{p} %</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
