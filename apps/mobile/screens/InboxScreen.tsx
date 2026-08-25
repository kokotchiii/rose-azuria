// Boîte de réception mobile : factures reçues par mail (robot Gmail), pré-remplies
// par l'IA, à valider pour créer la dépense.

import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile, Category, PaymentSource } from "@resto/shared";
import { PAYMENT_SOURCES } from "@resto/shared";
import {
  fetchEmailInbox, validateInboxDocument, ignoreInboxDocument, type InboxDoc,
} from "../lib/data";
import { supabase } from "../supabaseClient";
import { fmtDate, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, DateField, Empty, Loading, Screen, SectionTitle, Segmented, Select } from "./ui";

const FACTURE_TYPES = ["facture", "bon_de_livraison", "loyer", "taxe_impot", "recouvrement", "assurance", "honoraires", "pret", "fiche_de_paie", "logiciel", "frais_bancaires"];
const PS_LABEL: Record<PaymentSource, string> = { cb_pro: "CB pro", cb_perso: "CB perso", especes: "Espèces", virement: "Virement / prélèvement" };

export function InboxScreen({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<InboxDoc[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        fetchEmailInbox(),
        supabase.from("categories").select("*").eq("establishment_id", profile.establishment_id).eq("is_active", true),
      ]);
      setRows(r);
      setCats((c.data ?? []) as Category[]);
    } finally {
      setLoading(false);
    }
  }, [profile.establishment_id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("rt-inbox-m")
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  return (
    <Screen>
      <Text style={styles.intro}>
        Les factures reçues par mail (libellé « Factures ») arrivent ici, lues par l'IA.
        Vérifie et valide pour créer la dépense.
      </Text>
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon="mail-open-outline" text="Aucune facture en attente." />
      ) : (
        rows.map((doc) => <InboxItem key={doc.id} doc={doc} cats={cats} profile={profile} onDone={reload} />)
      )}
    </Screen>
  );
}

