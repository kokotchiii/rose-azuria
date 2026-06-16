// Écran « Rapprochement bancaire » (mobile) : importe un relevé PDF, l'IA en
// extrait les opérations, puis on pointe chaque débit contre les dépenses.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { Profile, ParsedBankTx, BankTxStatus } from "@resto/shared";
import { uploadAndParseBankStatement, reconcile, type ReconcileExpense } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchExpensesForReconcile, commitBankReconciliation, type BankTxRow, fetchBankTransactions,
} from "../lib/data";
import { fmtDate, fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Kpi, Screen, SectionTitle } from "./ui";

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface DebitRow {
  tx: ParsedBankTx;
  options: ReconcileExpense[];
  selectedId: string | null;
  auto: boolean;
}

export function ReconcileScreen({ profile }: { profile: Profile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [debits, setDebits] = useState<DebitRow[]>([]);
  const [credits, setCredits] = useState<ParsedBankTx[]>([]);
  const [unmatchedExpenses, setUnmatchedExpenses] = useState<ReconcileExpense[]>([]);
  const [meta, setMeta] = useState<{ bank: string | null; from: string | null; to: string | null } | null>(null);
  const [history, setHistory] = useState<BankTxRow[]>([]);

  const loadHistory = useCallback(() => {
    fetchBankTransactions().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  async function importStatement() {
    setError(null); setInfo(null);
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0]!;
    setBusy(true);
    setDebits([]); setCredits([]); setUnmatchedExpenses([]); setMeta(null);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const { parse } = await uploadAndParseBankStatement({
        client: supabase,
        establishmentId: profile.establishment_id,
        pages: [{ file: base64ToBytes(base64), contentType: "application/pdf" }],
        fileBaseName: `releve-${(asset.name ?? "releve").replace(/\.[^.]+$/, "")}`,
      });

      const expenses = await fetchExpensesForReconcile();
      const result = reconcile(parse.transactions, expenses);

      const rows: DebitRow[] = [];
      for (const a of result.auto) rows.push({ tx: a.tx, options: [a.expense], selectedId: a.expense.id, auto: true });
      for (const am of result.ambiguous) rows.push({ tx: am.tx, options: am.candidates.map((c) => c.expense), selectedId: null, auto: false });
      for (const tx of result.unmatchedTx) rows.push({ tx, options: [], selectedId: null, auto: false });
      rows.sort((x, y) => x.tx.date.localeCompare(y.tx.date));

      setDebits(rows);
      setCredits(parse.transactions.filter((t) => t.direction === "credit"));
      setUnmatchedExpenses(result.unmatchedExpenses);
      setMeta({ bank: parse.bank_name, from: parse.period_start, to: parse.period_end });
      setInfo(`${result.auto.length} auto · ${result.ambiguous.length} à confirmer · ${result.unmatchedTx.length} sans facture`);
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number, id: string) {
    setDebits((prev) => prev.map((r, i) => (i === index ? { ...r, selectedId: r.selectedId === id ? null : id } : r)));
  }

  const matchedCount = debits.filter((d) => d.selectedId).length;

  async function save() {
    setBusy(true); setError(null);
    try {
      const rows: Array<{ tx: ParsedBankTx; matchedExpenseId: string | null; status: BankTxStatus }> = [];
      for (const d of debits) rows.push({ tx: d.tx, matchedExpenseId: d.selectedId, status: d.selectedId ? "matched" : "unmatched" });
      for (const c of credits) rows.push({ tx: c, matchedExpenseId: null, status: "unmatched" });
      await commitBankReconciliation({
        establishmentId: profile.establishment_id,
        createdBy: profile.id,
        importBatch: makeUuid(),
        rows,
      });
      setInfo(`Import enregistré : ${matchedCount} pointée(s).`);
      setDebits([]); setCredits([]); setUnmatchedExpenses([]); setMeta(null);
      loadHistory();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function expLabel(ex: ReconcileExpense): string {
    return `${ex.supplier_name ?? "Sans fournisseur"} · ${fmtEUR(ex.amount_ttc)} · ${fmtDate(ex.expense_date)}`;
  }

  const hasImport = meta != null;
  const total = (arr: ParsedBankTx[]) => arr.reduce((s, t) => s + t.amount, 0);

  return (
    <Screen>
      <Pressable
        style={({ pressed }) => [styles.importBtn, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]}
        onPress={importStatement}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Importer un relevé bancaire PDF"
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="document-attach-outline" size={20} color={colors.white} />
            <Text style={styles.importText}>Importer un relevé (PDF)</Text>
          </>
        )}
      </Pressable>

      {info && <Text style={styles.info}>{info}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {hasImport && (
        <>
          <Text style={styles.meta}>
            {meta?.bank ?? "Relevé"} · {meta?.from ? fmtDate(meta.from) : "?"} → {meta?.to ? fmtDate(meta.to) : "?"}
          </Text>

          <View style={styles.kpiRow}>
            <Kpi label="Débits" value={fmtEUR(total(debits.map((d) => d.tx)))} tone="warn" />
            <Kpi label="Pointées" value={String(matchedCount)} tone="good" />
          </View>

          <SectionTitle>Débits à pointer ({debits.length})</SectionTitle>
          {debits.map((d, i) => (
            <Card key={i} style={d.selectedId ? styles.matchedCard : d.options.length ? undefined : styles.orphanCard}>
              <View style={styles.row}>
                <Text style={styles.label} numberOfLines={2}>{d.tx.label}</Text>
                <Text style={styles.amount}>{fmtEUR(d.tx.amount)}</Text>
              </View>
              <Text style={styles.sub}>{fmtDate(d.tx.date)}</Text>

              {d.options.length === 0 ? (
                <Text style={styles.orphanTag}>Aucune facture trouvée — dépense à créer ?</Text>
              ) : (
                <View style={styles.options}>
                  {d.options.map((ex) => {
                    const sel = d.selectedId === ex.id;
                    return (
                      <Pressable
                        key={ex.id}
                        style={[styles.option, sel && styles.optionSel]}
                        onPress={() => toggle(i, ex.id)}
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name={sel ? "checkmark-circle" : "ellipse-outline"}
                          size={18}
                          color={sel ? colors.success : colors.textMuted}
                        />
                        <Text style={[styles.optionText, sel && { color: colors.text, fontWeight: "700" }]} numberOfLines={1}>
                          {expLabel(ex)}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {d.auto && <Text style={styles.autoTag}>Proposé automatiquement</Text>}
                </View>
              )}
            </Card>
          ))}

          {unmatchedExpenses.length > 0 && (
            <>
              <SectionTitle>Dépenses sans débit ({unmatchedExpenses.length})</SectionTitle>
              <Text style={styles.sub}>Pas (encore) débitées, payées en espèces, ou hors période.</Text>
              {unmatchedExpenses.slice(0, 40).map((ex) => (
                <Card key={ex.id}>
                  <View style={styles.row}>
                    <Text style={styles.label} numberOfLines={1}>{ex.supplier_name ?? "—"}</Text>
                    <Text style={styles.amount}>{fmtEUR(ex.amount_ttc)}</Text>
                  </View>
                  <Text style={styles.sub}>{fmtDate(ex.expense_date)}{ex.invoice_number ? ` · ${ex.invoice_number}` : ""}</Text>
                </Card>
              ))}
            </>
          )}

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]}
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer le pointage"
          >
            <Ionicons name="save-outline" size={18} color={colors.white} />
            <Text style={styles.importText}>Enregistrer le pointage ({matchedCount})</Text>
          </Pressable>
        </>
      )}

      {!hasImport && history.length > 0 && (
        <>
          <SectionTitle>Opérations importées ({history.length})</SectionTitle>
          {history.slice(0, 60).map((t) => (
            <Card key={t.id}>
              <View style={styles.row}>
                <Text style={styles.label} numberOfLines={1}>{t.label}</Text>
                <Text style={[styles.amount, { color: t.direction === "debit" ? colors.danger : colors.success }]}>
                  {t.direction === "debit" ? "−" : "+"}{fmtEUR(t.amount)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.sub}>{fmtDate(t.tx_date)}</Text>
                <Text style={[styles.statusTag, { color: t.status === "matched" ? colors.success : colors.textMuted }]}>
                  {t.status === "matched" ? "pointée" : t.status === "ignored" ? "ignorée" : "non pointée"}
                </Text>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

// uuid v4 simple (sans dépendance crypto native).
function makeUuid(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else {
      const r = Math.floor(Math.random() * 16);
      out += i === 19 ? hex[(r & 0x3) | 0x8] : hex[r];
    }
  }
  return out;
}

const styles = StyleSheet.create({
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, marginBottom: space.sm },
  importText: { ...type.title, color: colors.white },
  info: { ...type.small, color: colors.success, marginBottom: space.xs },
  error: { ...type.small, color: colors.danger, marginBottom: space.xs },
  meta: { ...type.small, color: colors.textMuted, marginBottom: space.sm },
  kpiRow: { flexDirection: "row", gap: space.md, marginBottom: space.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  label: { ...type.title, color: colors.text, flex: 1 },
  amount: { ...type.title, color: colors.primary },
  sub: { ...type.small, color: colors.textMuted },
  matchedCard: { borderWidth: 1, borderColor: colors.success },
  orphanCard: { borderWidth: 1, borderColor: colors.gold },
  orphanTag: { ...type.small, color: colors.gold, fontWeight: "700", marginTop: space.xs },
  autoTag: { ...type.small, color: colors.textMuted, marginTop: 2, fontStyle: "italic" },
  options: { marginTop: space.sm, gap: space.xs },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  optionSel: {},
  optionText: { ...type.body, color: colors.textMuted, flex: 1 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.success, marginTop: space.md, marginBottom: space.xl },
  statusTag: { ...type.small, fontWeight: "700" },
});
