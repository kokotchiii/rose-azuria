// Écran SUIVI : où j'en suis vs mes objectifs, clairement.
//  - Semaine en cours (lun→dim) : CA réalisé + PROJETÉ (extrapolation des services
//    restants), vs objectif, ticket moyen, couvert moyen.
//  - Détail jour par jour de la semaine.
//  - Cap annuel : à ce rythme, est-ce qu'on atteint le budget prévisionnel ?
//  - Historique des semaines passées.

import { useEffect, useMemo, useState } from "react";
import { fetchRevenues, type RevenueRow } from "../lib/revenues";
import { serviceUnits, revenueHT, expenseHT, fetchExpenses, type ExpenseListItem } from "../lib/queries";
import { fmtEUR } from "../lib/format";
import {
  caHTParService, coutMatiereReel, coutMatiereHypothese, compteResultat3Ans,
  HYPOTHESES_DEFAUT,
  type AnneeResultat, type CategorieFacture, type Facture, type ProjectionCA, type VenteService,
} from "@resto/previsionnel";

// --- Objectif (business plan) ---
const OBJ_HT_PER_SERVICE = 278.91;      // CA HT moyen / service visé (An1 ≈ 125 175 €)
const TVA = 0.10;
const OBJ_TTC_PER_SERVICE = OBJ_HT_PER_SERVICE * (1 + TVA);  // ≈ 306,80 € TTC
// Services planifiés par jour : lun→ven midi+soir (2), samedi soir (1), dimanche fermé.
const SVC_PER_WEEKDAY = [2, 2, 2, 2, 2, 1, 0]; // index 0 = lundi
const WEEK_PLANNED_UNITS = SVC_PER_WEEKDAY.reduce((a, b) => a + b, 0); // 11
const SEMAINES_PAR_AN = 48;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOIS_NOMS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const OPENING_DATE = "2026-06-01"; // 1er service

function mapCategorie(label?: string | null): CategorieFacture {
  const l = (label ?? "").toLowerCase();
  if (/(alcool|vin|bi[eè]re|spiritueux|champagne)/.test(l)) return "alcool";
  if (/(boisson|soft|caf[eé]|eau|jus)/.test(l)) return "boissons";
  if (/(food|mati[eè]res?\s*premi|aliment|nourrit|cuisine|[ée]picerie|primeur|boucher|poisson)/.test(l)) return "nourriture";
  if (/([ée]quip|mat[eé]riel|mobilier|travaux|entretien)/.test(l)) return "materiel";
  return "autre";
}
// Fraction de l'année 1 réellement exploitée (ouverture → 31/12).
function moisJusquaDecembre(openingISO: string): number {
  const m = Number(openingISO.slice(5, 7)) || 1;
  return Math.min(12, Math.max(1, 12 - m + 1));
}
function servicesOuvertureAFinAnnee(openingISO: string, svcPerWeekday: number[]): number {
  const p = openingISO.slice(0, 10).split("-").map(Number);
  const y = p[0] ?? 2026;
  const day = new Date(y, (p[1] ?? 1) - 1, p[2] ?? 1);
  const end = new Date(y, 11, 31);
  let n = 0;
  while (day <= end) {
    const wd = (day.getDay() + 6) % 7;
    n += svcPerWeekday[wd] ?? 0;
    day.setDate(day.getDate() + 1);
  }
  return n;
}

const fmt0 = (n: number) => fmtEUR(Math.round(n));
const revTotal = (r: RevenueRow) => Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);

// lundi=0 … dimanche=6
function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setDate(d.getDate() - weekdayMon0(d));
  m.setHours(0, 0, 0, 0);
  return m;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}

interface DayRow {
  label: string;
  dateISO: string;
  plannedUnits: number;
  ca: number;
  units: number;        // services saisis
  covers: number;
  tables: number;
  hasData: boolean;
  isFuture: boolean;
  isToday: boolean;
}

interface WeekStats {
  mondayISO: string;
  realizedCA: number;
  realizedUnits: number;
  covers: number;
  tables: number;
  plannedUnits: number;
  objective: number;     // objectif TTC de la semaine
  projectedCA: number;   // réalisé + extrapolation des services restants
  complete: boolean;     // semaine passée (tous les jours écoulés)
}

