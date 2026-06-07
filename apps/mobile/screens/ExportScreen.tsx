import { useState } from "react";
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchExpenses } from "../lib/data";
import { fmtEUR, startOfMonthISO, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, Screen, SectionTitle } from "./ui";

function csvEscape(v: string): string {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function ExportScreen() {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  async function run(share: boolean) {
    setBusy(true);
    try {
      const rows = await fetchExpenses({ from, to });
      setCount(rows.length);
      setTotal(rows.reduce((s, e) => s + Number(e.amount_ttc), 0));
      if (share) {
        const header = "Date;Fournisseur;Categorie;Montant TTC;TVA;N facture;Note";
        const lines = rows.map((e) =>
          [
            e.expense_date,
            e.supplier?.name ?? "",
            e.category?.label ?? "",
            String(e.amount_ttc ?? ""),
            String(e.amount_tva ?? ""),
            e.invoice_number ?? "",
            e.note ?? "",
          ].map((c) => csvEscape(String(c ?? ""))).join(";"),
        );
        const csv = [header, ...lines].join("\n");
        await Share.share({ title: `export-depenses-${from}_${to}.csv`, message: csv });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>Période</SectionTitle>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.label}>Du</Text>
            <TextInput style={styles.input} value={from} onChangeText={setFrom} placeholder="AAAA-MM-JJ" placeholderTextColor={colors.textMuted} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.label}>Au</Text>
            <TextInput style={styles.input} value={to} onChangeText={setTo} placeholder="AAAA-MM-JJ" placeholderTextColor={colors.textMuted} />
          </View>
        </View>

        <Pressable style={({ pressed }) => [styles.btn, styles.ghost, pressed && { opacity: 0.85 }]} onPress={() => run(false)} disabled={busy} accessibilityRole="button">
          <Text style={styles.ghostText}>Calculer le total</Text>
        </Pressable>

        {count != null && (
          <View style={styles.summary}>
            <Text style={styles.summaryText}>{count} dépense{count > 1 ? "s" : ""}</Text>
            <Text style={styles.summaryTotal}>{fmtEUR(total)}</Text>
          </View>
        )}

        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={() => run(true)} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name="share-outline" size={20} color={colors.white} />
              <Text style={styles.btnText}>Exporter / partager (CSV)</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>Le CSV est partagé via le menu de partage iOS (Mail, Fichiers, AirDrop…).</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md },
  label: { ...type.label, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  btn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm, marginTop: space.xs },
  btnText: { ...type.title, color: colors.white },
  ghost: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  ghostText: { ...type.title, color: colors.text },
  summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space.sm },
  summaryText: { ...type.body, color: colors.textMuted },
  summaryTotal: { ...type.h2, color: colors.primary },
  hint: { ...type.small, color: colors.textMuted },
});
