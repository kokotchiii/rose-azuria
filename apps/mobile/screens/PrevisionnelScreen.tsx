// Écran Prévisionnel : branche le moteur @resto/previsionnel sur les données réelles
// (recettes + dépenses) pour projeter le CA An1/An2/An3 et le compte de résultat 3 ans.

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  genererPrevisionnel,
  HYPOTHESES_DEFAUT,
  type AnneeResultat,
  type CategorieFacture,
  type CompteResultat3Ans,
  type Facture,
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
import { getDefaultTvaRate, getOpenSchedule, servicesPerWeekdayOf, TVA_DEFAULT } from "../lib/settings";
import { fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle } from "./ui";
import { BarList } from "./charts";

// Mappe un libellé de catégorie de dépense vers la nomenclature du moteur.
// Seules nourriture/boissons/alcool comptent dans le coût matière ; le reste est neutre.
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

export function PrevisionnelScreen() {
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [rate, setRate] = useState(TVA_DEFAULT);
  const [svcPerWeek, setSvcPerWeek] = useState(HYPOTHESES_DEFAUT.servicesParSemaine);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchRevenues(), fetchExpenses(), getDefaultTvaRate(), getOpenSchedule()])
      .then(([rev, exp, r, sch]) => {
        setRevenues(rev);
        setExpenses(exp);
        setRate(r);
        const n = servicesPerWeekdayOf(sch).reduce((a, b) => a + b, 0);
        setSvcPerWeek(n > 0 ? n : HYPOTHESES_DEFAUT.servicesParSemaine);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const prev = useMemo(() => {
    // Une recette → autant de "services" que d'unités (une journée = 2 services),
    // chacun portant sa part de CA HT → CA moyen/service cohérent avec le business plan.
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
    const h = { ...HYPOTHESES_DEFAUT, servicesParSemaine: svcPerWeek };
    return genererPrevisionnel(ventes, factures, h);
  }, [revenues, expenses, rate, svcPerWeek]);

  if (loading) return <Loading />;
  if (revenues.length === 0) {
    return <Screen><Empty icon="trending-up-outline" text="Saisis des recettes pour générer le prévisionnel." /></Screen>;
  }

  const { projectionCA: pc, compteResultat: cr, coutMatiereSource, coutMatiereUtilise, caServiceHT, horizons } = prev;
  const reel = coutMatiereSource === "reel";

  return (
    <Screen>
      {/* Base de calcul */}
      <Card>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, reel ? styles.badgeReal : styles.badgeHyp]}>
            <Text style={[styles.badgeText, { color: reel ? colors.success : colors.gold }]}>
              {reel ? "Basé sur le coût matière RÉEL" : "Basé sur l'hypothèse (pas assez de données)"}
            </Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <Kpi label="CA moyen / service (HT)" value={fmtEUR(caServiceHT.total)} />
          <Kpi label="Coût matière" value={pct(coutMatiereUtilise)} tone="warn" />
        </View>
        <Text style={styles.note}>
          {svcPerWeek} services/semaine · 48 semaines/an · montée en charge 85 % (An1).
        </Text>
      </Card>

      {/* Projection CA */}
      <SectionTitle>Projection du chiffre d'affaires (HT)</SectionTitle>
      <Card>
        <BarList
          data={[
            { label: "An 1", value: pc.an1 },
            { label: "An 2", value: pc.an2 },
            { label: "An 3", value: pc.an3 },
          ]}
          format={fmt0}
          color={colors.success}
        />
        <Text style={styles.note}>Régime annuel plein (avant montée en charge) : {fmt0(pc.regimeAnnuel)}.</Text>
      </Card>

      {/* Compte de résultat 3 ans */}
      <SectionTitle>Compte de résultat 3 ans</SectionTitle>
      <Card>
        <PnlTable cr={cr} />
      </Card>

      {/* Run-rate (rythme réel extrapolé) */}
      <SectionTitle>Rythme réel extrapolé</SectionTitle>
      <View style={styles.kpiRow}>
        <Kpi label="CA HT / semaine" value={fmt0(horizons.parSemaine)} />
        <Kpi label="CA HT / mois" value={fmt0(horizons.parMois)} />
      </View>
      <Kpi label="CA HT / an (run-rate)" value={fmt0(horizons.parAn)} tone="good" />
    </Screen>
  );
}

// Tableau compte de résultat : libellé + colonnes An1/An2/An3.
function PnlTable({ cr }: { cr: CompteResultat3Ans }) {
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

  return (
    <View>
      <View style={[styles.trow, styles.thead]}>
        <Text style={[styles.tcLabel, styles.thText]}>€</Text>
        {["An 1", "An 2", "An 3"].map((h) => (
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
  tc: { width: 70, textAlign: "right", ...type.small, color: colors.text, fontSize: 12.5 },
  thText: { color: colors.textMuted, fontWeight: "700" },
  tStrong: { fontWeight: "800", color: colors.text },
  tNeg: { color: colors.textMuted },
});
