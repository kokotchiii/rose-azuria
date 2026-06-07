import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import {
  createPlannedExpense,
  deletePlannedExpense,
  fetchMonthlyNet,
  fetchPlannedExpenses,
  updatePlannedExpense,
  type PlanStatus,
  type PlannedExpense,
} from "../lib/data";
import { fmtDate, fmtEUR, parseAmount, todayISO } from "../lib/format";
import { supabase } from "../supabaseClient";
import type { TaskPriority } from "../lib/data";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, DateField, Empty, Kpi, Loading, Screen, SectionTitle, Segmented } from "./ui";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const PRIO_RANK: Record<TaskPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
const PRIORITIES: { key: TaskPriority; label: string }[] = [
  { key: "low", label: "Basse" },
  { key: "normal", label: "Normale" },
  { key: "high", label: "Haute" },
  { key: "urgent", label: "Urgente" },
];
const STATUSES: { key: PlanStatus; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "idea", label: "Idée", icon: "bulb-outline" },
  { key: "planned", label: "Planifié", icon: "calendar-outline" },
  { key: "done", label: "Fait", icon: "checkmark-circle-outline" },
];

const prioColor: Record<TaskPriority, string> = {
  urgent: colors.danger,
  high: colors.gold,
  normal: colors.textMuted,
  low: colors.textMuted,
};

