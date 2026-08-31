// Rapprochement bancaire : importe un relevé PDF, l'IA en extrait les opérations,
// puis on pointe chaque débit contre les dépenses saisies.

import { useEffect, useMemo, useState } from "react";
import type { Profile, ParsedBankTx, BankTxStatus } from "@resto/shared";
import { uploadAndParseBankStatement, reconcile, type ReconcileExpense } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchExpensesForReconcile, commitBankReconciliation, fetchBankTransactions,
  unmatchBankTransaction, autoReconcileUnmatched, fetchBankCredits, classifyCredit, type BankTxRow,
} from "../lib/queries";
import { fetchRevenues } from "../lib/revenues";
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

  // Contrôle des recettes : ce qui est arrivé sur le compte vs ce qu'on a déclaré.
  const [control, setControl] = useState<{
    carte: number; especes: number; autre: number; encaisse: number;
    declCb: number; declCash: number; declTotal: number; tva: number;
    from: string | null; to: string | null;
  } | null>(null);

  async function loadControl() {
    try {
      const credits = await fetchBankCredits("2000-01-01", "2999-12-31");
      if (!credits.length) { setControl(null); return; }
      let carte = 0, especes = 0, autre = 0;
      let minD = credits[0]!.tx_date, maxD = credits[0]!.tx_date;
      for (const c of credits) {
        const k = classifyCredit(c.label); const a = Number(c.amount) || 0;
        if (k === "carte") carte += a; else if (k === "especes") especes += a; else autre += a;
        if (c.tx_date < minD) minD = c.tx_date;
        if (c.tx_date > maxD) maxD = c.tx_date;
      }
      const rev = await fetchRevenues({ from: minD, to: maxD });
      const declCb = rev.reduce((s, r) => s + Number(r.amount_cb || 0), 0);
      const declCash = rev.reduce((s, r) => s + Number(r.amount_cash || 0), 0);
      const declOther = rev.reduce((s, r) => s + Number(r.amount_other || 0), 0);
      const tva = rev.reduce((s, r) => s + Number(r.tva_amount || 0), 0);
      setControl({
        carte, especes, autre, encaisse: carte + especes + autre,
        declCb, declCash, declTotal: declCb + declCash + declOther, tva, from: minD, to: maxD,
      });
    } catch (e) { console.error(e); }
  }

  function loadHistory() {
    fetchBankTransactions().then(setHistory).catch((e) => console.error(e));
    loadControl();
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

  function fmtSigned(v: number): string {
    if (Math.abs(v) < 0.5) return "≈ 0";
    return (v > 0 ? "+" : "−") + fmtEUR(Math.abs(v));
  }

  function expenseLabel(ex: ReconcileExpense): string {
    const sup = ex.supplier_name ?? "Sans fournisseur";
    const inv = ex.invoice_number ? ` · ${ex.invoice_number}` : "";
    return `${sup} — ${fmtEUR(ex.amount_ttc)} — ${fmtDate(ex.expense_date)}${inv}`;
  }

  const hasImport = parsedMeta != null;
  // Historique SANS les remises carte (REMISE CB) : elles polluent la liste et
  // sont déjà synthétisées dans le Contrôle des recettes.
  const shownHistory = history.filter((t) => !(t.direction === "credit" && classifyCredit(t.label) === "carte"));

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

      {/* Contrôle des recettes : CA arrivé sur le compte vs recettes déclarées */}
      {control && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>💰 Contrôle des recettes — arrivé sur le compte vs déclaré</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Ce qui est réellement <b>tombé sur le compte</b> (remises carte nettes de commission + dépôts
            d'espèces) comparé à ce que tu as <b>saisi dans Recettes</b>. Période des encaissements :
            {" "}{control.from ? fmtDate(control.from) : "?"} → {control.to ? fmtDate(control.to) : "?"}.
          </p>
          <table className="exp-table">
            <thead>
              <tr><th>Mode</th><th className="num">Déclaré (app)</th><th className="num">Encaissé (banque)</th><th className="num">Écart</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Carte (CB)</td>
                <td className="num">{fmtEUR(control.declCb)}</td>
                <td className="num">{fmtEUR(control.carte)} <span className="muted">(net)</span></td>
                <td className="num" style={{ color: Math.abs(control.carte - control.declCb) < 5 ? "#16a34a" : "#6b7280" }}>
                  {fmtSigned(control.carte - control.declCb)}
                </td>
              </tr>
              {control.declCb - control.carte > 1 && (
                <tr style={{ fontSize: "0.85em", color: "#6b7280" }}>
                  <td style={{ paddingLeft: "1.5rem" }}>↳ dont commission carte (frais bancaires)</td>
                  <td className="num">—</td>
                  <td className="num">−{fmtEUR(control.declCb - control.carte)}</td>
                  <td className="num muted">{control.declCb > 0 ? `${((control.declCb - control.carte) / control.declCb * 100).toFixed(2)} %` : "—"}</td>
                </tr>
              )}
              <tr>
                <td>Espèces</td>
                <td className="num">{fmtEUR(control.declCash)}</td>
                <td className="num">{fmtEUR(control.especes)} <span className="muted">(déposées)</span></td>
                <td className="num muted">{fmtSigned(control.especes - control.declCash)}</td>
              </tr>
              {control.autre > 0 && (
                <tr>
                  <td>Autres crédits <span className="muted">(virements reçus…)</span></td>
                  <td className="num">—</td>
                  <td className="num">{fmtEUR(control.autre)}</td>
                  <td className="num muted">—</td>
                </tr>
              )}
              <tr style={{ fontWeight: 700, borderTop: "2px solid #d1d5db" }}>
                <td>Total</td>
                <td className="num">{fmtEUR(control.declTotal)}</td>
                <td className="num">{fmtEUR(control.encaisse)}</td>
                <td className="num" style={{ color: Math.abs(control.encaisse - control.declTotal) < 20 ? "#16a34a" : "#d97706" }}>
                  {fmtSigned(control.encaisse - control.declTotal)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: "0.5rem" }}>
            TVA collectée déclarée sur la période : <b>{control.tva > 0 ? fmtEUR(control.tva) : "—"}</b>.
            La carte est créditée nette de commission ; les espèces déposées sont normalement inférieures à
            l'encaissé (fond de caisse, dépôts espacés). Un écart carte bien supérieur à la commission = un
            service non saisi.
          </p>
        </div>
      )}

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

          {/* Crédits (entrées) hors remises carte — informatif. Les REMISE CB
              sont exclues (traitées dans le Contrôle des recettes ci-dessus). */}
          {credits.filter((c) => classifyCredit(c.label) !== "carte").length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">
                Autres crédits / entrées — hors remises carte (résumées plus haut)
              </summary>
              <table>
                <tbody>
                  {credits.filter((c) => classifyCredit(c.label) !== "carte").map((c, i) => (
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
      {shownHistory.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Opérations importées ({shownHistory.length}) <span className="muted" style={{ fontSize: "0.8em", fontWeight: 400 }}>· remises carte masquées</span></h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Libellé</th><th style={{ textAlign: "right" }}>Montant</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {shownHistory.slice(0, 200).map((t) => {
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
