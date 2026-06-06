import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View, Button, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { supabase } from "./supabaseClient";

// Phase 0 mobile : login Supabase, vérification du câblage. La capture photo
// et l'envoi à l'IA arriveront en phase 4.

export default function App() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession]   = useState<unknown>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert("Erreur", error.message);
  }

  if (session) {
    return (
      <View style={styles.container}>
        <Text style={styles.h1}>Connecté ✅</Text>
        <Text style={styles.muted}>Phase 0 — squelette mobile prêt.</Text>
        <Button title="Se déconnecter" onPress={() => supabase.auth.signOut()} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Resto Dépenses</Text>
      <Text style={styles.muted}>Connexion</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="mot de passe"
        value={password}
        onChangeText={setPassword}
      />
      <Button title="Se connecter" onPress={signIn} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, gap: 12, backgroundColor: "#fff" },
  h1:        { fontSize: 28, fontWeight: "600" },
  muted:     { color: "#777", marginBottom: 12 },
  input:     { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 12, fontSize: 16 },
});
