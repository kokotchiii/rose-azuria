import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  expenseHT,
  fetchAiCostThisMonth,
  fetchExpenses,
  fetchPendingReimbursements,
  fetchRevenues,
  revenueHT,
  revenueTVA,
  revenueTotal,
  type ExpenseListItem,
  type RevenueRow,
} from "../lib/data";
import { byWeekdayAvg, bucketSeries, caSeries, windowStats, type AmountFn } from "../lib/stats";
import { getDefaultTvaRate, TVA_DEFAULT } from "../lib/settings";
import { daysAgoISO, fmtEUR, startOfMonthISO, todayISO } from "../lib/format";
import { supabase } from "../supabaseClient";
import { colors, radius, space, type } from "../theme";
import { BarList, Donut, LineChart, StackBar } from "./charts";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle, Segmented } from "./ui";

type Period = "month" | "30j" | "all";
type DashView = "revenues" | "expenses";

// Palette tournante pour les parts du donut des catégories.
const CAT_COLORS = ["#DC2626", "#CA8A04", "#15803D", "#2563EB", "#7C3AED", "#DB2777", "#0891B2", "#EA580C", "#6B7280"];

export function DashboardScreen() {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [aiCost, setAiCost] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [reimbTotal, setReimbTotal] = useState(0); // à rembourser, tout-temps
  const [period, setPeriod] = useState<Period>("month");
  const [view, setView] = useState<DashView>("revenues");
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
    fetchPendingReimbursements()
      .then((groups) => setReimbTotal(groups.reduce((s, g) => s + g.total, 0)))
      .catch(() => setReimbTotal(0));
  }, [range]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_usage" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "revenues" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // Montant HT d'une dépense (TTC − TVA si connue, sinon TTC).
  const expHT = useCallback((e: ExpenseListItem) => expenseHT(e) ?? Number(e.amount_ttc), []);

  // Résultat net (HT) = recettes HT − dépenses HT.
  const top = useMemo(() => {
    const revHT = revenues.reduce((s, r) => s + revenueHT(r, defaultRate), 0);
    const depHT = expenses.reduce((s, e) => s + expHT(e), 0);
    return { revHT, depHT, net: revHT - depHT };
  }, [revenues, expenses, defaultRate, expHT]);

  const periodLabel = period === "month" ? "ce mois" : period === "30j" ? "30 j" : "tout";

  if (loading) return <Loading />;

  return (
    <Screen>
      <Segmented<Period>
        options={[{ key: "month", label: "Ce mois" }, { key: "30j", label: "30 jours" }, { key: "all", label: "Tout" }]}
        value={period}
        onChange={setPeriod}
      />

      <Kpi
        label={`Résultat net HT (${periodLabel})`}
        value={fmtEUR(top.net)}
        tone={top.net >= 0 ? "good" : "warn"}
      />
      {(top.revHT > 0 || top.depHT > 0) && (
        <Card>
          <CompareBar label="Recettes HT" value={top.revHT} scale={Math.max(top.revHT, top.depHT, 1)} color={colors.success} />
          <CompareBar label="Dépenses HT" value={top.depHT} scale={Math.max(top.revHT, top.depHT, 1)} color={colors.primary} />
        </Card>
      )}

      <Segmented<DashView>
        options={[{ key: "revenues", label: "Recettes" }, { key: "expenses", label: "Dépenses" }]}
        value={view}
        onChange={setView}
      />

      {view === "revenues"
        ? <RevenuesDash revenues={revenues} defaultRate={defaultRate} periodLabel={periodLabel} />
        : <ExpensesDash expenses={expenses} expHT={expHT} aiCost={aiCost} reimbTotal={reimbTotal} periodLabel={periodLabel} />}
    </Screen>
  );
}

