// Galerie photos du restaurant : prendre / importer des photos « comm »
// (plats, ambiance, événements), séparées des justificatifs. Album + export
// (partage natif pour réutiliser les photos ailleurs / faire des montages).

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { Profile } from "@resto/shared";
import {
  fetchGalleryPhotos, uploadGalleryPhoto, deleteGalleryPhoto, updateGalleryCaption,
  type GalleryPhotoRow,
} from "../lib/data";
import { colors, radius, space, type, TOUCH } from "../theme";
import { Empty, Loading } from "./ui";

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function GalleryScreen({ profile }: { profile: Profile }) {
  const { width } = useWindowDimensions();
  const gap = 6;
  const cols = 3;
  const size = Math.floor((width - space.md * 2 - gap * (cols - 1)) / cols);

  const [photos, setPhotos] = useState<GalleryPhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GalleryPhotoRow | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setPhotos(await fetchGalleryPhotos());
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function uploadAssets(assets: ImagePicker.ImagePickerAsset[]) {
    setBusy(true); setError(null);
    try {
      for (const a of assets) {
        if (!a.base64) continue;
        await uploadGalleryPhoto({
          establishmentId: profile.establishment_id,
          createdBy: profile.id,
          file: base64ToBytes(a.base64),
          contentType: a.mimeType ?? "image/jpeg",
        });
      }
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function takePhoto() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError("Autorise l'accès à la caméra pour prendre une photo."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, base64: true });
    if (res.canceled) return;
    await uploadAssets(res.assets ?? []);
  }

  async function importPhotos() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.8, base64: true,
      allowsMultipleSelection: true, selectionLimit: 20,
    });
    if (res.canceled) return;
    await uploadAssets(res.assets ?? []);
  }

  async function sharePhoto(p: GalleryPhotoRow) {
    if (!p.url) return;
    try {
      const target = `${FileSystem.cacheDirectory}rose-photo-${p.id}.jpg`;
      const dl = await FileSystem.downloadAsync(p.url, target);
      if (!(await Sharing.isAvailableAsync())) { setError("Le partage n'est pas disponible sur cet appareil."); return; }
      await Sharing.shareAsync(dl.uri);
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    }
  }

  function confirmDelete(p: GalleryPhotoRow) {
    Alert.alert("Supprimer cette photo ?", "Elle sera retirée de l'album.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          try {
            await deleteGalleryPhoto(p.id, p.storage_path);
            setSelected(null);
            await load();
          } catch (e: unknown) {
            setError(String((e as Error).message ?? e));
          }
        },
      },
    ]);
  }

  async function saveCaption() {
    if (!selected) return;
    try {
      await updateGalleryCaption(selected.id, captionDraft.trim() || null);
      setPhotos((prev) => prev.map((x) => (x.id === selected.id ? { ...x, caption: captionDraft.trim() || null } : x)));
      setSelected((s) => (s ? { ...s, caption: captionDraft.trim() || null } : s));
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    }
  }

  if (loading) return <Loading />;

  return (
    <View style={styles.root}>
      <View style={styles.actions}>
        <Pressable style={[styles.actionBtn, styles.primaryBtn]} onPress={takePhoto} disabled={busy} accessibilityRole="button">
          <Ionicons name="camera" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>Prendre</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, styles.secondaryBtn]} onPress={importPhotos} disabled={busy} accessibilityRole="button">
          <Ionicons name="images-outline" size={20} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>Importer</Text>
        </Pressable>
      </View>

      {busy && (
        <View style={styles.busyRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Envoi en cours…</Text>
        </View>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {photos.length === 0 && !busy ? (
        <Empty icon="image-outline" text="Aucune photo. Prends ou importe les photos de ton restaurant pour les garder ici." />
      ) : (
        <ScrollView contentContainerStyle={[styles.grid, { gap }]}>
          {photos.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => { setSelected(p); setCaptionDraft(p.caption ?? ""); }}
              style={{ width: size, height: size, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.border }}
            >
              {p.url ? <Image source={{ uri: p.url }} style={{ width: "100%", height: "100%" }} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Plein écran */}
      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalTop}>
            <Pressable onPress={() => setSelected(null)} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Fermer">
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
          {selected?.url ? (
            <Image source={{ uri: selected.url }} style={styles.fullImage} resizeMode="contain" />
          ) : null}
          <View style={styles.captionRow}>
            <TextInput
              value={captionDraft}
              onChangeText={setCaptionDraft}
              onBlur={saveCaption}
              placeholder="Légende (optionnel)…"
              placeholderTextColor="#bbb"
              style={styles.captionInput}
            />
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalAction} onPress={() => selected && sharePhoto(selected)} accessibilityRole="button">
              <Ionicons name="share-outline" size={22} color="#fff" />
              <Text style={styles.modalActionText}>Partager / Exporter</Text>
            </Pressable>
            <Pressable style={styles.modalAction} onPress={() => selected && confirmDelete(selected)} accessibilityRole="button">
              <Ionicons name="trash-outline" size={22} color="#ff6b6b" />
              <Text style={[styles.modalActionText, { color: "#ff6b6b" }]}>Supprimer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.md, paddingTop: space.sm },
  actions: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: TOUCH, borderRadius: radius.md,
  },
  primaryBtn: { backgroundColor: colors.primary },
  primaryBtnText: { ...type.label, color: "#fff", textTransform: "none", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.primarySoft },
  secondaryBtnText: { ...type.label, color: colors.primary, textTransform: "none", fontSize: 15 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: space.sm },
  muted: { ...type.small, color: colors.textMuted },
  errorText: { ...type.small, color: colors.danger ?? "#c0392b", marginBottom: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingBottom: space.xl },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  modalTop: { flexDirection: "row", justifyContent: "flex-end", padding: space.md, paddingTop: space.xl },
  iconBtn: { padding: 6 },
  fullImage: { flex: 1, width: "100%" },
  captionRow: { paddingHorizontal: space.md, paddingVertical: space.sm },
  captionInput: { color: "#fff", ...type.body, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#555" },
  modalActions: { flexDirection: "row", justifyContent: "space-around", paddingVertical: space.lg, paddingBottom: space.xl },
  modalAction: { flexDirection: "row", alignItems: "center", gap: 8, padding: space.sm },
  modalActionText: { ...type.label, color: "#fff", textTransform: "none", fontSize: 15 },
});
