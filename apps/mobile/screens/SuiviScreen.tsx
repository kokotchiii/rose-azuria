// Écran SUIVI (mobile) : où j'en suis vs objectifs, semaine par semaine.
// Semaine en cours PROJETÉE (extrapolation mi-semaine), CA/obj, couverts/obj, jour par jour.
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchRevenues, serviceUnits, type RevenueRow } from "../lib/data";
import { supabase } from "../supabaseClient";
import { fmtEUR } from "../lib/format";
import { colors, radius, space, type } from "../theme";
import { Card, Loading, Screen } from "./ui";

const OBJ_HT_PER_SERVICE = 225.79;              // BP N+1 119 216 € / 528 services
const TVA = 0.10;
const OBJ_TTC = OBJ_HT_PER_SERVICE * (1 + TVA); // ≈ 248,37 € TTC / service
const TICKET_CIBLE_TTC = 33;                    // ticket moyen cible du BP (TTC)
const SVC = [2, 2, 2, 2, 2, 1, 0];              // lun→dim
const WEEK_UNITS = SVC.reduce((a, b) => a + b, 0); // 11
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const revTotal = (r: RevenueRow) => Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);
const fmt0 = (n: number) => fmtEUR(Math.round(n));
const wd = (d: Date) => (d.getDay() + 6) % 7;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date) { const m = new Date(d); m.setDate(d.getDate() - wd(d)); m.setHours(0, 0, 0, 0); return m; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(d.getDate() + n); return x; }

interface WeekAgg {
  mondayISO: string; ca: number; units: number; covers: number;
  objective: number; projected: number; days: DayAgg[];
}
interface DayAgg { label: string; ca: number; covers: number; planned: number; hasData: boolean; isFuture: boolean; isToday: boolean; }

function buildWeek(monday: Date, byDate: Map<string, RevenueRow[]>, today: Date): WeekAgg {
  const todayISO = iso(today);
  let ca = 0, units = 0, covers = 0;
  const days: DayAgg[] = [];
  for (let i = 0; i < 7; i++) {
    const dISO = iso(addDays(monday, i));
    const rows = byDate.get(dISO) ?? [];
    const dca = rows.reduce((s, r) => s + revTotal(r), 0);
    const du = rows.reduce((s, r) => s + Math.max(1, serviceUnits(r.service)), 0);
    const dc = rows.reduce((s, r) => s + (r.covers ?? 0), 0);
    ca += dca; units += du; covers += dc;
    days.push({ label: JOURS[i]!, ca: dca, covers: dc, planned: SVC[i] ?? 0, hasData: rows.length > 0, isFuture: dISO > todayISO, isToday: dISO === todayISO });
  }
  const objective = WEEK_UNITS * OBJ_TTC;
  const avg = units > 0 ? ca / units : OBJ_TTC;
  const projected = ca + avg * Math.max(0, WEEK_UNITS - units);
  return { mondayISO: iso(monday), ca, units, covers, objective, projected, days };
}

function pctClass(p: number) { return p >= 1 ? colors.success : p >= 0.9 ? colors.gold : colors.danger; }

