import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Profile } from "@resto/shared";
import {
  deleteRevenue,
  fetchRevenues,
  revenueHT,
  revenueTotal,
  revenueTVA,
  updateRevenue,
  upsertRevenue,
  type RevenueRow,
  type Service,
} from "../lib/data";
import { caSeries, byWeekdayAvg, project, windowStart, windowStats, type AmountFn, type Gran, type Horizon, type ScheduleCfg } from "../lib/stats";
import { getGrowthTarget, setGrowthTarget } from "../lib/goals";
import {
  getDefaultTvaRate, setDefaultTvaRate, TVA_DEFAULT, TVA_RATES,
  getOpenSchedule, setOpenSchedule, getOpeningDate, setOpeningDate,
  servicesPerWeekdayOf, DEFAULT_OPEN_SCHEDULE, DEFAULT_OPENING_DATE, type DaySchedule,
} from "../lib/settings";
import { fmtDate, fmtEUR, parseAmount, todayISO } from "../lib/format";
import { colors, radius, space, TOUCH, type } from "../theme";
import { Card, DateField, Empty, Kpi, Loading, Pill, Screen, SectionTitle, Segmented, Select } from "./ui";

const WEEKDAYS_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
import { BarList, LineChart, StackBar } from "./charts";

const SERVICES: { key: Service; label: string }[] = [
  { key: "midi", label: "Midi" },
  { key: "soir", label: "Soir" },
  { key: "journee", label: "Journée" },
  { key: "autre", label: "Autre" },
];

const GRANS: { key: Gran; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "year", label: "Année" },
];

const HORIZONS: { key: Horizon; label: string }[] = [
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "year", label: "Année" },
];

type View2 = "stats" | "entry";
type Basis = "ttc" | "ht";