// ---------- Vue Recettes ----------
function RevenuesDash({ revenues, defaultRate, periodLabel }: { revenues: RevenueRow[]; defaultRate: number; periodLabel: string }) {
  const r = useMemo(() => {
    const amount: AmountFn = (row) => revenueHT(row, defaultRate);
    const st = windowStats(revenues, amount);
    const caTTC = revenues.reduce((s, row) => s + revenueTotal(row), 0);
    const tva = revenues.reduce((s, row) => s + revenueTVA(row, defaultRate), 0);
    const daySeries = caSeries(revenues, "day", amount);
    const weekSeries = caSeries(revenues, "week", amount);
    const weekdayAvg = byWeekdayAvg(revenues, amount).filter((x) => x.value > 0);
    return { st, caTTC, tva, daySeries, weekSeries, weekdayAvg };
  }, [revenues, defaultRate]);

  if (r.st.count === 0) return <Empty icon="cash-outline" text={`Aucune recette (${periodLabel}).`} />;
  const { st } = r;

  return (
    <>
      <View style={styles.kpiRow}>
        <Kpi label="CA HT (net)" value={fmtEUR(st.ca)} tone="good" />
        <Kpi label="CA TTC (brut)" value={fmtEUR(r.caTTC)} />
      </View>
      <View style={styles.kpiRow}>
        <Kpi label="TVA collectée" value={fmtEUR(r.tva)} tone="warn" />
        <Kpi label="Couverts" value={String(st.covers)} />
      </View>

      <SectionTitle>Moyennes (HT)</SectionTitle>
      <View style={styles.kpiRow}>
        <Kpi label="CA moyen / jour" value={fmtEUR(st.avgPerDay)} />
        <Kpi label="CA moyen / semaine" value={fmtEUR(st.avgPerWeek)} />
      </View>
      <View style={styles.kpiRow}>
        <Kpi label="Couverts moyens / jour" value={st.avgCoversPerDay > 0 ? String(Math.round(st.avgCoversPerDay)) : "—"} />
        <Kpi label="Panier moyen / couvert" value={st.covers > 0 ? fmtEUR(st.panier) : "—"} />
      </View>

      <SectionTitle>Évolution du CA HT</SectionTitle>
      <Card>
        {r.daySeries.length > 1 ? (
          <LineChart data={r.daySeries} color={colors.success} format={fmtEUR} />
        ) : (
          <Text style={styles.muted}>Pas assez de jours pour tracer une courbe.</Text>
        )}
      </Card>

      <SectionTitle>CA HT par semaine</SectionTitle>
      <Card>
        {r.weekSeries.length > 0 ? (
          <BarList data={[...r.weekSeries].reverse()} format={fmtEUR} color={colors.success} />
        ) : (
          <Text style={styles.muted}>Aucune donnée.</Text>
        )}
      </Card>

      <SectionTitle>CA HT moyen par jour de semaine</SectionTitle>
      <Card>
        {r.weekdayAvg.length > 0 ? (
          <BarList data={r.weekdayAvg} format={fmtEUR} color={colors.gold} />
        ) : (
          <Text style={styles.muted}>Aucune donnée.</Text>
        )}
      </Card>

      <SectionTitle>Moyens d'encaissement (TTC)</SectionTitle>
      <Card>
        <StackBar
          segments={[
            { label: "Espèces", value: st.cash, color: colors.success },
            { label: "CB", value: st.cb, color: colors.primary },
            { label: "Autre", value: st.other, color: colors.gold },
          ]}
        />
        <Text style={[styles.muted, { marginTop: space.sm }]}>
          Esp. {fmtEUR(st.cash)} · CB {fmtEUR(st.cb)} · Autre {fmtEUR(st.other)}
        </Text>
      </Card>
    </>
  );
}

// ---------- Vue Dépenses ----------
function ExpensesDash({
  expenses, expHT, aiCost, reimbTotal, periodLabel,
}: {
  expenses: ExpenseListItem[];
  expHT: (e: ExpenseListItem) => number;
  aiCost: { total: number; count: number };
  reimbTotal: number;
  periodLabel: string;
}) {
  const e = useMemo(() => {
    const totalTTC = expenses.reduce((s, x) => s + Number(x.amount_ttc), 0);
    const totalHT = expenses.reduce((s, x) => s + expHT(x), 0);
    const map = new Map<string, number>();
    for (const x of expenses) {
      const k = x.category?.label ?? "Sans catégorie";
      map.set(k, (map.get(k) ?? 0) + Number(x.amount_ttc));
    }
    const byCategory = Array.from(map.entries())
      .map(([name, value], i) => ({ label: name, value, color: CAT_COLORS[i % CAT_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
    const daySeries = bucketSeries(expenses.map((x) => ({ date: x.expense_date, value: Number(x.amount_ttc) })), "day");
    const weekSeries = bucketSeries(expenses.map((x) => ({ date: x.expense_date, value: Number(x.amount_ttc) })), "week");
    return { totalTTC, totalHT, byCategory, daySeries, weekSeries };
  }, [expenses, expHT]);

  return (
    <>
      <View style={styles.kpiRow}>
        <Kpi label={`Dépenses TTC (${periodLabel})`} value={fmtEUR(e.totalTTC)} />
        <Kpi label="Dépenses HT" value={fmtEUR(e.totalHT)} />
      </View>
      <View style={styles.kpiRow}>
        <Kpi label="À rembourser (total)" value={fmtEUR(reimbTotal)} tone="warn" />
        <Kpi
          label={`Coût IA ce mois · ${aiCost.count} analyse${aiCost.count > 1 ? "s" : ""}`}
          value={`$${aiCost.total.toFixed(2)}`}
        />
      </View>

      {e.byCategory.length === 0 ? (
        <Empty icon="pie-chart-outline" text={`Aucune dépense (${periodLabel}).`} />
      ) : (
        <>
          <SectionTitle>Dépenses par catégorie (TTC)</SectionTitle>
          <Card>
            <Donut segments={e.byCategory} centerValue={fmtEUR(e.totalTTC)} centerLabel="total" format={fmtEUR} />
          </Card>

          <SectionTitle>Évolution des dépenses</SectionTitle>
          <Card>
            {e.daySeries.length > 1 ? (
              <LineChart data={e.daySeries} color={colors.primary} format={fmtEUR} />
            ) : (
              <Text style={styles.muted}>Pas assez de jours pour tracer une courbe.</Text>
            )}
          </Card>

          <SectionTitle>Dépenses par semaine</SectionTitle>
          <Card>
            <BarList data={[...e.weekSeries].reverse()} format={fmtEUR} color={colors.primary} />
          </Card>
        </>
      )}
    </>
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
  kpiRow: { flexDirection: "row", gap: space.md },
  muted: { ...type.small, color: colors.textMuted },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 12, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 12, borderRadius: radius.pill },
});
