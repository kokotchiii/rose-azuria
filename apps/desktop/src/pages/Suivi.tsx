// Écran SUIVI : où j'en suis vs mes objectifs, clairement.
//  - Semaine en cours (lun→dim) : CA réalisé + PROJETÉ (extrapolation des services
//    restants), vs objectif, ticket moyen, couvert moyen.
//  - Détail jour par jour de la semaine.
//  - Cap annuel : à ce rythme, est-ce qu'on atteint le budget prévisionnel ?
//  - Historique des semaines passées.

import { useEffect, useMemo, useState } from "react";
import { fetchRevenues, type RevenueRow } from "../lib/revenues";
import { serviceUnits } from "../lib/queries";
import { fmtEUR } from "../lib/format";

// --- Objectif (business plan) ---
const OBJ_HT_PER_SERVICE = 278.91;      // CA HT moyen / service visé (An1 ≈ 125 175 €)
const TVA = 0.10;
const OBJ_TTC_PER_SERVICE = OBJ_HT_PER_SERVICE * (1 + TVA);  // ≈ 306,80 € TTC
// Services planifiés par jour : lun→ven midi+soir (2), samedi soir (1), dimanche fermé.
const SVC_PER_WEEKDAY = [2, 2, 2, 2, 2, 1, 0]; // index 0 = lundi
const WEEK_PLANNED_UNITS = SVC_PER_WEEKDAY.reduce((a, b) => a + b, 0); // 11
const SEMAINES_PAR_AN = 48;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRevenues().then(setRevenues).catch(() => {}).finally(() => setLoading(false));
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
    const avgPerUnit = units > 0 ? ca / units : OBJ_TTC_PER_SERVICE;
    const projete = avgPerUnit * WEEK_PLANNED_UNITS * SEMAINES_PAR_AN;
    const budget = OBJ_TTC_PER_SERVICE * WEEK_PLANNED_UNITS * SEMAINES_PAR_AN;
    return { projete, budget, avgPerUnit, hasData: units > 0 };
  }, [revenues, today]);

  if (loading) return <div className="suivi-page"><h1>Suivi</h1><p className="muted">Chargement…</p></div>;

  const s = current.stats;
  const pctProj = s.objective ? s.projectedCA / s.objective : 0;
  const pctReal = s.objective ? s.realizedCA / s.objective : 0;
  const cls = pctClass(pctProj);
  const ticketMoyen = s.covers > 0 ? s.realizedCA / s.covers : 0;          // CA ÷ couverts
  const couvertsParService = s.realizedUnits > 0 ? s.covers / s.realizedUnits : 0; // nb couverts / service
  const verdict = cls === "ok" ? "Objectif en vue 👍" : cls === "warn" ? "Tout près de l'objectif" : "En retard sur l'objectif";

  const annualPct = annual.budget ? annual.projete / annual.budget : 0;

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

      {/* ---- Cap annuel ---- */}
      <h2>Cap sur le budget prévisionnel</h2>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="muted" style={{ marginTop: 0 }}>À ton rythme des 30 derniers jours, sur une année pleine de croisière :</p>
        <div className="suivi-kpis">
          <div><div className="muted">CA annuel projeté</div><b>{fmt0(annual.projete)}</b></div>
          <div><div className="muted">Budget de croisière</div><b>{fmt0(annual.budget)}</b></div>
          <div><div className="muted">Atteinte</div><b className={`pct-${pctClass(annualPct)}`}>{Math.round(annualPct * 100)} %</b></div>
        </div>
        <div className="hint">
          {annual.hasData
            ? annualPct >= 1
              ? "À ce rythme, tu dépasses le budget de croisière. 🎯"
              : `À ce rythme, il manque ${fmt0(annual.budget - annual.projete)} sur l'année pour atteindre le budget de croisière.`
            : "Saisis quelques services pour estimer le cap annuel."}
          {" "}Repère 1re année (montée en charge) : ~125 175 € HT.
        </div>
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
