// Écran « Factures » : récap payées vs reste à payer, statut de pointage bancaire.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchInvoices, setExpensePaid, type ExpenseListItem } from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { supabase } from "../supabaseClient";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, Empty, Loading, Screen, Segmented } from "./ui";

type Tab = "topay" | "paid";

function payerName(e: ExpenseListItem): string {
  return e.payer?.full_name ?? "Société (Azuria)";
}

// Statut synchronisé avec les notes de frais.
function statusOf(e: ExpenseListItem): { label: string; ok: boolean } {
  if (!e.paid) return { label: "À payer au fournisseur", ok: false };
  if (e.reimbursable && !e.reimbursed) return { label: `À rembourser à ${payerName(e)}`, ok: false };
  if (e.reimbursable && e.reimbursed) return { label: `Remboursée à ${payerName(e)}`, ok: true };
  return { label: "Payée", ok: true };
}

export function InvoicesScreen() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("topay");

  const load = useCallback(() => {
    fetchInvoices().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("invoices-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function togglePaid(e: ExpenseListItem, paid: boolean) {
    setBusy(e.id);
    try {
      await setExpensePaid(e.id, paid);
      setItems((prev) => prev.map((it) => (it.id === e.id ? { ...it, paid } : it)));
    } finally { setBusy(null); }
  }

  const toPay = useMemo(() => items.filter((e) => !e.paid), [items]);
  const paid = useMemo(() => items.filter((e) => e.paid), [items]);
  const sum = (arr: ExpenseListItem[]) => arr.reduce((s, e) => s + Number(e.amount_ttc || 0), 0);
  const rows = tab === "topay" ? toPay : paid;

  if (loading) return <Loading />;

  return (
    <Screen>
      <View style={styles.kpis}>
        <Card style={styles.kpi}>
          <Text style={styles.kpiLabel}>Reste à payer</Text>
          <Text style={[styles.kpiValue, { color: colors.primary }]}>{fmtEUR(sum(toPay))}</Text>
        </Card>
        <Card style={styles.kpi}>
          <Text style={styles.kpiLabel}>Payées</Text>
          <Text style={styles.kpiValue}>{fmtEUR(sum(paid))}</Text>
        </Card>
      </View>

      <Segmented<Tab>
        options={[{ key: "topay", label: `À payer (${toPay.length})` }, { key: "paid", label: `Payées (${paid.length})` }]}
        value={tab}
        onChange={setTab}
      />

      {rows.length === 0 ? (
        <Empty icon={tab === "topay" ? "checkmark-done-outline" : "document-text-outline"}
          text={tab === "topay" ? "Aucune facture en attente. 🎉" : "Aucune facture payée."} />
      ) : (
        rows.map((e) => {
          const st = statusOf(e);
          const pendingRefund = e.paid && e.reimbursable && !e.reimbursed;
          return (
            <Card key={e.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.supplier} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
                  <Text style={styles.meta}>
                    {fmtDate(e.expense_date)}{e.due_date ? ` · éch. ${fmtDate(e.due_date)}` : ""}{e.invoice_number ? ` · ${e.invoice_number}` : ""}
                  </Text>
                  <Text style={styles.payer}>Payé par : {payerName(e)}</Text>
                  <View style={styles.badges}>
                    <Text style={[styles.badge, st.ok ? styles.badgeOk : styles.badgeWarn]}>{st.label}</Text>
                  </View>
                  <View style={styles.badges}>
                    {e.reconciled
                      ? <Text style={[styles.badge, styles.badgeOk]}>pointée banque</Text>
                      : <Text style={[styles.badge, styles.badgeWarn]}>non pointée</Text>}
                  </View>
                </View>
                <Text style={styles.amount}>{fmtEUR(Number(e.amount_ttc))}</Text>
              </View>
              {pendingRefund ? (
                <Text style={styles.hint}>Se règle dans « Notes de frais »</Text>
              ) : (
                <Pressable
                  onPress={() => togglePaid(e, tab === "topay")}
                  disabled={busy !== null}
                  style={({ pressed }) => [styles.action, tab === "topay" ? styles.actionPay : styles.actionUndo, pressed && { opacity: 0.85 }]}
                >
                  {busy === e.id ? <ActivityIndicator size="small" color={tab === "topay" ? colors.white : colors.danger} /> : (
                    <Text style={[styles.actionText, { color: tab === "topay" ? colors.white : colors.danger }]}>
                      {tab === "topay" ? "✓ Valider le paiement" : "↶ Remettre à payer"}
                    </Text>
                  )}
                </Pressable>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: "row", gap: space.md },
  kpi: { flex: 1, gap: 2 },
  kpiLabel: { ...type.small, color: colors.textMuted },
  kpiValue: { ...type.h2, color: colors.text },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  supplier: { ...type.title, color: colors.text },
  meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
  payer: { ...type.small, color: colors.text, marginTop: 4 },
  hint: { ...type.small, color: colors.textMuted, marginTop: space.sm, textAlign: "center" },
  badges: { flexDirection: "row", marginTop: 6 },
  badge: { ...type.small, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  badgeOk: { backgroundColor: colors.successBg, color: colors.success },
  badgeWarn: { backgroundColor: colors.goldSoft, color: colors.gold },
  amount: { ...type.title, color: colors.text },
  action: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  actionPay: { backgroundColor: colors.primary },
  actionUndo: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.danger },
  actionText: { ...type.title },
});
