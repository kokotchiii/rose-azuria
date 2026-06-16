// Queries DB partagées (catégories, fournisseurs, dépenses, items).
// RLS s'occupe d'isoler l'établissement, on n'a pas à filtrer manuellement.

import type {
  Category, Supplier, Expense, Profile, AiExtraction,
  ReconcileExpense, ParsedBankTx, BankTxDirection, BankTxStatus,
} from "@resto/shared";
// (Expense est utilisé par les helpers HT/échéances ci-dessous.)
import { supabase } from "../supabaseClient";
import { normalizeLabel } from "./normalize";

// ---------------------------------------------------------------------------
// Fetchs basiques
// ---------------------------------------------------------------------------

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("label");
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Supplier[];
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

// ---------------------------------------------------------------------------
// Dépenses (liste avec joints)
// ---------------------------------------------------------------------------

export interface ExpenseListItem extends Expense {
  supplier?: { name: string } | null;
  category?: { label: string } | null;
  payer?: { full_name: string | null } | null;
}

export async function fetchExpenses(filters: {
  from?: string;
  to?: string;
  categoryId?: string;
  supplierId?: string;
  payerId?: string;
}): Promise<ExpenseListItem[]> {
  // On précise expenses_payer_id_fkey car la table expenses a 2 FK vers profiles.
  let q = supabase
    .from("expenses")
    .select(
      "*, supplier:suppliers(name), category:categories(label), payer:profiles!expenses_payer_id_fkey(full_name)",
    )
    .order("expense_date", { ascending: false });

  if (filters.from) q = q.gte("expense_date", filters.from);
  if (filters.to) q = q.lte("expense_date", filters.to);
  if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
  if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
  if (filters.payerId) q = q.eq("payer_id", filters.payerId);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseListItem[];
}

// ---------------------------------------------------------------------------
// Fournisseurs : trouve ou crée par nom
// ---------------------------------------------------------------------------

