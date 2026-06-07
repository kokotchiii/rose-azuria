import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchAiCostThisMonth, fetchExpenses, type ExpenseListItem } from "../lib/data";
import { fmtEUR, startOfMonthISO, todayISO } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle } from "./ui";

export function DashboardScreen() {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [aiCost, setAiCost] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExpenses({ from: startOfMonthISO(), to: todayISO() })
      .then(setExpenses)
      .catch(() => setExpenses([]))
      .finally(() => setLoading(false));
    fetchAiCostThisMonth().then(setAiCost).catch(() => setAiCost({ total: 0, count: 0 }));
  }, []);

  const totals = useMemo(() => {
    const total = expenses.reduce((s, e) => s + Number(e.amount_ttc), 0);
    const reimbursable = expenses
      .filter((e) => e.reimbursable && !e.reimbursed)
      .reduce((s, e) => s + Number(e.amount_ttc), 0);
    return { total, reimbursable, count: expenses.length };
  }, [expenses]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.category?.label ?? "Sans catégorie";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);

  if (loading) return <Loading />;

  const max = byCategory[0]?.value ?? 1;

  return (
    <Screen>
      <Text style={styles.h1}>Mois en cours</Text>
      <View style={styles.kpiRow}>
        <Kpi label="Total dépenses" value={fmtEUR(totals.total)} />
        <Kpi label="Dépenses" value={String(totals.count)} />
      </View>
      <Kpi label="Notes de frais à rembourser" value={fmtEUR(totals.reimbursable)} tone="warn" />
      <Kpi
        label={`Coût IA ce mois · ${aiCost.count} analyse${aiCost.count > 1 ? "s" : ""} (API, USD)`}
        value={`$${aiCost.total.toFixed(2)}`}
        tone="good"
      />

      <SectionTitle>Par catégorie</SectionTitle>
      {byCategory.length === 0 ? (
        <Empty icon="pie-chart-outline" text="Aucune dépense ce mois-ci." />
      ) : (
        <Card>
          {byCategory.map((c) => (
            <View key={c.name} style={styles.barRow}>
              <View style={styles.barHead}>
                <Text style={styles.barLabel} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.barVal}>{fmtEUR(c.value)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(4, (c.value / max) * 100)}%` }]} />
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { ...type.h2, color: colors.text },
  kpiRow: { flexDirection: "row", gap: space.md },
  barRow: { gap: 4, paddingVertical: 4 },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
});
