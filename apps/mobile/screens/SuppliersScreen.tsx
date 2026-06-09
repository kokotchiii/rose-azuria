import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchExpenses,
  fetchSuppliersWithStats,
  findSupplierDuplicates,
  mergeSuppliers,
  type ExpenseListItem,
  type SupplierDupGroup,
  type SupplierStats,
} from "../lib/data";
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
  const [merging, setMerging] = useState<SupplierDupGroup | null>(null); // groupe en cours de fusion
  const [mergeBusy, setMergeBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchSuppliersWithStats(), fetchExpenses()])
      .then(([sup, exp]) => { setItems(sup); setExpenses(exp); })
      .catch(() => { setItems([]); setExpenses([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Doublons probables (même nom normalisé : "EURL Sud Primeurs" = "Sud Primeurs").
  const dups = useMemo(() => findSupplierDuplicates(items), [items]);

  // Fusionne en gardant `keep`, en réaffectant les dépenses des autres.
  async function doMerge(group: SupplierDupGroup, keep: SupplierStats) {
    setMergeBusy(true);
    try {
      await mergeSuppliers(keep.supplier.id, group.members.filter((m) => m.supplier.id !== keep.supplier.id).map((m) => m.supplier.id));
      setMerging(null);
      load();
    } catch {
      // on laisse la modale ouverte pour réessayer
    } finally {
      setMergeBusy(false);
    }
  }

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
      {dups.length > 0 && (
        <Card style={styles.dupCard}>
          <View style={styles.dupHead}>
            <Ionicons name="git-merge-outline" size={18} color={colors.gold} />
            <Text style={styles.dupTitle}>{dups.length} doublon{dups.length > 1 ? "s" : ""} possible{dups.length > 1 ? "s" : ""}</Text>
          </View>
          {dups.map((g) => (
            <View key={g.key} style={styles.dupRow}>
              <Text style={styles.dupNames} numberOfLines={2}>{g.members.map((m) => m.supplier.name).join("  ·  ")}</Text>
              <Pressable style={({ pressed }) => [styles.dupBtn, pressed && { opacity: 0.85 }]} onPress={() => setMerging(g)} accessibilityRole="button">
                <Text style={styles.dupBtnText}>Fusionner</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

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

      {/* Modale fusion : choisir le nom à conserver */}
      <Modal visible={merging !== null} transparent animationType="fade" onRequestClose={() => !mergeBusy && setMerging(null)}>
        <Pressable style={styles.backdrop} onPress={() => !mergeBusy && setMerging(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Fusionner les fournisseurs</Text>
            <Text style={styles.sheetSub}>Choisis le nom à conserver : les dépenses des autres y seront rattachées, puis les doublons supprimés.</Text>
            {merging?.members.map((m) => (
              <Pressable
                key={m.supplier.id}
                style={({ pressed }) => [styles.keepRow, pressed && { opacity: 0.85 }]}
                onPress={() => merging && !mergeBusy && doMerge(merging, m)}
                disabled={mergeBusy}
                accessibilityRole="button"
                accessibilityLabel={`Garder ${m.supplier.name}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.keepName} numberOfLines={1}>{m.supplier.name}</Text>
                  <Text style={styles.keepMeta}>{m.invoice_count} facture{m.invoice_count > 1 ? "s" : ""} · {fmtEUR(m.total_amount)}</Text>
                </View>
                <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
              </Pressable>
            ))}
            {mergeBusy && (
              <View style={styles.mergeBusyRow}><ActivityIndicator color={colors.primary} /><Text style={styles.keepMeta}>Fusion en cours…</Text></View>
            )}
            <Pressable style={styles.cancelBtn} onPress={() => !mergeBusy && setMerging(null)} accessibilityRole="button">
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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

  dupCard: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: colors.gold, gap: space.sm },
  dupHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dupTitle: { ...type.title, color: colors.gold },
  dupRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dupNames: { ...type.small, color: colors.text, flex: 1 },
  dupBtn: { backgroundColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8 },
  dupBtnText: { ...type.small, color: colors.white, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.sm },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetSub: { ...type.small, color: colors.textMuted },
  keepRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  keepName: { ...type.title, color: colors.text },
  keepMeta: { ...type.small, color: colors.textMuted },
  mergeBusyRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cancelBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  cancelText: { ...type.title, color: colors.textMuted },
});
