// Tableau de bord : totaux + camembert par catégorie + top fournisseurs.

import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";
import { fetchExpenses, type ExpenseListItem } from "../lib/queries";
import { fmtEUR, startOfMonthISO, todayISO } from "../lib/format";

const COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#d97706", "#7c3aed", "#db2777", "#475569", "#0d9488"];

export function Dashboard() {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetchExpenses({ from: startOfMonthISO(), to: todayISO() })
      .then(setExpenses)
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const total = expenses.reduce((s, e) => s + Number(e.amount_ttc), 0);
    const reimbursable = expenses
      .filter((e) => e.reimbursable && !e.reimbursed)
      .reduce((s, e) => s + Number(e.amount_ttc), 0);
    return { total, reimbursable, count: expenses.length };
  }, [expenses]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.category?.label ?? "Sans catégorie";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const k = e.supplier?.name ?? "—";
      map.set(k, (map.get(k) ?? 0) + Number(e.amount_ttc));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [expenses]);

  if (loading) return <div className="dashboard-page"><h1>Tableau de bord</h1><p>Chargement…</p></div>;

  return (
    <div className="dashboard-page">
      <h1>Tableau de bord — mois en cours</h1>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Total dépenses</div>
          <div className="kpi-value">{fmtEUR(totals.total)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Notes de frais à rembourser</div>
          <div className="kpi-value warn">{fmtEUR(totals.reimbursable)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Nombre de dépenses</div>
          <div className="kpi-value">{totals.count}</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="card">
          <h2>Par catégorie</h2>
          {byCategory.length === 0 ? (
            <p className="muted">Aucune dépense pour l'instant.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={100} label>
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtEUR(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Top fournisseurs</h2>
          {topSuppliers.length === 0 ? (
            <p className="muted">Aucun fournisseur pour l'instant.</p>
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
    </div>
  );
}
