import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import { supabase } from "./supabaseClient";
import { colors, radius, space, type } from "./theme";
import { Capture } from "./Capture";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ExpensesScreen } from "./screens/ExpensesScreen";
import { SuppliersScreen } from "./screens/SuppliersScreen";
import { ProductsScreen } from "./screens/ProductsScreen";
import { RevenuesScreen } from "./screens/RevenuesScreen";
import { TodosScreen } from "./screens/TodosScreen";
import { ExportScreen } from "./screens/ExportScreen";
import { ReimbursementsScreen } from "./screens/ReimbursementsScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { Screen as ScreenScroll } from "./screens/ui";

type Tab = "capture" | "expenses" | "dashboard" | "more";
type SubKey = "reimbursements" | "events" | "revenues" | "suppliers" | "products" | "todos" | "export";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "capture", label: "Capturer", icon: "camera" },
  { key: "expenses", label: "Dépenses", icon: "receipt" },
  { key: "dashboard", label: "Bord", icon: "stats-chart" },
  { key: "more", label: "Plus", icon: "grid" },
];

const SUBS: { key: SubKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "reimbursements", label: "Notes de frais", icon: "wallet-outline" },
  { key: "events", label: "Événements", icon: "sparkles-outline" },
  { key: "revenues", label: "Recettes", icon: "cash-outline" },
  { key: "suppliers", label: "Fournisseurs", icon: "storefront-outline" },
  { key: "products", label: "Produits récurrents", icon: "cart-outline" },
  { key: "todos", label: "À faire", icon: "checkmark-done-outline" },
  { key: "export", label: "Export comptable", icon: "share-outline" },
];

const TITLES: Record<Tab | SubKey, string> = {
  capture: "Nouvelle dépense",
  expenses: "Dépenses",
  dashboard: "Tableau de bord",
  more: "Plus",
  reimbursements: "Notes de frais",
  events: "Événements",
  revenues: "Recettes",
  suppliers: "Fournisseurs",
  products: "Produits récurrents",
  todos: "À faire",
  export: "Export comptable",
};

export function Home({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>("capture");
  const [sub, setSub] = useState<SubKey | null>(null);

  const title = sub ? TITLES[sub] : TITLES[tab];
  const showBack = tab === "more" && sub !== null;

  function renderBody() {
    if (tab === "capture") return <Capture profile={profile} />;
    if (tab === "expenses") return <ExpensesScreen />;
    if (tab === "dashboard") return <DashboardScreen />;
    // tab === "more"
    if (sub === "reimbursements") return <ReimbursementsScreen />;
    if (sub === "events") return <EventsScreen profile={profile} />;
    if (sub === "revenues") return <RevenuesScreen profile={profile} />;
    if (sub === "suppliers") return <SuppliersScreen />;
    if (sub === "products") return <ProductsScreen />;
    if (sub === "todos") return <TodosScreen profile={profile} />;
    if (sub === "export") return <ExportScreen />;
    return <MoreMenu onPick={setSub} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {/* En-tête global */}
      <View style={styles.header}>
        {showBack ? (
          <Pressable onPress={() => setSub(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retour" style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn}><Text style={styles.brand}>Rose</Text></View>
        )}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Se déconnecter" style={styles.headerBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Corps */}
      <View style={styles.body}>{renderBody()}</View>

      {/* Barre d'onglets */}
      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => { setTab(t.key); if (t.key !== "more") setSub(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
            >
              <Ionicons name={t.icon} size={22} color={active ? colors.primary : colors.textMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function MoreMenu({ onPick }: { onPick: (k: SubKey) => void }) {
  return (
    <ScreenScroll>
      {SUBS.map((item) => (
        <Pressable
          key={item.key}
          style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.85 }]}
          onPress={() => onPick(item.key)}
          accessibilityRole="button"
        >
          <Ionicons name={item.icon} size={22} color={colors.primary} />
          <Text style={styles.menuLabel}>{item.label}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      ))}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  headerBtn: { minWidth: 64, minHeight: 40, justifyContent: "center" },
  brand: { ...type.h2, color: colors.primary },
  title: { ...type.title, color: colors.text, flex: 1, textAlign: "center" },
  body: { flex: 1 },
  tabbar: {
    flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface, paddingTop: 6, paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 52 },
  tabLabel: { fontSize: 11, color: colors.textMuted },
  tabLabelActive: { color: colors.primary, fontWeight: "600" },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  menuLabel: { ...type.title, color: colors.text, flex: 1 },
});
