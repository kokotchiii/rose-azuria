import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchPendingReimbursements,
  fetchReimbursedHistory,
  setExpenseReimbursed,
  settlePayer,
  type PayerReimbursement,
} from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Loading, Pill, Screen } from "./ui";

type Tab = "pending" | "history";

export function ReimbursementsScreen() {
  const [tab, setTab] = useState<Tab>("pending");
  const [groups, setGroups] = useState<PayerReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // id en cours d'action

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      const data = which === "pending" ? await fetchPendingReimbursements() : await fetchReimbursedHistory();
      setGroups(data);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function onSettleItem(expenseId: string, reimbursed: boolean) {
    setBusy(expenseId);
    try {
      await setExpenseReimbursed(expenseId, reimbursed);
      await load(tab);
    } catch {
      setBusy(null);
    }
  }

  async function onSettlePayer(payerId: string) {
    setBusy(payerId);
    try {
      await settlePayer(payerId);
      await load(tab);
    } catch {
      setBusy(null);
    }
  }

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <Screen>
      {/* Onglets */}
      <View style={styles.tabs}>
        <Pill label="À rembourser" active={tab === "pending"} onPress={() => setTab("pending")} />
        <Pill label="Historique" active={tab === "history"} onPress={() => setTab("history")} />
      </View>

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty
          icon={tab === "pending" ? "checkmark-done-outline" : "time-outline"}
          text={tab === "pending" ? "Aucun remboursement en attente. 🎉" : "Aucun remboursement archivé."}
        />
      ) : (
        <>
          {tab === "pending" && (
            <Card style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total à rembourser</Text>
              <Text style={styles.totalValue}>{fmtEUR(grandTotal)}</Text>
            </Card>
          )}

          {groups.map((g) => (
            <Card key={g.payer_id}>
              <View style={styles.payerHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payerName}>{g.payer_name}</Text>
                  <Text style={styles.payerMeta}>
                    {g.items.length} facture{g.items.length > 1 ? "s" : ""}
                  </Text>
                </View>
                <Text style={[styles.payerTotal, tab === "history" && { color: colors.success }]}>
                  {fmtEUR(g.total)}
                </Text>
              </View>

              <View style={styles.sep} />

              {g.items.map((e) => (
                <View key={e.id} style={styles.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemSupplier} numberOfLines={1}>
                      {e.supplier?.name ?? "Sans fournisseur"}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {fmtDate(e.expense_date)} · {e.category?.label ?? "—"}
                    </Text>
                  </View>
                  <Text style={styles.itemAmount}>{fmtEUR(Number(e.amount_ttc))}</Text>

                  {tab === "pending" ? (
                    <Pressable
                      onPress={() => onSettleItem(e.id, true)}
                      disabled={busy !== null}
                      accessibilityRole="button"
                      accessibilityLabel="Marquer remboursé"
                      style={({ pressed }) => [styles.itemBtn, pressed && { opacity: 0.8 }]}
                    >
                      {busy === e.id ? (
                        <ActivityIndicator size="small" color={colors.success} />
                      ) : (
                        <Ionicons name="checkmark-circle-outline" size={26} color={colors.success} />
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => onSettleItem(e.id, false)}
                      disabled={busy !== null}
                      accessibilityRole="button"
                      accessibilityLabel="Annuler le remboursement"
                      style={({ pressed }) => [styles.itemBtn, pressed && { opacity: 0.8 }]}
                    >
                      {busy === e.id ? (
                        <ActivityIndicator size="small" color={colors.textMuted} />
                      ) : (
                        <Ionicons name="arrow-undo-outline" size={22} color={colors.textMuted} />
                      )}
                    </Pressable>
                  )}
                </View>
              ))}

              {tab === "pending" && g.payer_id !== "?" && (
                <Pressable
                  onPress={() => onSettlePayer(g.payer_id)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.settleAll, pressed && { opacity: 0.85 }]}
                >
                  {busy === g.payer_id ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={18} color={colors.white} />
                      <Text style={styles.settleAllText}>Tout rembourser ({fmtEUR(g.total)})</Text>
                    </>
                  )}
                </Pressable>
              )}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: space.sm },
  totalCard: { alignItems: "center", gap: 2, backgroundColor: colors.surfaceAlt },
  totalLabel: { ...type.small, color: colors.textMuted },
  totalValue: { fontSize: 28, fontWeight: "700", color: colors.primary },

  payerHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  payerName: { ...type.title, color: colors.text },
  payerMeta: { ...type.small, color: colors.textMuted },
  payerTotal: { ...type.h2, color: colors.primary },
  sep: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },

  item: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  itemSupplier: { ...type.body, color: colors.text },
  itemMeta: { ...type.small, color: colors.textMuted },
  itemAmount: { ...type.title, color: colors.text },
  itemBtn: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },

  settleAll: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm,
    backgroundColor: colors.success, borderRadius: radius.md, minHeight: 44, marginTop: space.sm,
  },
  settleAllText: { ...type.title, color: colors.white },
});
