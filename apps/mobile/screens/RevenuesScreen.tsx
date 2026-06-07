import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import { fetchRevenues, revenueTotal, upsertRevenue, type RevenueRow, type Service } from "../lib/data";
import { fmtDate, fmtEUR, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, Empty, Loading, Pill, Screen, SectionTitle } from "./ui";

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

  async function save() {
    setSaving(true);
    try {
      await upsertRevenue({
        establishment_id: profile.establishment_id,
        revenue_date: date,
        service,
        amount_cash: Number(cash) || 0,
        amount_cb: Number(cb) || 0,
        amount_other: Number(other) || 0,
        covers: covers ? Number(covers) : null,
        note: null,
        created_by: profile.id,
      });
      setCash(""); setCb(""); setOther(""); setCovers("");
      setLoading(true); load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>Saisir une recette</SectionTitle>
        <View style={styles.row}>
          <Field label="Date" flex>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="AAAA-MM-JJ" placeholderTextColor={colors.textMuted} />
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
        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={save} disabled={saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name="add" size={20} color={colors.white} />
              <Text style={styles.btnText}>Enregistrer la recette</Text>
            </>
          )}
        </Pressable>
      </Card>

      <SectionTitle>Historique</SectionTitle>
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty icon="cash-outline" text="Aucune recette saisie." />
      ) : (
        items.map((r) => (
          <Card key={r.id}>
            <View style={styles.lineRow}>
              <Text style={styles.name}>{fmtDate(r.revenue_date)} · {r.service}</Text>
              <Text style={styles.amount}>{fmtEUR(revenueTotal(r))}</Text>
            </View>
            <Text style={styles.meta}>
              Esp. {fmtEUR(r.amount_cash)} · CB {fmtEUR(r.amount_cb)} · Autre {fmtEUR(r.amount_other)}
              {r.covers != null ? ` · ${r.covers} couv.` : ""}
            </Text>
          </Card>
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
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text },
  amount: { ...type.title, color: colors.success },
  meta: { ...type.small, color: colors.textMuted },
});
