import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchSuppliersWithStats, type SupplierStats } from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, space, type } from "../theme";
import { Card, Empty, Loading, Screen } from "./ui";

export function SuppliersScreen() {
  const [items, setItems] = useState<SupplierStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuppliersWithStats()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!items.length) return <Screen><Empty icon="storefront-outline" text="Aucun fournisseur." /></Screen>;

  return (
    <Screen>
      {items.map((s) => (
        <Card key={s.supplier.id}>
          <View style={styles.row}>
            <Text style={styles.name} numberOfLines={1}>{s.supplier.name}</Text>
            <Text style={styles.amount}>{fmtEUR(s.total_amount)}</Text>
          </View>
          <Text style={styles.meta}>
            {s.invoice_count} facture{s.invoice_count > 1 ? "s" : ""} · dernière {fmtDate(s.last_date)}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted },
});
