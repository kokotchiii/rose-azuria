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
import { PrevisionnelScreen } from "./screens/PrevisionnelScreen";
import { PayableScreen } from "./screens/PayableScreen";
import { TodosScreen } from "./screens/TodosScreen";
import { PlannedScreen } from "./screens/PlannedScreen";
import { ExportScreen } from "./screens/ExportScreen";
import { ReimbursementsScreen } from "./screens/ReimbursementsScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { ReconcileScreen } from "./screens/ReconcileScreen";
import { GalleryScreen } from "./screens/GalleryScreen";
import { InvoicesScreen } from "./screens/InvoicesScreen";
import { InboxScreen } from "./screens/InboxScreen";
import { CoffreScreen } from "./screens/CoffreScreen";
import { SuiviScreen } from "./screens/SuiviScreen";
import { AccueilScreen, type GoKey } from "./screens/AccueilScreen";
import { BrandLogo, Screen as ScreenScroll } from "./screens/ui";

type Tab = "accueil" | "capture" | "suivi" | "more";
type SubKey =
  | "inbox"
  | "expenses" | "invoices" | "payable" | "reimbursements" | "reconcile"
  | "revenues" | "dashboard" | "events"
  | "previsionnel" | "planned" | "coffre"
  | "gallery"
  | "suppliers" | "products" | "todos" | "export";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "accueil", label: "Accueil", icon: "home" },
  { key: "capture", label: "Capturer", icon: "camera" },
  { key: "suivi", label: "Suivi", icon: "stats-chart" },
  { key: "more", label: "Plus", icon: "grid" },
];

// Menu « Plus » rangé par sections pour ne plus avoir une longue liste.
const SECTIONS: { title: string; items: { key: SubKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] }[] = [
  {
    title: "Argent & factures",
    items: [
      { key: "inbox", label: "Boîte de réception", icon: "mail-unread-outline" },
      { key: "expenses", label: "Dépenses", icon: "receipt-outline" },
      { key: "invoices", label: "Factures", icon: "document-text-outline" },
      { key: "payable", label: "À payer (échéances)", icon: "card-outline" },
      { key: "reimbursements", label: "Notes de frais", icon: "wallet-outline" },
      { key: "reconcile", label: "Rapprochement bancaire", icon: "git-compare-outline" },
    ],
  },
  {
    title: "Activité",
    items: [
      { key: "revenues", label: "Recettes", icon: "cash-outline" },
      { key: "dashboard", label: "Tableau de bord", icon: "pie-chart-outline" },
      { key: "events", label: "Événements", icon: "sparkles-outline" },
    ],
  },
  {
    title: "Prévision & documents",
    items: [
      { key: "previsionnel", label: "Prévisionnel", icon: "trending-up-outline" },
      { key: "planned", label: "À prévoir", icon: "construct-outline" },
      { key: "coffre", label: "Coffre à documents", icon: "folder-outline" },
      { key: "gallery", label: "Galerie photos", icon: "images-outline" },
    ],
  },
  {
    title: "Référentiel & réglages",
    items: [
      { key: "suppliers", label: "Fournisseurs", icon: "storefront-outline" },
      { key: "products", label: "Produits récurrents", icon: "cart-outline" },
      { key: "todos", label: "À faire", icon: "checkmark-done-outline" },
      { key: "export", label: "Export comptable", icon: "share-outline" },
    ],
  },
];

const TITLES: Record<Tab | SubKey, string> = {
  accueil: "Rose", capture: "Nouvelle dépense", suivi: "Suivi", more: "Plus",
  inbox: "Boîte de réception",
  expenses: "Dépenses", invoices: "Factures", payable: "À payer",
  reimbursements: "Notes de frais", reconcile: "Rapprochement bancaire",
  revenues: "Recettes", dashboard: "Tableau de bord", events: "Événements",
  previsionnel: "Prévisionnel", planned: "À prévoir", coffre: "Coffre à documents",
  gallery: "Galerie photos", suppliers: "Fournisseurs", products: "Produits récurrents",
  todos: "À faire", export: "Export comptable",
};

export function Home({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>("accueil");
  const [sub, setSub] = useState<SubKey | null>(null);

  const title = sub ? TITLES[sub] : TITLES[tab];
  const showBack = tab === "more" && sub !== null;

  // Navigation depuis l'accueil (boutons/alertes) vers n'importe quel écran.
  function goTo(k: GoKey) {
    if (k === "capture") { setTab("capture"); setSub(null); }
    else if (k === "suivi") { setTab("suivi"); setSub(null); }
    else { setTab("more"); setSub(k as SubKey); }
  }

  function renderBody() {
    if (tab === "accueil") return <AccueilScreen profile={profile} onGo={goTo} />;
    if (tab === "capture") return <Capture profile={profile} />;
    if (tab === "suivi") return <SuiviScreen />;
    // tab === "more"
    if (sub === "inbox") return <InboxScreen profile={profile} />;
    if (sub === "expenses") return <ExpensesScreen />;
    if (sub === "invoices") return <InvoicesScreen />;
    if (sub === "payable") return <PayableScreen />;
    if (sub === "reimbursements") return <ReimbursementsScreen />;
    if (sub === "reconcile") return <ReconcileScreen profile={profile} />;
    if (sub === "revenues") return <RevenuesScreen profile={profile} />;
    if (sub === "dashboard") return <DashboardScreen />;
    if (sub === "events") return <EventsScreen profile={profile} />;
    if (sub === "previsionnel") return <PrevisionnelScreen />;
    if (sub === "planned") return <PlannedScreen profile={profile} />;
    if (sub === "coffre") return <CoffreScreen profile={profile} />;
    if (sub === "gallery") return <GalleryScreen profile={profile} />;
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
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn}><BrandLogo size={34} /></View>
        )}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Se déconnecter" style={styles.headerBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
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
              <View style={[styles.tabIcon, active && styles.tabIconActive]}>
                <Ionicons name={t.icon} size={23} color={active ? colors.primary : colors.textMuted} />
              </View>
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
      {SECTIONS.map((section) => (
        <View key={section.title} style={{ marginBottom: space.md }}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.group}>
            {section.items.map((item, i) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.menuItem, i > 0 && styles.menuDivider, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => onPick(item.key)}
                accessibilityRole="button"
              >
                <View style={styles.menuIcon}><Ionicons name={item.icon} size={20} color={colors.primary} /></View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
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
  headerBtn: { minWidth: 60, minHeight: 40, justifyContent: "center" },
  title: { ...type.title, fontSize: 17, color: colors.text, flex: 1, textAlign: "center" },
  body: { flex: 1 },
  tabbar: {
    flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface, paddingTop: 8, paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56 },
  tabIcon: { paddingHorizontal: 20, paddingVertical: 4, borderRadius: radius.pill },
  tabIconActive: { backgroundColor: colors.primarySoft },
  tabLabel: { ...type.small, fontSize: 11, color: colors.textMuted },
  tabLabelActive: { fontFamily: "Karla_700Bold", fontSize: 11, color: colors.primary },

  sectionTitle: { ...type.label, color: colors.textMuted, marginBottom: 6, marginLeft: 2 },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 14 },
  menuDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  menuIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  menuLabel: { ...type.body, color: colors.text, flex: 1 },
});
