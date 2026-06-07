import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFonts, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display";
import { Karla_400Regular, Karla_500Medium, Karla_600SemiBold, Karla_700Bold } from "@expo-google-fonts/karla";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@resto/shared";
import { supabase } from "./supabaseClient";
import { Home } from "./Home";
import { colors, radius, shadow, space, TOUCH, type } from "./theme";

export default function App() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession]   = useState<Session | null>(null);
  const [profile, setProfile]   = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    Karla_400Regular,
    Karla_500Medium,
    Karla_600SemiBold,
    Karla_700Bold,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Pré-remplit l'email mémorisé (« se souvenir de moi »).
  useEffect(() => {
    AsyncStorage.multiGet(["rememberMe", "rememberedEmail"]).then((entries) => {
      const map = Object.fromEntries(entries);
      const on = map.rememberMe !== "0"; // coché par défaut
      setRemember(on);
      if (on && map.rememberedEmail) setEmail(map.rememberedEmail);
    });
  }, []);

  // Charge le profil métier (establishment_id) dès qu'on a une session.
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    setLoadingProfile(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        setProfile(data as Profile | null);
        setLoadingProfile(false);
      });
  }, [session]);

  async function signIn() {
    setError(null);
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      // Mémorise (ou oublie) l'email selon la case cochée.
      await AsyncStorage.multiSet([
        ["rememberMe", remember ? "1" : "0"],
        ["rememberedEmail", remember ? email.trim() : ""],
      ]);
    }
    setSigningIn(false);
  }

  // Attend le chargement des polices pour éviter un flash de texte système.
  if (!fontsLoaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  // Connecté + profil prêt → navigation principale
  if (session && profile) {
    return <Home profile={profile} />;
  }

  // Connecté mais profil en cours de chargement / introuvable
  if (session) {
    return (
      <View style={[styles.screen, styles.center]}>
        {loadingProfile ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : (
          <View style={styles.card}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
            <Text style={styles.cardTitle}>Aucun profil lié</Text>
            <Text style={styles.muted}>Ce compte n'est rattaché à aucun établissement.</Text>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              onPress={() => supabase.auth.signOut()}
            >
              <Text style={styles.btnGhostText}>Se déconnecter</Text>
            </Pressable>
          </View>
        )}
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.center, { flex: 1, padding: space.xl }]}>
        {/* Marque */}
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="restaurant" size={28} color={colors.white} />
          </View>
          <Text style={styles.brandName}>Rose</Text>
          <Text style={styles.muted}>Gestion des dépenses</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion</Text>

          <View style={styles.field}>
            <Text style={styles.label} nativeID="lbl-email">Email</Text>
            <TextInput
              style={styles.input}
              accessibilityLabelledBy="lbl-email"
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="vous@restaurant.fr"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label} nativeID="lbl-pwd">Mot de passe</Text>
            <TextInput
              style={styles.input}
              accessibilityLabelledBy="lbl-pwd"
              accessibilityLabel="Mot de passe"
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <Pressable
            style={styles.remember}
            onPress={() => setRemember((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
            accessibilityLabel="Se souvenir de moi"
          >
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>
              {remember && <Ionicons name="checkmark" size={16} color={colors.white} />}
            </View>
            <Text style={styles.rememberLabel}>Se souvenir de moi</Text>
          </Pressable>

          {error && (
            <View style={styles.errorBox} accessibilityLiveRegion="assertive">
              <Ionicons name="warning-outline" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
            onPress={signIn}
            disabled={signingIn}
            accessibilityRole="button"
          >
            {signingIn ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.btnPrimaryText}>Se connecter</Text>
            )}
          </Pressable>
        </View>
      </View>
      <StatusBar style="dark" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: "center", alignItems: "center" },
  brand:  { alignItems: "center", marginBottom: space.xl, gap: space.xs },
  logo: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", marginBottom: space.sm, ...shadow.card,
  },
  brandName: { ...type.h1, color: colors.text },
  muted: { ...type.small, color: colors.textMuted, textAlign: "center" },
  card: {
    width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: space.xl, gap: space.lg, ...shadow.card, alignItems: "stretch",
  },
  cardTitle: { ...type.h2, color: colors.text },
  field: { gap: space.xs },
  label: { ...type.label, color: colors.textMuted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text,
    backgroundColor: colors.surface,
  },
  btn: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...type.title, color: colors.white },
  btnGhost: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { ...type.title, color: colors.text },
  pressed: { opacity: 0.85 },
  remember: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, marginTop: -space.xs },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rememberLabel: { ...type.small, color: colors.text },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md,
    backgroundColor: colors.dangerBg, borderRadius: radius.md,
  },
  errorText: { ...type.small, color: colors.danger, flex: 1 },
});
