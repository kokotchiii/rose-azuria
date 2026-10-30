// Tableau de bord — RÉSULTAT RÉEL : recettes vs dépenses par type, avec filtre
// de période. Les recettes viennent de Lightspeed (auto), les dépenses de ce
// qui a été saisi/importé. Résultat = encaissements − dépenses.

import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";
import { fetchExpenses, type ExpenseListItem } from "../lib/queries";
import { fetchRevenues, type RevenueRow } from "../lib/revenues";
import { fmtEUR } from "../lib/format";

const COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#d97706", "#7c3aed", "#db2777", "#475569", "#0d9488"];

type PeriodKey = "mois" | "mois-1" | "90j" | "tout";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "mois",   label: "Ce mois" },
  { key: "mois-1", label: "Mois dernier" },
  { key: "90j",    label: "90 jours" },
  { key: "tout",   label: "Depuis l'ouverture" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(p: PeriodKey): { from: string; to: string; label: string } {
  const now = new Date();
  const to = iso(now);
  if (p === "mois") {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to, label: "ce mois-ci" };
  }
  if (p === "mois-1") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(first), to: iso(last), label: "le mois dernier" };
  }
  if (p === "90j") {
    const f = new Date(now); f.setDate(f.getDate() - 90);
    return { from: iso(f), to, label: "sur 90 jours" };
  }
  return { from: "2026-06-01", to, label: "depuis l'ouverture" };
}

const revTTC = (r: RevenueRow) => Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);

export function Dashboard() {
  const [period, setPeriod]     = useState<PeriodKey>("mois");
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [loading, setLoading]   = useState(true);

  const range = useMemo(() => rangeFor(period), [period]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchExpenses({ from: range.from, to: range.to }),
      fetchRevenues({ from: range.from, to: range.to }),
    ])
      .then(([exp, rev]) => { setExpenses(exp); setRevenues(rev); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const totals = useMemo(() => {
    const depenses = expenses.reduce((s, e) => s + Number(e.amount_ttc), 0);
    const recettes = revenues.reduce((s, r) => s + revTTC(r), 0);
    const tvaCollectee = revenues.reduce((s, r) => s + Number(r.tva_amount ?? 0), 0);
    const couverts = revenues.reduce((s, r) => s + (r.covers ?? 0), 0);
    const reimbursable = expenses.filter((e) => e.reimbursable && !e.reimbursed).reduce((s, e) => s + Number(e.amount_ttc), 0);
    return {
      depenses, recettes, resultat: recettes - depenses, tvaCollectee, couverts,
      reimbursable, ticket: couverts > 0 ? recettes / couverts : 0,
    };
  }, [expenses, revenues]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.category?.label ?? "Sans catégorie";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, pct: totals.recettes > 0 ? value / totals.recettes : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [expenses, totals.recettes]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.supplier?.name ?? "—";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [expenses]);

  const resultatPositif = totals.resultat >= 0;

  return (
    <div className="dashboard-page">
      <h1>Tableau de bord — résultat réel</h1>

      {/* Filtre de période */}
      <div className="tabs" style={{ marginBottom: "1rem" }}>
        {PERIODS.map((p) => (
          <button key={p.key} className={`tab ${period === p.key ? "active" : ""}`} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          {/* Résultat : recettes − dépenses */}
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">💰 Recettes ({range.label})</div>
              <div className="kpi-value">{fmtEUR(totals.recettes)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">💸 Dépenses</div>
              <div className="kpi-value">{fmtEUR(totals.depenses)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{resultatPositif ? "✅ Résultat" : "⚠️ Résultat"}</div>
              <div className="kpi-value" style={{ color: resultatPositif ? "var(--primary)" : "var(--error)" }}>
                {resultatPositif ? "+" : ""}{fmtEUR(totals.resultat)}
              </div>
            </div>
          </div>

          <div className="kpis" style={{ marginTop: "0.5rem" }}>
            <div className="kpi"><div className="kpi-label">Couverts</div><div className="kpi-value">{totals.couverts || "—"}</div></div>
            <div className="kpi"><div className="kpi-label">Ticket moyen</div><div className="kpi-value">{totals.ticket > 0 ? fmtEUR(totals.ticket) : "—"}</div></div>
            <div className="kpi"><div className="kpi-label">TVA collectée</div><div className="kpi-value">{fmtEUR(totals.tvaCollectee)}</div></div>
            <div className="kpi"><div className="kpi-label">Notes de frais à rembourser</div><div className="kpi-value warn">{fmtEUR(totals.reimbursable)}</div></div>
          </div>

          <div className="hint" style={{ margin: "0.5rem 0 1.25rem" }}>
            Résultat = encaissements (recettes Lightspeed) − dépenses saisies/importées, {range.label}.
            Le % indiqué par catégorie, c'est la part de chaque poste dans ton chiffre d'affaires.
          </div>

          {/* Dépenses par type (clair, avec % du CA) */}
          <h2>Dépenses par type</h2>
          <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
            <table className="exp-table">
              <thead>
                <tr><th>Poste</th><th className="num">Montant</th><th className="num">% du CA</th></tr>
              </thead>
              <tbody>
                {byCategory.length === 0 ? (
                  <tr><td colSpan={3} className="muted">Aucune dépense sur la période.</td></tr>
                ) : byCategory.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="num">{fmtEUR(c.value)}</td>
                    <td className="num">{totals.recettes > 0 ? `${Math.round(c.pct * 100)} %` : "—"}</td>
                  </tr>
                ))}
                {byCategory.length > 0 && (
                  <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #ddd)" }}>
                    <td>Total dépenses</td>
                    <td className="num">{fmtEUR(totals.depenses)}</td>
                    <td className="num">{totals.recettes > 0 ? `${Math.round((totals.depenses / totals.recettes) * 100)} %` : "—"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="charts-grid">
            <div className="card">
              <h2>Répartition des dépenses</h2>
              {byCategory.length === 0 ? (
                <p className="muted">Aucune dépense sur la période.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={100} label>
                      {byCategory.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtEUR(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card">
              <h2>Top fournisseurs</h2>
              {topSuppliers.length === 0 ? (
                <p className="muted">Aucun fournisseur sur la période.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topSuppliers} layout="vertical">
                    <XAxis type="number" tickFormatter={(v) => fmtEUR(v)} />
                    <YAxis type="category" dataKey="name" width={120} />
                    <Tooltip formatter={(v: number) => fmtEUR(v)} />
                    <Bar dataKey="value" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
