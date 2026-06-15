// Page « À payer » : factures avec une échéance, non réglées.
// KPIs trésorerie (total / en retard / sous 7 j) + échéancier avec « Marquer payée ».

import { useEffect, useState } from "react";
import { fetchPayables, setExpensePaid, type ExpenseListItem } from "../lib/queries";
import { fmtEUR, fmtDate, todayISO } from "../lib/format";

function plusDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysUntil(iso: string): number {
  const parts = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function Payable() {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchPayables().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function markPaid(e: ExpenseListItem) {
    setBusy(e.id);
    try {
      await setExpensePaid(e.id, true);
      setItems((prev) => prev.filter((it) => it.id !== e.id));
    } finally {
      setBusy(null);
    }
  }

  const today = todayISO();
  const in7 = plusDaysISO(7);
  const sum = (arr: ExpenseListItem[]) => arr.reduce((s, e) => s + Number(e.amount_ttc || 0), 0);
  const overdue = items.filter((e) => (e.due_date ?? "") < today);
  const week = items.filter((e) => (e.due_date ?? "") >= today && (e.due_date ?? "") <= in7);

  return (
    <div className="payable-page">
      <h1>À payer</h1>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="muted">Aucune facture à échéance en attente. 🎉</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Total à payer</div>
              <div className="kpi-value warn">{fmtEUR(sum(items))}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">En retard</div>
              <div className={`kpi-value ${overdue.length ? "warn" : ""}`}>{fmtEUR(sum(overdue))}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">À payer sous 7 jours</div>
              <div className="kpi-value">{fmtEUR(sum(week))}</div>
            </div>
          </div>

          <h2>Échéancier</h2>
          <div className="table-wrap">
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th>Échéance</th>
                  <th>N° facture</th>
                  <th>Statut</th>
                  <th className="num">TTC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const dd = e.due_date ?? "";
                  const n = daysUntil(dd);
                  const late = n < 0;
                  const soon = n >= 0 && n <= 3;
                  const tag = late ? `En retard de ${-n} j` : n === 0 ? "Aujourd'hui" : `Dans ${n} j`;
                  const tagClass = late ? "danger" : soon ? "warn-text" : "muted";
                  return (
                    <tr key={e.id} className={late ? "row-late" : undefined}>
                      <td><b>{e.supplier?.name ?? "Sans fournisseur"}</b></td>
                      <td>{fmtDate(dd)}</td>
                      <td>{e.invoice_number ?? "—"}</td>
                      <td><span className={tagClass}>{tag}</span></td>
                      <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                      <td>
                        <button className="primary" disabled={busy !== null} onClick={() => markPaid(e)}>
                          {busy === e.id ? "…" : "✓ Marquer payée"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
