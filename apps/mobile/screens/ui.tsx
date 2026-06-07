// Petit kit UI partagé par les écrans (style "Rose").
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, space, type } from "../theme";

export function Screen({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "default" | "warn" | "good" }) {
  const color = tone === "warn" ? colors.gold : tone === "good" ? colors.success : colors.text;
  return (
    <View style={[s.kpi, shadow.card]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function Empty({ icon = "file-tray-outline", text }: { icon?: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={36} color={colors.secondary} />
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [s.pill, active && s.pillActive, pressed && { opacity: 0.85 }]}
    >
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow.card },
  section: { ...type.label, color: colors.textMuted, marginTop: space.sm },
  kpi: { flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  kpiLabel: { ...type.small, color: colors.textMuted },
  kpiValue: { fontSize: 22, fontWeight: "700" },
  center: { paddingVertical: space.xxl, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl },
  emptyText: { ...type.small, color: colors.textMuted },
  pill: { minHeight: 40, justifyContent: "center", paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { ...type.small, color: colors.text },
  pillTextActive: { color: colors.white, fontWeight: "600" },
});