function buildWeek(monday: Date, byDate: Map<string, RevenueRow[]>, today: Date): { stats: WeekStats; days: DayRow[] } {
  const todayISOv = isoDate(today);
  let realizedCA = 0, realizedUnits = 0, covers = 0, tables = 0;
  const days: DayRow[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const dISO = isoDate(d);
    const rows = byDate.get(dISO) ?? [];
    const ca = rows.reduce((s, r) => s + revTotal(r), 0);
    const units = rows.reduce((s, r) => s + Math.max(1, serviceUnits(r.service)), 0);
    const cov = rows.reduce((s, r) => s + (r.covers ?? 0), 0);
    const tab = rows.reduce((s, r) => s + (r.tables_count ?? 0), 0);
    realizedCA += ca; realizedUnits += units; covers += cov; tables += tab;
    days.push({
      label: JOURS[i]!,
      dateISO: dISO,
      plannedUnits: SVC_PER_WEEKDAY[i] ?? 0,
      ca, units, covers: cov, tables: tab,
      hasData: rows.length > 0,
      isFuture: dISO > todayISOv,
      isToday: dISO === todayISOv,
    });
  }
  const objective = WEEK_PLANNED_UNITS * OBJ_TTC_PER_SERVICE;
  const avgPerUnit = realizedUnits > 0 ? realizedCA / realizedUnits : OBJ_TTC_PER_SERVICE;
  const remainingUnits = Math.max(0, WEEK_PLANNED_UNITS - realizedUnits);
  const projectedCA = realizedCA + avgPerUnit * remainingUnits;
  const sundayISO = isoDate(addDays(monday, 6));
  const complete = sundayISO < todayISOv;
  return {
    stats: {
      mondayISO: isoDate(monday),
      realizedCA, realizedUnits, covers, tables,
      plannedUnits: WEEK_PLANNED_UNITS, objective, projectedCA, complete,
    },
    days,
  };
}

function pctClass(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 1) return "ok";
  if (pct >= 0.9) return "warn";
  return "bad";
}

