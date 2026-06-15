// Écran « À payer » : factures avec une échéance, non réglées.
// Visuel + prévisionnel de trésorerie (en retard / cette semaine / total).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchPayables, setExpensePaid, type ExpenseListItem } from "../lib/data";
import { fmtDate, fmtEUR, todayISO } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Kpi, Loading, Screen, SectionTitle } from "./ui";

function plusDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysUntil(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function PayableScreen() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchPayables().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function markPaid(e: ExpenseListItem) {
    setBusy(e.id);
    try {
      await setExpensePaid(e.id, true);
      setItems((prev) => prev.filter((it) => it.id !== e.id));
    } catch {
      // garde l'item
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (!items.length) return <Screen><Empty icon="checkmark-done-outline" text="Aucune facture à échéance en attente. 🎉" /></Screen>;

  const today = todayISO();
  const in7 = plusDaysISO(7);
  const sum = (arr: ExpenseListItem[]) => arr.reduce((s, e) => s + Number(e.amount_ttc || 0), 0);
  const overdue = items.filter((e) => (e.due_date ?? "") < today);
  const week = items.filter((e) => (e.due_date ?? "") >= today && (e.due_date ?? "") <= in7);

  return (
    <Screen>
      {/* Prévisionnel de trésorerie */}
      <View style={styles.kpiRow}>
        <Kpi label="Total à payer" value={fmtEUR(sum(items))} tone="warn" />
        <Kpi label="En retard" value={fmtEUR(sum(overdue))} tone={overdue.length ? "warn" : "default"} />
      </View>
      <Kpi label="À payer sous 7 jours" value={fmtEUR(sum(week))} />

      <SectionTitle>Échéancier</SectionTitle>
      {items.map((e) => {
        const dd = e.due_date ?? "";
        const n = daysUntil(dd);
        const late = n < 0;
        const soon = n >= 0 && n <= 3;
        const tag = late ? `En retard de ${-n} j` : n === 0 ? "Aujourd'hui" : `Dans ${n} j`;
        const tagColor = late ? colors.danger : soon ? colors.gold : colors.textMuted;
        return (
          <Card key={e.id} style={late ? styles.lateCard : undefined}>
            <View style={styles.row}>
              <Text style={styles.supplier} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
              <Text style={styles.amount}>{fmtEUR(Number(e.amount_ttc))}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.meta}>
                Échéance {fmtDate(dd)}{e.invoice_number ? ` · n° ${e.invoice_number}` : ""}
              </Text>
              <Text style={[styles.tag, { color: tagColor }]}>{tag}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.payBtn, pressed && { opacity: 0.85 }]}
              onPress={() => markPaid(e)}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Marquer payée"
            >
              {busy === e.id ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                  <Text style={styles.payText}>Marquer payée</Text>
                </>
              )}
            </Pressable>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: space.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  supplier: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted, flex: 1 },
  tag: { ...type.small, fontWeight: "700" },
  lateCard: { borderWidth: 1, borderColor: colors.danger },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.success, marginTop: space.xs },
  payText: { ...type.title, color: colors.white },
});
