// Onglet « Factures » : récap des factures fournisseurs — payées vs reste à payer,
// avec totaux, statut de pointage bancaire, et accès direct au rapprochement.

import { useEffect, useMemo, useState } from "react";
import { fetchInvoices, setExpensePaid, type ExpenseListItem } from "../lib/queries";
import { fmtEUR, fmtDate } from "../lib/format";

type Tab = "topay" | "paid";

export function Invoices({ onGoReconcile }: { onGoReconcile?: () => void }) {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("topay");

  function load() {
    setLoading(true);
    fetchInvoices().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function togglePaid(e: ExpenseListItem, paid: boolean) {
    setBusy(e.id);
    try {
      await setExpensePaid(e.id, paid);
      setItems((prev) => prev.map((it) => (it.id === e.id ? { ...it, paid } : it)));
    } finally {
      setBusy(null);
    }
  }

  const toPay = useMemo(() => items.filter((e) => !e.paid), [items]);
  const paid = useMemo(() => items.filter((e) => e.paid), [items]);
  const sum = (arr: ExpenseListItem[]) => arr.reduce((s, e) => s + Number(e.amount_ttc || 0), 0);
  const rows = tab === "topay" ? toPay : paid;

  return (
    <div className="invoices-page">
      <div className="todos-head">
        <h1>Factures</h1>
        {onGoReconcile && (
          <button className="primary" onClick={onGoReconcile}>🏦 Rapprochement bancaire</button>
        )}
      </div>
      <p className="muted">Récap des factures fournisseurs. Le rapprochement bancaire (importer un relevé) bascule automatiquement les factures retrouvées en « payée ».</p>

      <div className="kpis" style={{ marginBottom: "1rem" }}>
        <div className="kpi"><div className="kpi-label">Reste à payer</div><div className="kpi-value warn">{fmtEUR(sum(toPay))}</div></div>
        <div className="kpi"><div className="kpi-label">Payées</div><div className="kpi-value">{fmtEUR(sum(paid))}</div></div>
        <div className="kpi"><div className="kpi-label">Total factures</div><div className="kpi-value">{fmtEUR(sum(items))}</div></div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "topay" ? "active" : ""}`} onClick={() => setTab("topay")}>
          À payer ({toPay.length})
        </button>
        <button className={`tab ${tab === "paid" ? "active" : ""}`} onClick={() => setTab("paid")}>
          Payées ({paid.length})
        </button>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{tab === "topay" ? "Aucune facture en attente de paiement. 🎉" : "Aucune facture payée pour l'instant."}</p>
      ) : (
        <div className="table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Date</th>
                <th>Échéance</th>
                <th>N° facture</th>
                <th>Pointée banque</th>
                <th className="num">TTC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><b>{e.supplier?.name ?? "Sans fournisseur"}</b></td>
                  <td>{fmtDate(e.expense_date)}</td>
                  <td>{e.due_date ? fmtDate(e.due_date) : "—"}</td>
                  <td>{e.invoice_number ?? "—"}</td>
                  <td>
                    {e.reconciled
                      ? <span className="badge ok">pointée</span>
                      : <span className="badge warn">non pointée</span>}
                  </td>
                  <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                  <td>
                    {tab === "topay" ? (
                      <button className="primary" disabled={busy !== null} onClick={() => togglePaid(e, true)}>
                        {busy === e.id ? "…" : "✓ Marquer payée"}
                      </button>
                    ) : (
                      <button className="link danger" disabled={busy !== null} onClick={() => togglePaid(e, false)}>
                        {busy === e.id ? "…" : "↶ Remettre à payer"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
