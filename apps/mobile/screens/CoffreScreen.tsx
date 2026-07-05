// Coffre à documents (mobile) : dépôt + classement + extraction IA qui pré-remplit
// le prévisionnel (bail, prêt, assurance, contrat de travail…).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { Profile, BusinessDocExtraction } from "@resto/shared";
import { uploadAndAnalyzeBusinessDoc } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchLibraryDocuments, insertLibraryDocument, deleteLibraryDocument, applyPrevisionnelOverrides,
  type LibraryDoc,
} from "../lib/data";
import { fmtDate } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, Empty, Loading, Screen } from "./ui";

const CAT_LABEL: Record<string, string> = {
  bail: "Bail / local", banque: "Banque / prêt", assurance: "Assurance",
  comptable: "Comptable", juridique: "Juridique", rh: "RH / personnel", autre: "Autre",
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function CoffreScreen({ profile }: { profile: Profile }) {
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<{ ex: BusinessDocExtraction; storagePath: string; fileType: string } | null>(null);

  const load = useCallback(() => {
    fetchLibraryDocuments().then(setDocs).catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function pickAndAnalyze() {
    setError(null); setInfo(null); setPending(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0]!;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const out = await uploadAndAnalyzeBusinessDoc({
        client: supabase, establishmentId: profile.establishment_id,
        pages: [{ file: base64ToBytes(b64), contentType: a.mimeType ?? "application/pdf" }],
        fileBaseName: `doc-${a.name.replace(/\.[^.]+$/, "")}`,
      });
      setPending({ ex: out.extraction, storagePath: out.storagePath, fileType: out.fileType });
    } catch (e: unknown) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  async function confirmSave(applyOverrides: boolean) {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      const ex = pending.ex;
      await insertLibraryDocument({
        establishmentId: profile.establishment_id, createdBy: profile.id,
        title: ex.title, category: ex.category, docType: ex.doc_type,
        storagePath: pending.storagePath, fileType: pending.fileType, summary: ex.summary, extracted: ex,
      });
      const ov = ex.proposed_overrides ?? {};
      if (applyOverrides && Object.keys(ov).length) await applyPrevisionnelOverrides(profile.establishment_id, ov);
      setInfo("Document enregistré.");
      setPending(null); load();
    } catch (e: unknown) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  async function openDoc(d: LibraryDoc) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 3600);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  }

  function confirmDelete(d: LibraryDoc) {
    Alert.alert("Supprimer ce document ?", d.title, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await deleteLibraryDocument(d.id, d.storage_path); load(); } },
    ]);
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Pressable style={styles.addBtn} onPress={pickAndAnalyze} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={colors.white} /> : (
          <>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.white} />
            <Text style={styles.addBtnText}>Ajouter un document</Text>
          </>
        )}
      </Pressable>
      <Text style={styles.hint}>Bail, prêt, assurance, contrat de travail… L'IA en extrait les chiffres pour le prévisionnel.</Text>
      {info && <Text style={[styles.hint, { color: colors.success }]}>{info}</Text>}
      {error && <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>}

      {/* Fiche à valider */}
      {pending && (
        <Card style={{ borderColor: colors.primary, borderWidth: 1.5 }}>
          <Text style={styles.docTitle}>{pending.ex.title}</Text>
          <Text style={styles.meta}>{CAT_LABEL[pending.ex.category] ?? pending.ex.category} · {pending.ex.doc_type}</Text>
          <Text style={styles.summary}>{pending.ex.summary}</Text>
          {Object.keys(pending.ex.proposed_overrides ?? {}).length > 0 ? (
            <>
              <Text style={styles.subhead}>Chiffres détectés pour le prévisionnel</Text>
              {Object.entries(pending.ex.proposed_overrides).map(([k, v]) => (
                <Text key={k} style={styles.ov}>• {k} : <Text style={{ fontFamily: "Karla_700Bold" }}>{String(v)}</Text></Text>
              ))}
              <Pressable style={[styles.action, styles.actionPrimary]} onPress={() => confirmSave(true)} disabled={busy}>
                <Text style={styles.actionPrimaryText}>Enregistrer + injecter au prévisionnel</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.meta}>Aucun chiffre exploitable — le document sera juste archivé.</Text>
          )}
          <Pressable style={[styles.action, styles.actionGhost]} onPress={() => confirmSave(false)} disabled={busy}>
            <Text style={styles.actionGhostText}>Enregistrer sans injecter</Text>
          </Pressable>
          <Pressable onPress={() => setPending(null)} style={{ alignSelf: "center", paddingVertical: 6 }}>
            <Text style={{ ...type.small, color: colors.textMuted }}>Annuler</Text>
          </Pressable>
        </Card>
      )}

      {docs.length === 0 && !pending ? (
        <Empty icon="folder-open-outline" text="Aucun document. Ajoute ton premier document (bail, prêt, contrat…)." />
      ) : (
        docs.map((d) => (
          <Card key={d.id}>
            <View style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => openDoc(d)}>
                <Text style={styles.docTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.meta}>{CAT_LABEL[d.category] ?? d.category} · {fmtDate(d.created_at)}</Text>
                {d.summary ? <Text style={styles.summary} numberOfLines={2}>{d.summary}</Text> : null}
              </Pressable>
              <Pressable onPress={() => confirmDelete(d)} hitSlop={10} style={styles.del}>
                <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, backgroundColor: colors.primary, borderRadius: radius.md, minHeight: TOUCH },
  addBtnText: { ...type.title, color: colors.white },
  hint: { ...type.small, color: colors.textMuted },
  docTitle: { ...type.title, color: colors.text },
  meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
  summary: { ...type.body, color: colors.text, marginTop: 6 },
  subhead: { ...type.label, color: colors.textMuted, marginTop: space.sm },
  ov: { ...type.small, color: colors.text, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  del: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
  action: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { ...type.title, color: colors.white },
  actionGhost: { backgroundColor: colors.surfaceAlt },
  actionGhostText: { ...type.title, color: colors.text },
});
