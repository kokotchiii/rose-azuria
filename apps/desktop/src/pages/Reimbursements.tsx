// Page « Notes de frais » : onglets À rembourser / Historique, regroupé par payeur.
// Total, bouton « Tout rembourser » par payeur + par dépense.

import { useCallback, useEffect, useState } from "react";
import {
  fetchPendingReimbursements,
  fetchReimbursedHistory,
  setExpenseReimbursed,
  settlePayer,
  type PayerReimbursement,
} from "../lib/queries";
import { fmtEUR, fmtDate } from "../lib/format";

type Tab = "pending" | "history";

export function Reimbursements() {
  const [tab, setTab] = useState<Tab>("pending");
  const [groups, setGroups] = useState<PayerReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      const data = which === "pending" ? await fetchPendingReimbursements() : await fetchReimbursedHistory();
      setGroups(data);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  async function onSettleItem(expenseId: string, reimbursed: boolean) {
    setBusy(expenseId);
    try {
      await setExpenseReimbursed(expenseId, reimbursed);
      await load(tab);
    } finally {
      setBusy(null);
    }
  }

  async function onSettlePayer(payerId: string) {
    setBusy(payerId);
    try {
      await settlePayer(payerId);
      await load(tab);
    } finally {
      setBusy(null);
    }
  }

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div className="reimbursements-page">
      <h1>Notes de frais</h1>

      <div className="tabs">
        <button className={`tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
          À rembourser
        </button>
        <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          Historique
        </button>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : groups.length === 0 ? (
        <p className="muted">
          {tab === "pending" ? "Aucun remboursement en attente. 🎉" : "Aucun remboursement archivé."}
        </p>
      ) : (
        <>
          {tab === "pending" && (
            <div className="totals-bar">
              <span>{groups.length} payeur{groups.length > 1 ? "s" : ""}</span>
              <span className="total">Total à rembourser : <b>{fmtEUR(grandTotal)}</b></span>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.payer_id} className="card" style={{ marginBottom: "1rem" }}>
              <div className="reimb-head">
                <div>
                  <b>{g.payer_name}</b>
                  <div className="muted small">{g.items.length} facture{g.items.length > 1 ? "s" : ""}</div>
                </div>
                <div className="reimb-total" style={tab === "history" ? { color: "var(--ok)" } : undefined}>
                  {fmtEUR(g.total)}
                </div>
              </div>

              <table className="exp-table">
                <thead>
                  <tr>
                    <th>Fournisseur</th>
                    <th>Date</th>
                    <th>Catégorie</th>
                    <th className="num">TTC</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((e) => (
                    <tr key={e.id}>
                      <td><b>{e.supplier?.name ?? "Sans fournisseur"}</b></td>
                      <td>{fmtDate(e.expense_date)}</td>
                      <td>{e.category?.label ?? "—"}</td>
                      <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                      <td>
                        {tab === "pending" ? (
                          <button className="link" disabled={busy !== null} onClick={() => onSettleItem(e.id, true)}>
                            {busy === e.id ? "…" : "✓ Remboursé"}
                          </button>
                        ) : (
                          <button className="link danger" disabled={busy !== null} onClick={() => onSettleItem(e.id, false)}>
                            {busy === e.id ? "…" : "↶ Annuler"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {tab === "pending" && g.payer_id !== "?" && (
                <button
                  className="primary"
                  style={{ marginTop: "0.75rem" }}
                  disabled={busy !== null}
                  onClick={() => onSettlePayer(g.payer_id)}
                >
                  {busy === g.payer_id ? "…" : `✓ Tout rembourser (${fmtEUR(g.total)})`}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
