// Page Recettes : saisie du CA par service + stats clés.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Profile } from "@resto/shared";
import {
  fetchRevenues, upsertRevenue, deleteRevenue, totalOf,
  type RevenueRow, type Service,
} from "../lib/revenues";
import { fetchBankCredits, classifyCredit, type BankCreditRow } from "../lib/queries";
import { supabase } from "../supabaseClient";
import { fmtEUR, fmtDate, todayISO, startOfMonthISO } from "../lib/format";

interface Props { profile: Profile; }

const SERVICES: Array<{ key: Service; label: string }> = [
  { key: "midi",    label: "Midi" },
  { key: "soir",    label: "Soir" },
  { key: "journee", label: "Journée" },
  { key: "autre",   label: "Autre" },
];

// Montant signé avec « + » explicite (les écarts se lisent mieux ainsi).
function fmtSigned(v: number): string {
  const s = fmtEUR(Math.abs(v));
  if (Math.abs(v) < 0.5) return "≈ 0";
  return (v > 0 ? "+" : "−") + s;
}

// Couleur d'un écart. Pour les espèces, un déficit (déposé < déclaré) est normal → neutre ;
// un excédent est plus suspect. Pour la carte, tout écart marqué est signalé en orange.
function ecartColor(v: number, isCash = false): string {
  const a = Math.abs(v);
  if (a < 5) return "#16a34a";                 // quasi nul → vert
  if (isCash && v < 0) return "#6b7280";       // moins déposé que déclaré → normal, gris
  if (a < 50) return "#6b7280";
  return "#d97706";                            // écart notable → orange
}

