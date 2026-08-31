// Mes dépenses : LA vue simple. Un justificatif par ligne, un statut clair —
//   🔴 À payer · 🟢 Payé (✓ si vu sur le relevé) · 🟠 Note de frais (à rembourser / remboursée).
// Fini le jargon (dépannage/manuel/pointée) : payé / pas payé / note de frais.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAllExpensesEnriched, setExpensePaid, markReimbursed, getExpenseDocUrl,
  type ExpenseListItem,
} from "../lib/queries";
import { supabase } from "../supabaseClient";
import { fmtEUR, fmtDate } from "../lib/format";

type Filter = "tout" | "apayer" | "paye" | "notes";

interface Status { key: "apayer" | "paye" | "arembourser" | "rembourse"; label: string; color: string; }

function payerName(e: ExpenseListItem): string {
  return e.payer?.full_name?.trim() || "perso";
}

// Un seul statut clair par dépense.
function statusOf(e: ExpenseListItem): Status {
  if (e.reimbursable && !e.reimbursed) return { key: "arembourser", label: `À rembourser à ${payerName(e)}`, color: "#d97706" };
  if (e.reimbursable && e.reimbursed) return { key: "rembourse", label: `Remboursée à ${payerName(e)}`, color: "#16a34a" };
  if (!e.paid) return { key: "apayer", label: "À payer", color: "#dc2626" };
  return { key: "paye", label: "Payé", color: "#16a34a" };
}

function whatIs(e: ExpenseListItem): string {
  return e.supplier?.name || e.note || e.category?.label || "Dépense";
}

export function Depenses() {
  const [rows, setRows] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("tout");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchAllExpensesEnriched()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("rt-depenses")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const kpis = useMemo(() => {
    const aPayer = rows.filter((e) => !e.reimbursable && !e.paid);
    const aRembourser = rows.filter((e) => e.reimbursable && !e.reimbursed);
    const paye = rows.filter((e) => (e.paid || e.reimbursed) && !(e.reimbursable && !e.reimbursed));
    return {
      aPayerSum: aPayer.reduce((s, e) => s + Number(e.amount_ttc), 0), aPayerN: aPayer.length,
      aRembSum: aRembourser.reduce((s, e) => s + Number(e.amount_ttc), 0), aRembN: aRembourser.length,
      payeSum: paye.reduce((s, e) => s + Number(e.amount_ttc), 0), payeN: paye.length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    if (filter === "apayer") return rows.filter((e) => !e.reimbursable && !e.paid);
    if (filter === "paye") return rows.filter((e) => (e.paid || e.reimbursed) && !(e.reimbursable && !e.reimbursed));
    if (filter === "notes") return rows.filter((e) => e.reimbursable);
    return rows;
  }, [rows, filter]);

  async function openJustif(e: ExpenseListItem) {
    if (!e.document_id) return;
    const url = await getExpenseDocUrl(e.document_id);
    if (url) window.open(url, "_blank");
  }
  async function onPay(e: ExpenseListItem) {
    setBusy(e.id); try { await setExpensePaid(e.id, true); await reload(); } finally { setBusy(null); }
  }
  async function onReimburse(e: ExpenseListItem) {
    setBusy(e.id); try { await markReimbursed(e.id, true); await reload(); } finally { setBusy(null); }
  }

  const TABS: { key: Filter; label: string }[] = [
    { key: "tout", label: "Tout" },
    { key: "apayer", label: "À payer" },
    { key: "paye", label: "Payé" },
    { key: "notes", label: "Notes de frais" },
  ];

  return (
    <div className="page">
      <h1>Mes dépenses</h1>

      {/* 3 compteurs simples */}
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">🔴 Reste à payer</div><div className="kpi-value" style={{ color: kpis.aPayerSum > 0 ? "#dc2626" : undefined }}>{fmtEUR(kpis.aPayerSum)}</div><div className="kpi-label">{kpis.aPayerN} facture(s)</div></div>
        <div className="kpi"><div className="kpi-label">🟠 À rembourser</div><div className="kpi-value" style={{ color: kpis.aRembSum > 0 ? "#d97706" : undefined }}>{fmtEUR(kpis.aRembSum)}</div><div className="kpi-label">{kpis.aRembN} note(s) de frais</div></div>
        <div className="kpi"><div className="kpi-label">🟢 Payé</div><div className="kpi-value">{fmtEUR(kpis.payeSum)}</div><div className="kpi-label">{kpis.payeN} dépense(s)</div></div>
      </div>

      {/* Filtres */}
      <div className="tabs" style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        {TABS.map((t) => (
          <button key={t.key} className={filter === t.key ? "primary" : "secondary"} onClick={() => setFilter(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="exp-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Date</th>
              <th>Quoi</th>
              <th className="num">Montant</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="muted">Chargement…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="muted">Aucune dépense.</td></tr>
            ) : shown.map((e) => {
              const st = statusOf(e);
              return (
                <tr key={e.id}>
                  <td>
                    {e.document_id
                      ? <button className="link" title="Voir le justificatif" onClick={() => openJustif(e)}>📎</button>
                      : <span className="muted" title="Pas de justificatif">—</span>}
                  </td>
                  <td>{fmtDate(e.expense_date)}</td>
                  <td>
                    {whatIs(e)}
                    {e.invoice_number ? <span className="muted"> · {e.invoice_number}</span> : ""}
                    {e.category?.label ? <div className="muted" style={{ fontSize: "0.8em" }}>{e.category.label}</div> : ""}
                  </td>
                  <td className="num"><b>{fmtEUR(Number(e.amount_ttc))}</b></td>
                  <td>
                    <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                    {st.key === "paye" && e.reconciled && (
                      <span title="Vérifié sur le relevé bancaire" style={{ color: "#16a34a", marginLeft: 6 }}>✓ relevé</span>
                    )}
                  </td>
                  <td>
                    {st.key === "apayer" && (
                      <button className="link" disabled={busy === e.id} onClick={() => onPay(e)}>Marquer payé</button>
                    )}
                    {st.key === "arembourser" && (
                      <button className="link" disabled={busy === e.id} onClick={() => onReimburse(e)}>Marquer remboursé</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ marginTop: "0.75rem" }}>
        <b>À payer</b> = pas encore réglé · <b>Payé</b> = sorti du compte (✓ relevé = confirmé par la banque) ·
        <b> Note de frais</b> = avancé en perso, à rembourser puis remboursé. 📎 = justificatif (facture / ticket).
      </p>
    </div>
  );
}
