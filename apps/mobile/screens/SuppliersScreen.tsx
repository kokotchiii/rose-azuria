import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchExpenses, fetchSuppliersWithStats, type ExpenseListItem, type SupplierStats } from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Loading, Screen } from "./ui";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function monthLabel(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export function SuppliersScreen() {
  const [items, setItems] = useState<SupplierStats[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SupplierStats | null>(null);

  useEffect(() => {
    Promise.all([fetchSuppliersWithStats(), fetchExpenses()])
      .then(([sup, exp]) => { setItems(sup); setExpenses(exp); })
      .catch(() => { setItems([]); setExpenses([]); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  // ----- Détail d'un fournisseur : ses factures, groupées par mois -----
  if (selected) {
    const own = expenses
      .filter((e) => e.supplier_id === selected.supplier.id)
      .sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));

    // Groupage par mois (clé YYYY-MM), du plus récent au plus ancien.
    const groups: { key: string; rows: ExpenseListItem[] }[] = [];
    for (const e of own) {
      const key = e.expense_date.slice(0, 7);
      const g = groups.find((x) => x.key === key);
      if (g) g.rows.push(e);
      else groups.push({ key, rows: [e] });
    }

    return (
      <Screen>
        <Pressable onPress={() => setSelected(null)} style={styles.backRow} accessibilityRole="button">
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Tous les fournisseurs</Text>
        </Pressable>

        <Card>
          <Text style={styles.name}>{selected.supplier.name}</Text>
          <Text style={styles.meta}>
            {selected.invoice_count} facture{selected.invoice_count > 1 ? "s" : ""} · total {fmtEUR(selected.total_amount)}
          </Text>
        </Card>

        {own.length === 0 ? (
          <Empty icon="receipt-outline" text="Aucune facture pour ce fournisseur." />
        ) : (
          groups.map((g) => (
            <View key={g.key} style={{ gap: space.sm }}>
              <Text style={styles.monthHead}>{monthLabel(g.key + "-01")}</Text>
              {g.rows.map((e) => (
                <Card key={e.id}>
                  <View style={styles.row}>
                    <Text style={styles.lineDate}>{fmtDate(e.expense_date)}</Text>
                    <Text style={styles.amount}>{fmtEUR(Number(e.amount_ttc))}</Text>
                  </View>
                  <Text style={styles.meta}>
                    {e.category?.label ?? "—"}{e.invoice_number ? ` · n° ${e.invoice_number}` : ""}
                  </Text>
                  {e.note ? <Text style={styles.meta} numberOfLines={2}>{e.note}</Text> : null}
                </Card>
              ))}
            </View>
          ))
        )}
      </Screen>
    );
  }

  // ----- Liste des fournisseurs (triés par total) -----
  if (!items.length) return <Screen><Empty icon="storefront-outline" text="Aucun fournisseur." /></Screen>;

  return (
    <Screen>
      {items.map((s) => (
        <Pressable
          key={s.supplier.id}
          onPress={() => setSelected(s)}
          accessibilityRole="button"
          accessibilityLabel={`${s.supplier.name} — voir les factures`}
          style={({ pressed }) => pressed && { opacity: 0.9 }}
        >
          <Card>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>{s.supplier.name}</Text>
              <Text style={styles.amount}>{fmtEUR(s.total_amount)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.meta}>
                {s.invoice_count} facture{s.invoice_count > 1 ? "s" : ""} · dernière {fmtDate(s.last_date)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  backText: { ...type.title, color: colors.primary },
  monthHead: { ...type.label, color: colors.textMuted, marginTop: space.sm, textTransform: "capitalize" },
  lineDate: { ...type.title, color: colors.text },
});
