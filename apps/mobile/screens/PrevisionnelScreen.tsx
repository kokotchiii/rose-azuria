// Écran Prévisionnel : branche le moteur @resto/previsionnel sur les données réelles.
// Deux modes :
//  - "initial"   : le business plan cible (CA/service de référence, hypothèses par défaut, années pleines).
//  - "live"      : temps réel d'après les recettes + dépenses saisies (coût matière réel), avec 1er
//                  exercice PARTIEL (ouverture en cours d'année → bilan en décembre).

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  fetchRevenues,
  revenueHT,
  serviceUnits,
  type ExpenseListItem,
  type RevenueRow,
} from "../lib/data";
import {
  DEFAULT_OPENING_DATE,
  DEFAULT_OPEN_SCHEDULE,
  getDefaultTvaRate,
  getOpeningDate,
  getOpenSchedule,
  servicesPerWeekdayOf,
  TVA_DEFAULT,
  type DaySchedule,
} from "../lib/settings";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle, Segmented } from "./ui";
import { BarList } from "./charts";

type Mode = "initial" | "live";

// CA HT/service de référence du business plan → An1 ≈ 125 175 € (11 services × 48 sem × 0,85).
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
  let day = new Date(y, (parts[1] ?? 1) - 1, parts[2] ?? 1);
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

