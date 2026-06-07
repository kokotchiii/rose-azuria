// Agrégations et projections pour les statistiques de recettes.
// Fonctions pures (testables), sans dépendance React.

import { revenueTotal, serviceUnits, type RevenueRow } from "./data";

export type Gran = "day" | "week" | "month" | "year";
export type Horizon = "week" | "month" | "year";

export interface Point { label: string; value: number }

// Sélecteur de montant d'une recette : TTC par défaut, ou HT selon la base choisie.
export type AmountFn = (r: RevenueRow) => number;

// ---------- Planning d'ouverture (configurable) ----------
// servicesPerWeekday : nb de services ouverts par jour de semaine (lundi = 0).
// openingDate : aucun service compté avant cette date.
export interface ScheduleCfg { servicesPerWeekday: number[]; openingDate: string }
export const DEFAULT_SCHEDULE_CFG: ScheduleCfg = { servicesPerWeekday: [2, 2, 2, 2, 2, 1, 0], openingDate: "2026-06-02" };

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// ---------- utilitaires de date (locale, app RN) ----------
function pad(n: number): string { return String(n).padStart(2, "0"); }
function isoOf(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dateOnly(iso: string): Date { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d: Date, n: number): Date { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
const DAY_MS = 86_400_000;

// Numéro de semaine ISO (lundi = début, la semaine 1 contient le 1er jeudi).
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // dimanche → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// Clé + étiquette d'un regroupement selon la granularité.
function bucket(iso: string, g: Gran): { key: string; label: string } {
  const ymd = iso.slice(0, 10);
  const [y, m, d] = ymd.split("-");
  if (g === "day") return { key: ymd, label: `${d}/${m}` };
  if (g === "month") return { key: `${y}-${m}`, label: `${MONTHS_SHORT[+m - 1]} ${y.slice(2)}` };
  if (g === "year") return { key: y, label: y };
  const wk = isoWeek(dateOnly(ymd));
  return { key: `${wk.year}-W${pad(wk.week)}`, label: `S${wk.week}` };
}

// Date de départ de la fenêtre affichée selon la granularité.
export function windowStart(g: Gran, now: Date = new Date()): string {
  if (g === "day") return isoOf(addDays(now, -29)); // 30 derniers jours
  if (g === "week") return isoOf(addDays(now, -7 * 11)); // ~12 semaines
  if (g === "month") return isoOf(new Date(now.getFullYear(), now.getMonth() - 11, 1)); // 12 mois
  return "0000-00-00"; // année → tout l'historique
}

// Série de CA agrégée par bucket, triée chronologiquement.
export function caSeries(rows: RevenueRow[], g: Gran, amount: AmountFn = revenueTotal): Point[] {
  const map = new Map<string, { label: string; value: number }>();
  for (const r of rows) {
    const b = bucket(r.revenue_date, g);
    const cur = map.get(b.key) ?? { label: b.label, value: 0 };
    cur.value += amount(r);
    map.set(b.key, cur);
  }
  return [...map.entries()].sort((a, b2) => (a[0] < b2[0] ? -1 : 1)).map(([, v]) => ({ label: v.label, value: v.value }));
}

// Répartition du CA par jour de semaine (Lun→Dim).
export function byWeekday(rows: RevenueRow[], amount: AmountFn = revenueTotal): Point[] {
  const sums = new Array(7).fill(0);
  for (const r of rows) {
    const wd = (dateOnly(r.revenue_date).getDay() + 6) % 7; // lundi = 0
    sums[wd] += amount(r);
  }
  return WEEKDAYS.map((label, i) => ({ label, value: sums[i] }));
}

export interface WindowStats {
  ca: number;
  covers: number;
  panier: number;          // CA / couvert
  cash: number; cb: number; other: number;
  count: number;           // nb de jours-service
  days: number;            // nb de jours distincts avec recette
  avgPerDay: number;       // CA moyen par jour avec recette
  avgCoversPerDay: number; // couverts moyens par jour avec recette
  bestDay: { date: string; value: number } | null;
}

export function windowStats(rows: RevenueRow[], amount: AmountFn = revenueTotal): WindowStats {
  const ca = rows.reduce((s, r) => s + amount(r), 0);
  const covers = rows.reduce((s, r) => s + (r.covers ?? 0), 0);
  // Les encaissements (espèces/CB/autre) sont toujours des montants reçus (TTC).
  const cash = rows.reduce((s, r) => s + Number(r.amount_cash || 0), 0);
  const cb = rows.reduce((s, r) => s + Number(r.amount_cb || 0), 0);
  const other = rows.reduce((s, r) => s + Number(r.amount_other || 0), 0);

  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.revenue_date, (byDay.get(r.revenue_date) ?? 0) + amount(r));
  let bestDay: WindowStats["bestDay"] = null;
  for (const [date, value] of byDay) if (!bestDay || value > bestDay.value) bestDay = { date, value };
  const days = byDay.size;

  return {
    ca, covers, panier: covers > 0 ? ca / covers : 0, cash, cb, other,
    count: rows.length, days,
    avgPerDay: days > 0 ? ca / days : 0,
    avgCoversPerDay: days > 0 ? covers / days : 0,
    bestDay,
  };
}

// ---------- Projections ----------
export interface Projection {
  horizon: Horizon;
  actual: number;     // réalisé depuis le début de la période en cours
  projected: number;  // extrapolation à la fin de la période (au prorata des services)
  prev: number;       // total de la période précédente (complète)
  objective: number;  // objectif = prev × (1 + croissance%)
  elapsed: number;    // services écoulés (depuis l'ouverture / début de période)
  total: number;      // services prévus sur la période
}

// Compte les services planifiés dans [startIso, endIso), borne basse relevée à la
// date d'ouverture (pas de service avant). Tient compte du planning hebdomadaire.
function servicesBetween(startIso: string, endIso: string, cfg: ScheduleCfg): number {
  const from = startIso < cfg.openingDate ? cfg.openingDate : startIso;
  if (from >= endIso) return 0;
  const end = dateOnly(endIso);
  let d = dateOnly(from);
  let n = 0;
  while (d < end) {
    const wd = (d.getDay() + 6) % 7; // lundi = 0
    n += cfg.servicesPerWeekday[wd] ?? 0;
    d = addDays(d, 1);
  }
  return n;
}

function horizonBounds(h: Horizon, now: Date): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  if (h === "week") {
    const dow = (now.getDay() + 6) % 7; // lundi = 0
    const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -dow);
    const end = addDays(start, 7);
    return { start, end, prevStart: addDays(start, -7), prevEnd: start };
  }
  if (h === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end, prevStart: new Date(now.getFullYear(), now.getMonth() - 1, 1), prevEnd: start };
  }
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear() + 1, 0, 1);
  return { start, end, prevStart: new Date(now.getFullYear() - 1, 0, 1), prevEnd: start };
}