export function RevenuesScreen({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View2>("stats");
  const [defaultRate, setDefaultRate] = useState(TVA_DEFAULT);
  const [schedule, setScheduleState] = useState<DaySchedule[]>(DEFAULT_OPEN_SCHEDULE);
  const [openingDate, setOpeningDateState] = useState<string>(DEFAULT_OPENING_DATE);

  useEffect(() => {
    getDefaultTvaRate().then(setDefaultRate);
    getOpenSchedule().then(setScheduleState);
    getOpeningDate().then(setOpeningDateState);
  }, []);
  function changeDefaultRate(r: number) { setDefaultRate(r); setDefaultTvaRate(r); }
  function changeSchedule(s: DaySchedule[]) { setScheduleState(s); setOpenSchedule(s); }
  function changeOpeningDate(d: string) { setOpeningDateState(d); setOpeningDate(d); }

  const cfg: ScheduleCfg = useMemo(
    () => ({ servicesPerWeekday: servicesPerWeekdayOf(schedule), openingDate }),
    [schedule, openingDate],
  );

  const scrollRef = useRef<ScrollView | null>(null);
  function scrollToTop() { scrollRef.current?.scrollTo({ y: 0, animated: true }); }

  function load() {
    fetchRevenues()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <Screen scrollRef={scrollRef}>
      <Segmented<View2>
        options={[{ key: "stats", label: "Statistiques" }, { key: "entry", label: "Saisie" }]}
        value={view}
        onChange={setView}
      />

      {loading ? (
        <Loading />
      ) : view === "stats" ? (
        <StatsView
          items={items}
          defaultRate={defaultRate}
          onChangeDefaultRate={changeDefaultRate}
          cfg={cfg}
          schedule={schedule}
          openingDate={openingDate}
          onChangeSchedule={changeSchedule}
          onChangeOpeningDate={changeOpeningDate}
        />
      ) : (
        <EntryView profile={profile} items={items} defaultRate={defaultRate} reload={() => { setLoading(true); load(); }} scrollToTop={scrollToTop} />
      )}
    </Screen>
  );
}

// ---------- Vue Statistiques ----------
function StatsView({
  items, defaultRate, onChangeDefaultRate, cfg, schedule, openingDate, onChangeSchedule, onChangeOpeningDate,
}: {
  items: RevenueRow[];
  defaultRate: number;
  onChangeDefaultRate: (r: number) => void;
  cfg: ScheduleCfg;
  schedule: DaySchedule[];
  openingDate: string;
  onChangeSchedule: (s: DaySchedule[]) => void;
  onChangeOpeningDate: (d: string) => void;
}) {
  const [gran, setGran] = useState<Gran>("day");
  const [svcFilter, setSvcFilter] = useState<Service | "all">("all");

  // Priorité au HT : tous les graphiques/moyennes sont en net de TVA. Le TTC est affiché à côté.
  const amount: AmountFn = (r) => revenueHT(r, defaultRate);

  const win = useMemo(() => {
    const from = windowStart(gran);
    const rows = items.filter((r) => r.revenue_date >= from && (svcFilter === "all" || r.service === svcFilter));
    const st = windowStats(rows, amount);
    const caTTC = rows.reduce((s, r) => s + revenueTotal(r), 0);
    const series = caSeries(rows, gran, amount);
    const svc = new Map<string, number>();
    for (const r of rows) svc.set(r.service, (svc.get(r.service) ?? 0) + amount(r));
    const byService = SERVICES.map((s) => ({ label: s.label, value: svc.get(s.key) ?? 0 })).filter((x) => x.value > 0);
    const weekdayAvg = byWeekdayAvg(rows, amount).filter((x) => x.value > 0);
    const tva = rows.reduce((s, r) => s + revenueTVA(r, defaultRate), 0);
    return { st, caTTC, series, byService, weekdayAvg, tva };
  }, [items, gran, svcFilter, defaultRate]);

  const granLabel = GRANS.find((g) => g.key === gran)?.label.toLowerCase() ?? "";
  const { st } = win;

  return (
    <>
      <SectionTitle>Granularité</SectionTitle>
      <Segmented<Gran> options={GRANS} value={gran} onChange={setGran} />

      <SectionTitle>Filtrer par service</SectionTitle>
      <Select<string>
        value={svcFilter}
        options={[{ key: "all", label: "Tous les services" }, ...SERVICES.map((s) => ({ key: s.key, label: s.label }))]}
        onChange={(k) => setSvcFilter(k as Service | "all")}
      />

      {st.count === 0 ? (
        <Empty icon="bar-chart-outline" text="Aucune recette sur cette période." />
      ) : (
        <>
          {/* CA HT prioritaire (= brut), TTC à côté (= net encaissé) */}
          <View style={styles.kpiRow}>
            <Kpi label="CA HT (brut)" value={fmtEUR(st.ca)} tone="good" />
            <Kpi label="CA TTC (net)" value={fmtEUR(win.caTTC)} />
          </View>
          <View style={styles.kpiRow}>
            <Kpi label="TVA collectée" value={fmtEUR(win.tva)} tone="warn" />
            <Kpi label="Couverts" value={String(st.covers)} />
          </View>

          <SectionTitle>Moyennes (HT)</SectionTitle>
          <View style={styles.kpiRow}>
            <Kpi label="CA moyen / jour" value={fmtEUR(st.avgPerDay)} tone="good" />
            <Kpi label="CA moyen / semaine" value={fmtEUR(st.avgPerWeek)} tone="good" />
          </View>
          <View style={styles.kpiRow}>
            <Kpi label="Couverts moyens / jour" value={st.avgCoversPerDay > 0 ? String(Math.round(st.avgCoversPerDay)) : "—"} />
            <Kpi label="Panier moyen / couvert" value={st.covers > 0 ? fmtEUR(st.panier) : "—"} />
          </View>
          {st.bestDay && (
            <Kpi label={`Meilleur jour · ${fmtDate(st.bestDay.date)}`} value={fmtEUR(st.bestDay.value)} tone="good" />
          )}

          <SectionTitle>Évolution du CA HT (par {granLabel})</SectionTitle>
          <Card>
            {win.series.length > 1 ? (
              <LineChart data={win.series} format={fmtEUR} />
            ) : (
              <Text style={styles.muted}>Pas assez de points pour tracer une courbe (au moins 2).</Text>
            )}
          </Card>

          <SectionTitle>CA HT par {granLabel}</SectionTitle>
          <Card>
            <BarList data={[...win.series].reverse()} format={fmtEUR} />
          </Card>

          <SectionTitle>CA HT moyen par jour de semaine</SectionTitle>
          <Card>
            {win.weekdayAvg.length > 0 ? (
              <BarList data={win.weekdayAvg} format={fmtEUR} color={colors.gold} />
            ) : (
              <Text style={styles.muted}>Aucune donnée.</Text>
            )}
          </Card>

          {svcFilter === "all" && (
            <>
              <SectionTitle>Répartition par service (HT)</SectionTitle>
              <Card>
                <BarList data={win.byService} format={fmtEUR} />
              </Card>
            </>
          )}

          <SectionTitle>Moyens d'encaissement (TTC)</SectionTitle>
          <Card>
            <StackBar
              segments={[
                { label: "Espèces", value: st.cash, color: colors.success },
                { label: "CB", value: st.cb, color: colors.primary },
                { label: "Autre", value: st.other, color: colors.gold },
              ]}
            />
            <Text style={[styles.muted, { marginTop: space.sm }]}>
              Esp. {fmtEUR(st.cash)} · CB {fmtEUR(st.cb)} · Autre {fmtEUR(st.other)}
            </Text>
          </Card>
        </>
      )}

      <SectionTitle>TVA par défaut</SectionTitle>
      <Segmented<number>
        options={TVA_RATES.map((r) => ({ key: r, label: `${String(r).replace(".", ",")} %` }))}
        value={defaultRate}
        onChange={onChangeDefaultRate}
      />
      <Text style={styles.muted}>
        Appliqué aux recettes sans taux précis pour estimer le HT. Tu peux fixer un taux par recette à la saisie.
      </Text>

      <ProjectionsCard items={items} amount={amount} basis="ht" cfg={cfg} />

      <ScheduleEditor
        schedule={schedule}
        openingDate={openingDate}
        onChangeSchedule={onChangeSchedule}
        onChangeOpeningDate={onChangeOpeningDate}
      />
    </>
  );
}

// ---------- Éditeur de planning d'ouverture ----------
function ScheduleEditor({
  schedule, openingDate, onChangeSchedule, onChangeOpeningDate,
}: {
  schedule: DaySchedule[];
  openingDate: string;
  onChangeSchedule: (s: DaySchedule[]) => void;
  onChangeOpeningDate: (d: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = servicesPerWeekdayOf(schedule).reduce((a, b) => a + b, 0);

  function toggle(i: number, slot: "midi" | "soir") {
    onChangeSchedule(schedule.map((d, idx) => (idx === i ? { ...d, [slot]: !d[slot] } : d)));
  }

  return (
    <>
      <SectionTitle>Planning d'ouverture</SectionTitle>
      <Card>
        <View style={styles.schedHead}>
          <Text style={styles.muted}>{total} services / semaine · ouverture {fmtDate(openingDate)}</Text>
          <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button">
            <Text style={styles.link}>{open ? "Fermer" : "Modifier"}</Text>
          </Pressable>
        </View>

        {open && (
          <>
            {WEEKDAYS_FULL.map((wd, i) => (
              <View key={wd} style={styles.schedRow}>
                <Text style={styles.schedDay}>{wd}</Text>
                <Pill label="Midi" active={schedule[i].midi} onPress={() => toggle(i, "midi")} />
                <Pill label="Soir" active={schedule[i].soir} onPress={() => toggle(i, "soir")} />
              </View>
            ))}
            <View style={{ gap: 4, marginTop: space.sm }}>
              <Text style={styles.label}>Date d'ouverture</Text>
              <DateField value={openingDate} onChange={onChangeOpeningDate} />
            </View>
            <Text style={styles.muted}>
              Sert au calcul des projections : les services à venir sont comptés selon ce planning, et rien n'est compté avant la date d'ouverture.
            </Text>
          </>
        )}
      </Card>
    </>
  );
}

// ---------- Carte Projections + objectif ----------
function ProjectionsCard({ items, amount, basis, cfg }: { items: RevenueRow[]; amount: AmountFn; basis: Basis; cfg: ScheduleCfg }) {
  const [horizon, setHorizon] = useState<Horizon>("month");
  const [growth, setGrowth] = useState(10);

  useEffect(() => { getGrowthTarget().then(setGrowth); }, []);
  function changeGrowth(delta: number) {
    setGrowth((g) => {
      const next = Math.max(-50, Math.min(200, g + delta));
      setGrowthTarget(next);
      return next;
    });
  }

  const p = useMemo(() => project(items, horizon, growth, amount, cfg), [items, horizon, growth, amount, cfg]);

  const hLabel = HORIZONS.find((h) => h.key === horizon)?.label.toLowerCase() ?? "";
  const onTrack = p.objective <= 0 ? null : p.projected >= p.objective;
  const gapPct = p.objective > 0 ? Math.round(((p.projected - p.objective) / p.objective) * 100) : 0;
  // Échelle commune pour les deux barres (réalisé/projection vs objectif).
  const scale = Math.max(p.projected, p.objective, p.actual, 1);

  return (
    <>
      <SectionTitle>Projection du chiffre d'affaires ({basis === "ht" ? "HT" : "TTC"})</SectionTitle>
      <Segmented<Horizon> options={HORIZONS} value={horizon} onChange={setHorizon} />

      <Card>
        {/* Objectif de croissance */}
        <View style={styles.objRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Objectif de croissance</Text>
            <Text style={styles.muted}>vs {hLabel} précédent{p.prev > 0 ? ` (${fmtEUR(p.prev)})` : ""}</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => changeGrowth(-5)} accessibilityRole="button" accessibilityLabel="Diminuer l'objectif">
              <Ionicons name="remove" size={20} color={colors.text} />
            </Pressable>
            <Text style={styles.stepVal}>{growth > 0 ? "+" : ""}{growth}%</Text>
            <Pressable style={styles.stepBtn} onPress={() => changeGrowth(5)} accessibilityRole="button" accessibilityLabel="Augmenter l'objectif">
              <Ionicons name="add" size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.sep} />

        <Text style={styles.muted}>
          {p.elapsed} services réalisés / {p.total} prévus · réalisé {fmtEUR(p.actual)}
        </Text>

        <ProjBar label="Projection fin de période" value={p.projected} scale={scale} color={colors.primary} />
        <ProjBar label={`Objectif (${growth > 0 ? "+" : ""}${growth}%)`} value={p.objective} scale={scale} color={colors.gold} />

        {onTrack !== null && (
          <View style={[styles.badge, { backgroundColor: onTrack ? colors.successBg : colors.dangerBg }]}>
            <Ionicons name={onTrack ? "trending-up" : "trending-down"} size={16} color={onTrack ? colors.success : colors.danger} />
            <Text style={[styles.badgeText, { color: onTrack ? colors.success : colors.danger }]}>
              {onTrack
                ? `En avance sur l'objectif (+${gapPct}% projeté)`
                : `En retard sur l'objectif (${gapPct}% projeté)`}
            </Text>
          </View>
        )}
        {p.prev <= 0 && (
          <Text style={styles.muted}>Pas d'historique sur le {hLabel} précédent : l'objectif s'affinera avec le temps.</Text>
        )}
      </Card>
    </>
  );
}

function ProjBar({ label, value, scale, color }: { label: string; value: number; scale: number; color: string }) {
  return (
    <View style={{ gap: 4, marginTop: space.sm }}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barVal}>{fmtEUR(value)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(2, (value / scale) * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ---------- Vue Saisie (formulaire + historique + édition) ----------
function EntryView({ profile, items, defaultRate, reload, scrollToTop }: { profile: Profile; items: RevenueRow[]; defaultRate: number; reload: () => void; scrollToTop: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [service, setService] = useState<Service>("soir");
  const [cash, setCash] = useState("");
  const [cb, setCb] = useState("");
  const [other, setOther] = useState("");
  const [covers, setCovers] = useState("");
  const [rate, setRate] = useState<number>(defaultRate);
  const [tvaMode, setTvaMode] = useState<"rate" | "amount">("rate");
  const [tvaManual, setTvaManual] = useState("");

  function resetForm() {
    setEditingId(null);
    setDate(todayISO());
    setService("soir");
    setCash(""); setCb(""); setOther(""); setCovers("");
    setRate(defaultRate);
    setTvaMode("rate"); setTvaManual("");
    setError(null);
  }

  function startEdit(r: RevenueRow) {
    setEditingId(r.id);
    setDate(r.revenue_date);
    setService(r.service);
    setCash(r.amount_cash ? String(r.amount_cash) : "");
    setCb(r.amount_cb ? String(r.amount_cb) : "");
    setOther(r.amount_other ? String(r.amount_other) : "");
    setCovers(r.covers != null ? String(r.covers) : "");
    setRate(r.tva_rate ?? defaultRate);
    setTvaMode(r.tva_amount != null ? "amount" : "rate");
    setTvaManual(r.tva_amount != null ? String(r.tva_amount) : "");
    setError(null);
    scrollToTop(); // remonte vers le formulaire pour montrer qu'on édite
  }

  // Aperçu HT / TVA en direct : TVA saisie manuellement, ou calculée depuis le taux.
  const totalTTC = parseAmount(cash) + parseAmount(cb) + parseAmount(other);
  const previewTVA = tvaMode === "amount" ? parseAmount(tvaManual) : totalTTC - totalTTC / (1 + rate / 100);
  const previewHT = totalTTC - previewTVA;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const fields = {
        revenue_date: date,
        service,
        amount_cash: parseAmount(cash),
        amount_cb: parseAmount(cb),
        amount_other: parseAmount(other),
        covers: covers ? Math.round(parseAmount(covers)) : null,
        tva_rate: tvaMode === "rate" ? rate : null,
        tva_amount: tvaMode === "amount" ? parseAmount(tvaManual) : null,
      };
      if (editingId) await updateRevenue(editingId, fields);
      else await upsertRevenue({ establishment_id: profile.establishment_id, note: null, created_by: profile.id, ...fields });
      resetForm();
      reload();
    } catch (e: unknown) {
      const msg = String((e as Error).message ?? e);
      setError(msg.includes("duplicate") || msg.includes("unique")
        ? "Une recette existe déjà pour cette date et ce service."
        : msg);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    setSaving(true);
    try {
      await deleteRevenue(editingId);
      resetForm();
      reload();
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <SectionTitle>{editingId ? "Modifier la recette" : "Saisir une recette"}</SectionTitle>
        <View style={styles.row}>
          <Field label="Date" flex>
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Couverts" flex>
            <TextInput style={styles.input} value={covers} onChangeText={setCovers} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
          </Field>
        </View>
        <Segmented<Service> options={SERVICES} value={service} onChange={setService} />
        <View style={styles.row}>
          <Field label="Espèces €" flex>
            <TextInput style={styles.input} value={cash} onChangeText={setCash} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
          <Field label="CB €" flex>
            <TextInput style={styles.input} value={cb} onChangeText={setCb} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
          <Field label="Autre €" flex>
            <TextInput style={styles.input} value={other} onChangeText={setOther} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </Field>
        </View>

        <Field label="TVA collectée">
          <Segmented<"rate" | "amount">
            options={[{ key: "rate", label: "Par taux" }, { key: "amount", label: "Montant €" }]}
            value={tvaMode}
            onChange={setTvaMode}
          />
        </Field>
        {tvaMode === "rate" ? (
          <Segmented<number>
            options={TVA_RATES.map((r) => ({ key: r, label: `${String(r).replace(".", ",")} %` }))}
            value={rate}
            onChange={setRate}
          />
        ) : (
          <Field label="Montant de TVA collectée (€)">
            <TextInput style={styles.input} value={tvaManual} onChangeText={setTvaManual} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
          </Field>
        )}
        {totalTTC > 0 && (
          <View style={styles.tvaPreview}>
            <Text style={styles.tvaPreviewStrong}>Brut (HT) {fmtEUR(previewHT)}</Text>
            <Text style={styles.muted}>+ TVA {fmtEUR(previewTVA)}</Text>
            <Text style={styles.tvaPreviewStrong}>= Net (TTC) {fmtEUR(totalTTC)}</Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={save} disabled={saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name={editingId ? "save-outline" : "add"} size={20} color={colors.white} />
              <Text style={styles.btnText}>{editingId ? "Enregistrer les modifications" : "Enregistrer la recette"}</Text>
            </>
          )}
        </Pressable>

        {editingId && (
          <View style={styles.editActions}>
            <Pressable style={[styles.smallBtn, styles.ghostBtn]} onPress={resetForm} disabled={saving} accessibilityRole="button">
              <Text style={styles.ghostText}>Annuler</Text>
            </Pressable>
            <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={remove} disabled={saving} accessibilityRole="button">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.dangerText}>Supprimer</Text>
            </Pressable>
          </View>
        )}
      </Card>

      <SectionTitle>Historique</SectionTitle>
      <Text style={styles.muted}>Touchez une recette pour la modifier (date, service, journée, montants, TVA) ou la supprimer.</Text>
      {items.length === 0 ? (
        <Empty icon="cash-outline" text="Aucune recette saisie." />
      ) : (
        items.map((r) => (
          <Pressable key={r.id} onPress={() => startEdit(r)} accessibilityRole="button" accessibilityLabel="Modifier cette recette" style={({ pressed }) => pressed && { opacity: 0.9 }}>
            <Card style={editingId === r.id ? styles.editingCard : undefined}>
              <View style={styles.lineRow}>
                <Text style={styles.name}>{fmtDate(r.revenue_date)} · {SERVICES.find((s) => s.key === r.service)?.label ?? r.service}</Text>
                <Text style={styles.amount}>{fmtEUR(revenueTotal(r))}</Text>
              </View>
              <View style={styles.lineRow}>
                <Text style={styles.meta}>
                  HT {fmtEUR(revenueHT(r, defaultRate))} · TVA {fmtEUR(revenueTVA(r, defaultRate))}
                  {r.tva_amount != null ? " (saisie)" : ""}
                  {r.covers != null ? ` · ${r.covers} couv.` : ""}
                </Text>
                <Ionicons name="create-outline" size={16} color={colors.secondary} />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={[{ gap: 4 }, flex && { flex: 1 }]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: space.sm },
  basisRow: { flexDirection: "row", gap: space.sm },
  periodRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tvaPreview: { flexDirection: "row", flexWrap: "wrap", gap: space.md, alignItems: "baseline", paddingVertical: space.xs },
  tvaPreviewStrong: { ...type.title, color: colors.text },
  schedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  link: { ...type.small, color: colors.primary, fontWeight: "600" },
  schedRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 },
  schedDay: { ...type.body, color: colors.text, flex: 1 },
  kpiRow: { flexDirection: "row", gap: space.md },
  muted: { ...type.small, color: colors.textMuted },
  row: { flexDirection: "row", gap: space.md },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  label: { ...type.label, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TOUCH, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  btn: { minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm, marginTop: space.xs },
  btnText: { ...type.title, color: colors.white },
  error: { ...type.small, color: colors.danger },
  editActions: { flexDirection: "row", gap: space.sm },
  smallBtn: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.xs },
  ghostBtn: { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border },
  ghostText: { ...type.title, color: colors.text },
  dangerBtn: { backgroundColor: colors.dangerBg },
  dangerText: { ...type.title, color: colors.danger },
  editingCard: { borderWidth: 2, borderColor: colors.primary },
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  name: { ...type.title, color: colors.text },
  amount: { ...type.title, color: colors.success },
  meta: { ...type.small, color: colors.textMuted, flex: 1 },
  // projections
  objRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.chipBg, borderRadius: radius.pill, padding: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  stepVal: { ...type.title, color: colors.text, minWidth: 48, textAlign: "center" },
  sep: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 10, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 10, borderRadius: radius.pill },
  badge: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.md, marginTop: space.sm },
  badgeText: { ...type.small, fontWeight: "600", flex: 1 },
});
