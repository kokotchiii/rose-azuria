// Écran phare mobile : prendre une facture en photo → IA → formulaire pré-rempli → enregistrement.

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { uploadAndClassify, uploadAndClassifyPages, PAYMENT_SOURCES } from "@resto/shared";
import type { AiExtraction, Category, PaymentSource, Profile } from "@resto/shared";
import { supabase } from "./supabaseClient";
import { DateField } from "./screens/ui";
import { colors, radius, shadow, space, TOUCH, type } from "./theme";

interface Props {
  profile: Profile;
}

interface PickedImage {
  uri: string;
  bytes: Uint8Array;
  contentType: string;
  base64?: string; // gardé pour générer le PDF (embed dans le HTML de rendu)
  name?: string;   // nom de fichier (affiché pour un PDF, non prévisualisable en image)
}

// Sentinel : "c'est la société (Azuria) qui paie" → payer_id = null en base.
const AZURIA = "AZURIA";

interface FormState {
  expense_date: string;
  supplier_name: string;
  category_id: string;
  amount_ttc: string;
  amount_tva: string;
  tva_rate: string;
  invoice_number: string;
  payer_id: string; // AZURIA ou un profile.id
  payment_source: PaymentSource;
  note: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = (): FormState => ({
  expense_date: todayISO(),
  supplier_name: "",
  category_id: "",
  amount_ttc: "",
  amount_tva: "",
  tva_rate: "",
  invoice_number: "",
  payer_id: AZURIA,
  payment_source: "cb_pro",
  note: "",
});

// Décode une chaîne base64 en octets bruts (pour l'upload Storage en RN).
function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin);
}