function sumBetween(rows: RevenueRow[], startIso: string, endIso: string, amount: AmountFn): number {
  // [start, end) en comparaison de chaînes ISO.
  let s = 0;
  for (const r of rows) if (r.revenue_date >= startIso && r.revenue_date < endIso) s += amount(r);
  return s;
}

export function project(rows: RevenueRow[], h: Horizon, growthPct: number, amount: AmountFn = revenueTotal, cfg: ScheduleCfg = DEFAULT_SCHEDULE_CFG, now: Date = new Date()): Projection {
  const { start, end, prevStart, prevEnd } = horizonBounds(h, now);
  const startIso = isoOf(start), endIso = isoOf(end);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowIso = isoOf(addDays(today, 1));

  // Services RÉELLEMENT réalisés = toutes les saisies de la période (une saisie = un
  // service déjà fait, puisqu'on saisit après coup). Une « journée » compte pour 2.
  // Ainsi une fermeture exceptionnelle ne dilue pas la moyenne, et le décompte colle
  // exactement au CA réalisé (même plage).
  const inPeriod = rows.filter((r) => r.revenue_date >= startIso && r.revenue_date < endIso);
  const recorded = inPeriod.reduce((n, r) => n + serviceUnits(r.service), 0);

  // Jour le plus récent déjà saisi (pour ne pas recompter en « à venir » un jour saisi).
  let lastLogged = "";
  for (const r of inPeriod) if (r.revenue_date > lastLogged) lastLogged = r.revenue_date;
  const afterLast = lastLogged ? isoOf(addDays(dateOnly(lastLogged), 1)) : tomorrowIso;
  const futureStart = afterLast > tomorrowIso ? afterLast : tomorrowIso;
  // Services restant à venir d'ici la fin de période, au planning normal (« on sera ouvert »).
  const future = servicesBetween(futureStart, endIso, cfg);

  const elapsed = recorded;            // services réalisés
  const total = recorded + future;     // réalisés + à venir (toujours ≥ réalisés)

  const actual = sumBetween(rows, startIso, endIso, amount);
  const projected = recorded > 0 ? (actual / recorded) * total : 0;
  const prev = sumBetween(rows, isoOf(prevStart), isoOf(prevEnd), amount);
  const objective = prev * (1 + growthPct / 100);

  return { horizon: h, actual, projected, prev, objective, elapsed, total };
}