export function Revenues({ profile }: Props) {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo]     = useState(todayISO());
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [credits, setCredits] = useState<BankCreditRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Saisie rapide
  const [date, setDate]         = useState(todayISO());
  const [service, setService]   = useState<Service>("soir");
  const [cash, setCash]         = useState("");
  const [cb, setCb]             = useState("");
  const [other, setOther]       = useState("");
  const [tva, setTva]           = useState("");
  const [covers, setCovers]     = useState("");
  const [tables, setTables]     = useState("");
  const [note, setNote]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        fetchRevenues({ from, to }),
        fetchBankCredits(from, to).catch(() => [] as BankCreditRow[]),
      ]);
      setRows(r);
      setCredits(c);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { reload(); }, [reload]);

  // Temps réel : dès qu'une recette change (autre appareil), on recharge.
  useEffect(() => {
    const ch = supabase
      .channel("rt-revenues")
      .on("postgres_changes", { event: "*", schema: "public", table: "revenues" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await upsertRevenue({
        establishment_id: profile.establishment_id,
        revenue_date:     date,
        service,
        amount_cash:      Number(cash || 0),
        amount_cb:        Number(cb || 0),
        amount_other:     Number(other || 0),
        tva_amount:       tva ? Number(tva) : null,
        covers:           covers  ? Number(covers)  : null,
        tables_count:     tables  ? Number(tables)  : null,
        note:             note.trim() || null,
        created_by:       profile.id,
      });
      setMsg(`✅ Service ${service} du ${fmtDate(date)} enregistré`);
      setCash(""); setCb(""); setOther(""); setTva("");
      setCovers(""); setTables(""); setNote("");
      await reload();
    } catch (e: unknown) {
      setMsg("⚠ " + String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r: RevenueRow) {
    if (!confirm(`Supprimer la recette ${r.service} du ${fmtDate(r.revenue_date)} ?`)) return;
    await deleteRevenue(r.id);
    await reload();
  }

  // ----------- Stats -----------
  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + totalOf(r), 0);
    const cash  = rows.reduce((s, r) => s + Number(r.amount_cash), 0);
    const cb    = rows.reduce((s, r) => s + Number(r.amount_cb), 0);
    const other = rows.reduce((s, r) => s + Number(r.amount_other), 0);
    const covers = rows.reduce((s, r) => s + (r.covers ?? 0), 0);
    const tables = rows.reduce((s, r) => s + (r.tables_count ?? 0), 0);
    const tva = rows.reduce((s, r) => s + Number(r.tva_amount ?? 0), 0);
    const ht = total - tva;
    const panierMoyen = covers > 0 ? total / covers : null;
    const ticketParTable = tables > 0 ? total / tables : null;

    // Midi vs Soir
    const midi = rows.filter((r) => r.service === "midi").reduce((s, r) => s + totalOf(r), 0);
    const soir = rows.filter((r) => r.service === "soir").reduce((s, r) => s + totalOf(r), 0);

    return { total, cash, cb, other, covers, tables, tva, ht, panierMoyen, ticketParTable, midi, soir };
  }, [rows]);

  // Evolution par jour
  const byDay = useMemo(() => {
    const map = new Map<string, { date: string; total: number; midi: number; soir: number }>();
    for (const r of rows) {
      const cur = map.get(r.revenue_date) ?? { date: r.revenue_date, total: 0, midi: 0, soir: 0 };
      const t = totalOf(r);
      cur.total += t;
      if (r.service === "midi") cur.midi += t;
      if (r.service === "soir") cur.soir += t;
      map.set(r.revenue_date, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const paymentMix = [
    { name: "Espèces", value: stats.cash },
    { name: "CB",      value: stats.cb },
    { name: "Autre",   value: stats.other },
  ].filter((x) => x.value > 0);

  // ----------- Contrôle recettes (déclaré vs encaissé en banque) -----------
  const bankCheck = useMemo(() => {
    let carte = 0, especes = 0, autre = 0;
    for (const c of credits) {
      const k = classifyCredit(c.label);
      const a = Number(c.amount) || 0;
      if (k === "carte") carte += a;
      else if (k === "especes") especes += a;
      else autre += a;
    }
    const encaisse = carte + especes + autre;
    // Les remises CB sont créditées NETTES de commission ; le CB déclaré est le brut
    // encaissé au client. La différence (si le net est inférieur) ≈ commission bancaire.
    const commissionCarte = stats.cb - carte;
    return {
      hasData: credits.length > 0,
      carte, especes, autre, encaisse, commissionCarte,
      // Écarts : encaissé − déclaré. Positif = plus reçu en banque que déclaré.
      ecartCarte: carte - stats.cb,
      ecartEspeces: especes - stats.cash,
      ecartTotal: encaisse - stats.total,
    };
  }, [credits, stats.cb, stats.cash, stats.total]);

  return (
    <div className="revenues-page">
      <h1>Recettes</h1>

      {/* Saisie rapide */}
      <form className="card revenue-form" onSubmit={onSubmit}>
        <h2>Saisir un service</h2>
        <div className="grid-2">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Service
            <select value={service} onChange={(e) => setService(e.target.value as Service)}>
              {SERVICES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label>
            CB (€)
            <input type="number" step="0.01" value={cb} onChange={(e) => setCb(e.target.value)} placeholder="0" />
          </label>
          <label>
            Espèces (€)
            <input type="number" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
          </label>
          <label>
            Autre — chèque, ticket resto… (€)
            <input type="number" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" />
          </label>
          <label>
            TVA perçue (€)
            <input type="number" step="0.01" value={tva} onChange={(e) => setTva(e.target.value)} placeholder="collectée sur le service" />
          </label>
          <label>
            Couverts (nb clients)
            <input type="number" value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="0" />
          </label>
          <label>
            Tables servies
            <input type="number" value={tables} onChange={(e) => setTables(e.target.value)} placeholder="0" />
          </label>
          <label className="full">
            Note (météo, événement, soirée privée…)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optionnel" />
          </label>
        </div>
        <div className="form-total">
          Total saisi : <b>{fmtEUR(Number(cash || 0) + Number(cb || 0) + Number(other || 0))}</b>
        </div>
        <button className="primary big" type="submit" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer le service"}
        </button>
        {msg && <div className="hint" style={{ marginTop: "0.5rem" }}>{msg}</div>}
      </form>

      {/* Filtres période */}
      <div className="filters" style={{ marginTop: "1.5rem" }}>
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="link" onClick={() => reload()}>↻ Rafraîchir</button>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">CA total (TTC)</div><div className="kpi-value">{fmtEUR(stats.total)}</div></div>
        <div className="kpi"><div className="kpi-label">CA HT</div><div className="kpi-value">{fmtEUR(stats.ht)}</div></div>
        <div className="kpi"><div className="kpi-label">TVA collectée</div><div className="kpi-value">{stats.tva > 0 ? fmtEUR(stats.tva) : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Couverts</div><div className="kpi-value">{stats.covers}</div></div>
        <div className="kpi">
          <div className="kpi-label">Panier moyen</div>
          <div className="kpi-value">{stats.panierMoyen != null ? fmtEUR(stats.panierMoyen) : "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ticket / table</div>
          <div className="kpi-value">{stats.ticketParTable != null ? fmtEUR(stats.ticketParTable) : "—"}</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="card">
          <h2>Évolution quotidienne</h2>
          {byDay.length === 0 ? <p className="muted">Aucune recette sur la période.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byDay}>
                <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} />
                <YAxis tickFormatter={(v) => `${v}€`} />
                <Tooltip formatter={(v: number) => fmtEUR(v)} labelFormatter={(l) => fmtDate(l as string)} />
                <Bar dataKey="midi" stackId="ca" fill="#fbbf24" name="Midi" />
                <Bar dataKey="soir" stackId="ca" fill="#2563eb" name="Soir" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h2>Répartition CB / Espèces / Autre</h2>
          {paymentMix.length === 0 ? <p className="muted">Aucune donnée.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={paymentMix} dataKey="value" nameKey="name" outerRadius={100} label>
                  {paymentMix.map((_, i) => (
                    <Cell key={i} fill={["#16a34a", "#2563eb", "#9ca3af"][i % 3]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtEUR(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Contrôle recettes : déclaré (app) vs encaissé (banque) */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Contrôle des recettes (déclaré vs encaissé en banque)</h2>
        {!bankCheck.hasData ? (
          <p className="muted">
            Aucun encaissement bancaire importé sur cette période. Importe le relevé qui couvre
            ces dates depuis <b>Rapprochement bancaire</b> : les crédits (remises carte, dépôts
            d'espèces) apparaîtront ici pour être comparés à ce que tu as saisi.
          </p>
        ) : (
          <>
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="num">Déclaré (app)</th>
                  <th className="num">Encaissé (banque)</th>
                  <th className="num">Écart</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Carte (CB)</td>
                  <td className="num">{fmtEUR(stats.cb)}</td>
                  <td className="num">{fmtEUR(bankCheck.carte)}</td>
                  <td className="num" style={{ color: ecartColor(bankCheck.ecartCarte) }}>
                    {fmtSigned(bankCheck.ecartCarte)}
                  </td>
                </tr>
                {bankCheck.commissionCarte > 1 && (
                  <tr style={{ fontSize: "0.85em", color: "#6b7280" }}>
                    <td style={{ paddingLeft: "1.5rem" }}>↳ dont commission carte (retenue banque)</td>
                    <td className="num">—</td>
                    <td className="num">−{fmtEUR(bankCheck.commissionCarte)}</td>
                    <td className="num muted">{stats.cb > 0 ? `${(bankCheck.commissionCarte / stats.cb * 100).toFixed(2)} %` : "—"}</td>
                  </tr>
                )}
                <tr>
                  <td>Espèces</td>
                  <td className="num">{fmtEUR(stats.cash)}</td>
                  <td className="num">{fmtEUR(bankCheck.especes)} <span className="muted">(déposées)</span></td>
                  <td className="num" style={{ color: ecartColor(bankCheck.ecartEspeces, true) }}>
                    {fmtSigned(bankCheck.ecartEspeces)}
                  </td>
                </tr>
                {bankCheck.autre > 0 && (
                  <tr>
                    <td>Autres crédits <span className="muted">(virements reçus…)</span></td>
                    <td className="num">{stats.other > 0 ? fmtEUR(stats.other) : "—"}</td>
                    <td className="num">{fmtEUR(bankCheck.autre)}</td>
                    <td className="num muted">—</td>
                  </tr>
                )}
                <tr style={{ fontWeight: 700, borderTop: "2px solid #d1d5db" }}>
                  <td>Total</td>
                  <td className="num">{fmtEUR(stats.total)}</td>
                  <td className="num">{fmtEUR(bankCheck.encaisse)}</td>
                  <td className="num" style={{ color: ecartColor(bankCheck.ecartTotal) }}>
                    {fmtSigned(bankCheck.ecartTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="hint" style={{ marginTop: "0.75rem" }}>
              <b>Carte :</b> les remises sont créditées <i>nettes de commission</i> (ligne « dont commission » ci-dessus).
              L'écart restant vient du décalage d'encaissement (remises à J+1/J+2, celles de fin de période créditées
              après). Sur un mois complet, hors commission, il doit être proche de 0. Un écart bien plus grand que la
              commission = un service non saisi.<br />
              <b>Espèces :</b> l'app compte les espèces <i>encaissées au service</i>, la banque ne voit que
              celles <i>déposées</i>. Un dépôt est en général inférieur (fond de caisse, dépôts espacés) ;
              un écart anormal signale des espèces non déposées.<br />
              <b>TVA collectée sur la période :</b> {stats.tva > 0 ? fmtEUR(stats.tva) : "— (non saisie)"} · CA HT {fmtEUR(stats.ht)}.
            </p>
          </>
        )}
      </div>

      {/* Historique */}
      <div className="table-wrap" style={{ marginTop: "1.5rem" }}>
        <h2 style={{ padding: "0.75rem 0.75rem 0" }}>Historique</h2>
        <table className="exp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th className="num">CB</th>
              <th className="num">Espèces</th>
              <th className="num">Autre</th>
              <th className="num">Total</th>
              <th className="num">TVA</th>
              <th className="num">Couverts</th>
              <th className="num">P. moyen</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="muted">Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="muted">Aucune recette saisie.</td></tr>
            ) : rows.map((r) => {
              const t = totalOf(r);
              const pm = r.covers && r.covers > 0 ? t / r.covers : null;
              return (
                <tr key={r.id}>
                  <td>{fmtDate(r.revenue_date)}</td>
                  <td>{SERVICES.find((s) => s.key === r.service)?.label}</td>
                  <td className="num">{fmtEUR(Number(r.amount_cb))}</td>
                  <td className="num">{fmtEUR(Number(r.amount_cash))}</td>
                  <td className="num">{Number(r.amount_other) ? fmtEUR(Number(r.amount_other)) : "—"}</td>
                  <td className="num"><b>{fmtEUR(t)}</b></td>
                  <td className="num">{r.tva_amount != null ? fmtEUR(Number(r.tva_amount)) : "—"}</td>
                  <td className="num">{r.covers ?? "—"}</td>
                  <td className="num">{pm != null ? fmtEUR(pm) : "—"}</td>
                  <td>{r.note ?? ""}</td>
                  <td><button className="link danger" onClick={() => onDelete(r)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
