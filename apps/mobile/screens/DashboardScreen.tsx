import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  expenseHT,
  fetchAiCostThisMonth,
  fetchExpenses,
  fetchPendingReimbursements,
  fetchRevenues,
  revenueHT,
  revenueTotal,
  type ExpenseListItem,
  type RevenueRow,
} from "../lib/data";
import { getDefaultTvaRate, TVA_DEFAULT } from "../lib/settings";
import { daysAgoISO, fmtDayShort, fmtEUR, startOfMonthISO, todayISO } from "../lib/format";
import { supabase } from "../supabaseClient";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle, Segmented } from "./ui";
import { Donut, LineChart } from "./charts";

type Period = "month" | "30j" | "all";
type Basis = "ttc" | "ht";

// Palette tournante pour les parts du donut des catégories.
const CAT_COLORS = ["#DC2626", "#CA8A04", "#15803D", "#2563EB", "#7C3AED", "#DB2777", "#0891B2", "#EA580C", "#6B7280"];

export function DashboardScreen() {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [aiCost, setAiCost] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [reimbTotal, setReimbTotal] = useState(0); // à rembourser, tout-temps
  const [period, setPeriod] = useState<Period>("month");
  const [basis, setBasis] = useState<Basis>("ht");
  const [defaultRate, setDefaultRate] = useState(TVA_DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getDefaultTvaRate().then(setDefaultRate); }, []);

  const range = useMemo(() => {
    if (period === "month") return { from: startOfMonthISO(), to: todayISO() };
    if (period === "30j") return { from: daysAgoISO(29), to: todayISO() };
    return {} as { from?: string; to?: string };
  }, [period]);

  const load = useCallback(() => {
    Promise.all([fetchExpenses(range), fetchRevenues(range)])
      .then(([exp, rev]) => { setExpenses(exp); setRevenues(rev); })
      .catch(() => { setExpenses([]); setRevenues([]); })
      .finally(() => setLoading(false));
    fetchAiCostThisMonth().then(setAiCost).catch(() => setAiCost({ total: 0, count: 0 }));
    // Le « à rembourser » est indépendant de la période : c'est tout ce qui reste dû.
    fetchPendingReimbursements()
      .then((groups) => setReimbTotal(groups.reduce((s, g) => s + g.total, 0)))
      .catch(() => setReimbTotal(0));
  }, [range]);

  useEffect(() => {
    load();
    // Temps réel : rafraîchit dès qu'une analyse IA, une dépense ou une recette change.
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_usage" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "revenues" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const totals = useMemo(() => {
    const ht = basis === "ht";
    // Dépense HT : TTC − TVA si connue, sinon on retombe sur le TTC (TVA non extraite).
    const dep = expenses.reduce((s, e) => s + (ht ? expenseHT(e) ?? Number(e.amount_ttc) : Number(e.amount_ttc)), 0);
    const rev = revenues.reduce((s, r) => s + (ht ? revenueHT(r, defaultRate) : revenueTotal(r)), 0);
    return { dep, rev, net: rev - dep, count: expenses.length };
  }, [expenses, revenues, basis, defaultRate]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.category?.label ?? "Sans catégorie";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries())
      .map(([name, value], i) => ({ label: name, value, color: CAT_COLORS[i % CAT_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // Évolution des dépenses par jour sur la période.
  const expSeries = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of expenses) byDay.set(e.expense_date, (byDay.get(e.expense_date) ?? 0) + Number(e.amount_ttc));
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => ({ label: fmtDayShort(d), value: v }));
  }, [expenses]);

  if (loading) return <Loading />;

  const periodLabel = period === "month" ? "ce mois" : period === "30j" ? "30 j" : "tout";
  const bSuffix = basis === "ht" ? " HT" : " TTC";

  return (
    <Screen>
      <Segmented<Period>
        options={[{ key: "month", label: "Ce mois" }, { key: "30j", label: "30 jours" }, { key: "all", label: "Tout" }]}
        value={period}
        onChange={setPeriod}
      />
      <Segmented<Basis>
        options={[{ key: "ht", label: "HT (brut)" }, { key: "ttc", label: "TTC (net)" }]}
        value={basis}
        onChange={setBasis}
      />

      <View style={styles.kpiRow}>
        <Kpi label={`Recettes${bSuffix} (${periodLabel})`} value={fmtEUR(totals.rev)} tone="good" />
        <Kpi label={`Dépenses${bSuffix} (${periodLabel})`} value={fmtEUR(totals.dep)} />
      </View>
      <Kpi
        label={`Résultat net${bSuffix} (${periodLabel})`}
        value={fmtEUR(totals.net)}
        tone={totals.net >= 0 ? "good" : "warn"}
      />

      {(totals.rev > 0 || totals.dep > 0) && (
        <Card>
          <CompareBar label="Recettes" value={totals.rev} scale={Math.max(totals.rev, totals.dep, 1)} color={colors.success} />
          <CompareBar label="Dépenses" value={totals.dep} scale={Math.max(totals.rev, totals.dep, 1)} color={colors.primary} />
        </Card>
      )}

      <View style={styles.kpiRow}>
        <Kpi label="À rembourser (total)" value={fmtEUR(reimbTotal)} tone="warn" />
        <Kpi
          label={`Coût IA ce mois · ${aiCost.count} analyse${aiCost.count > 1 ? "s" : ""}`}
          value={`$${aiCost.total.toFixed(2)}`}
        />
      </View>

      <SectionTitle>Dépenses par catégorie</SectionTitle>
      {byCategory.length === 0 ? (
        <Empty icon="pie-chart-outline" text="Aucune dépense sur cette période." />
      ) : (
        <Card>
          <Donut
            segments={byCategory}
            centerValue={fmtEUR(totals.dep)}
            centerLabel="total"
            format={fmtEUR}
          />
        </Card>
      )}

      <SectionTitle>Évolution des dépenses</SectionTitle>
      {expSeries.length > 1 ? (
        <Card>
          <LineChart data={expSeries} color={colors.primary} format={fmtEUR} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.muted}>Pas assez de jours pour tracer une courbe (au moins 2).</Text>
        </Card>
      )}
    </Screen>
  );
}

function CompareBar({ label, value, scale, color }: { label: string; value: number; scale: number; color: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barVal}>{fmtEUR(value)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(2, (value / scale) * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  periodRow: { flexDirection: "row", gap: space.sm },
  kpiRow: { flexDirection: "row", gap: space.md },
  muted: { ...type.small, color: colors.textMuted },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 12, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 12, borderRadius: radius.pill },
});
