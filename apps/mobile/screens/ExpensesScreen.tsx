import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchExpenses, type ExpenseListItem } from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, space, type } from "../theme";
import { Card, Empty, Loading, Screen } from "./ui";

export function ExpensesScreen() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExpenses()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!items.length) return <Screen><Empty icon="receipt-outline" text="Aucune dépense enregistrée." /></Screen>;

  return (
    <Screen>
      {items.map((e) => (
        <Card key={e.id}>
          <View style={styles.row}>
            <Text style={styles.supplier} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
            <Text style={styles.amount}>{fmtEUR(Number(e.amount_ttc))}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.meta}>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</Text>
            {e.reimbursable && !e.reimbursed && <Text style={styles.tag}>à rembourser</Text>}
          </View>
          {e.note ? <Text style={styles.note} numberOfLines={2}>{e.note}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  supplier: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted },
  tag: { ...type.small, color: colors.gold, fontWeight: "600" },
  note: { ...type.small, color: colors.textMuted },
});