export function PrevisionnelScreen() {
  const [mode, setMode] = useState<Mode>("live");
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [rate, setRate] = useState(TVA_DEFAULT);
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_OPEN_SCHEDULE);
  const [openingDate, setOpeningDate] = useState(DEFAULT_OPENING_DATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchRevenues(), fetchExpenses(), getDefaultTvaRate(), getOpenSchedule(), getOpeningDate()])
      .then(([rev, exp, r, sch, od]) => {
        setRevenues(rev);
        setExpenses(exp);
        setRate(r);
        setSchedule(sch);
        setOpeningDate(od);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const svcPerWeek = useMemo(() => {
    const n = servicesPerWeekdayOf(schedule).reduce((a, b) => a + b, 0);
    return n > 0 ? n : HYPOTHESES_DEFAUT.servicesParSemaine;
  }, [schedule]);

  const model: Model = useMemo(() => {
    if (mode === "initial") {
      const res = genererPrevisionnel([{ date: "2026-01-01", totalHT: CA_SERVICE_CIBLE_HT }], [], HYPOTHESES_DEFAUT);
      return {
        pc: res.projectionCA, cr: res.compteResultat, caService: res.caServiceHT.total,
        cmPct: res.coutMatiereUtilise, cmSource: res.coutMatiereSource, horizons: res.horizons,
        fractionAn1: 1, servicesAn1: 0,
      };
    }
    // --- mode temps réel ---
    const h = { ...HYPOTHESES_DEFAUT, servicesParSemaine: svcPerWeek };
    const ventes: VenteService[] = revenues.flatMap((r) => {
      const units = Math.max(1, serviceUnits(r.service));
      const htPer = revenueHT(r, rate) / units;
      return Array.from({ length: units }, () => ({ date: r.revenue_date, totalHT: htPer }));
    });
    const factures: Facture[] = expenses.map((e) => ({
      date: e.expense_date,
      categorie: mapCategorie(e.category?.label),
      montantHT: expenseHT(e) ?? Number(e.amount_ttc),
    }));
    const caService = caHTParService(ventes, h);
    const cm = coutMatiereReel(factures, ventes, h);
    const cmSource: "reel" | "hypothese" = cm.suffisant ? "reel" : "hypothese";
    const cmPct = cm.suffisant ? cm.ratioGlobal : coutMatiereHypothese(caService, h);

    const regimeAnnuel = caService.total * h.servicesParSemaine * h.semainesParAn;
    const servicesAn1 = servicesOuvertureAFinAnnee(openingDate, servicesPerWeekdayOf(schedule));
    const fractionAn1 = moisJusquaDecembre(openingDate) / 12;
    // An1 = 1er exercice partiel (réel run-rate) ; An2 = 1re année pleine ; An3 = +croissance.
    const pc: ProjectionCA = {
      regimeAnnuel,
      an1: caService.total * servicesAn1,
      an2: regimeAnnuel,
      an3: regimeAnnuel * (1 + h.croissanceAn3),
    };
    const cr = compteResultat3Ans(pc, cmPct, h, fractionAn1);
    return { pc, cr, caService: caService.total, cmPct, cmSource, horizons: projeterHorizons(caService.total, h), fractionAn1, servicesAn1 };
  }, [mode, revenues, expenses, rate, svcPerWeek, schedule, openingDate]);

  if (loading) return <Loading />;

  const live = mode === "live";
  const noData = live && revenues.length === 0;
  const reel = model.cmSource === "reel";
  const moisAn1 = Math.round(model.fractionAn1 * 12);

  return (
    <Screen>
      <Segmented<Mode>
        options={[{ key: "initial", label: "Prévisionnel initial" }, { key: "live", label: "Temps réel" }]}
        value={mode}
        onChange={setMode}
      />

      {noData ? (
        <Empty icon="trending-up-outline" text="Aucune recette saisie. Vois le « Prévisionnel initial », ou saisis des recettes pour le temps réel." />
      ) : (
        <>
          {/* Base de calcul */}
          <Card>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, reel ? styles.badgeReal : styles.badgeHyp]}>
                <Text style={[styles.badgeText, { color: reel ? colors.success : colors.gold }]}>
                  {live
                    ? reel ? "Coût matière RÉEL (d'après tes dépenses)" : "Coût matière : hypothèse (≥ 6 services + factures pour le réel)"
                    : "Business plan — hypothèses de référence"}
                </Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <Kpi label="CA moyen / service (HT)" value={fmtEUR(model.caService)} />
              <Kpi label="Coût matière" value={pct(model.cmPct)} tone="warn" />
            </View>
            <Text style={styles.note}>
              {svcPerWeek} services/semaine · 48 semaines/an{live ? "" : " · montée en charge 85 % (An1)"}.
            </Text>
            {live && (
              <Text style={styles.note}>
                1er exercice partiel : {model.servicesAn1} services du {fmtDate(openingDate)} au 31/12 ({moisAn1} mois).
                An2/An3 = années pleines.
              </Text>
            )}
          </Card>

          {/* Projection CA */}
          <SectionTitle>Projection du chiffre d'affaires (HT)</SectionTitle>
          <Card>
            <BarList
              data={[
                { label: live ? `An 1 (${moisAn1} mois)` : "An 1", value: model.pc.an1 },
                { label: "An 2", value: model.pc.an2 },
                { label: "An 3", value: model.pc.an3 },
              ]}
              format={fmt0}
              color={colors.success}
            />
            <Text style={styles.note}>Régime annuel plein (run-rate) : {fmt0(model.pc.regimeAnnuel)}.</Text>
          </Card>

          {/* Compte de résultat 3 ans */}
          <SectionTitle>Compte de résultat 3 ans</SectionTitle>
          <Card>
            <PnlTable cr={model.cr} live={live} moisAn1={moisAn1} />
          </Card>

          {/* Run-rate */}
          <SectionTitle>Rythme réel extrapolé</SectionTitle>
          <View style={styles.kpiRow}>
            <Kpi label="CA HT / semaine" value={fmt0(model.horizons.parSemaine)} />
            <Kpi label="CA HT / mois" value={fmt0(model.horizons.parMois)} />
          </View>
          <Kpi label="CA HT / an (run-rate)" value={fmt0(model.horizons.parAn)} tone="good" />
        </>
      )}
    </Screen>
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
  const heads = [live ? `An 1\n(${moisAn1} m.)` : "An 1", "An 2", "An 3"];

  return (
    <View>
      <View style={[styles.trow, styles.thead]}>
        <Text style={[styles.tcLabel, styles.thText]}>€</Text>
        {heads.map((h) => (
          <Text key={h} style={[styles.tc, styles.thText]}>{h}</Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.label} style={[styles.trow, r.strong && styles.trowStrong]}>
          <Text style={[styles.tcLabel, r.strong && styles.tStrong]} numberOfLines={1}>{r.label}</Text>
          {cols.map((a, i) => {
            const v = r.pick(a);
            return (
              <Text key={i} style={[styles.tc, r.strong && styles.tStrong, v < 0 && styles.tNeg]}>
                {fmt0(v)}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: "row" },
  badge: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  badgeReal: { backgroundColor: colors.successBg },
  badgeHyp: { backgroundColor: "#FEF3C7" },
  badgeText: { ...type.small, fontWeight: "700" },
  kpiRow: { flexDirection: "row", gap: space.md },
  note: { ...type.small, color: colors.textMuted },

  trow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  thead: { borderBottomColor: colors.borderStrong },
  trowStrong: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm },
  tcLabel: { flex: 1, ...type.small, color: colors.text, fontSize: 12.5 },
  tc: { width: 68, textAlign: "right", ...type.small, color: colors.text, fontSize: 12 },
  thText: { color: colors.textMuted, fontWeight: "700", fontSize: 11 },
  tStrong: { fontWeight: "800", color: colors.text },
  tNeg: { color: colors.textMuted },
});