function InboxItem({ doc, cats, profile, onDone }: { doc: InboxDoc; cats: Category[]; profile: Profile; onDone: () => void }) {
  const ex = doc.extraction;
  const defaultKind: "facture" | "depannage" = ex && FACTURE_TYPES.includes(ex.document_type) ? "facture" : "depannage";

  const [supplierName, setSupplierName] = useState(ex?.supplier_name ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(ex?.invoice_number ?? "");
  const [expenseDate, setExpenseDate] = useState(ex?.document_date ?? todayISO());
  const [dueDate, setDueDate] = useState(ex?.due_date ?? "");
  const [amountTtc, setAmountTtc] = useState(ex?.amount_ttc != null ? String(ex.amount_ttc) : "");
  const [amountTva, setAmountTva] = useState(ex?.amount_tva != null ? String(ex.amount_tva) : "");
  const [kind, setKind] = useState<"facture" | "depannage">(defaultKind);
  const [categoryId, setCategoryId] = useState<string>(
    ex?.suggested_category ? (cats.find((c) => c.label.toLowerCase() === ex.suggested_category.toLowerCase())?.id ?? "") : "",
  );
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("virement");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function openPdf() {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  }

  async function onValidate() {
    if (!amountTtc || Number(amountTtc) <= 0) { setMsg("⚠ Renseigne le montant TTC."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await validateInboxDocument({
        documentId: doc.id, establishmentId: profile.establishment_id, createdBy: profile.id,
        kind, supplierName: supplierName.trim() || null, categoryId: categoryId || null,
        expenseDate, dueDate: dueDate || null, amountTtc: Number(amountTtc),
        tvaRate: null, amountTva: amountTva ? Number(amountTva) : null,
        paymentSource, invoiceNumber: invoiceNumber.trim() || null, paid,
        note: doc.email_subject ? `Reçu par mail : ${doc.email_subject}` : "Reçu par mail",
      });
      setMsg(res.matched ? "✅ Créée et pointée" : "✅ Dépense créée");
      setTimeout(onDone, 500);
    } catch (e: unknown) {
      setMsg("⚠ " + String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onIgnore() {
    setBusy(true);
    try { await ignoreInboxDocument(doc.id); onDone(); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginBottom: space.md }}>
      <Text style={styles.subject} numberOfLines={2}>{doc.email_subject ?? "(sans objet)"}</Text>
      <Text style={styles.meta}>
        De {doc.email_from ?? "?"} · {doc.email_received_at ? fmtDate(doc.email_received_at) : "?"}
      </Text>
      <View style={styles.badgeRow}>
        {doc.ai_status === "pending" && <Text style={styles.badgeWarn}>IA en cours…</Text>}
        {doc.ai_status === "failed" && <Text style={styles.badgeWarn}>Lecture IA échouée — remplis à la main</Text>}
        {doc.ai_status === "done" && ex && <Text style={styles.badgeOk}>IA · {Math.round((ex.confidence ?? 0) * 100)}%</Text>}
        <Pressable onPress={openPdf} hitSlop={8}><Text style={styles.link}>📎 Voir le PDF</Text></Pressable>
      </View>

      <SectionTitle>Fournisseur</SectionTitle>
      <TextInput style={styles.input} value={supplierName} onChangeText={setSupplierName} placeholder="Nom du fournisseur" placeholderTextColor={colors.textMuted} />

      <View style={styles.row}>
        <View style={styles.col}>
          <SectionTitle>Montant TTC (€)</SectionTitle>
          <TextInput style={styles.input} value={amountTtc} onChangeText={setAmountTtc} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={styles.col}>
          <SectionTitle>TVA (€)</SectionTitle>
          <TextInput style={styles.input} value={amountTva} onChangeText={setAmountTva} keyboardType="decimal-pad" placeholder="opt." placeholderTextColor={colors.textMuted} />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <SectionTitle>Date</SectionTitle>
          <DateField value={expenseDate} onChange={setExpenseDate} />
        </View>
        <View style={styles.col}>
          <SectionTitle>Échéance</SectionTitle>
          <DateField value={dueDate} onChange={setDueDate} placeholder="—" />
        </View>
      </View>

      <SectionTitle>N° de facture</SectionTitle>
      <TextInput style={styles.input} value={invoiceNumber} onChangeText={setInvoiceNumber} placeholder="—" placeholderTextColor={colors.textMuted} />

      <SectionTitle>Catégorie</SectionTitle>
      <Select<string>
        value={categoryId}
        options={[{ key: "", label: "— non classé —" }, ...cats.map((c) => ({ key: c.id, label: c.label }))]}
        onChange={setCategoryId}
      />

      <SectionTitle>Type</SectionTitle>
      <Segmented<string>
        options={[{ key: "facture", label: "Facture" }, { key: "depannage", label: "Dépannage" }]}
        value={kind} onChange={(k) => setKind(k as "facture" | "depannage")}
      />

      <SectionTitle>Moyen de paiement</SectionTitle>
      <Select<string>
        value={paymentSource}
        options={PAYMENT_SOURCES.map((p) => ({ key: p, label: PS_LABEL[p] }))}
        onChange={(k) => setPaymentSource(k as PaymentSource)}
      />

      <SectionTitle>Statut</SectionTitle>
      <Segmented<string>
        options={[{ key: "unpaid", label: "À payer" }, { key: "paid", label: "Déjà payée" }]}
        value={paid ? "paid" : "unpaid"} onChange={(k) => setPaid(k === "paid")}
      />

      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} onPress={onValidate} disabled={busy}>
          <Ionicons name="checkmark" size={18} color={colors.white} />
          <Text style={styles.btnPrimaryText}>Valider</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onIgnore} disabled={busy}>
          <Text style={styles.btnGhostText}>Ignorer</Text>
        </Pressable>
      </View>
      {msg && <Text style={styles.msg}>{msg}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.small, color: colors.textMuted, marginBottom: space.md },
  subject: { ...type.title, color: colors.text },
  meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.xs, flexWrap: "wrap" },
  badgeOk: { ...type.small, color: colors.success, fontWeight: "600" },
  badgeWarn: { ...type.small, color: colors.gold, fontWeight: "600" },
  link: { ...type.small, color: colors.primary, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  row: { flexDirection: "row", gap: space.md },
  col: { flex: 1 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  btn: { flex: 1, minHeight: TOUCH, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...type.title, color: colors.white },
  btnGhost: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border, flex: 0.5 },
  btnGhostText: { ...type.body, color: colors.text, fontWeight: "600" },
  msg: { ...type.small, color: colors.text, marginTop: space.sm },
});