// Étiquette de mois à n mois d'aujourd'hui (ex. « sept. 2026 »).
function monthLabelIn(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function PlannedScreen({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<PlannedExpense[]>([]);
  const [monthlyNet, setMonthlyNet] = useState(0);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([fetchPlannedExpenses(), fetchMonthlyNet(3)])
      .then(([list, cap]) => { setItems(list); setMonthlyNet(cap.monthlyNet); })
      .catch(() => { setItems([]); setMonthlyNet(0); })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    const channel = supabase
      .channel("planned-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "planned_expenses" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Items à financer (hors « fait »), triés par priorité puis échéance.
  const pending = useMemo(() => {
    return [...items]
      .filter((i) => i.status !== "done")
      .sort((a, b) => {
        if (PRIO_RANK[b.priority] !== PRIO_RANK[a.priority]) return PRIO_RANK[b.priority] - PRIO_RANK[a.priority];
        if (a.target_date && b.target_date) return a.target_date < b.target_date ? -1 : 1;
        return a.target_date ? -1 : b.target_date ? 1 : 0;
      });
  }, [items]);

  // Plan de financement cumulé : à quel moment chaque poste devient finançable.
  const plan = useMemo(() => {
    let cumulative = 0;
    return pending.map((i) => {
      cumulative += Number(i.estimated_amount || 0);
      const months = monthlyNet > 0 ? Math.ceil(cumulative / monthlyNet) : null;
      return { item: i, cumulative, months, etaLabel: months != null ? monthLabelIn(months) : null };
    });
  }, [pending, monthlyNet]);

  const totalPending = pending.reduce((s, i) => s + Number(i.estimated_amount || 0), 0);
  const globalMonths = monthlyNet > 0 ? Math.ceil(totalPending / monthlyNet) : null;

  if (loading) return <Loading />;

  return (
    <Screen>
      <PlanForm profile={profile} reload={load} />

      <View style={styles.kpiRow}>
        <Kpi label="À financer (total)" value={fmtEUR(totalPending)} tone="warn" />
        <Kpi label="Épargne / mois (est.)" value={fmtEUR(monthlyNet)} tone={monthlyNet >= 0 ? "good" : "warn"} />
      </View>
      <Kpi
        label="Tout financer en"
        value={globalMonths != null ? `~${globalMonths} mois (${monthLabelIn(globalMonths)})` : "épargne insuffisante"}
        tone={globalMonths != null ? "default" : "warn"}
      />
      <Text style={styles.muted}>
        Épargne estimée à partir de la moyenne (recettes − dépenses) des 3 derniers mois.
      </Text>

      {pending.length > 0 && (
        <>
          <SectionTitle>Plan de financement</SectionTitle>
          {plan.map(({ item, etaLabel, months }) => (
            <PlanRow key={item.id} item={item} etaLabel={etaLabel} months={months} reload={load} />
          ))}
        </>
      )}

      {/* Réalisés */}
      {items.some((i) => i.status === "done") && (
        <>
          <SectionTitle>Réalisés</SectionTitle>
          {items.filter((i) => i.status === "done").map((item) => (
            <PlanRow key={item.id} item={item} etaLabel={null} months={null} reload={load} />
          ))}
        </>
      )}

      {items.length === 0 && <Empty icon="construct-outline" text="Aucun projet à prévoir pour l'instant." />}
    </Screen>
  );
}

// Ligne d'un projet (édition inline via modal léger : on réutilise le formulaire en mode édition).
function PlanRow({ item, etaLabel, months, reload }: { item: PlannedExpense; etaLabel: string | null; months: number | null; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const done = item.status === "done";

  async function toggleDone() {
    setBusy(true);
    try {
      await updatePlannedExpense(item.id, { status: done ? "idea" : "done" });
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try { await deletePlannedExpense(item.id); reload(); } finally { setBusy(false); }
  }

  return (
    <Card style={done ? styles.doneCard : undefined}>
      <View style={styles.lineRow}>
        <Text style={[styles.name, done && styles.strike]} numberOfLines={1}>{item.label}</Text>
        <Text style={styles.amount}>{fmtEUR(item.estimated_amount)}</Text>
      </View>
      <View style={styles.metaRow}>
        {item.category ? <Text style={styles.tag}>{item.category}</Text> : null}
        <View style={[styles.prioDot, { backgroundColor: prioColor[item.priority] }]} />
        <Text style={styles.muted}>{PRIORITIES.find((p) => p.key === item.priority)?.label}</Text>
        {item.target_date ? <Text style={styles.muted}>· échéance {fmtDate(item.target_date)}</Text> : null}
      </View>

      {!done && etaLabel && (
        <View style={styles.etaRow}>
          <Ionicons name="time-outline" size={16} color={colors.primary} />
          <Text style={styles.eta}>Finançable dans ~{months} mois ({etaLabel})</Text>
        </View>
      )}

      <View style={styles.rowActions}>
        <Pressable style={[styles.smallBtn, done ? styles.ghostBtn : styles.goodBtn]} onPress={toggleDone} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.text} /> : (
            <>
              <Ionicons name={done ? "arrow-undo-outline" : "checkmark"} size={16} color={done ? colors.text : colors.white} />
              <Text style={[styles.smallBtnText, { color: done ? colors.text : colors.white }]}>{done ? "Rouvrir" : "Marquer fait"}</Text>
            </>
          )}
        </Pressable>
        <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={remove} disabled={busy} accessibilityRole="button" accessibilityLabel="Supprimer">
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </Pressable>
      </View>
    </Card>
  );
}

// Formulaire d'ajout d'un projet.
function PlanForm({ profile, reload }: { profile: Profile; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [status, setStatus] = useState<PlanStatus>("idea");
  const [target, setTarget] = useState("");

  function reset() {
    setLabel(""); setAmount(""); setCategory(""); setPriority("normal"); setStatus("idea"); setTarget(""); setError(null);
  }

  async function save() {
    if (!label.trim()) { setError("Donne un nom au projet."); return; }
    setSaving(true);
    setError(null);
    try {
      await createPlannedExpense({
        establishment_id: profile.establishment_id,
        label: label.trim(),
        estimated_amount: parseAmount(amount),
        category: category.trim() || null,
        priority,
        target_date: target || null,
        status,
        created_by: profile.id,
      });
      reset();
      setOpen(false);
      reload();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Pressable style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]} onPress={() => setOpen(true)} accessibilityRole="button">
        <Ionicons name="add-circle-outline" size={22} color={colors.white} />
        <Text style={styles.btnText}>Ajouter un projet à prévoir</Text>
      </Pressable>
    );
  }

  return (
    <Card>
      <SectionTitle>Nouveau projet</SectionTitle>
      <Field label="Intitulé">
        <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="ex : Rénovation cuisine" placeholderTextColor={colors.textMuted} />
      </Field>
      <View style={styles.row}>
        <Field label="Montant estimé €" flex>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
        </Field>
        <Field label="Catégorie" flex>
          <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="travaux, matériel…" placeholderTextColor={colors.textMuted} />
        </Field>
      </View>

      <Field label="Priorité">
        <Segmented<TaskPriority> options={PRIORITIES} value={priority} onChange={setPriority} />
      </Field>
      <Field label="Statut">
        <Segmented<PlanStatus>
          options={STATUSES.filter((s) => s.key !== "done").map((s) => ({ key: s.key, label: s.label }))}
          value={status}
          onChange={setStatus}
        />
      </Field>
      <Field label="Échéance souhaitée (optionnel)">
        <DateField value={target} onChange={setTarget} placeholder="Aucune" />
      </Field>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.editActions}>
        <Pressable style={[styles.smallBtn, styles.ghostBtn, { flex: 1 }]} onPress={() => { reset(); setOpen(false); }} disabled={saving} accessibilityRole="button">
          <Text style={styles.ghostText}>Annuler</Text>
        </Pressable>
        <Pressable style={[styles.btn, { flex: 2 }]} onPress={save} disabled={saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name="save-outline" size={20} color={colors.white} />
              <Text style={styles.btnText}>Enregistrer</Text>
            </>
          )}
        </Pressable>
      </View>
    </Card>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={[{ gap: 4 }, flex && { flex: 1 }]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: space.md },
  muted: { ...type.small, color: colors.textMuted },
  row: { flexDirection: "row", gap: space.md },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  label: { ...type.label, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  addBtn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm },
  btn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm },
  btnText: { ...type.title, color: colors.white },
  error: { ...type.small, color: colors.danger },
  editActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  smallBtn: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.xs },
  smallBtnText: { ...type.small, fontWeight: "600" },
  goodBtn: { backgroundColor: colors.success },
  ghostBtn: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  ghostText: { ...type.title, color: colors.text },
  dangerBtn: { backgroundColor: colors.dangerBg },
  doneCard: { opacity: 0.7 },
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text, flex: 1 },
  strike: { textDecorationLine: "line-through", color: colors.textMuted },
  amount: { ...type.title, color: colors.text },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.xs },
  tag: { ...type.small, color: colors.primary, backgroundColor: colors.surfaceAlt, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  prioDot: { width: 8, height: 8, borderRadius: 4, marginLeft: space.xs },
  etaRow: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs },
  eta: { ...type.small, color: colors.primary, fontWeight: "600" },
  rowActions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
});