export async function findOrCreateSupplier(
  name: string,
  establishmentId: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nom fournisseur vide");

  const { data: existing } = await supabase
    .from("suppliers")
    .select("id")
    .eq("establishment_id", establishmentId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("suppliers")
    .insert({ establishment_id: establishmentId, name: trimmed })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("create supplier failed");
  return created.id as string;
}

// ---------------------------------------------------------------------------
// Détection de doublons
// ---------------------------------------------------------------------------

// Vrai doublon : même fichier déjà uploadé (même SHA-256 → octet pour octet identique).
export async function findDuplicateByHash(
  fileHash: string,
): Promise<{ documentId: string; expenseId: string | null } | null> {
  const { data: docs } = await supabase
    .from("documents")
    .select("id")
    .eq("file_hash", fileHash)
    .limit(1);
  const first = docs?.[0];
  if (!first) return null;
  const documentId = first.id as string;
  const { data: expense } = await supabase
    .from("expenses")
    .select("id")
    .eq("document_id", documentId)
    .maybeSingle();
  return { documentId, expenseId: (expense?.id as string) ?? null };
}

// Doublon "logique" : même fournisseur + même n° de facture déjà saisi.
export async function findDuplicateByInvoiceNumber(
  supplierId: string,
  invoiceNumber: string,
): Promise<{ id: string; expense_date: string; amount_ttc: number } | null> {
  const { data } = await supabase
    .from("expenses")
    .select("id, expense_date, amount_ttc")
    .eq("supplier_id", supplierId)
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();
  return (data as unknown as { id: string; expense_date: string; amount_ttc: number } | null) ?? null;
}

// ---------------------------------------------------------------------------
// Insertion des lignes d'articles (depuis l'IA)
// ---------------------------------------------------------------------------

export async function insertExpenseItems(args: {
  establishmentId: string;
  expenseId: string;
  expenseDate: string;
  supplierId: string | null;
  categoryId: string | null;
  items: AiExtraction["line_items"];
}): Promise<void> {
  const rows = (args.items ?? [])
    .filter((it) => it.description && it.description.trim())
    .map((it) => {
      const qty = typeof it.quantity === "number" ? it.quantity : null;
      const unit = typeof it.unit_price === "number" ? it.unit_price : null;
      return {
        establishment_id: args.establishmentId,
        expense_id:       args.expenseId,
        supplier_id:      args.supplierId,
        category_id:      args.categoryId,
        expense_date:     args.expenseDate,
        description:      it.description.trim(),
        normalized_label: normalizeLabel(it.description),
        quantity:         qty,
        unit_price:       unit,
        line_total:       qty != null && unit != null ? qty * unit : null,
      };
    });
  if (!rows.length) return;
  const { error } = await supabase.from("expense_items").insert(rows);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Détail d'une dépense : items extraits + URL signée du justificatif
// ---------------------------------------------------------------------------

export interface ExpenseItemRow {
  id: string;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
}

// Items d'une dépense. Si la table est vide (vieilles dépenses pré-migration),
// fallback sur ai_raw_json du document lié.
export async function fetchExpenseDetail(
  expenseId: string,
  documentId: string | null,
): Promise<{ items: ExpenseItemRow[]; aiRawJson: unknown | null }> {
  const { data: items } = await supabase
    .from("expense_items")
    .select("id, description, quantity, unit_price, line_total")
    .eq("expense_id", expenseId)
    .order("description");

  let fallback: ExpenseItemRow[] = [];
  let aiRawJson: unknown | null = null;
  if ((!items || items.length === 0) && documentId) {
    const { data: doc } = await supabase
      .from("documents")
      .select("ai_raw_json")
      .eq("id", documentId)
      .single();
    aiRawJson = doc?.ai_raw_json ?? null;
    const lineItems = (doc?.ai_raw_json as { line_items?: Array<{ description: string; quantity: number | null; unit_price: number | null }> } | null)?.line_items ?? [];
    fallback = lineItems.map((li, i) => ({
      id:          `fallback-${i}`,
      description: li.description ?? "",
      quantity:    li.quantity ?? null,
      unit_price:  li.unit_price ?? null,
      line_total:  li.quantity != null && li.unit_price != null ? li.quantity * li.unit_price : null,
    }));
  }

  return {
    items: (items ?? fallback) as ExpenseItemRow[],
    aiRawJson,
  };
}

export async function getDocumentSignedUrl(documentId: string, expiresIn = 3600): Promise<string | null> {
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .single();
  if (!doc?.storage_path) return null;
  const { data: signed } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, expiresIn);
  return signed?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Stats Fournisseurs
// ---------------------------------------------------------------------------

export interface SupplierStats {
  supplier: Supplier;
  total_amount: number;
  invoice_count: number;
  last_date: string | null;
}

export async function fetchSuppliersWithStats(): Promise<SupplierStats[]> {
  const [{ data: suppliers }, { data: expenses }] = await Promise.all([
    supabase.from("suppliers").select("*"),
    supabase.from("expenses").select("supplier_id, amount_ttc, expense_date"),
  ]);

  const map = new Map<string, { total: number; count: number; last: string | null }>();
  for (const e of expenses ?? []) {
    const k = e.supplier_id;
    if (!k) continue;
    const cur = map.get(k) ?? { total: 0, count: 0, last: null };
    cur.total += Number(e.amount_ttc ?? 0);
    cur.count += 1;
    if (!cur.last || e.expense_date > cur.last) cur.last = e.expense_date;
    map.set(k, cur);
  }

  return ((suppliers ?? []) as Supplier[])
    .map((s) => {
      const m = map.get(s.id) ?? { total: 0, count: 0, last: null };
      return { supplier: s, total_amount: m.total, invoice_count: m.count, last_date: m.last };
    })
    .sort((a, b) => b.total_amount - a.total_amount);
}

// ---------------------------------------------------------------------------
// Échéances / À payer
// ---------------------------------------------------------------------------

const ENRICHED_SELECT =
  "*, supplier:suppliers(name), category:categories(label), payer:profiles!expenses_payer_id_fkey(full_name)";

// Factures avec une date d'échéance, non encore réglées (triées par échéance).
export async function fetchPayables(): Promise<ExpenseListItem[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(ENRICHED_SELECT)
    .not("due_date", "is", null)
    .eq("paid", false)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseListItem[];
}

// Marque une facture comme réglée (ou annule).
export async function setExpensePaid(expenseId: string, paid: boolean): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq("id", expenseId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Notes de frais (remboursements)
// ---------------------------------------------------------------------------

export interface PayerReimbursement {
  payer_id: string;
  payer_name: string;
  items: ExpenseListItem[];
  total: number;
}

function groupByPayer(rows: ExpenseListItem[]): PayerReimbursement[] {
  const map = new Map<string, PayerReimbursement>();
  for (const e of rows) {
    const pid = e.payer_id ?? "?";
    const g = map.get(pid) ?? {
      payer_id: pid,
      payer_name: e.payer?.full_name ?? "Inconnu",
      items: [],
      total: 0,
    };
    g.items.push(e);
    g.total += Number(e.amount_ttc ?? 0);
    map.set(pid, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// À rembourser : avancé par un membre, pas encore remboursé.
export async function fetchPendingReimbursements(): Promise<PayerReimbursement[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(ENRICHED_SELECT)
    .eq("reimbursable", true)
    .eq("reimbursed", false)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return groupByPayer((data ?? []) as unknown as ExpenseListItem[]);
}

// Historique : déjà remboursé (archivé).
export async function fetchReimbursedHistory(): Promise<PayerReimbursement[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(ENRICHED_SELECT)
    .eq("reimbursable", true)
    .eq("reimbursed", true)
    .order("reimbursed_at", { ascending: false });
  if (error) throw error;
  return groupByPayer((data ?? []) as unknown as ExpenseListItem[]);
}

// Marque une dépense comme remboursée (ou annule).
export async function setExpenseReimbursed(expenseId: string, reimbursed: boolean): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ reimbursed, reimbursed_at: reimbursed ? new Date().toISOString() : null })
    .eq("id", expenseId);
  if (error) throw error;
}

// Marque TOUT le dû d'un membre comme remboursé en une fois.
export async function settlePayer(payerId: string): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ reimbursed: true, reimbursed_at: new Date().toISOString() })
    .eq("payer_id", payerId)
    .eq("reimbursable", true)
    .eq("reimbursed", false);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Événements (dépenses + recettes rattachées)
// ---------------------------------------------------------------------------

export interface EventRow {
  id: string;
  name: string;
  event_date: string | null;
  note: string | null;
}

export interface EventWithTotals extends EventRow {
  revenue: number; // total recettes rattachées
  expense: number; // total dépenses rattachées
  net: number;     // recettes − dépenses
}

// Recette simplifiée pour l'affichage dans un événement (montant total agrégé).
export interface EventRevenue {
  id: string;
  revenue_date: string;
  service: string;
  total: number;
}

function revTotal(r: { amount_cash: number; amount_cb: number; amount_other: number }): number {
  return Number(r.amount_cash ?? 0) + Number(r.amount_cb ?? 0) + Number(r.amount_other ?? 0);
}

// Liste des événements avec leur rentabilité.
export async function fetchEvents(): Promise<EventWithTotals[]> {
  const [{ data: events, error: e1 }, { data: exp, error: e2 }, { data: rev, error: e3 }] = await Promise.all([
    supabase.from("events").select("id, name, event_date, note").order("event_date", { ascending: false, nullsFirst: false }),
    supabase.from("expenses").select("event_id, amount_ttc").not("event_id", "is", null),
    supabase.from("revenues").select("event_id, amount_cash, amount_cb, amount_other").not("event_id", "is", null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const expMap = new Map<string, number>();
  for (const r of (exp ?? []) as Array<{ event_id: string; amount_ttc: number }>) {
    expMap.set(r.event_id, (expMap.get(r.event_id) ?? 0) + Number(r.amount_ttc ?? 0));
  }
  const revMap = new Map<string, number>();
  for (const r of (rev ?? []) as Array<{ event_id: string; amount_cash: number; amount_cb: number; amount_other: number }>) {
    revMap.set(r.event_id, (revMap.get(r.event_id) ?? 0) + revTotal(r));
  }
  return ((events ?? []) as EventRow[]).map((ev) => {
    const revenue = revMap.get(ev.id) ?? 0;
    const expense = expMap.get(ev.id) ?? 0;
    return { ...ev, revenue, expense, net: revenue - expense };
  });
}

export async function createEvent(
  establishmentId: string,
  name: string,
  eventDate: string | null,
  createdBy: string,
): Promise<EventRow> {
  const { data, error } = await supabase
    .from("events")
    .insert({ establishment_id: establishmentId, name: name.trim(), event_date: eventDate, created_by: createdBy })
    .select("id, name, event_date, note")
    .single();
  if (error || !data) throw error ?? new Error("event_create_failed");
  return data as EventRow;
}

// Dépenses / recettes rattachées à un événement (eventId), ou libres (null).
export async function fetchExpensesForEvent(eventId: string | null): Promise<ExpenseListItem[]> {
  let q = supabase.from("expenses").select(ENRICHED_SELECT).order("expense_date", { ascending: false });
  q = eventId === null ? q.is("event_id", null) : q.eq("event_id", eventId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseListItem[];
}

export async function fetchRevenuesForEvent(eventId: string | null): Promise<EventRevenue[]> {
  let q = supabase
    .from("revenues")
    .select("id, revenue_date, service, amount_cash, amount_cb, amount_other")
    .order("revenue_date", { ascending: false });
  q = eventId === null ? q.is("event_id", null) : q.eq("event_id", eventId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; revenue_date: string; service: string; amount_cash: number; amount_cb: number; amount_other: number }>)
    .map((r) => ({ id: r.id, revenue_date: r.revenue_date, service: r.service, total: revTotal(r) }));
}

// Rattacher / détacher un item (eventId = null pour détacher).
export async function setExpenseEvent(expenseId: string, eventId: string | null): Promise<void> {
  const { error } = await supabase.from("expenses").update({ event_id: eventId }).eq("id", expenseId);
  if (error) throw error;
}

export async function setRevenueEvent(revenueId: string, eventId: string | null): Promise<void> {
  const { error } = await supabase.from("revenues").update({ event_id: eventId }).eq("id", revenueId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Édition / suppression d'une dépense
// ---------------------------------------------------------------------------

// Change le payeur d'une dépense. payerId = null → la société (Azuria) a payé.
export async function updateExpensePayer(expenseId: string, payerId: string | null): Promise<void> {
  const isCompany = payerId === null;
  const { error } = await supabase
    .from("expenses")
    .update({
      payer_id: payerId,
      payment_source: isCompany ? "cb_pro" : "cb_perso",
      ...(isCompany ? { reimbursable: false, reimbursed: false } : {}),
    })
    .eq("id", expenseId);
  if (error) throw error;
}

// Suppression d'une dépense (+ son justificatif : fichier Storage + ligne documents).
export async function deleteExpense(expenseId: string, documentId?: string | null): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
  if (documentId) {
    const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", documentId).maybeSingle();
    const path = (doc as { storage_path?: string } | null)?.storage_path;
    if (path) { try { await supabase.storage.from("documents").remove([path]); } catch { /* best effort */ } }
    await supabase.from("documents").delete().eq("id", documentId);
  }
}

// ---------------------------------------------------------------------------
// Doublons de DÉPENSES (même facture saisie 2 fois)
// ---------------------------------------------------------------------------

export interface ExpenseDupGroup {
  key: string;
  items: ExpenseListItem[];
}

// Signature : même fournisseur + (même n° de facture) OU (même montant + même date).
export function findExpenseDuplicates(items: ExpenseListItem[]): ExpenseDupGroup[] {
  const map = new Map<string, ExpenseListItem[]>();
  for (const e of items) {
    const sup = e.supplier_id ?? (e.supplier?.name ?? "?").toLowerCase();
    const inv = (e.invoice_number ?? "").trim().toLowerCase();
    const amount = Number(e.amount_ttc || 0).toFixed(2);
    const key = inv ? `${sup}|inv:${inv}` : `${sup}|${amount}|${e.expense_date}`;
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()]
    .filter(([, a]) => a.length > 1)
    .map(([key, dupItems]) => ({ key, items: dupItems }));
}

// ---------------------------------------------------------------------------
// Rapprochement de fournisseurs (doublons)
// ---------------------------------------------------------------------------

// Normalise un nom pour repérer les doublons : minuscules, sans accents, sans
// forme juridique (EURL/SARL/SAS…), sans ponctuation.
export function normalizeSupplierName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(eurl|sarl|sasu|sas|sa|sci|eirl|ets|etablissement|etablissements|snc|scop|scea|gaec|earl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface SupplierDupGroup {
  key: string;
  members: SupplierStats[]; // ≥ 2 fournisseurs au même nom normalisé
}

// Groupe les fournisseurs qui semblent être le même (nom normalisé identique).
export function findSupplierDuplicates(suppliers: SupplierStats[]): SupplierDupGroup[] {
  const map = new Map<string, SupplierStats[]>();
  for (const s of suppliers) {
    const key = normalizeSupplierName(s.supplier.name);
    if (!key) continue;
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  return [...map.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, members]) => ({ key, members }));
}

// Fusionne des fournisseurs : réaffecte leurs dépenses vers `keepId` puis supprime
// les doublons.
export async function mergeSuppliers(keepId: string, dropIds: string[]): Promise<void> {
  for (const dropId of dropIds) {
    if (dropId === keepId) continue;
    const { error: e1 } = await supabase.from("expenses").update({ supplier_id: keepId }).eq("supplier_id", dropId);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("suppliers").delete().eq("id", dropId);
    if (e2) throw e2;
  }
}

// ---------------------------------------------------------------------------
// Helpers HT/TVA pour le prévisionnel
// ---------------------------------------------------------------------------

// Nombre de services que représente une saisie : une « journée » couvre midi + soir (2).
export function serviceUnits(service: string): number {
  return service === "journee" ? 2 : 1;
}

// CA HT d'une recette = TTC − TVA (déduite du taux par défaut faute de TVA stockée côté desktop).
export function revenueHT(
  r: { amount_cash: number; amount_cb: number; amount_other: number },
  defaultRate: number,
): number {
  const ttc = revTotal(r);
  return ttc / (1 + defaultRate / 100);
}

// HT d'une dépense : TTC − TVA (si la TVA est connue, sinon null).
export function expenseHT(e: Pick<Expense, "amount_ttc" | "amount_tva">): number | null {
  if (e.amount_tva == null) return null;
  return Number(e.amount_ttc) - Number(e.amount_tva);
}

// ---------------------------------------------------------------------------
// Stats Produits récurrents
// ---------------------------------------------------------------------------

export interface ProductStats {
  normalized_label: string;
  display_label: string;
  category_label: string | null;
  total_qty: number;
  total_spent: number;
  avg_unit_price: number | null;
  min_unit_price: number | null;
  max_unit_price: number | null;
  occurrences: number;          // nb de factures où on retrouve ce produit
  last_date: string | null;
  avg_days_between: number | null; // fréquence moyenne d'achat
  price_trend: "up" | "down" | "stable" | "unknown";
}

export async function fetchProductStats(filters: {
  from?: string;
  to?: string;
  categoryId?: string;
}): Promise<ProductStats[]> {
  let q = supabase
    .from("expense_items")
    .select(
      "normalized_label, description, quantity, unit_price, line_total, expense_date, category:categories(label)",
    );
  if (filters.from) q = q.gte("expense_date", filters.from);
  if (filters.to) q = q.lte("expense_date", filters.to);
  if (filters.categoryId) q = q.eq("category_id", filters.categoryId);

  const { data, error } = await q;
  if (error) throw error;

  // Group by normalized_label
  const groups = new Map<
    string,
    {
      display: string;
      catLabel: string | null;
      totalQty: number;
      totalSpent: number;
      prices: { date: string; price: number }[];
      dates: string[];
    }
  >();

  for (const row of (data ?? []) as unknown as Array<{
    normalized_label: string;
    description: string;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
    expense_date: string;
    category: { label: string } | null;
  }>) {
    const k = row.normalized_label;
    if (!k) continue;
    const g =
      groups.get(k) ??
      { display: row.description, catLabel: row.category?.label ?? null, totalQty: 0, totalSpent: 0, prices: [], dates: [] };

    g.totalQty   += Number(row.quantity ?? 0);
    g.totalSpent += Number(row.line_total ?? (row.unit_price != null && row.quantity != null ? row.quantity * row.unit_price : 0));
    if (row.unit_price != null) g.prices.push({ date: row.expense_date, price: Number(row.unit_price) });
    g.dates.push(row.expense_date);

    groups.set(k, g);
  }

  const out: ProductStats[] = [];
  for (const [normLabel, g] of groups.entries()) {
    const priceVals = g.prices.map((p) => p.price);
    const avgP = priceVals.length ? priceVals.reduce((a, b) => a + b, 0) / priceVals.length : null;
    const minP = priceVals.length ? Math.min(...priceVals) : null;
    const maxP = priceVals.length ? Math.max(...priceVals) : null;

    // Tendance prix : compare la moyenne des prix de la 1re moitié vs 2e moitié
    let trend: ProductStats["price_trend"] = "unknown";
    if (g.prices.length >= 3) {
      const sorted = [...g.prices].sort((a, b) => a.date.localeCompare(b.date));
      const mid = Math.floor(sorted.length / 2);
      const early = sorted.slice(0, mid).map((p) => p.price);
      const late  = sorted.slice(mid).map((p) => p.price);
      const eAvg = early.reduce((a, b) => a + b, 0) / early.length;
      const lAvg = late.reduce((a, b) => a + b, 0) / late.length;
      const diff = (lAvg - eAvg) / eAvg;
      if (diff > 0.05) trend = "up";
      else if (diff < -0.05) trend = "down";
      else trend = "stable";
    }

    // Fréquence moyenne (en jours) entre 2 occurrences
    const datesSorted = [...new Set(g.dates)].sort();
    let avgDays: number | null = null;
    if (datesSorted.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < datesSorted.length; i++) {
        const a = new Date(datesSorted[i - 1] ?? "");
        const b = new Date(datesSorted[i] ?? "");
        diffs.push((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
      }
      avgDays = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    }

    out.push({
      normalized_label: normLabel,
      display_label:    g.display,
      category_label:   g.catLabel,
      total_qty:        g.totalQty,
      total_spent:      g.totalSpent,
      avg_unit_price:   avgP,
      min_unit_price:   minP,
      max_unit_price:   maxP,
      occurrences:      g.dates.length,
      last_date:        datesSorted[datesSorted.length - 1] ?? null,
      avg_days_between: avgDays,
      price_trend:      trend,
    });
  }

  return out.sort((a, b) => b.total_spent - a.total_spent);
}

// ---------------------------------------------------------------------------
// Rapprochement bancaire
// ---------------------------------------------------------------------------

// Dépenses candidates au pointage : non encore rapprochées, avec nom fournisseur.
export async function fetchExpensesForReconcile(): Promise<ReconcileExpense[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("id, expense_date, amount_ttc, supplier_id, invoice_number, note, reconciled, supplier:suppliers(name)")
    .eq("reconciled", false)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string; expense_date: string; amount_ttc: number; supplier_id: string | null;
    invoice_number: string | null; note: string | null; supplier: { name: string } | null;
  }>).map((r) => ({
    id: r.id,
    expense_date: r.expense_date,
    amount_ttc: Number(r.amount_ttc),
    supplier_id: r.supplier_id,
    supplier_name: r.supplier?.name ?? null,
    invoice_number: r.invoice_number,
    note: r.note,
  }));
}

export interface BankTxRow {
  id: string;
  tx_date: string;
  label: string;
  amount: number;
  direction: BankTxDirection;
  status: BankTxStatus;
  matched_expense_id: string | null;
}

// Liste des opérations bancaires déjà importées (les plus récentes d'abord).
export async function fetchBankTransactions(): Promise<BankTxRow[]> {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("id, tx_date, label, amount, direction, status, matched_expense_id")
    .order("tx_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BankTxRow[];
}

// Enregistre un import : insère les opérations + marque les dépenses pointées.
export async function commitBankReconciliation(args: {
  establishmentId: string;
  createdBy: string;
  importBatch: string;
  rows: Array<{ tx: ParsedBankTx; matchedExpenseId: string | null; status: BankTxStatus }>;
}): Promise<void> {
  const inserts = args.rows.map((r) => ({
    establishment_id:   args.establishmentId,
    import_batch:       args.importBatch,
    tx_date:            r.tx.date,
    label:              r.tx.label,
    amount:             r.tx.amount,
    direction:          r.tx.direction,
    matched_expense_id: r.matchedExpenseId,
    status:             r.status,
    raw_json:           r.tx as unknown as Record<string, unknown>,
    created_by:         args.createdBy,
  }));
  if (inserts.length) {
    const { error } = await supabase.from("bank_transactions").insert(inserts);
    if (error) throw error;
  }
  // Marque pointées les dépenses rapprochées.
  const matchedIds = args.rows.map((r) => r.matchedExpenseId).filter((x): x is string => !!x);
  if (matchedIds.length) {
    const { error } = await supabase.from("expenses").update({ reconciled: true }).in("id", matchedIds);
    if (error) throw error;
  }
}

// Annule le pointage d'une opération (et dé-rapproche la dépense liée).
export async function unmatchBankTransaction(txId: string, expenseId: string | null): Promise<void> {
  const { error } = await supabase
    .from("bank_transactions")
    .update({ status: "unmatched", matched_expense_id: null })
    .eq("id", txId);
  if (error) throw error;
  if (expenseId) {
    await supabase.from("expenses").update({ reconciled: false }).eq("id", expenseId);
  }
}