export function Suivi() {
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPnl, setShowPnl] = useState(false);

  useEffect(() => {
    Promise.all([fetchRevenues(), fetchExpenses({})])
      .then(([rev, exp]) => { setRevenues(rev); setExpenses(exp); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, RevenueRow[]>();
    for (const r of revenues) {
      const arr = m.get(r.revenue_date) ?? [];
      arr.push(r);
      m.set(r.revenue_date, arr);
    }
    return m;
  }, [revenues]);

  const current = useMemo(() => buildWeek(mondayOf(today), byDate, today), [byDate, today]);

  // Semaines passées (8 dernières semaines complètes ou en cours, hors semaine courante).
  const pastWeeks = useMemo(() => {
    const out: WeekStats[] = [];
    const curMonday = mondayOf(today);
    for (let i = 1; i <= 8; i++) {
      const monday = addDays(curMonday, -7 * i);
      const { stats } = buildWeek(monday, byDate, today);
      if (stats.realizedUnits > 0) out.push(stats);
    }
    return out;
  }, [byDate, today]);

  // Cap annuel : rythme actuel extrapolé sur l'année de croisière.
  const annual = useMemo(() => {
    // moyenne par service sur les 30 derniers jours saisis (sinon objectif).
    let ca = 0, units = 0;
    const since = isoDate(addDays(today, -30));
    for (const r of revenues) {
      if (r.revenue_date >= since && r.revenue_date <= isoDate(today)) {
        ca += revTotal(r); units += Math.max(1, serviceUnits(r.service));
      }
    }
    const avgPerUnitTTC = units > 0 ? ca / units : OBJ_TTC_PER_SERVICE;
    const avgPerUnitHT = avgPerUnitTTC / (1 + TVA);
    // Run-rate annuel (HT) = rythme actuel maintenu sur une année pleine.
    const projeteHT = avgPerUnitHT * WEEK_PLANNED_UNITS * SEMAINES_PAR_AN;
    const budgetHT = OBJ_HT_PER_SERVICE * WEEK_PLANNED_UNITS * SEMAINES_PAR_AN;
    return { avgPerUnitHT, projeteHT, budgetHT, hasData: units > 0 };
  }, [revenues, today]);

  // ---- Projection compte de résultat (à ce rythme) via le moteur prévisionnel ----
  // an1 = 1re année RÉELLE (1er juin → 31/12, ~7 mois) ; an2 = année prochaine (pleine).
  const projection = useMemo(() => {
    const h = { ...HYPOTHESES_DEFAUT, servicesParSemaine: WEEK_PLANNED_UNITS };
    const ventes: VenteService[] = revenues.flatMap((r) => {
      const units = Math.max(1, serviceUnits(r.service));
      const htPer = revenueHT(r, 10) / units;
      return Array.from({ length: units }, () => ({ date: r.revenue_date, totalHT: htPer }));
    });
    const factures: Facture[] = expenses.map((e) => ({
      date: e.expense_date,
      categorie: mapCategorie(e.category?.label),
      montantHT: expenseHT(e) ?? Number(e.amount_ttc),
    }));
    const caService = caHTParService(ventes, h);
    const cm = coutMatiereReel(factures, ventes, h);
    const cmPct = cm.suffisant ? cm.ratioGlobal : coutMatiereHypothese(caService, h);
    const regimeAnnuel = caService.total * h.servicesParSemaine * h.semainesParAn;
    const servicesAn1 = servicesOuvertureAFinAnnee(OPENING_DATE, SVC_PER_WEEKDAY);
    const fractionAn1 = moisJusquaDecembre(OPENING_DATE) / 12;
    const pc: ProjectionCA = {
      regimeAnnuel,
      an1: caService.total * servicesAn1,
      an2: regimeAnnuel,
      an3: regimeAnnuel * (1 + h.croissanceAn3),
    };
    const cr = compteResultat3Ans(pc, cmPct, h, fractionAn1);
    return { cr, moisAn1: Math.round(fractionAn1 * 12), servicesAn1, hasData: ventes.length > 0 };
  }, [revenues, expenses]);

  // ---- Agrégat par JOUR DE LA SEMAINE (moyennes sur tout l'historique) ----
  const byWeekday = useMemo(() => {
    const acc = JOURS.map(() => ({ ca: 0, covers: 0, services: 0, dates: new Set<string>() }));
    for (const r of revenues) {
      const d = new Date(r.revenue_date + "T00:00:00");
      const wd = (d.getDay() + 6) % 7;
      const a = acc[wd]!;
      a.ca += revTotal(r);
      a.covers += r.covers ?? 0;
      a.services += Math.max(1, serviceUnits(r.service));
      a.dates.add(r.revenue_date);
    }
    return acc.map((a, i) => ({
      label: JOURS[i]!,
      nbJours: a.dates.size,
      caMoyen: a.dates.size ? a.ca / a.dates.size : 0,         // CA moyen pour ce jour
      couvertsMoyen: a.dates.size ? a.covers / a.dates.size : 0,
      ticketMoyen: a.covers ? a.ca / a.covers : 0,
    }));
  }, [revenues]);

  // ---- Agrégat par MOIS ----
  const byMonth = useMemo(() => {
    const map = new Map<string, { ca: number; covers: number; services: number }>();
    for (const r of revenues) {
      const ym = r.revenue_date.slice(0, 7);
      const g = map.get(ym) ?? { ca: 0, covers: 0, services: 0 };
      g.ca += revTotal(r);
      g.covers += r.covers ?? 0;
      g.services += Math.max(1, serviceUnits(r.service));
      map.set(ym, g);
    }
    // objectif du mois = services planifiés ce mois × objectif/service.
    function plannedUnitsInMonth(ym: string): number {
      const [y, m] = ym.split("-").map(Number);
      const day = new Date(y!, (m! - 1), 1);
      let n = 0;
      while (day.getMonth() === (m! - 1)) {
        const wd = (day.getDay() + 6) % 7;
        n += SVC_PER_WEEKDAY[wd] ?? 0;
        day.setDate(day.getDate() + 1);
      }
      return n;
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, g]) => {
        const [y, m] = ym.split("-").map(Number);
        const obj = plannedUnitsInMonth(ym) * OBJ_TTC_PER_SERVICE;
        return {
          ym,
          label: `${MOIS_NOMS[(m! - 1)]} ${y}`,
          ca: g.ca, covers: g.covers,
          objective: obj,
          pct: obj ? g.ca / obj : 0,
          ticketMoyen: g.covers ? g.ca / g.covers : 0,
        };
      });
  }, [revenues]);

  if (loading) return <div className="suivi-page"><h1>Suivi</h1><p className="muted">Chargement…</p></div>;

  const s = current.stats;
  const pctProj = s.objective ? s.projectedCA / s.objective : 0;
  const pctReal = s.objective ? s.realizedCA / s.objective : 0;
  const cls = pctClass(pctProj);
  const ticketMoyen = s.covers > 0 ? s.realizedCA / s.covers : 0;          // CA ÷ couverts
  const couvertsParService = s.realizedUnits > 0 ? s.covers / s.realizedUnits : 0; // nb couverts / service
  const verdict = cls === "ok" ? "Objectif en vue 👍" : cls === "warn" ? "Tout près de l'objectif" : "En retard sur l'objectif";

  const annualPct = annual.budgetHT ? annual.projeteHT / annual.budgetHT : 0;

  return (
    <div className="suivi-page">
      <h1>Suivi — où j'en suis</h1>
      <p className="muted">CA réel vs objectif, jour par jour et semaine par semaine. La semaine en cours est <b>projetée</b> (on extrapole les services pas encore faits à ta moyenne actuelle).</p>

      {/* ---- Semaine en cours ---- */}
      <h2>Cette semaine (lun → dim)</h2>
      <div className="card suivi-hero">
        <div className="suivi-hero-top">
          <div>
            <div className="muted">CA réalisé à ce jour</div>
            <div className="suivi-big">{fmt0(s.realizedCA)}</div>
          </div>
          <div>
            <div className="muted">CA projeté fin de semaine</div>
            <div className="suivi-big">{fmt0(s.projectedCA)}</div>
          </div>
          <div>
            <div className="muted">Objectif semaine</div>
            <div className="suivi-big">{fmt0(s.objective)}</div>
          </div>
          <div>
            <div className="muted">Atteinte (projetée)</div>
            <div className={`suivi-big pct-${cls}`}>{Math.round(pctProj * 100)} %</div>
          </div>
        </div>

        <div className="suivi-bar">
          <div className={`suivi-bar-fill fill-${cls}`} style={{ width: `${Math.min(100, Math.round(pctReal * 100))}%` }} />
          <div className="suivi-bar-proj" style={{ left: `${Math.min(100, Math.round(pctProj * 100))}%` }} title="projeté" />
        </div>
        <div className={`badge ${cls === "ok" ? "ok" : cls === "warn" ? "warn" : "bad"}`}>{verdict}</div>

        <div className="suivi-kpis">
          <div><div className="muted">Ticket moyen (CA ÷ couverts)</div><b>{ticketMoyen > 0 ? fmtEUR(ticketMoyen) : "—"}</b></div>
          <div><div className="muted">Couverts moyens / service</div><b>{couvertsParService > 0 ? Math.round(couvertsParService) : "—"}</b></div>
          <div><div className="muted">Couverts (total semaine)</div><b>{s.covers || "—"}</b></div>
          <div><div className="muted">Services faits</div><b>{s.realizedUnits} / {s.plannedUnits}</b></div>
        </div>
      </div>

      {/* ---- Jour par jour ---- */}
      <h2>Jour par jour</h2>
      <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
        <table className="exp-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="num">CA</th>
              <th className="num">Objectif</th>
              <th className="num">Couverts</th>
              <th className="num">Ticket moyen</th>
              <th className="num">% obj.</th>
            </tr>
          </thead>
          <tbody>
            {current.days.map((d) => {
              const obj = d.plannedUnits * OBJ_TTC_PER_SERVICE;
              const tm = d.covers > 0 ? d.ca / d.covers : 0;
              const p = obj ? d.ca / obj : 0;
              const closed = d.plannedUnits === 0;
              return (
                <tr key={d.dateISO} className={d.isToday ? "row-today" : ""} style={d.isFuture || (!d.hasData && !closed) ? { color: "var(--muted)" } : undefined}>
                  <td>{d.label}{d.isToday ? " · aujourd'hui" : ""}{closed ? " (fermé)" : ""}</td>
                  <td className="num">{d.hasData ? fmt0(d.ca) : closed ? "—" : <span className="muted">à venir</span>}</td>
                  <td className="num">{closed ? "—" : fmt0(obj)}</td>
                  <td className="num">{d.covers || (closed ? "—" : "")}</td>
                  <td className="num">{tm > 0 ? fmtEUR(tm) : "—"}</td>
                  <td className="num">{d.hasData && obj ? `${Math.round(p * 100)} %` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Rythme vs objectif (tout en HT, comme le business plan) ---- */}
      <h2>Ton rythme vs objectif (HT)</h2>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="muted" style={{ marginTop: 0 }}>Moyenne de tes 30 derniers jours, en HT (hors TVA), pour comparer à ton business plan.</p>
        <div className="suivi-kpis">
          <div><div className="muted">CA moyen / service (HT)</div><b>{annual.hasData ? fmtEUR(annual.avgPerUnitHT) : "—"}</b></div>
          <div><div className="muted">Objectif / service (HT)</div><b>{fmtEUR(OBJ_HT_PER_SERVICE)}</b></div>
          <div><div className="muted">Atteinte</div><b className={`pct-${pctClass(annualPct)}`}>{Math.round(annualPct * 100)} %</b></div>
        </div>
        <div className="hint">
          {annual.hasData ? (
            <>
              Tu réalises en moyenne <b>{fmtEUR(annual.avgPerUnitHT)} HT par service</b>, soit <b>{Math.round(annualPct * 100)} %</b> de la cible (278,91 € HT/service).<br />
              <b>Run-rate</b> (si tu gardes ce rythme sur 12 mois pleins) : <b>{fmt0(annual.projeteHT)} HT</b> vs <b>{fmt0(annual.budgetHT)} HT</b> visés en croisière (année pleine).<br />
              Ta <b>1re année réelle (1er juin → 31 déc)</b> est plus courte (~7 mois) et en montée en charge : budget business plan ≈ <b>125 175 € HT</b> — détail dans l'onglet <b>Prévisionnel</b>.
            </>
          ) : "Saisis quelques services pour estimer ton rythme."}
        </div>
      </div>

      {/* ---- Par jour de la semaine ---- */}
      <h2>Par jour de la semaine (moyennes)</h2>
      <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
        <table className="exp-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="num">CA moyen</th>
              <th className="num">Couverts moyens</th>
              <th className="num">Ticket moyen</th>
              <th className="num">Nb de fois</th>
            </tr>
          </thead>
          <tbody>
            {byWeekday.map((d, i) => (
              <tr key={d.label} style={(SVC_PER_WEEKDAY[i] ?? 0) === 0 ? { color: "var(--muted)" } : undefined}>
                <td>{d.label}</td>
                <td className="num">{d.nbJours ? fmt0(d.caMoyen) : "—"}</td>
                <td className="num">{d.nbJours && d.couvertsMoyen ? Math.round(d.couvertsMoyen) : "—"}</td>
                <td className="num">{d.ticketMoyen ? fmtEUR(d.ticketMoyen) : "—"}</td>
                <td className="num">{d.nbJours || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Par mois ---- */}
      {byMonth.length > 0 && (
        <>
          <h2>Par mois</h2>
          <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th className="num">CA</th>
                  <th className="num">Objectif</th>
                  <th className="num">% obj.</th>
                  <th className="num">Couverts</th>
                  <th className="num">Ticket moyen</th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map((m) => (
                  <tr key={m.ym}>
                    <td>{m.label}</td>
                    <td className="num">{fmt0(m.ca)}</td>
                    <td className="num">{fmt0(m.objective)}</td>
                    <td className={`num pct-${pctClass(m.pct)}`}>{Math.round(m.pct * 100)} %</td>
                    <td className="num">{m.covers || "—"}</td>
                    <td className="num">{m.ticketMoyen ? fmtEUR(m.ticketMoyen) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---- Projection compte de résultat (à ce rythme) ---- */}
      <h2>À ce rythme — compte de résultat projeté (HT)</h2>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Projection si tu gardes ton rythme actuel. <b>1re année = {projection.moisAn1} mois</b> (1er juin → 31 déc, {projection.servicesAn1} services) ;
          année prochaine = année pleine.
        </p>
        <table className="exp-table">
          <thead>
            <tr>
              <th>€ (HT)</th>
              <th className="num">1re année ({projection.moisAn1} mois)</th>
              <th className="num">Année prochaine (pleine)</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows: { label: string; pick: (a: AnneeResultat) => number; strong?: boolean; always?: boolean }[] = [
                { label: "Chiffre d'affaires", pick: (a) => a.ca, strong: true, always: true },
                { label: "Coût matière", pick: (a) => -a.achats },
                { label: "Marge brute", pick: (a) => a.margeBrute, always: true },
                { label: "Charges externes", pick: (a) => -a.chargesExternes },
                { label: "Personnel", pick: (a) => -a.personnel },
                { label: "EBE", pick: (a) => a.ebe, strong: true, always: true },
                { label: "Amortissements", pick: (a) => -a.dotations },
                { label: "Résultat exploitation", pick: (a) => a.resultatExploitation },
                { label: "Charges financières", pick: (a) => -a.chargesFinancieres },
                { label: "Résultat avant impôt", pick: (a) => a.resultatAvantImpot },
                { label: "Impôt (IS)", pick: (a) => -a.is },
                { label: "Résultat net", pick: (a) => a.resultatNet, strong: true, always: true },
              ];
              const visible = showPnl ? rows : rows.filter((r) => r.always);
              return visible.map((r) => {
                const v1 = r.pick(projection.cr.an1);
                const v2 = r.pick(projection.cr.an2);
                return (
                  <tr key={r.label}>
                    <td>{r.strong ? <b>{r.label}</b> : r.label}</td>
                    <td className="num" style={{ color: v1 < 0 ? "var(--muted)" : undefined }}>{r.strong ? <b>{fmt0(v1)}</b> : fmt0(v1)}</td>
                    <td className="num" style={{ color: v2 < 0 ? "var(--muted)" : undefined }}>{r.strong ? <b>{fmt0(v2)}</b> : fmt0(v2)}</td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
        <button className="link" style={{ marginTop: 8 }} onClick={() => setShowPnl((v) => !v)}>
          {showPnl ? "▲ Replier le détail" : "▼ Dérouler le détail complet (jusqu'au résultat net)"}
        </button>
      </div>

      {/* ---- Semaines passées ---- */}
      {pastWeeks.length > 0 && (
        <>
          <h2>Semaines précédentes</h2>
          <div className="table-wrap">
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Semaine du</th>
                  <th className="num">CA</th>
                  <th className="num">Objectif</th>
                  <th className="num">% obj.</th>
                  <th className="num">Couverts</th>
                  <th className="num">Ticket moyen</th>
                </tr>
              </thead>
              <tbody>
                {pastWeeks.map((w) => {
                  const p = w.objective ? w.realizedCA / w.objective : 0;
                  const tm = w.covers > 0 ? w.realizedCA / w.covers : 0;
                  return (
                    <tr key={w.mondayISO}>
                      <td>{w.mondayISO}</td>
                      <td className="num">{fmt0(w.realizedCA)}</td>
                      <td className="num">{fmt0(w.objective)}</td>
                      <td className={`num pct-${pctClass(p)}`}>{Math.round(p * 100)} %</td>
                      <td className="num">{w.covers || "—"}</td>
                      <td className="num">{tm > 0 ? fmtEUR(tm) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
