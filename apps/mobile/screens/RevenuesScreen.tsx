import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import {
  deleteRevenue,
  fetchRevenues,
  revenueTotal,
  updateRevenue,
  upsertRevenue,
  type RevenueRow,
  type Service,
} from "../lib/data";
import { fmtDate, fmtEUR, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, DateField, Empty, Loading, Pill, Screen, SectionTitle } from "./ui";

const SERVICES: { key: Service; label: string }[] = [
  { key: "midi", label: "Midi" },
  { key: "soir", label: "Soir" },
  { key: "journee", label: "Journée" },
  { key: "autre", label: "Autre" },
];

export function RevenuesScreen({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [service, setService] = useState<Service>("soir");
  const [cash, setCash] = useState("");
  const [cb, setCb] = useState("");
  const [other, setOther] = useState("");
  const [covers, setCovers] = useState("");

  function load() {
    fetchRevenues()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setDate(todayISO());
    setService("soir");
    setCash(""); setCb(""); setOther(""); setCovers("");
    setError(null);
  }

  // Charge une recette existante dans le formulaire pour la modifier.
  function startEdit(r: RevenueRow) {
    setEditingId(r.id);
    setDate(r.revenue_date);
    setService(r.service);
    setCash(r.amount_cash ? String(r.amount_cash) : "");
    setCb(r.amount_cb ? String(r.amount_cb) : "");
    setOther(r.amount_other ? String(r.amount_other) : "");
    setCovers(r.covers != null ? String(r.covers) : "");
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const fields = {
        revenue_date: date,
        service,
        amount_cash: Number(cash) || 0,
        amount_cb: Number(cb) || 0,
        amount_other: Number(other) || 0,
        covers: covers ? Number(covers) : null,
      };
      if (editingId) {
        await updateRevenue(editingId, fields);
      } else {
        await upsertRevenue({ establishment_id: profile.establishment_id, note: null, created_by: profile.id, ...fields });
      }
      resetForm();
      setLoading(true);
      load();
    } catch (e: unknown) {
      const msg = String((e as Error).message ?? e);
      setError(msg.includes("duplicate") || msg.includes("unique")
        ? "Une recette existe déjà pour cette date et ce service."
        : msg);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    setSaving(true);
    try {
      await deleteRevenue(editingId);
      resetForm();
      setLoading(true);
      load();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{editingId ? "Modifier la recette" : "Saisir une recette"}</SectionTitle>
        <View style={styles.row}>
          <Field label="Date" flex>
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Couverts" flex>
            <TextInput style={styles.input} value={covers} onChangeText={setCovers} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
          </Field>
        </View>
        <View style={styles.pills}>
          {SERVICES.map((s) => <Pill key={s.key} label={s.label} active={service === s.key} onPress={() => setService(s.key)} />)}
        </View>
        <View style={styles.row}>
          <Field label="Espèces €" flex>
            <TextInput style={styles.input} value={cash} onChangeText={setCash} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
          <Field label="CB €" flex>
            <TextInput style={styles.input} value={cb} onChangeText={setCb} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
          <Field label="Autre €" flex>
            <TextInput style={styles.input} value={other} onChangeText={setOther} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={save} disabled={saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name={editingId ? "save-outline" : "add"} size={20} color={colors.white} />
              <Text style={styles.btnText}>{editingId ? "Enregistrer les modifications" : "Enregistrer la recette"}</Text>
            </>
          )}
        </Pressable>

        {editingId && (
          <View style={styles.editActions}>
            <Pressable style={[styles.smallBtn, styles.ghostBtn]} onPress={resetForm} disabled={saving} accessibilityRole="button">
              <Text style={styles.ghostText}>Annuler</Text>
            </Pressable>
            <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={remove} disabled={saving} accessibilityRole="button">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.dangerText}>Supprimer</Text>
            </Pressable>
          </View>
        )}
      </Card>

      <SectionTitle>Historique</SectionTitle>
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty icon="cash-outline" text="Aucune recette saisie." />
      ) : (
        items.map((r) => (
          <Pressable key={r.id} onPress={() => startEdit(r)} accessibilityRole="button" accessibilityLabel="Modifier cette recette" style={({ pressed }) => pressed && { opacity: 0.9 }}>
            <Card style={editingId === r.id ? styles.editingCard : undefined}>
              <View style={styles.lineRow}>
                <Text style={styles.name}>{fmtDate(r.revenue_date)} · {SERVICES.find((s) => s.key === r.service)?.label ?? r.service}</Text>
                <Text style={styles.amount}>{fmtEUR(revenueTotal(r))}</Text>
              </View>
              <View style={styles.lineRow}>
                <Text style={styles.meta}>
                  Esp. {fmtEUR(r.amount_cash)} · CB {fmtEUR(r.amount_cb)} · Autre {fmtEUR(r.amount_other)}
                  {r.covers != null ? ` · ${r.covers} couv.` : ""}
                </Text>
                <Ionicons name="create-outline" size={16} color={colors.secondary} />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
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
  row: { flexDirection: "row", gap: space.md },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  label: { ...type.label, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  btn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm, marginTop: space.xs },
  btnText: { ...type.title, color: colors.white },
  error: { ...type.small, color: colors.danger },
  editActions: { flexDirection: "row", gap: space.sm },
  smallBtn: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.xs },
  ghostBtn: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  ghostText: { ...type.title, color: colors.text },
  dangerBtn: { backgroundColor: colors.dangerBg },
  dangerText: { ...type.title, color: colors.danger },
  editingCard: { borderWidth: 2, borderColor: colors.primary },
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text },
  amount: { ...type.title, color: colors.success },
  meta: { ...type.small, color: colors.textMuted, flex: 1 },
});
