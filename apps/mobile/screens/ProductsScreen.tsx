import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchProductStats, type ProductStats } from "../lib/data";
import { fmtEUR } from "../lib/format";
import { colors, space, type } from "../theme";
import { Card, Empty, Loading, Screen } from "./ui";

function trendIcon(t: ProductStats["price_trend"]) {
  if (t === "up") return { name: "trending-up" as const, color: colors.danger };
  if (t === "down") return { name: "trending-down" as const, color: colors.success };
  if (t === "stable") return { name: "remove" as const, color: colors.textMuted };
  return { name: "help" as const, color: colors.textMuted };
}

export function ProductsScreen() {
  const [items, setItems] = useState<ProductStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductStats()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!items.length) return <Screen><Empty icon="cart-outline" text="Aucun produit récurrent détecté." /></Screen>;

  return (
    <Screen>
      {items.map((p) => {
        const ti = trendIcon(p.price_trend);
        return (
          <Card key={p.normalized_label}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={2}>{p.display_label}</Text>
              <Text style={styles.amount}>{fmtEUR(p.total_spent)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.meta}>
                {p.occurrences}× · qté {p.total_qty} · PU moy. {fmtEUR(p.avg_unit_price)}
              </Text>
              <Ionicons name={ti.name} size={18} color={ti.color} />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted, flex: 1 },
});
