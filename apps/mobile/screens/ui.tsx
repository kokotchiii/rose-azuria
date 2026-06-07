// Petit kit UI partagé par les écrans (style "Rose").
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, space, type } from "../theme";
import { fmtDate } from "../lib/format";

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

// ---------- Sélecteur de date (calendrier, sans dépendance native) ----------
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function parseISO(v: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
function todayParts() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; }
function isoOf(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekdayMon(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7; } // 0 = lundi

export function DateField({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={s.dateField} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Choisir une date">
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
        <Text style={[s.dateText, !value && { color: colors.textMuted }]}>
          {value ? fmtDate(value) : placeholder ?? "Choisir une date"}
        </Text>
      </Pressable>
      <CalendarModal
        visible={open}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(iso) => { onChange(iso); setOpen(false); }}
      />
    </>
  );
}

function CalendarModal({ visible, value, onClose, onPick }: { visible: boolean; value: string; onClose: () => void; onPick: (iso: string) => void }) {
  const start = parseISO(value) ?? todayParts();
  const [view, setView] = useState({ y: start.y, m: start.m });

  // Réaligne sur le mois de la valeur à chaque ouverture.
  useEffect(() => {
    if (visible) { const p = parseISO(value) ?? todayParts(); setView({ y: p.y, m: p.m }); }
  }, [visible, value]);

  const sel = parseISO(value);
  const lead = firstWeekdayMon(view.y, view.m);
  const total = daysInMonth(view.y, view.m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  function prev() { setView(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })); }
  function next() { setView(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })); }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.calBackdrop} onPress={onClose}>
        <Pressable style={s.calCard} onPress={() => {}}>
          <View style={s.calHead}>
            <Pressable onPress={prev} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mois précédent">
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={s.calTitle}>{MONTHS[view.m]} {view.y}</Text>
            <Pressable onPress={next} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mois suivant">
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={s.calWeek}>
            {WEEKDAYS.map((w, i) => <Text key={i} style={s.calWeekday}>{w}</Text>)}
          </View>

          <View style={s.calGrid}>
            {cells.map((day, i) => {
              if (day === null) return <View key={`b${i}`} style={s.calCell} />;
              const isSel = sel && sel.y === view.y && sel.m === view.m && sel.d === day;
              return (
                <Pressable
                  key={day}
                  style={s.calCell}
                  onPress={() => onPick(isoOf(view.y, view.m, day))}
                  accessibilityRole="button"
                >
                  <View style={[s.calDay, isSel && s.calDaySel]}>
                    <Text style={[s.calDayText, isSel && s.calDayTextSel]}>{day}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={s.calToday} onPress={() => { const t = todayParts(); onPick(isoOf(t.y, t.m, t.d)); }} accessibilityRole="button">
            <Text style={s.calTodayText}>Aujourd'hui</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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

  dateField: {
    flexDirection: "row", alignItems: "center", gap: space.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: 48, backgroundColor: colors.surface,
  },
  dateText: { fontSize: 16, color: colors.text },

  calBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: space.xl },
  calCard: { width: "100%", maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow.card },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calTitle: { ...type.title, color: colors.text },
  calWeek: { flexDirection: "row" },
  calWeekday: { width: `${100 / 7}%`, textAlign: "center", ...type.small, color: colors.textMuted },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  calDay: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  calDaySel: { backgroundColor: colors.primary },
  calDayText: { fontSize: 15, color: colors.text },
  calDayTextSel: { color: colors.white, fontWeight: "700" },
  calToday: { alignSelf: "center", paddingVertical: space.xs, marginTop: space.xs },
  calTodayText: { ...type.small, color: colors.primary, fontWeight: "600" },
});
