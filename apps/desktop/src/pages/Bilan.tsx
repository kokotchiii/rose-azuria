// Bilan : la vue de synthèse qui répond à 3 questions —
//   1) ce qui est PAYÉ, 2) ce qui reste À PAYER,
//   3) ce qui est SORTI en banque SANS facture rattachée.
// Tout est recoupé automatiquement (dépenses ↔ relevés bancaires).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAllExpensesEnriched, fetchBankTransactions,
  autoReconcileUnmatched, type ExpenseListItem, type BankTxRow,
} from "../lib/queries";
import { supabase } from "../supabaseClient";
import { fmtEUR, fmtDate } from "../lib/format";

interface Props { onGoReconcile: () => void; onGoCapture: () => void; }

export function Bilan({ onGoReconcile, onGoCapture }: Props) {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [txs, setTxs] = useState<BankTxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [e, t] = await Promise.all([fetchAllExpensesEnriched(), fetchBankTransactions()]);
      setExpenses(e);
      setTxs(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("rt-bilan")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "bank_transactions" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const paid = useMemo(() => expenses.filter((e) => e.paid), [expenses]);
  const toPay = useMemo(() => expenses.filter((e) => !e.paid), [expenses]);
  const debitsNoInvoice = useMemo(
    () => txs.filter((t) => t.direction === "debit" && t.status === "unmatched"),
    [txs],
  );

  const sum = (arr: { amount_ttc?: number; amount?: number }[], key: "amount_ttc" | "amount") =>
    arr.reduce((s, x) => s + Number((x as Record<string, number>)[key] ?? 0), 0);

  const totalPaid = sum(paid, "amount_ttc");
  const totalToPay = sum(toPay, "amount_ttc");
  const totalDebitsNoInvoice = sum(debitsNoInvoice, "amount");

  async function onReconcile() {
    setBusy(true); setMsg(null);
    try {
      const r = await autoReconcileUnmatched();
      await reload();
      setMsg(r.matched === 0 ? "Aucune nouvelle correspondance." : `✅ ${r.matched} facture(s) pointée(s) automatiquement.`);
    } catch (e: unknown) {
      setMsg("⚠ " + String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><h1>Bilan</h1><p className="muted">Chargement…</p></div>;

  return (
    <div className="page">
      <h1>Bilan</h1>
      <p className="muted">
        Synthèse recoupée entre tes <b>factures</b> et tes <b>relevés bancaires</b>. Clique
        « Rapprocher » pour re-pointer après un import ou une nouvelle facture.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "0.5rem 0 1rem" }}>
        <button className="primary" disabled={busy} onClick={onReconcile}>🔗 Rapprocher maintenant</button>
        <button className="secondary" onClick={onGoReconcile}>Importer un relevé</button>
        {msg && <span className="hint" style={{ alignSelf: "center" }}>{msg}</span>}
      </div>

      {/* 3 compteurs */}
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">✅ Payé</div><div className="kpi-value">{fmtEUR(totalPaid)}</div><div className="kpi-label">{paid.length} facture(s)</div></div>
        <div className="kpi"><div className="kpi-label">⏰ Reste à payer</div><div className="kpi-value" style={{ color: totalToPay > 0 ? "#d97706" : undefined }}>{fmtEUR(totalToPay)}</div><div className="kpi-label">{toPay.length} facture(s)</div></div>
        <div className="kpi"><div className="kpi-label">❓ Payé en banque sans facture</div><div className="kpi-value" style={{ color: totalDebitsNoInvoice > 0 ? "#dc2626" : undefined }}>{fmtEUR(totalDebitsNoInvoice)}</div><div className="kpi-label">{debitsNoInvoice.length} opération(s)</div></div>
      </div>

      {/* À PAYER */}
      <div className="card" style={{ marginTop: "1.25rem" }}>
        <h2>⏰ Ce qu'il reste à payer ({toPay.length})</h2>
        {toPay.length === 0 ? <p className="muted">Rien à payer. 🎉</p> : (
          <table className="exp-table">
            <thead><tr><th>Fournisseur</th><th>Date facture</th><th>Échéance</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {toPay.map((e) => (
                <tr key={e.id}>
                  <td>{e.supplier?.name ?? "—"}{e.invoice_number ? ` · ${e.invoice_number}` : ""}</td>
                  <td>{fmtDate(e.expense_date)}</td>
                  <td>{e.due_date ? fmtDate(e.due_date) : "—"}</td>
                  <td className="num"><b>{fmtEUR(Number(e.amount_ttc))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* DÉBITS SANS FACTURE */}
      <div className="card" style={{ marginTop: "1.25rem" }}>
        <h2>❓ Payé en banque, mais aucune facture rattachée ({debitsNoInvoice.length})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Ce sont des sorties d'argent réelles sans justificatif dans l'app : soit une facture à
          scanner/valider, soit une dépense à identifier (frais, prélèvement…).
        </p>
        {debitsNoInvoice.length === 0 ? <p className="muted">Tout est rattaché. 🎉</p> : (
          <table className="exp-table">
            <thead><tr><th>Date</th><th>Libellé (banque)</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {debitsNoInvoice.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.tx_date)}</td>
                  <td>{t.label}</td>
                  <td className="num"><b>{fmtEUR(Number(t.amount))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {debitsNoInvoice.length > 0 && (
          <button className="secondary" style={{ marginTop: 8 }} onClick={onGoCapture}>📷 Scanner une facture manquante</button>
        )}
      </div>

      {/* PAYÉ (récap) */}
      <div className="card" style={{ marginTop: "1.25rem" }}>
        <h2>✅ Déjà payé ({paid.length})</h2>
        {paid.length === 0 ? <p className="muted">Aucune facture payée pour l'instant.</p> : (
          <table className="exp-table">
            <thead><tr><th>Fournisseur</th><th>Date facture</th><th>Réglée le</th><th className="num">Montant</th><th>Pointée banque</th></tr></thead>
            <tbody>
              {paid.slice(0, 200).map((e) => (
                <tr key={e.id}>
                  <td>{e.supplier?.name ?? "—"}{e.invoice_number ? ` · ${e.invoice_number}` : ""}</td>
                  <td>{fmtDate(e.expense_date)}</td>
                  <td>{e.paid_at ? fmtDate(e.paid_at) : "—"}</td>
                  <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                  <td>{e.reconciled ? <span className="badge ok">oui</span> : <span className="badge warn">manuel</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
