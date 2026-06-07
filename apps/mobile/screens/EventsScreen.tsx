import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import {
  createEvent,
  fetchEvents,
  fetchExpensesForEvent,
  fetchRevenuesForEvent,
  setExpenseEvent,
  setRevenueEvent,
  type EventWithTotals,
  type ExpenseListItem,
  type EventRevenue,
} from "../lib/data";
import { fmtDate, fmtEUR, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, DateField, Empty, Loading, Screen } from "./ui";

const SERVICE_LABEL: Record<string, string> = { midi: "Midi", soir: "Soir", journee: "Journée", autre: "Autre" };

export function EventsScreen({ profile }: { profile: Profile }) {
  const [list, setList] = useState<EventWithTotals[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventWithTotals | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setList(await fetchEvents());
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createEvent(profile.establishment_id, name, date || null, profile.id);
      setName("");
      setDate(todayISO());
      setShowForm(false);
      await loadList();
    } catch {
      // garde le formulaire ouvert pour réessayer
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return <EventDetail event={selected} onBack={() => { setSelected(null); loadList(); }} />;
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      {!showForm ? (
        <Pressable style={styles.newBtn} onPress={() => setShowForm(true)} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.white} />
          <Text style={styles.newBtnText}>Nouvel événement</Text>
        </Pressable>
      ) : (
        <Card style={{ gap: space.md }}>
          <Text style={styles.formTitle}>Nouvel événement</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nom (ex. Mariage Durand)"
            placeholderTextColor={colors.textMuted}
          />
          <DateField value={date} onChange={setDate} placeholder="Date de l'événement" />
          <View style={styles.formActions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setShowForm(false)} disabled={creating}>
              <Text style={styles.btnGhostText}>Annuler</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={create} disabled={creating || !name.trim()}>
              {creating ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnPrimaryText}>Créer</Text>}
            </Pressable>
          </View>
        </Card>
      )}

      {list.length === 0 ? (
        <Empty icon="sparkles-outline" text="Aucun événement. Crée-en un pour regrouper des factures et des recettes." />
      ) : (
        list.map((ev) => (
          <Pressable key={ev.id} onPress={() => setSelected(ev)} style={({ pressed }) => pressed && { opacity: 0.9 }}>
            <Card>
              <View style={styles.evHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.evName} numberOfLines={1}>{ev.name}</Text>
                  {ev.event_date && <Text style={styles.evMeta}>{fmtDate(ev.event_date)}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
              </View>
              <View style={styles.pnl}>
                <PnlCell label="Recettes" value={fmtEUR(ev.revenue)} color={colors.success} />
                <PnlCell label="Dépenses" value={fmtEUR(ev.expense)} color={colors.danger} />
                <PnlCell label="Résultat" value={fmtEUR(ev.net)} color={ev.net >= 0 ? colors.success : colors.danger} strong />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function PnlCell({ label, value, color, strong }: { label: string; value: string; color: string; strong?: boolean }) {
  return (
    <View style={styles.pnlCell}>
      <Text style={styles.pnlLabel}>{label}</Text>
      <Text style={[styles.pnlValue, { color }, strong && { fontWeight: "800" }]}>{value}</Text>
    </View>
  );
}

// ---------- Détail d'un événement ----------
function EventDetail({ event, onBack }: { event: EventWithTotals; onBack: () => void }) {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<EventRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<null | "expense" | "revenue">(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ex, rv] = await Promise.all([fetchExpensesForEvent(event.id), fetchRevenuesForEvent(event.id)]);
      setExpenses(ex);
      setRevenues(rv);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRev = revenues.reduce((s, r) => s + r.total, 0);
  const totalExp = expenses.reduce((s, e) => s + Number(e.amount_ttc), 0);
  const net = totalRev - totalExp;

  return (
    <Screen>
      <Pressable onPress={onBack} style={styles.backRow} accessibilityRole="button">
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Tous les événements</Text>
      </Pressable>

      <Card>
        <Text style={styles.evName}>{event.name}</Text>
        {event.event_date && <Text style={styles.evMeta}>{fmtDate(event.event_date)}</Text>}
        <View style={[styles.pnl, { marginTop: space.sm }]}>
          <PnlCell label="Recettes" value={fmtEUR(totalRev)} color={colors.success} />
          <PnlCell label="Dépenses" value={fmtEUR(totalExp)} color={colors.danger} />
          <PnlCell label="Résultat" value={fmtEUR(net)} color={net >= 0 ? colors.success : colors.danger} strong />
        </View>
      </Card>

      {loading ? (
        <Loading />
      ) : (
        <>
          {/* Recettes */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recettes</Text>
            <Pressable onPress={() => setPicker("revenue")} accessibilityRole="button" style={styles.addLink}>
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={styles.addLinkText}>Ajouter</Text>
            </Pressable>
          </View>
          {revenues.length === 0 ? (
            <Text style={styles.muted}>Aucune recette rattachée.</Text>
          ) : (
            revenues.map((r) => (
              <Card key={r.id}>
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{SERVICE_LABEL[r.service] ?? r.service}</Text>
                    <Text style={styles.itemMeta}>{fmtDate(r.revenue_date)}</Text>
                  </View>
                  <Text style={[styles.itemAmount, { color: colors.success }]}>{fmtEUR(r.total)}</Text>
                  <DetachBtn onPress={async () => { await setRevenueEvent(r.id, null); load(); }} />
                </View>
              </Card>
            ))
          )}

          {/* Dépenses */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Dépenses</Text>
            <Pressable onPress={() => setPicker("expense")} accessibilityRole="button" style={styles.addLink}>
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={styles.addLinkText}>Ajouter</Text>
            </Pressable>
          </View>
          {expenses.length === 0 ? (
            <Text style={styles.muted}>Aucune dépense rattachée.</Text>
          ) : (
            expenses.map((e) => (
              <Card key={e.id}>
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
                    <Text style={styles.itemMeta}>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</Text>
                  </View>
                  <Text style={[styles.itemAmount, { color: colors.danger }]}>{fmtEUR(Number(e.amount_ttc))}</Text>
                  <DetachBtn onPress={async () => { await setExpenseEvent(e.id, null); load(); }} />
                </View>
              </Card>
            ))
          )}
        </>
      )}

      {/* Sélecteur d'items libres à rattacher */}
      <AttachPicker
        kind={picker}
        eventId={event.id}
        onClose={() => setPicker(null)}
        onAttached={() => { setPicker(null); load(); }}
      />
    </Screen>
  );
}

function DetachBtn({ onPress }: { onPress: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      onPress={async () => { setBusy(true); await onPress(); }}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Détacher de l'événement"
      style={styles.detachBtn}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />}
    </Pressable>
  );
}

// Modale : liste les dépenses/recettes LIBRES (event_id null) à rattacher.
function AttachPicker({
  kind,
  eventId,
  onClose,
  onAttached,
}: {
  kind: null | "expense" | "revenue";
  eventId: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<EventRevenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    setLoading(true);
    const p = kind === "expense" ? fetchExpensesForEvent(null) : fetchRevenuesForEvent(null);
    p.then((data) => {
      if (kind === "expense") setExpenses(data as ExpenseListItem[]);
      else setRevenues(data as EventRevenue[]);
    }).finally(() => setLoading(false));
  }, [kind]);

  async function attachExpense(id: string) {
    setBusy(id);
    try { await setExpenseEvent(id, eventId); onAttached(); } finally { setBusy(null); }
  }
  async function attachRevenue(id: string) {
    setBusy(id);
    try { await setRevenueEvent(id, eventId); onAttached(); } finally { setBusy(null); }
  }

  return (
    <Modal visible={kind !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{kind === "expense" ? "Ajouter des dépenses" : "Ajouter des recettes"}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          {loading ? (
            <Loading />
          ) : kind === "expense" ? (
            expenses.length === 0 ? (
              <Text style={styles.muted}>Aucune dépense libre à rattacher.</Text>
            ) : (
              <Screen>
                {expenses.map((e) => (
                  <Pressable key={e.id} onPress={() => attachExpense(e.id)} disabled={busy !== null} style={styles.pickRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle} numberOfLines={1}>{e.supplier?.name ?? "Sans fournisseur"}</Text>
                      <Text style={styles.itemMeta}>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</Text>
                    </View>
                    <Text style={styles.itemAmount}>{fmtEUR(Number(e.amount_ttc))}</Text>
                    {busy === e.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="add-circle" size={24} color={colors.primary} />}
                  </Pressable>
                ))}
              </Screen>
            )
          ) : revenues.length === 0 ? (
            <Text style={styles.muted}>Aucune recette libre à rattacher.</Text>
          ) : (
            <Screen>
              {revenues.map((r) => (
                <Pressable key={r.id} onPress={() => attachRevenue(r.id)} disabled={busy !== null} style={styles.pickRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{SERVICE_LABEL[r.service] ?? r.service}</Text>
                    <Text style={styles.itemMeta}>{fmtDate(r.revenue_date)}</Text>
                  </View>
                  <Text style={styles.itemAmount}>{fmtEUR(r.total)}</Text>
                  {busy === r.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="add-circle" size={24} color={colors.primary} />}
                </Pressable>
              ))}
            </Screen>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  newBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm,
    backgroundColor: colors.primary, borderRadius: radius.md, minHeight: TOUCH,
  },
  newBtnText: { ...type.title, color: colors.white },
  formTitle: { ...type.h2, color: colors.text },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface,
  },
  formActions: { flexDirection: "row", gap: space.sm },
  btn: { flex: 1, minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...type.title, color: colors.white },
  btnGhost: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { ...type.title, color: colors.text },

  evHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  evName: { ...type.title, color: colors.text },
  evMeta: { ...type.small, color: colors.textMuted },
  pnl: { flexDirection: "row", gap: space.sm },
  pnlCell: { flex: 1, gap: 2 },
  pnlLabel: { ...type.small, color: colors.textMuted },
  pnlValue: { ...type.title, fontWeight: "700" },

  backRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  backText: { ...type.title, color: colors.primary },

  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm },
  sectionTitle: { ...type.label, color: colors.textMuted },
  addLink: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, paddingHorizontal: space.xs },
  addLinkText: { ...type.small, color: colors.primary, fontWeight: "600" },
  muted: { ...type.small, color: colors.textMuted },

  itemRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  itemTitle: { ...type.body, color: colors.text },
  itemMeta: { ...type.small, color: colors.textMuted },
  itemAmount: { ...type.title, color: colors.text },
  detachBtn: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: space.lg, maxHeight: "80%",
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingBottom: space.sm },
  sheetTitle: { ...type.h2, color: colors.text },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border,
  },
});
