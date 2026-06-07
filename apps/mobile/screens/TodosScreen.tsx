import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import { createTask, deleteTask, fetchTasks, setTaskStatus, type TaskPriority, type TaskRow } from "../lib/data";
import { fmtDate } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, Empty, Loading, Screen, Segmented } from "./ui";

const PRIORITIES: { key: TaskPriority; label: string }[] = [
  { key: "normal", label: "Normal" },
  { key: "high", label: "Haute" },
  { key: "urgent", label: "Urgent" },
];

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: colors.textMuted,
  normal: colors.textMuted,
  high: colors.gold,
  urgent: colors.danger,
};

export function TodosScreen({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");

  function load() {
    fetchTasks().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function add() {
    if (!title.trim()) return;
    await createTask({ establishment_id: profile.establishment_id, title: title.trim(), priority, due_date: null, created_by: profile.id });
    setTitle(""); setPriority("normal");
    setLoading(true); load();
  }

  async function toggle(t: TaskRow) {
    await setTaskStatus(t.id, t.status === "done" ? "todo" : "done", profile.id);
    load();
  }

  function confirmDelete(t: TaskRow) {
    Alert.alert("Supprimer", `Supprimer « ${t.title} » ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await deleteTask(t.id); load(); } },
    ]);
  }

  return (
    <Screen>
      <Card>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Nouvelle tâche…" placeholderTextColor={colors.textMuted} />
        <Segmented<TaskPriority> options={PRIORITIES} value={priority} onChange={setPriority} />
        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={add} accessibilityRole="button">
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.btnText}>Ajouter</Text>
        </Pressable>
      </Card>

      {loading ? <Loading /> : items.length === 0 ? (
        <Empty icon="checkmark-done-outline" text="Aucune tâche." />
      ) : (
        items.map((t) => {
          const done = t.status === "done";
          return (
            <Card key={t.id}>
              <View style={styles.taskRow}>
                <Pressable onPress={() => toggle(t)} hitSlop={10} accessibilityRole="button" accessibilityLabel={done ? "Marquer à faire" : "Marquer fait"}>
                  <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={26} color={done ? colors.success : colors.border} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, done && styles.done]} numberOfLines={2}>{t.title}</Text>
                  <Text style={styles.meta}>
                    <Text style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority}</Text>
                    {t.due_date ? ` · ${fmtDate(t.due_date)}` : ""}
                  </Text>
                </View>
                <Pressable onPress={() => confirmDelete(t)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Supprimer">
                  <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  btn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm },
  btnText: { ...type.title, color: colors.white },
  taskRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { ...type.title, color: colors.text },
  done: { textDecorationLine: "line-through", color: colors.textMuted },
  meta: { ...type.small, color: colors.textMuted },
});
