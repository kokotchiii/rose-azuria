import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchExpenses,
  fetchMembers,
  getDocumentSignedUrl,
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

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
// "2026-06" → "juin 2026"
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export function ExpensesScreen() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  // Dépense en cours d'édition du payeur (null = modale fermée).
  const [editing, setEditing] = useState<ExpenseListItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);

  // Ouvre le justificatif (PDF/image) stocké via une URL signée temporaire.
  async function openDocument(e: ExpenseListItem) {
    if (!e.document_id) return;
    setDocBusy(true);
    setDocErr(null);
    try {
      const res = await getDocumentSignedUrl(e.document_id);
      if (res?.url) await Linking.openURL(res.url);
      else setDocErr("Justificatif introuvable.");
    } catch {
      setDocErr("Impossible d'ouvrir le justificatif.");
    } finally {
      setDocBusy(false);
    }
  }

  // Tri & filtres (type / fournisseur).
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [catFilter, setCatFilter] = useState<string | null>(null); // null = toutes
  const [supFilter, setSupFilter] = useState<string | null>(null); // null = tous

  // Catégories / fournisseurs réellement présents dans les dépenses (pour les filtres).
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) if (e.category?.label) set.add(e.category.label);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);
  const suppliers = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) if (e.supplier?.name) set.add(e.supplier.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Liste affichée : filtrée (type + fournisseur) puis triée.
  const visible = useMemo(() => {
    let filtered = items;
    if (catFilter) filtered = filtered.filter((e) => e.category?.label === catFilter);
    if (supFilter) filtered = filtered.filter((e) => e.supplier?.name === supFilter);
    const arr = [...filtered];
    if (sortBy === "amount") arr.sort((a, b) => Number(b.amount_ttc) - Number(a.amount_ttc));
    else arr.sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));
    return arr;
  }, [items, catFilter, supFilter, sortBy]);

  // Regroupement par mois (uniquement en tri par date) → navigation « par date ».
  const sections = useMemo(() => {
    const out: { key: string; rows: ExpenseListItem[] }[] = [];
    for (const e of visible) {
      const key = e.expense_date.slice(0, 7);
      const g = out.find((x) => x.key === key);
      if (g) g.rows.push(e);
      else out.push({ key, rows: [e] });
    }
    return out;
  }, [visible]);

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

  const renderCard = (e: ExpenseListItem) => (
    <Pressable
      key={e.id}
      onPress={() => setEditing(e)}
      accessibilityRole="button"
      accessibilityLabel={`Dépense ${e.supplier?.name ?? ""} — modifier`}
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
  );

  return (
    <Screen>
      {/* Tri */}
      <Segmented<"date" | "amount">
        options={[{ key: "date", label: "Plus récentes" }, { key: "amount", label: "Montant" }]}
        value={sortBy}
        onChange={setSortBy}
      />

      {/* Filtre par catégorie */}
      {categories.length > 0 && (
        <Select<string>
          value={catFilter ?? "__all__"}
          options={[{ key: "__all__", label: "Toutes les catégories" }, ...categories.map((c) => ({ key: c, label: c }))]}
          onChange={(k) => setCatFilter(k === "__all__" ? null : k)}
        />
      )}

      {/* Filtre par fournisseur */}
      {suppliers.length > 0 && (
        <Select<string>
          value={supFilter ?? "__all__"}
          options={[{ key: "__all__", label: "Tous les fournisseurs" }, ...suppliers.map((s) => ({ key: s, label: s }))]}
          onChange={(k) => setSupFilter(k === "__all__" ? null : k)}
        />
      )}

      {visible.length === 0 ? (
        <Empty icon="filter-outline" text="Aucune dépense pour ce filtre." />
      ) : null}

      {/* Tri par date → regroupé par mois ; tri par montant → liste à plat. */}
      {sortBy === "date"
        ? sections.map((sec) => (
            <View key={sec.key} style={{ gap: space.sm }}>
              <Text style={styles.monthHead}>{monthLabel(sec.key)}</Text>
              {sec.rows.map(renderCard)}
            </View>
          ))
        : visible.map(renderCard)}

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

            {/* Justificatif (PDF/photo scannée) */}
            <View style={styles.sep} />
            <Pressable
              style={({ pressed }) => [styles.docBtn, pressed && { opacity: 0.85 }]}
              onPress={() => editing && openDocument(editing)}
              disabled={docBusy || !editing?.document_id}
              accessibilityRole="button"
            >
              {docBusy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="document-attach-outline" size={18} color={editing?.document_id ? colors.primary : colors.textMuted} />
                  <Text style={[styles.docBtnText, { color: editing?.document_id ? colors.primary : colors.textMuted }]}>
                    {editing?.document_id ? "Voir le justificatif" : "Aucun justificatif joint"}
                  </Text>
                </>
              )}
            </Pressable>
            {docErr && <Text style={styles.docErrText}>{docErr}</Text>}

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
  monthHead: { ...type.label, color: colors.textMuted, marginTop: space.sm, textTransform: "capitalize" },
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
  docBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  docBtnText: { ...type.title },
  docErrText: { ...type.small, color: colors.danger, textAlign: "center" },
  savingRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  savingText: { ...type.small, color: colors.textMuted },
  cancelBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  cancelText: { ...type.title, color: colors.textMuted },
});
