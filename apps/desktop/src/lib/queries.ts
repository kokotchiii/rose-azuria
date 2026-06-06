// Queries DB partagées (catégories, fournisseurs, dépenses, items).
// RLS s'occupe d'isoler l'établissement, on n'a pas à filtrer manuellement.

import type { Category, Supplier, Expense, Profile, AiExtraction } from "@resto/shared";
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
  if (!docs?.length) return null;
  const documentId = docs[0].id as string;
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

  for (const row of (data ?? []) as Array<{
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
