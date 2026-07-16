// Onglet « Factures » : récap des factures fournisseurs — payées vs reste à payer,
// avec totaux, statut de pointage bancaire, et accès direct au rapprochement.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchInvoices, setExpensePaid, type ExpenseListItem } from "../lib/queries";
import { supabase } from "../supabaseClient";
import { fmtEUR, fmtDate } from "../lib/format";

type Tab = "topay" | "paid";

// Qui a réglé le fournisseur : une personne (note de frais) ou la société.
function payerName(e: ExpenseListItem): string {
  return e.payer?.full_name ?? "Société (Azuria)";
}

// Statut synchronisé avec les notes de frais :
//  - non payée      → la SOCIÉTÉ doit encore régler le fournisseur
//  - à rembourser   → une personne a avancé → note de frais en attente
//  - remboursée     → note de frais réglée
//  - payée          → réglée par la société
function statusOf(e: ExpenseListItem): { label: string; cls: "ok" | "warn" } {
  if (!e.paid) return { label: "À payer au fournisseur", cls: "warn" };
  if (e.reimbursable && !e.reimbursed) return { label: `Note de frais — à rembourser à ${payerName(e)}`, cls: "warn" };
  if (e.reimbursable && e.reimbursed) return { label: `Remboursée à ${payerName(e)}`, cls: "ok" };
  return { label: "Payée", cls: "ok" };
}

export function Invoices({ onGoReconcile }: { onGoReconcile?: () => void }) {
  const [items, setItems] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("topay");

  const load = useCallback(() => {
    setLoading(true);
    fetchInvoices().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Temps réel : un remboursement de note de frais (autre écran/appareil) se reflète ici.
  useEffect(() => {
    const ch = supabase
      .channel("rt-invoices")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

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
  const toRefund = useMemo(() => items.filter((e) => e.paid && e.reimbursable && !e.reimbursed), [items]);
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
        <div className="kpi"><div className="kpi-label">Reste à payer (fournisseurs)</div><div className="kpi-value warn">{fmtEUR(sum(toPay))}</div></div>
        <div className="kpi"><div className="kpi-label">À rembourser (notes de frais)</div><div className="kpi-value warn">{fmtEUR(sum(toRefund))}</div></div>
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
                <th>Payé par</th>
                <th>Statut</th>
                <th>Pointée banque</th>
                <th className="num">TTC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = statusOf(e);
                return (
                  <tr key={e.id}>
                    <td>
                      <b>{e.supplier?.name ?? "Sans fournisseur"}</b>
                      <div className="muted small">{e.due_date ? `éch. ${fmtDate(e.due_date)}` : ""}{e.invoice_number ? ` · ${e.invoice_number}` : ""}</div>
                    </td>
                    <td>{fmtDate(e.expense_date)}</td>
                    <td>{payerName(e)}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td>
                      {e.reconciled
                        ? <span className="badge ok">pointée</span>
                        : <span className="badge warn">non pointée</span>}
                    </td>
                    <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                    <td>
                      {tab === "topay" ? (
                        <button className="primary" disabled={busy !== null} onClick={() => togglePaid(e, true)}>
                          {busy === e.id ? "…" : "✓ Valider le paiement"}
                        </button>
                      ) : e.reimbursable && !e.reimbursed ? (
                        <span className="muted small">Se règle dans « Notes de frais »</span>
                      ) : (
                        <button className="link danger" disabled={busy !== null} onClick={() => togglePaid(e, false)}>
                          {busy === e.id ? "…" : "↶ Remettre à payer"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
