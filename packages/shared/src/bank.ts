// Rapprochement bancaire : upload d'un relevé (PDF/images) → Edge Function
// `parse-bank-statement` → liste d'opérations, puis moteur de matching qui
// associe chaque DÉBIT à une dépense saisie (montant + date proche + libellé).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankStatementParse, ParsedBankTx } from "./types";

// ---------------------------------------------------------------------------
// Upload + parsing IA
// ---------------------------------------------------------------------------

function buildStoragePath(establishmentId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const stamp = now.getTime();
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${establishmentId}/releves/${yyyy}/${mm}/${stamp}-${safe}`;
}

export interface BankPageInput {
  file: Blob | File | ArrayBuffer | Uint8Array;
  contentType?: string; // "application/pdf" | "image/jpeg" | "image/png"
}

export interface ParseBankStatementParams {
  client: SupabaseClient;
  establishmentId: string;
  pages: BankPageInput[];
  fileBaseName: string; // ex "releve-2026-06"
}

export async function uploadAndParseBankStatement(
  params: ParseBankStatementParams,
): Promise<{ parse: BankStatementParse; storagePaths: string[] }> {
  const { client, establishmentId, pages, fileBaseName } = params;
  if (!pages.length) throw new Error("no_pages");

  const storagePaths: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const ct = p.contentType ?? (p.file as File).type ?? "application/pdf";
    const ext = ct === "application/pdf" ? "pdf" : ct === "image/png" ? "png" : "jpg";
    const name = pages.length > 1 ? `${fileBaseName}-p${i + 1}.${ext}` : `${fileBaseName}.${ext}`;
    const path = buildStoragePath(establishmentId, name);
    const { error: upErr } = await client.storage
      .from("documents")
      .upload(path, p.file, { upsert: false, contentType: ct });
    if (upErr) throw new Error(`upload_failed: ${upErr.message}`);
    storagePaths.push(path);
  }

  const { data: fnData, error: fnErr } = await client.functions.invoke("parse-bank-statement", {
    body: { storage_paths: storagePaths, storage_path: storagePaths[0] },
  });

  if (fnErr || !fnData?.ok) {
    let detail = "";
    const ctx = (fnErr as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = await ctx.text(); } catch { /* ignore */ }
    } else if (fnData) {
      detail = JSON.stringify(fnData);
    }
    throw new Error(`parse_failed: ${fnErr?.message ?? "error"}${detail ? ` — ${detail}` : ""}`);
  }

  return { parse: fnData.result as BankStatementParse, storagePaths };
}

// ---------------------------------------------------------------------------
// Moteur de rapprochement
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  expense: ReconcileExpense;
  supplierName: string | null;
  score: number;          // 0..1
  dateDeltaDays: number;
  amountExact: boolean;
}

export interface ReconcileExpense {
  id: string;
  expense_date: string;
  amount_ttc: number;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  note: string | null;
}

export interface ReconcileResult {
  // Débit du relevé rapproché automatiquement (1 seul bon candidat).
  auto: Array<{ tx: ParsedBankTx; expense: ReconcileExpense; candidate: MatchCandidate }>;
  // Débit avec plusieurs candidats plausibles → choix manuel.
  ambiguous: Array<{ tx: ParsedBankTx; candidates: MatchCandidate[] }>;
  // Débit sans aucune dépense correspondante → dépense probablement manquante.
  unmatchedTx: ParsedBankTx[];
  // Dépenses non rapprochées (aucun débit du relevé ne correspond).
  unmatchedExpenses: ReconcileExpense[];
}

const DAY = 86_400_000;

function dayDelta(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return 9999;
  return Math.round(Math.abs(da - db) / DAY);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // accents
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Score de ressemblance libellé bancaire ↔ nom fournisseur : proportion de mots
// du fournisseur (≥3 lettres) présents dans le libellé.
function labelSupplierScore(label: string, supplierName: string | null): number {
  if (!supplierName) return 0;
  const hay = normalize(label);
  const words = normalize(supplierName).split(" ").filter((w) => w.length >= 3);
  if (!words.length) return 0;
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits / words.length;
}

export interface MatchOptions {
  amountTolerance?: number;  // écart absolu toléré en € (def 0.01 = montant exact)
  maxDateDeltaDays?: number; // fenêtre date max (def 10 j : le débit suit la facture)
}

// Associe les DÉBITS du relevé aux dépenses fournies.
export function reconcile(
  transactions: ParsedBankTx[],
  expenses: ReconcileExpense[],
  opts: MatchOptions = {},
): ReconcileResult {
  const tol = opts.amountTolerance ?? 0.01;
  const maxDelta = opts.maxDateDeltaDays ?? 10;

  const debits = transactions.filter((t) => t.direction === "debit");
  const usedExpense = new Set<string>();
  const result: ReconcileResult = { auto: [], ambiguous: [], unmatchedTx: [], unmatchedExpenses: [] };

  for (const tx of debits) {
    const candidates: MatchCandidate[] = [];
    for (const e of expenses) {
      if (usedExpense.has(e.id)) continue;
      const amountDiff = Math.abs(Number(e.amount_ttc) - tx.amount);
      if (amountDiff > tol) continue;                       // montant doit coller
      const delta = dayDelta(e.expense_date, tx.date);
      if (delta > maxDelta) continue;                       // date doit être proche
      const labelScore = labelSupplierScore(tx.label, e.supplier_name);
      // score : montant exact + proximité date + ressemblance libellé.
      const dateScore = 1 - delta / (maxDelta + 1);
      const score = 0.5 + 0.2 * dateScore + 0.3 * labelScore;
      candidates.push({
        expense: e,
        supplierName: e.supplier_name,
        score: Math.min(1, score),
        dateDeltaDays: delta,
        amountExact: amountDiff <= 0.01,
      });
    }

    if (!candidates.length) {
      result.unmatchedTx.push(tx);
      continue;
    }
    candidates.sort((a, b) => b.score - a.score || a.dateDeltaDays - b.dateDeltaDays);
    const best = candidates[0]!;
    const second = candidates[1];
    // Auto si un seul candidat, ou si le meilleur domine nettement le suivant.
    const dominant = !second || best.score - second.score >= 0.15 || best.dateDeltaDays === 0;
    if (dominant) {
      usedExpense.add(best.expense.id);
      result.auto.push({ tx, expense: best.expense as ReconcileExpense, candidate: best });
    } else {
      result.ambiguous.push({ tx, candidates: candidates.slice(0, 5) });
    }
  }

  result.unmatchedExpenses = expenses.filter((e) => !usedExpense.has(e.id));
  return result;
}
