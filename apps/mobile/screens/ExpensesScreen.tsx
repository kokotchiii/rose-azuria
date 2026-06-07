import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchExpenses,
  fetchMembers,
  setExpenseReimbursed,
  updateExpensePayer,
  type ExpenseListItem,
  type Member,
} from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Empty, Loading, Pill, Screen, Segmented, Select } from "./ui";

// Libellé du payeur d'une dépense (payer_id null = la société).
function payerLabel(e: ExpenseListItem): string {
  return e.payer?.full_name ?? "Société";
}

export function ExpensesScreen() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  // Dépense en cours d'édition du payeur (null = modale fermée).
  const [editing, setEditing] = useState<ExpenseListItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Tri & filtre par type (catégorie).
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [catFilter, setCatFilter] = useState<string | null>(null); // null = toutes

  // Catégories réellement présentes dans les dépenses (pour le filtre).
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) if (e.category?.label) set.add(e.category.label);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Liste affichée : filtrée par type puis triée.
  const visible = useMemo(() => {
    const filtered = catFilter ? items.filter((e) => e.category?.label === catFilter) : items;
    const arr = [...filtered];
    if (sortBy === "amount") arr.sort((a, b) => Number(b.amount_ttc) - Number(a.amount_ttc));
    else arr.sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));
    return arr;
  }, [items, catFilter, sortBy]);

  useEffect(() => {
    Promise.all([fetchExpenses(), fetchMembers()])
      .then(([exp, mem]) => {
        setItems(exp);
        setMembers(mem);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // Applique le nouveau payeur en base puis met à jour la liste locale.
  async function changePayer(expense: ExpenseListItem, payerId: string | null) {
    setSaving(true);
    try {
      await updateExpensePayer(expense.id, payerId);
      const isCompany = payerId === null;
      const full_name = isCompany ? null : members.find((m) => m.id === payerId)?.full_name ?? "Membre";
      setItems((prev) =>
        prev.map((it) =>
          it.id === expense.id
            ? {
                ...it,
                payer_id: payerId,
                payer: isCompany ? null : { full_name },
                payment_source: isCompany ? "cb_pro" : "cb_perso",
                reimbursable: isCompany ? false : true,
                reimbursed: isCompany ? false : it.reimbursed,
              }
            : it,
        ),
      );
      setEditing(null);
    } catch {
      // En cas d'échec, on laisse la modale ouverte pour réessayer.
    } finally {
      setSaving(false);
    }
  }

  // Bascule le statut « remboursé » (corriger une erreur : repasser en non-remboursé).
  // La modale reste ouverte pour visualiser le changement.
  async function toggleReimbursed(expense: ExpenseListItem, value: boolean) {
    setSaving(true);
    try {
      await setExpenseReimbursed(expense.id, value);
      const reimbursed_at = value ? new Date().toISOString() : null;
      setItems((prev) => prev.map((it) => (it.id === expense.id ? { ...it, reimbursed: value, reimbursed_at } : it)));
      setEditing((prev) => (prev && prev.id === expense.id ? { ...prev, reimbursed: value, reimbursed_at } : prev));
    } catch {
      // En cas d'échec, on laisse la modale ouverte pour réessayer.
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;
  if (!items.length) return <Screen><Empty icon="receipt-outline" text="Aucune dépense enregistrée." /></Screen>;

  return (
    <Screen>
      {/* Tri */}
      <Segmented<"date" | "amount">
        options={[{ key: "date", label: "Plus récentes" }, { key: "amount", label: "Montant" }]}
        value={sortBy}
        onChange={setSortBy}
      />

      {/* Filtre par catégorie (menu déroulant) */}
      {categories.length > 0 && (
        <Select<string>
          value={catFilter ?? "__all__"}
          options={[{ key: "__all__", label: "Toutes les catégories" }, ...categories.map((c) => ({ key: c, label: c }))]}
          onChange={(k) => setCatFilter(k === "__all__" ? null : k)}
        />
      )}

      {visible.length === 0 ? (
        <Empty icon="filter-outline" text="Aucune dépense pour ce filtre." />
      ) : null}

      {visible.map((e) => (
        <Pressable
          key={e.id}
          onPress={() => setEditing(e)}
          accessibilityRole="button"
          accessibilityLabel={`Dépense ${e.supplier?.name ?? ""} — modifier qui a payé`}
          style={({ pressed }) => pressed && { opacity: 0.9 }}
        >
          <Card>
            <View style={styles.row}>
              <Text style={styles.supplier} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
              <Text style={styles.amount}>{fmtEUR(Number(e.amount_ttc))}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.meta}>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</Text>
              {e.reimbursable && !e.reimbursed && <Text style={styles.tag}>à rembourser</Text>}
              {e.reimbursable && e.reimbursed && <Text style={styles.tagDone}>remboursé</Text>}
            </View>
            <View style={styles.payerRow}>
              <Ionicons name="person-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.payer}>Payé par {payerLabel(e)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.secondary} style={{ marginLeft: "auto" }} />
            </View>
            {e.note ? <Text style={styles.note} numberOfLines={2}>{e.note}</Text> : null}
          </Card>
        </Pressable>
      ))}

      {/* Modale : changer qui a payé */}
      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => !saving && setEditing(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Qui a payé ?</Text>
            {editing && (
              <Text style={styles.sheetSub} numberOfLines={1}>
                {editing.supplier?.name ?? "Sans fournisseur"} · {fmtEUR(Number(editing.amount_ttc))}
              </Text>
            )}

            <View style={styles.chipsWrap}>
              <Pill
                label="Société"
                active={editing?.payer_id == null}
                onPress={() => editing && changePayer(editing, null)}
              />
              {members.map((m) => (
                <Pill
                  key={m.id}
                  label={m.full_name ?? "Membre"}
                  active={editing?.payer_id === m.id}
                  onPress={() => editing && changePayer(editing, m.id)}
                />
              ))}
            </View>

            {/* Statut de remboursement (uniquement pour une avance d'un membre) */}
            {editing?.reimbursable && (
              <View style={styles.reimbSection}>
                <View style={styles.sep} />
                <View style={styles.reimbHead}>
                  <Text style={styles.reimbTitle}>Remboursement</Text>
                  {editing.reimbursed ? (
                    <Text style={[styles.reimbStatus, { color: colors.success }]}>
                      Remboursé{editing.reimbursed_at ? ` · ${fmtDate(editing.reimbursed_at)}` : ""}
                    </Text>
                  ) : (
                    <Text style={[styles.reimbStatus, { color: colors.gold }]}>À rembourser</Text>
                  )}
                </View>
                {editing.reimbursed ? (
                  <Pressable
                    style={({ pressed }) => [styles.reimbBtn, styles.reimbUndo, pressed && { opacity: 0.85 }]}
                    onPress={() => !saving && toggleReimbursed(editing, false)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Repasser en à rembourser"
                  >
                    <Ionicons name="arrow-undo-outline" size={18} color={colors.danger} />
                    <Text style={[styles.reimbBtnText, { color: colors.danger }]}>Annuler le remboursement</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={({ pressed }) => [styles.reimbBtn, styles.reimbDone, pressed && { opacity: 0.85 }]}
                    onPress={() => !saving && toggleReimbursed(editing, true)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Marquer remboursé"
                  >
                    <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                    <Text style={[styles.reimbBtnText, { color: colors.white }]}>Marquer remboursé</Text>
                  </Pressable>
                )}
              </View>
            )}

            {saving && (
              <View style={styles.savingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.savingText}>Enregistrement…</Text>
              </View>
            )}

            <Pressable style={styles.cancelBtn} onPress={() => !saving && setEditing(null)} accessibilityRole="button">
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sortRow: { flexDirection: "row", gap: space.sm },
  filterRow: { gap: space.sm, paddingVertical: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  supplier: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  meta: { ...type.small, color: colors.textMuted },
  tag: { ...type.small, color: colors.gold, fontWeight: "600" },
  tagDone: { ...type.small, color: colors.success, fontWeight: "600" },
  payerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  payer: { ...type.small, color: colors.textMuted },
  note: { ...type.small, color: colors.textMuted },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space.xl, gap: space.md,
  },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetSub: { ...type.small, color: colors.textMuted },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  reimbSection: { gap: space.sm },
  sep: { height: 1, backgroundColor: colors.border, marginTop: space.xs },
  reimbHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  reimbTitle: { ...type.label, color: colors.textMuted },
  reimbStatus: { ...type.small, fontWeight: "600" },
  reimbBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 44, borderRadius: radius.md },
  reimbBtnText: { ...type.title },
  reimbDone: { backgroundColor: colors.success },
  reimbUndo: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.danger },
  savingRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  savingText: { ...type.small, color: colors.textMuted },
  cancelBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  cancelText: { ...type.title, color: colors.textMuted },
});
