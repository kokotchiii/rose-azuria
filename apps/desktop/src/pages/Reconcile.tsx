// Rapprochement bancaire : importe un relevé PDF, l'IA en extrait les opérations,
// puis on pointe chaque débit contre les dépenses saisies.

import { useEffect, useMemo, useState } from "react";
import type { Profile, ParsedBankTx, BankTxStatus } from "@resto/shared";
import { uploadAndParseBankStatement, reconcile, type ReconcileExpense } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchExpensesForReconcile, commitBankReconciliation, fetchBankTransactions,
  unmatchBankTransaction, autoReconcileUnmatched, type BankTxRow,
} from "../lib/queries";
import { fmtEUR, fmtDate } from "../lib/format";

interface Props { profile: Profile }

// Une ligne de débit à pointer : la transaction + l'option de dépense choisie.
interface DebitRow {
  tx: ParsedBankTx;
  options: ReconcileExpense[];   // candidats proposés (vide = aucun)
  selectedId: string | null;     // dépense choisie (null = non pointée)
  auto: boolean;                 // proposé automatiquement
}

export function Reconcile({ profile }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [parsedMeta, setParsedMeta] = useState<{ bank: string | null; from: string | null; to: string | null; count: number } | null>(null);
  const [debits, setDebits] = useState<DebitRow[]>([]);
  const [credits, setCredits] = useState<ParsedBankTx[]>([]);
  const [unmatchedExpenses, setUnmatchedExpenses] = useState<ReconcileExpense[]>([]);
  const [expensesById, setExpensesById] = useState<Record<string, ReconcileExpense>>({});

  const [history, setHistory] = useState<BankTxRow[]>([]);

  function loadHistory() {
    fetchBankTransactions().then(setHistory).catch((e) => console.error(e));
  }
  useEffect(() => { loadHistory(); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    setBusy(true); setError(null); setInfo(null);
    setDebits([]); setCredits([]); setUnmatchedExpenses([]); setParsedMeta(null);
    try {
      const buf = await file.arrayBuffer();
      const ct = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const { parse } = await uploadAndParseBankStatement({
        client: supabase,
        establishmentId: profile.establishment_id,
        pages: [{ file: buf, contentType: ct }],
        fileBaseName: `releve-${file.name.replace(/\.[^.]+$/, "")}`,
      });

      const expenses = await fetchExpensesForReconcile();
      const byId: Record<string, ReconcileExpense> = {};
      for (const ex of expenses) byId[ex.id] = ex;
      setExpensesById(byId);

      const res = reconcile(parse.transactions, expenses);

      // Construit les lignes de débit à pointer.
      const rows: DebitRow[] = [];
      for (const a of res.auto) {
        rows.push({ tx: a.tx, options: [a.expense], selectedId: a.expense.id, auto: true });
      }
      for (const am of res.ambiguous) {
        rows.push({ tx: am.tx, options: am.candidates.map((c) => c.expense), selectedId: null, auto: false });
      }
      for (const tx of res.unmatchedTx) {
        rows.push({ tx, options: [], selectedId: null, auto: false });
      }
      // Ordre chronologique.
      rows.sort((x, y) => x.tx.date.localeCompare(y.tx.date));

      setDebits(rows);
      setCredits(parse.transactions.filter((t) => t.direction === "credit"));
      setUnmatchedExpenses(res.unmatchedExpenses);
      setParsedMeta({
        bank: parse.bank_name,
        from: parse.period_start,
        to: parse.period_end,
        count: parse.transactions.length,
      });
      setInfo(`${res.auto.length} rapprochées automatiquement · ${res.ambiguous.length} à confirmer · ${res.unmatchedTx.length} débits sans facture`);
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function setSelected(index: number, id: string | null) {
    setDebits((prev) => prev.map((r, i) => (i === index ? { ...r, selectedId: id } : r)));
  }

  const matchedCount = useMemo(() => debits.filter((d) => d.selectedId).length, [debits]);

  async function onSave() {
    if (!debits.length && !credits.length) return;
    setBusy(true); setError(null);
    try {
      const batch = crypto.randomUUID();
      const rows: Array<{ tx: ParsedBankTx; matchedExpenseId: string | null; status: BankTxStatus }> = [];
      for (const d of debits) {
        rows.push({ tx: d.tx, matchedExpenseId: d.selectedId, status: d.selectedId ? "matched" : "unmatched" });
      }
      for (const c of credits) {
        rows.push({ tx: c, matchedExpenseId: null, status: "unmatched" });
      }
      await commitBankReconciliation({
        establishmentId: profile.establishment_id,
        createdBy: profile.id,
        importBatch: batch,
        rows,
      });
      setInfo(`Import enregistré : ${matchedCount} facture(s) marquée(s) payée(s).`);
      setDebits([]); setCredits([]); setUnmatchedExpenses([]); setParsedMeta(null);
      loadHistory();
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function onUnmatch(tx: BankTxRow) {
    try {
      await unmatchBankTransaction(tx.id, tx.matched_expense_id);
      loadHistory();
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    }
  }

  // Rapprochement inversé : pointe automatiquement les justificatifs qui
  // correspondent à une opération non pointée déjà importée (montant + date).
  async function onAutoReconcile() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await autoReconcileUnmatched(5);
      loadHistory();
      setInfo(res.matched === 0
        ? "Aucune nouvelle correspondance (rien à pointer parmi les opérations non pointées)."
        : `✅ ${res.matched} justificatif(s) pointé(s) automatiquement : ${res.details.map((d) => `${d.supplier ?? d.label} ${fmtEUR(d.amount)}`).join(", ")}`);
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function expenseLabel(ex: ReconcileExpense): string {
    const sup = ex.supplier_name ?? "Sans fournisseur";
    const inv = ex.invoice_number ? ` · ${ex.invoice_number}` : "";
    return `${sup} — ${fmtEUR(ex.amount_ttc)} — ${fmtDate(ex.expense_date)}${inv}`;
  }

  const hasImport = parsedMeta != null;

  return (
    <div className="page">
      <h1>Rapprochement bancaire</h1>
      <p className="muted">
        Importe ton relevé bancaire (PDF). L'IA en lit les opérations et les pointe contre tes dépenses
        (montant identique + date proche + libellé reconnu). Une facture rapprochée à un débit est
        considérée <b>payée</b> ; une facture sans débit reste <b>non payée</b>.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label className={`primary import-btn ${busy ? "disabled" : ""}`}>
          <input type="file" accept="application/pdf,image/*" onChange={onFile} disabled={busy} style={{ display: "none" }} />
          {busy ? "Analyse en cours…" : "📄 Importer un relevé (PDF)"}
        </label>
        <button className="secondary" style={{ marginLeft: 12 }} disabled={busy} onClick={onAutoReconcile}
          title="Pointe automatiquement les justificatifs (factures) qui correspondent à une opération déjà importée mais non pointée.">
          🔗 Rapprocher auto les justificatifs
        </button>
        {info && <span className="badge ok" style={{ marginLeft: 12 }}>{info}</span>}
        {error && <div className="danger" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {hasImport && (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>
            {parsedMeta?.bank ?? "Relevé"} · période {parsedMeta?.from ? fmtDate(parsedMeta.from) : "?"} → {parsedMeta?.to ? fmtDate(parsedMeta.to) : "?"} · {parsedMeta?.count} opérations
          </div>

          {/* Débits à pointer */}
          <h2>Débits du relevé ({debits.length})</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Libellé</th><th style={{ textAlign: "right" }}>Montant</th><th>Dépense rapprochée</th></tr>
            </thead>
            <tbody>
              {debits.map((d, i) => (
                <tr key={i} className={d.selectedId ? "row-matched" : d.options.length ? "" : "row-orphan"}>
                  <td>{fmtDate(d.tx.date)}</td>
                  <td>{d.tx.label}</td>
                  <td style={{ textAlign: "right" }}>{fmtEUR(d.tx.amount)}</td>
                  <td>
                    {d.options.length === 0 ? (
                      <span className="badge warn">aucune facture — à créer ?</span>
                    ) : (
                      <select value={d.selectedId ?? ""} onChange={(e) => setSelected(i, e.target.value || null)}>
                        <option value="">— non pointée —</option>
                        {d.options.map((ex) => (
                          <option key={ex.id} value={ex.id}>{expenseLabel(ex)}</option>
                        ))}
                      </select>
                    )}
                    {d.auto && d.selectedId && <span className="badge ok" style={{ marginLeft: 8 }}>auto</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Crédits (entrées) — informatif */}
          {credits.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Crédits / entrées ({credits.length}) — non rapprochés (côté recettes)</summary>
              <table>
                <tbody>
                  {credits.map((c, i) => (
                    <tr key={i}><td>{fmtDate(c.date)}</td><td>{c.label}</td><td style={{ textAlign: "right" }}>{fmtEUR(c.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {/* Dépenses sans débit */}
          {unmatchedExpenses.length > 0 && (
            <details style={{ marginTop: 12 }} open>
              <summary className="muted">Factures NON payées ({unmatchedExpenses.length}) — aucun débit trouvé (pas encore réglées, payées en espèces, ou hors période)</summary>
              <table>
                <tbody>
                  {unmatchedExpenses.slice(0, 100).map((ex) => (
                    <tr key={ex.id}>
                      <td>{fmtDate(ex.expense_date)}</td>
                      <td>{ex.supplier_name ?? "—"}{ex.invoice_number ? ` · ${ex.invoice_number}` : ""}</td>
                      <td style={{ textAlign: "right" }}>{fmtEUR(ex.amount_ttc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <button className="primary big" disabled={busy} onClick={onSave}>
            Valider : marquer {matchedCount} facture{matchedCount > 1 ? "s" : ""} payée{matchedCount > 1 ? "s" : ""}
          </button>
        </>
      )}

      {/* Historique des imports */}
      {history.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Opérations importées ({history.length})</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Libellé</th><th style={{ textAlign: "right" }}>Montant</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {history.slice(0, 200).map((t) => {
                const ex = t.matched_expense_id ? expensesById[t.matched_expense_id] : null;
                return (
                  <tr key={t.id}>
                    <td>{fmtDate(t.tx_date)}</td>
                    <td>{t.label}</td>
                    <td style={{ textAlign: "right" }}>{t.direction === "debit" ? "−" : "+"}{fmtEUR(t.amount)}</td>
                    <td>
                      {t.status === "matched"
                        ? <span className="badge ok">pointée{ex ? ` · ${ex.supplier_name ?? ""}` : ""}</span>
                        : t.status === "ignored"
                          ? <span className="badge">ignorée</span>
                          : <span className="badge warn">non pointée</span>}
                    </td>
                    <td>
                      {t.status === "matched" && (
                        <button className="link" onClick={() => onUnmatch(t)}>annuler</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