// Génère un PDF (une page A4 par image) façon document scanné, et renvoie ses octets.
async function buildScanPdf(imgPages: PickedImage[]): Promise<{ uri: string; bytes: Uint8Array }> {
  const body = imgPages
    .map((p) => {
      const b64 = p.base64 ?? bytesToBase64(p.bytes);
      return `<div class="pg"><img src="data:${p.contentType || "image/jpeg"};base64,${b64}"/></div>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { margin: 16px; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .pg { page-break-after: always; display: flex; align-items: center; justify-content: center; min-height: 1040px; }
    .pg:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 1040px; object-fit: contain; filter: contrast(1.06) saturate(0.92); }
  </style></head><body>${body}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, bytes: base64ToBytes(b64) };
}

// Trouve un fournisseur par nom (insensible à la casse) ou le crée.
async function findOrCreateSupplier(name: string, establishmentId: string): Promise<string> {
  const trimmed = name.trim();
  const { data: existing } = await supabase
    .from("suppliers")
    .select("id")
    .eq("establishment_id", establishmentId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("suppliers")
    .insert({ establishment_id: establishmentId, name: trimmed })
    .select("id")
    .single();
  if (error || !created) throw new Error(`supplier_create_failed: ${error?.message}`);
  return created.id as string;
}

export function Capture({ profile }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pages, setPages] = useState<PickedImage[]>([]);
  const [pdfUri, setPdfUri] = useState<string | null>(null); // PDF généré (partageable)
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraction, setExtraction] = useState<AiExtraction | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase
      .from("categories")
      .select("*")
      .eq("establishment_id", profile.establishment_id)
      .eq("is_active", true)
      .then(({ data }) => setCategories((data ?? []) as Category[]));

    supabase
      .from("profiles")
      .select("*")
      .eq("establishment_id", profile.establishment_id)
      .then(({ data }) => setProfiles((data ?? []) as Profile[]));
  }, [profile.establishment_id]);

  function resetAll() {
    setPages([]);
    setPdfUri(null);
    setExtraction(null);
    setDocumentId(null);
    setForm(EMPTY_FORM());
    setError(null);
  }

  // Une nouvelle page invalide l'analyse précédente (il faut relancer l'IA).
  function clearResults() {
    setExtraction(null);
    setDocumentId(null);
    setPdfUri(null);
    setSuccess(false);
  }

  // Scanner natif (détourage + redressement auto). Nécessite un build (dev client/EAS) ;
  // en Expo Go le module natif est absent → message de repli vers Photo/Galerie.
  async function scanDocuments() {
    setError(null);
    const mod = (() => { try { return require("react-native-document-scanner-plugin"); } catch { return null; } })();
    const Scanner = mod?.default;
    if (!Scanner) {
      setError("Le scan nécessite l'app installée (build). Utilise Photo ou Galerie en attendant.");
      return;
    }
    try {
      const { scannedImages } = await Scanner.scanDocument({
        maxNumDocuments: 10,
        responseType: mod.ResponseType?.Base64 ?? "base64",
        croppedImageQuality: 90,
      });
      const list: string[] = scannedImages ?? [];
      if (!list.length) return;
      const next: PickedImage[] = list.map((b64) => ({
        uri: `data:image/jpeg;base64,${b64}`,
        bytes: base64ToBytes(b64),
        contentType: "image/jpeg",
        base64: b64,
      }));
      clearResults();
      setPages((prev) => [...prev, ...next]);
    } catch (e: unknown) {
      setError(`Scan indisponible ici (utilise Photo/Galerie) : ${String((e as Error).message ?? e)}`);
    }
  }

  // --- 1) Acquisition des pages (scan / caméra / galerie multi / PDF). Chaque ajout
  //        s'AJOUTE aux pages existantes → un justificatif multi-pages. ---
  function addImageAssets(assets: ImagePicker.ImagePickerAsset[]) {
    const next: PickedImage[] = [];
    for (const a of assets) {
      if (!a.base64) continue;
      next.push({ uri: a.uri, bytes: base64ToBytes(a.base64), contentType: a.mimeType ?? "image/jpeg", base64: a.base64 });
    }
    if (!next.length) { setError("Impossible de lire l'image."); return; }
    clearResults();
    setPages((prev) => [...prev, ...next]);
  }

  async function pickFromCamera() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Autorise l'accès à la caméra pour photographier une facture.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    if (res.canceled) return;
    addImageAssets(res.assets ?? []);
  }

  async function pickFromLibrary() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.6, base64: true,
      allowsMultipleSelection: true, selectionLimit: 10,
    });
    if (res.canceled) return;
    addImageAssets(res.assets ?? []);
  }

  // Sélection d'un PDF (déjà multi-pages côté Claude). On l'ajoute comme une page.
  async function pickPdf() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      clearResults();
      setPages((prev) => [...prev, { uri: asset.uri, bytes: base64ToBytes(base64), contentType: "application/pdf", base64, name: asset.name }]);
    } catch (e: unknown) {
      setError(`Impossible de lire le PDF : ${String((e as Error).message ?? e)}`);
    }
  }

  function removePage(idx: number) {
    setPages((prev) => prev.filter((_, i) => i !== idx));
    clearResults();
  }

  // --- 2) Upload + classification IA ---
  async function analyze() {
    if (!pages.length) return;
    setClassifying(true);
    setError(null);
    try {
      const imgs = pages.filter((p) => p.contentType !== "application/pdf");
      const pdfs = pages.filter((p) => p.contentType === "application/pdf");

      let res: { extraction: AiExtraction; documentId: string };
      let madePdf: string | null = null;

      if (pdfs.length === 0) {
        // Toutes des images → un seul PDF « scan », c'est lui le justificatif.
        const pdf = await buildScanPdf(imgs);
        madePdf = pdf.uri;
        res = await uploadAndClassify({
          client: supabase, establishmentId: profile.establishment_id,
          file: pdf.bytes, fileName: `facture-${todayISO()}.pdf`, contentType: "application/pdf",
          uploadedBy: profile.id,
        });
      } else if (pdfs.length === 1 && imgs.length === 0) {
        // Déjà un PDF → tel quel.
        madePdf = pdfs[0]!.uri;
        res = await uploadAndClassify({
          client: supabase, establishmentId: profile.establishment_id,
          file: pdfs[0]!.bytes, fileName: `facture-${todayISO()}.pdf`, contentType: "application/pdf",
          uploadedBy: profile.id,
        });
      } else {
        // Mélange images + PDF → on envoie les pages telles quelles.
        res = await uploadAndClassifyPages({
          client: supabase, establishmentId: profile.establishment_id,
          pages: pages.map((p) => ({ file: p.bytes, contentType: p.contentType })),
          fileBaseName: `facture-${todayISO()}`, uploadedBy: profile.id,
        });
        if (imgs.length) { try { madePdf = (await buildScanPdf(imgs)).uri; } catch { /* best effort */ } }
      }

      setPdfUri(madePdf);
      setExtraction(res.extraction);
      setDocumentId(res.documentId);

      const ex = res.extraction;
      const matchedCat = categories.find((c) => c.label === ex.suggested_category);
      setForm((prev) => ({
        ...prev,
        expense_date: ex.document_date ?? prev.expense_date,
        supplier_name: ex.supplier_name ?? "",
        category_id: matchedCat?.id ?? "",
        amount_ttc: ex.amount_ttc != null ? String(ex.amount_ttc) : "",
        amount_tva: ex.amount_tva != null ? String(ex.amount_tva) : "",
        tva_rate: ex.tva_rate != null ? String(ex.tva_rate) : "",
        invoice_number: ex.invoice_number ?? "",
      }));
    } catch (e: unknown) {
      setError(`Analyse IA échouée : ${String((e as Error).message ?? e)}`);
    } finally {
      setClassifying(false);
    }
  }

  async function sharePdf() {
    if (!pdfUri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdfUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        setError("Partage indisponible sur cet appareil.");
      }
    } catch { /* partage annulé */ }
  }

  // --- 3) Enregistrement de la dépense ---
  async function save() {
    if (!form.amount_ttc) {
      setError("Renseigne au moins le montant TTC.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supplierId = form.supplier_name.trim()
        ? await findOrCreateSupplier(form.supplier_name, profile.establishment_id)
        : null;

      const { error: insErr } = await supabase.from("expenses").insert({
        establishment_id: profile.establishment_id,
        expense_date: form.expense_date,
        supplier_id: supplierId,
        category_id: form.category_id || null,
        amount_ttc: Number(form.amount_ttc),
        tva_rate: form.tva_rate ? Number(form.tva_rate) : null,
        amount_tva: form.amount_tva ? Number(form.amount_tva) : null,
        payer_id: form.payer_id === AZURIA ? null : form.payer_id,
        payment_source: form.payment_source,
        invoice_number: form.invoice_number || null,
        document_id: documentId,
        note: form.note || null,
        created_by: profile.id,
      });
      if (insErr) throw insErr;

      setSuccess(true);
      resetAll();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const conf = extraction?.confidence ?? 0;
  const confTone = conf >= 0.8 ? colors.success : conf >= 0.5 ? colors.gold : colors.danger;

  // Options de payeur : la société + chaque membre de l'établissement.
  const payerOptions = [
    { id: AZURIA, label: "Société" },
    ...profiles.map((p) => ({ id: p.id, label: p.full_name ?? "Membre" })),
  ];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {success && (
          <View style={styles.successBox} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.successText}>Dépense enregistrée avec succès.</Text>
          </View>
        )}

        {/* Carte capture */}
        <View style={styles.card}>
          {pages.length === 0 ? (
            <View style={styles.placeholder}>
              <Ionicons name="receipt-outline" size={40} color={colors.secondary} />
              <Text style={styles.muted}>Photo(s), galerie ou PDF pour démarrer</Text>
              <Text style={styles.muted}>Plusieurs photos = un seul justificatif multi-pages</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pagesRow}>
              {pages.map((p, i) => (
                <View key={`${p.uri}-${i}`} style={styles.thumbWrap}>
                  {p.contentType === "application/pdf" ? (
                    <View style={styles.thumbPdf}>
                      <Ionicons name="document-text-outline" size={26} color={colors.primary} />
                      <Text style={styles.thumbPdfText} numberOfLines={2}>{p.name ?? "PDF"}</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: p.uri }} style={styles.thumb} resizeMode="cover" accessibilityLabel={`Page ${i + 1}`} />
                  )}
                  <Pressable style={styles.thumbRemove} onPress={() => removePage(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Retirer la page ${i + 1}`}>
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                  <View style={styles.thumbBadge}><Text style={styles.thumbBadgeText}>{i + 1}</Text></View>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
            onPress={scanDocuments}
            accessibilityRole="button"
            accessibilityLabel="Scanner un document"
          >
            <Ionicons name="scan-outline" size={20} color={colors.white} />
            <Text style={styles.btnPrimaryText}>Scanner</Text>
          </Pressable>

          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, styles.flex1, pressed && styles.pressed]}
              onPress={pickFromCamera}
              accessibilityRole="button"
              accessibilityLabel="Prendre une photo"
            >
              <Ionicons name="camera" size={20} color={colors.text} />
              <Text style={styles.btnGhostText}>Photo</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, styles.flex1, pressed && styles.pressed]}
              onPress={pickFromLibrary}
              accessibilityRole="button"
              accessibilityLabel="Choisir dans la galerie"
            >
              <Ionicons name="images-outline" size={20} color={colors.text} />
              <Text style={styles.btnGhostText}>Galerie</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, styles.flex1, pressed && styles.pressed]}
              onPress={pickPdf}
              accessibilityRole="button"
              accessibilityLabel="Choisir un PDF"
            >
              <Ionicons name="document-outline" size={20} color={colors.text} />
              <Text style={styles.btnGhostText}>PDF</Text>
            </Pressable>
          </View>

          {pages.length > 0 && !extraction && (
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGold, pressed && styles.pressed]}
              onPress={analyze}
              disabled={classifying}
              accessibilityRole="button"
            >
              {classifying ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>
                    Analyser avec l'IA{pages.length > 1 ? ` (${pages.length} pages)` : ""}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {extraction && (
            <View style={styles.confidenceRow}>
              <View style={[styles.dot, { backgroundColor: confTone }]} />
              <Text style={styles.muted}>
                Confiance IA {Math.round(conf * 100)}% · {extraction.document_type}
              </Text>
            </View>
          )}

          {pdfUri && (
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              onPress={sharePdf}
              accessibilityRole="button"
              accessibilityLabel="Partager ou enregistrer le PDF"
            >
              <Ionicons name="document-text-outline" size={18} color={colors.text} />
              <Text style={styles.btnGhostText}>Voir / partager le PDF</Text>
            </Pressable>
          )}
        </View>

        {error && (
          <View style={styles.errorBox} accessibilityLiveRegion="assertive">
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Formulaire (après analyse) */}
        {extraction && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Détails</Text>

            <Field label="Date">
              <DateField value={form.expense_date} onChange={(v) => setForm({ ...form, expense_date: v })} />
            </Field>

            <Field label="Fournisseur">
              <TextInput
                style={styles.input}
                value={form.supplier_name}
                onChangeText={(v) => setForm({ ...form, supplier_name: v })}
                placeholder="ex : Metro Toulon"
                placeholderTextColor={colors.textMuted}
              />
            </Field>

            <Field label="Catégorie">
              <View style={styles.chipsWrap}>
                {categories.map((c) => {
                  const active = form.category_id === c.id;
                  return (
                    <Chip
                      key={c.id}
                      label={c.label}
                      active={active}
                      onPress={() => setForm({ ...form, category_id: c.id })}
                    />
                  );
                })}
              </View>
            </Field>

            <View style={styles.row}>
              <Field label="Montant TTC (€)" style={styles.flex1}>
                <TextInput
                  style={styles.input}
                  value={form.amount_ttc}
                  onChangeText={(v) => setForm({ ...form, amount_ttc: v })}
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.textMuted}
                />
              </Field>
              <Field label="TVA (€)" style={styles.flex1}>
                <TextInput
                  style={styles.input}
                  value={form.amount_tva}
                  onChangeText={(v) => setForm({ ...form, amount_tva: v })}
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.textMuted}
                />
              </Field>
            </View>

            <View style={styles.row}>
              <Field label="Taux TVA (%)" style={styles.flex1}>
                <TextInput
                  style={styles.input}
                  value={form.tva_rate}
                  onChangeText={(v) => setForm({ ...form, tva_rate: v })}
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.textMuted}
                />
              </Field>
              <Field label="N° facture" style={styles.flex1}>
                <TextInput
                  style={styles.input}
                  value={form.invoice_number}
                  onChangeText={(v) => setForm({ ...form, invoice_number: v })}
                  placeholderTextColor={colors.textMuted}
                />
              </Field>
            </View>

            {/* Qui a payé — choix société ou membre */}
            <Field label="Qui a payé ?">
              <View style={styles.chipsWrap}>
                {payerOptions.map((opt) => {
                  const active = form.payer_id === opt.id;
                  return (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      icon={opt.id === AZURIA ? "business-outline" : "person-outline"}
                      active={active}
                      onPress={() =>
                        setForm({
                          ...form,
                          payer_id: opt.id,
                          // Société → CB pro ; un membre avance → CB perso (à rembourser).
                          payment_source: opt.id === AZURIA ? "cb_pro" : "cb_perso",
                        })
                      }
                    />
                  );
                })}
              </View>
            </Field>

            <Field label="Moyen de paiement">
              <View style={styles.chipsWrap}>
                {PAYMENT_SOURCES.map((s) => (
                  <Chip
                    key={s}
                    label={labelPaymentSource(s)}
                    active={form.payment_source === s}
                    onPress={() => setForm({ ...form, payment_source: s })}
                  />
                ))}
              </View>
            </Field>

            <Field label="Note">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.note}
                onChangeText={(v) => setForm({ ...form, note: v })}
                multiline
                placeholder="précision si besoin…"
                placeholderTextColor={colors.textMuted}
              />
            </Field>

            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>Enregistrer la dépense</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
    >
      {icon && (
        <Ionicons name={icon} size={15} color={active ? colors.white : colors.textMuted} />
      )}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function labelPaymentSource(s: PaymentSource): string {
  switch (s) {
    case "cb_pro":   return "CB pro";
    case "cb_perso": return "CB perso";
    case "especes":  return "Espèces";
    case "virement": return "Virement";
  }
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  header:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand:   { ...type.h1, color: colors.text },
  muted:   { ...type.small, color: colors.textMuted },
  iconBtn: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: radius.md },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow.card },
  cardTitle: { ...type.h2, color: colors.text },

  preview: { width: "100%", height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  pagesRow: { gap: space.sm, paddingVertical: 2 },
  thumbWrap: { width: 110, height: 150 },
  thumb: { width: 110, height: 150, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  thumbPdf: {
    width: 110, height: 150, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
    alignItems: "center", justifyContent: "center", gap: 4, padding: space.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  thumbPdfText: { ...type.small, color: colors.textMuted, textAlign: "center", fontSize: 11 },
  thumbRemove: { position: "absolute", top: -6, right: -6, backgroundColor: colors.surface, borderRadius: 11 },
  thumbBadge: {
    position: "absolute", bottom: 6, left: 6, minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  thumbBadgeText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  placeholder: {
    width: "100%", height: 180, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
    alignItems: "center", justifyContent: "center", gap: space.sm,
    borderWidth: 1, borderColor: colors.border, borderStyle: "dashed",
  },

  row:   { flexDirection: "row", gap: space.md, alignItems: "flex-end" },
  flex1: { flex: 1 },

  btn: {
    minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnGold:    { backgroundColor: colors.gold },
  btnPrimaryText: { ...type.title, color: colors.white },
  btnGhost: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { ...type.title, color: colors.text },
  pressed: { opacity: 0.85 },

  confidenceRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },

  field: { gap: space.xs },
  label: { ...type.label, color: colors.textMuted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 72, paddingTop: space.md, textAlignVertical: "top" },

  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...type.small, color: colors.text },
  chipTextActive: { color: colors.white, fontWeight: "600" },

  successBox: {
    flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md,
    backgroundColor: colors.successBg, borderRadius: radius.md,
  },
  successText: { ...type.small, color: colors.success, flex: 1, fontWeight: "600" },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md,
    backgroundColor: colors.dangerBg, borderRadius: radius.md,
  },
  errorText: { ...type.small, color: colors.danger, flex: 1 },
});