export function SuiviScreen() {
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const load = useCallback(() => {
    fetchRevenues().then(setRevenues).catch(() => setRevenues([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("suivi-live").on("postgres_changes", { event: "*", schema: "public", table: "revenues" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, RevenueRow[]>();
    for (const r of revenues) { const a = m.get(r.revenue_date) ?? []; a.push(r); m.set(r.revenue_date, a); }
    return m;
  }, [revenues]);

  const current = useMemo(() => buildWeek(mondayOf(today), byDate, today), [byDate, today]);
  const past = useMemo(() => {
    const cur = mondayOf(today); const out: WeekAgg[] = [];
    for (let i = 1; i <= 8; i++) { const w = buildWeek(addDays(cur, -7 * i), byDate, today); if (w.units > 0) out.push(w); }
    return out;
  }, [byDate, today]);

  if (loading) return <Loading />;

  const s = current;
  const pctCA = s.objective ? s.projected / s.objective : 0;
  const objCovers = Math.round(s.objective / TICKET_CIBLE_TTC);
  const pctCov = objCovers ? s.covers / objCovers : 0;
  const ticket = s.covers > 0 ? s.ca / s.covers : 0;
  const verdict = pctCA >= 1 ? "Objectif en vue 👍" : pctCA >= 0.9 ? "Tout près" : "En retard sur l'objectif";

  return (
    <Screen>
      {/* Semaine en cours */}
      <Text style={styles.h}>Cette semaine (lun → dim)</Text>
      <Card>
        <View style={styles.grid}>
          <Kpi label="CA réalisé" value={fmtEUR(s.ca)} />
          <Kpi label="Projeté fin de semaine" value={fmtEUR(s.projected)} />
        </View>
        <View style={styles.grid}>
          <Kpi label="Objectif semaine" value={fmtEUR(s.objective)} />
          <Kpi label="Atteinte (projetée)" value={`${Math.round(pctCA * 100)} %`} color={pctClass(pctCA)} />
        </View>
        <Bar pct={s.objective ? s.ca / s.objective : 0} proj={pctCA} color={pctClass(pctCA)} />
        <Text style={[styles.badge, { color: pctClass(pctCA) }]}>{verdict}</Text>
      </Card>

      {/* CA / obj et Couverts / obj */}
      <View style={styles.grid}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.kl}>CA vs objectif</Text>
          <Text style={[styles.kv, { color: pctClass(pctCA) }]}>{Math.round(pctCA * 100)} %</Text>
          <Text style={styles.sub}>{fmtEUR(s.projected)} / {fmtEUR(s.objective)}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.kl}>Couverts vs objectif</Text>
          <Text style={[styles.kv, { color: pctClass(pctCov) }]}>{Math.round(pctCov * 100)} %</Text>
          <Text style={styles.sub}>{s.covers} / {objCovers} couverts</Text>
        </Card>
      </View>
      <View style={styles.grid}>
        <Kpi label="Ticket moyen" value={ticket > 0 ? fmtEUR(ticket) : "—"} />
        <Kpi label="Services faits" value={`${s.units} / ${WEEK_UNITS}`} />
      </View>

      {/* Jour par jour */}
      <Text style={styles.h}>Jour par jour</Text>
      <Card style={{ gap: 0 }}>
        <View style={[styles.drow, styles.dheadRow]}>
          <Text style={[styles.dlabel, styles.dhead]}>Jour</Text>
          <Text style={[styles.dca, styles.dhead]}>CA</Text>
          <Text style={[styles.dcov, styles.dhead]}>Couv.</Text>
          <Text style={[styles.dpct, styles.dhead]}>% obj</Text>
        </View>
        {current.days.map((d, i) => {
          const obj = d.planned * OBJ_TTC;
          const p = obj ? d.ca / obj : 0;
          const closed = d.planned === 0;
          return (
            <View key={i} style={[styles.drow, i < 6 && styles.drowBorder]}>
              <Text style={[styles.dlabel, d.isToday && styles.dToday]} numberOfLines={1}>
                {d.label}{d.isToday ? " · auj." : ""}{closed ? " · fermé" : ""}
              </Text>
              <Text style={styles.dca}>{d.hasData ? fmt0(d.ca) : closed ? "—" : d.isFuture ? "à venir" : "—"}</Text>
              <Text style={styles.dcov}>{d.covers || "—"}</Text>
              <Text style={[styles.dpct, { color: d.hasData && obj ? pctClass(p) : colors.textMuted }]}>
                {d.hasData && obj ? `${Math.round(p * 100)} %` : "—"}
              </Text>
            </View>
          );
        })}
      </Card>

      {/* Semaines précédentes */}
      {past.length > 0 && (
        <>
          <Text style={styles.h}>Semaines précédentes</Text>
          <Card style={{ gap: 0 }}>
            <View style={[styles.wrow, styles.dheadRow]}>
              <Text style={[styles.wdate, styles.dhead]}>Semaine</Text>
              <Text style={[styles.wca, styles.dhead]}>CA</Text>
              <Text style={[styles.wcov, styles.dhead]}>Couv.</Text>
              <Text style={[styles.wt, styles.dhead]}>Ticket</Text>
              <Text style={[styles.wpct, styles.dhead]}>% obj</Text>
            </View>
            {past.map((w, i) => {
              const p = w.objective ? w.ca / w.objective : 0;
              const t = w.covers > 0 ? w.ca / w.covers : 0;
              return (
                <View key={w.mondayISO} style={[styles.wrow, i < past.length - 1 && styles.drowBorder]}>
                  <Text style={styles.wdate}>{w.mondayISO.slice(8)}/{w.mondayISO.slice(5, 7)}</Text>
                  <Text style={styles.wca}>{fmt0(w.ca)}</Text>
                  <Text style={styles.wcov}>{w.covers || "—"}</Text>
                  <Text style={styles.wt}>{t > 0 ? fmtEUR(t) : "—"}</Text>
                  <Text style={[styles.wpct, { color: pctClass(p) }]}>{Math.round(p * 100)} %</Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
      <Text style={styles.foot}>Objectif : 225,79 € HT/service (business plan) × services planifiés. TTC ≈ {fmtEUR(OBJ_TTC)}/service.</Text>
    </Screen>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kl}>{label}</Text>
      <Text style={[styles.kv, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function Bar({ pct, proj, color }: { pct: number; proj: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.min(100, Math.round(pct * 100))}%`, backgroundColor: color }]} />
      <View style={[styles.barProj, { left: `${Math.min(100, Math.round(proj * 100))}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  h: { ...type.label, color: colors.textMuted, marginTop: space.sm },
  grid: { flexDirection: "row", gap: space.md },
  kpi: { flex: 1, gap: 2 },
  kl: { ...type.small, color: colors.textMuted },
  kv: { fontFamily: "Karla_700Bold", fontSize: 22, color: colors.text, letterSpacing: -0.3 },
  sub: { ...type.small, color: colors.textMuted },
  badge: { ...type.title, marginTop: 4 },
  barTrack: { height: 10, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, marginTop: space.sm, marginBottom: 6, position: "relative" },
  barFill: { height: "100%", borderRadius: radius.pill },
  barProj: { position: "absolute", top: -3, width: 2, height: 16, backgroundColor: colors.text },
  drow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  drowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  dheadRow: { borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingTop: 0, paddingBottom: 7 },
  dToday: { color: colors.primary, fontFamily: "Karla_700Bold" },
  dlabel: { flex: 1.4, ...type.body, color: colors.text },
  dca: { flex: 1.2, ...type.body, color: colors.text, textAlign: "right" },
  dcov: { flex: 0.8, ...type.small, color: colors.textMuted, textAlign: "right" },
  dpct: { flex: 0.9, ...type.body, textAlign: "right", fontFamily: "Karla_600SemiBold" },
  dhead: { ...type.small, color: colors.textMuted, fontFamily: "Karla_600SemiBold" },
  wrow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  wdate: { flex: 1.3, ...type.body, color: colors.text },
  wca: { flex: 1.1, ...type.body, color: colors.text, textAlign: "right" },
  wcov: { flex: 0.7, ...type.small, color: colors.textMuted, textAlign: "right" },
  wt: { flex: 0.9, ...type.small, color: colors.textMuted, textAlign: "right" },
  wpct: { flex: 0.8, ...type.body, textAlign: "right", fontFamily: "Karla_700Bold" },
  foot: { ...type.small, color: colors.textMuted, marginTop: space.sm },
});
