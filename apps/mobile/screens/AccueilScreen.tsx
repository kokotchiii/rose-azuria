// Écran d'ACCUEIL : l'essentiel en un coup d'œil (CA semaine + objectif, alertes,
// actions rapides). C'est la première chose qu'on voit en ouvrant l'app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import {
  fetchRevenues, fetchPayables, fetchPendingReimbursements, serviceUnits,
  type RevenueRow, type ExpenseListItem, type PayerReimbursement,
} from "../lib/data";
import { supabase } from "../supabaseClient";
import { fmtEUR } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Loading, Screen } from "./ui";

const OBJ_TTC = 225.79 * 1.1;                 // objectif TTC / service (BP)
const SVC = [2, 2, 2, 2, 2, 1, 0];
const WEEK_UNITS = SVC.reduce((a, b) => a + b, 0);
const fmt0 = (n: number) => fmtEUR(Math.round(n));
const revTotal = (r: RevenueRow) => Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);
const wd = (d: Date) => (d.getDay() + 6) % 7;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type GoKey = "capture" | "revenues" | "suivi" | "invoices" | "reimbursements" | "payable";

export function AccueilScreen({ profile, onGo }: { profile: Profile; onGo: (k: GoKey) => void }) {
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [payables, setPayables] = useState<ExpenseListItem[]>([]);
  const [reimb, setReimb] = useState<PayerReimbursement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      fetchRevenues().catch(() => []),
      fetchPayables().catch(() => []),
      fetchPendingReimbursements().catch(() => []),
    ]).then(([r, p, m]) => { setRevenues(r); setPayables(p); setReimb(m); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("accueil-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "revenues" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const week = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const monday = new Date(now); monday.setDate(now.getDate() - wd(now));
    const byDate = new Map<string, RevenueRow[]>();
    for (const r of revenues) { const a = byDate.get(r.revenue_date) ?? []; a.push(r); byDate.set(r.revenue_date, a); }
    let ca = 0, units = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const rows = byDate.get(isoOf(d)) ?? [];
      ca += rows.reduce((s, r) => s + revTotal(r), 0);
      units += rows.reduce((s, r) => s + Math.max(1, serviceUnits(r.service)), 0);
    }
    const objective = WEEK_UNITS * OBJ_TTC;
    const avg = units > 0 ? ca / units : OBJ_TTC;
    const projected = ca + avg * Math.max(0, WEEK_UNITS - units);
    const pct = objective ? projected / objective : 0;
    return { ca, projected, objective, pct };
  }, [revenues]);

  if (loading) return <Loading />;

  const pctColor = week.pct >= 1 ? colors.success : week.pct >= 0.9 ? colors.gold : colors.danger;
  const payTotal = payables.reduce((s, e) => s + Number(e.amount_ttc || 0), 0);
  const reimbTotal = reimb.reduce((s, g) => s + g.total, 0);
  const greeting = greetingFor();
  const firstName = (profile.full_name ?? "").split(" ")[0] || "";

  return (
    <Screen>
      <View style={styles.hello}>
        <Text style={styles.helloTxt}>{greeting}{firstName ? `, ${firstName}` : ""} 👋</Text>
        <Text style={styles.helloSub}>{longDate()}</Text>
      </View>

      {/* Semaine en cours */}
      <Pressable onPress={() => onGo("suivi")} style={({ pressed }) => [styles.hero, pressed && { opacity: 0.92 }]}>
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>Cette semaine</Text>
          <View style={[styles.pctPill, { backgroundColor: pctColor }]}>
            <Text style={styles.pctPillTxt}>{Math.round(week.pct * 100)} % obj.</Text>
          </View>
        </View>
        <Text style={styles.heroCA}>{fmt0(week.ca)}</Text>
        <Text style={styles.heroSub}>projeté {fmt0(week.projected)} · objectif {fmt0(week.objective)}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.min(100, Math.round((week.objective ? week.ca / week.objective : 0) * 100))}%`, backgroundColor: pctColor }]} />
        </View>
        <Text style={styles.heroCta}>Voir le suivi détaillé →</Text>
      </Pressable>

      {/* Alertes */}
      <Text style={styles.sectionH}>À traiter</Text>
      {payTotal === 0 && reimbTotal === 0 ? (
        <View style={styles.okCard}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.okTxt}>Rien en attente. Tout est à jour 🎉</Text>
        </View>
      ) : (
        <>
          {payTotal > 0 && (
            <AlertRow icon="card-outline" tint={colors.danger}
              title="Factures à payer" detail={`${payables.length} facture${payables.length > 1 ? "s" : ""} · échéances`}
              value={fmt0(payTotal)} onPress={() => onGo("payable")} />
          )}
          {reimbTotal > 0 && (
            <AlertRow icon="wallet-outline" tint={colors.gold}
              title="Notes de frais à rembourser" detail={`${reimb.length} personne${reimb.length > 1 ? "s" : ""}`}
              value={fmt0(reimbTotal)} onPress={() => onGo("reimbursements")} />
          )}
        </>
      )}

      {/* Actions rapides */}
      <Text style={styles.sectionH}>Actions rapides</Text>
      <View style={styles.actions}>
        <QuickAction icon="camera" label="Scanner une dépense" onPress={() => onGo("capture")} primary />
        <QuickAction icon="cash-outline" label="Saisir une recette" onPress={() => onGo("revenues")} />
        <QuickAction icon="document-text-outline" label="Factures" onPress={() => onGo("invoices")} />
        <QuickAction icon="stats-chart-outline" label="Suivi objectifs" onPress={() => onGo("suivi")} />
      </View>
    </Screen>
  );
}

function AlertRow({ icon, tint, title, detail, value, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; detail: string; value: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.alert, pressed && { opacity: 0.9 }]}>
      <View style={[styles.alertIcon, { backgroundColor: tint + "1A" }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.alertTitle}>{title}</Text>
        <Text style={styles.alertDetail}>{detail}</Text>
      </View>
      <Text style={[styles.alertValue, { color: tint }]}>{value}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function QuickAction({ icon, label, onPress, primary }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.qa, primary && styles.qaPrimary, pressed && { opacity: 0.9 }]}>
      <Ionicons name={icon} size={24} color={primary ? colors.white : colors.primary} />
      <Text style={[styles.qaTxt, primary && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

function greetingFor() {
  const h = new Date().getHours();
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}
const JOURS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function longDate() {
  const d = new Date();
  return `${JOURS_FR[d.getDay()]} ${d.getDate()} ${MOIS_FR[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  hello: { marginBottom: space.xs },
  helloTxt: { ...type.h2, color: colors.text },
  helloSub: { ...type.small, color: colors.textMuted, textTransform: "capitalize" },

  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroLabel: { ...type.label, color: "#F4D9E1" },
  pctPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  pctPillTxt: { ...type.small, color: colors.white, fontFamily: "Karla_700Bold", fontSize: 12 },
  heroCA: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 40, color: colors.white, letterSpacing: -0.5, marginTop: 2 },
  heroSub: { ...type.small, color: "#F4D9E1" },
  barTrack: { height: 8, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.pill, marginTop: 8, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: radius.pill },
  heroCta: { ...type.small, color: colors.white, marginTop: 8, fontFamily: "Karla_600SemiBold" },

  sectionH: { ...type.label, color: colors.textMuted, marginTop: space.lg, marginBottom: 2 },
  okCard: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.successBg, borderRadius: radius.md, padding: space.md },
  okTxt: { ...type.body, color: colors.text },

  alert: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  alertIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  alertTitle: { ...type.title, color: colors.text },
  alertDetail: { ...type.small, color: colors.textMuted },
  alertValue: { ...type.title, fontFamily: "Karla_700Bold" },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  qa: { width: "48%", flexGrow: 1, minHeight: 84, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 6, padding: space.sm },
  qaPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  qaTxt: { ...type.small, color: colors.text, fontFamily: "Karla_600SemiBold", textAlign: "center" },
});
