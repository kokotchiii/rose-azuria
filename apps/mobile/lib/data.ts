// Couche données mobile : requêtes Supabase pour tous les écrans.
// (Réplique l'essentiel de apps/desktop/src/lib — à consolider dans @resto/shared plus tard.)

import { supabase } from "../supabaseClient";
import type { Expense, Supplier } from "@resto/shared";

// ---------- Dépenses ----------
export interface ExpenseListItem extends Expense {
  supplier?: { name: string } | null;
  category?: { label: string } | null;
  payer?: { full_name: string | null } | null;
}

export async function fetchExpenses(filters: {
  from?: string;
  to?: string;
} = {}): Promise<ExpenseListItem[]> {
  let q = supabase
    .from("expenses")
    .select(
      "*, supplier:suppliers(name), category:categories(label), payer:profiles!expenses_payer_id_fkey(full_name)",
    )
    .order("expense_date", { ascending: false });
  if (filters.from) q = q.gte("expense_date", filters.from);
  if (filters.to) q = q.lte("expense_date", filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseListItem[];
}

// ---------- Fournisseurs (avec stats) ----------
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
  for (const e of (expenses ?? []) as Array<{ supplier_id: string | null; amount_ttc: number; expense_date: string }>) {
    if (!e.supplier_id) continue;
    const cur = map.get(e.supplier_id) ?? { total: 0, count: 0, last: null };
    cur.total += Number(e.amount_ttc ?? 0);
    cur.count += 1;
    if (!cur.last || e.expense_date > cur.last) cur.last = e.expense_date;
    map.set(e.supplier_id, cur);
  }
  return ((suppliers ?? []) as Supplier[])
    .map((s) => {
      const m = map.get(s.id) ?? { total: 0, count: 0, last: null };
      return { supplier: s, total_amount: m.total, invoice_count: m.count, last_date: m.last };
    })
    .sort((a, b) => b.total_amount - a.total_amount);
}

// ---------- Produits récurrents ----------
export interface ProductStats {
  normalized_label: string;
  display_label: string;
  category_label: string | null;
  total_qty: number;
  total_spent: number;
  avg_unit_price: number | null;
  occurrences: number;
  last_date: string | null;
  price_trend: "up" | "down" | "stable" | "unknown";
}

export async function fetchProductStats(): Promise<ProductStats[]> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("normalized_label, description, quantity, unit_price, line_total, expense_date, category:categories(label)");
  if (error) throw error;

  const groups = new Map<string, {
    display: string; catLabel: string | null; totalQty: number; totalSpent: number;
    prices: { date: string; price: number }[]; dates: string[];
  }>();

  for (const row of (data ?? []) as unknown as Array<{
    normalized_label: string; description: string; quantity: number | null;
    unit_price: number | null; line_total: number | null; expense_date: string;
    category: { label: string } | null;
  }>) {
    const k = row.normalized_label;
    if (!k) continue;
    const g = groups.get(k) ?? { display: row.description, catLabel: row.category?.label ?? null, totalQty: 0, totalSpent: 0, prices: [], dates: [] };
    g.totalQty += Number(row.quantity ?? 0);
    g.totalSpent += Number(row.line_total ?? (row.unit_price != null && row.quantity != null ? row.quantity * row.unit_price : 0));
    if (row.unit_price != null) g.prices.push({ date: row.expense_date, price: Number(row.unit_price) });
    g.dates.push(row.expense_date);
    groups.set(k, g);
  }

  const out: ProductStats[] = [];
  for (const [norm, g] of groups.entries()) {
    const prices = g.prices.map((p) => p.price);
    const avgP = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    let trend: ProductStats["price_trend"] = "unknown";
    if (g.prices.length >= 3) {
      const sorted = [...g.prices].sort((a, b) => a.date.localeCompare(b.date));
      const mid = Math.floor(sorted.length / 2);
      const early = sorted.slice(0, mid).map((p) => p.price);
      const late = sorted.slice(mid).map((p) => p.price);
      const eAvg = early.reduce((a, b) => a + b, 0) / early.length;
      const lAvg = late.reduce((a, b) => a + b, 0) / late.length;
      const diff = (lAvg - eAvg) / eAvg;
      trend = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "stable";
    }
    const datesSorted = [...new Set(g.dates)].sort();
    out.push({
      normalized_label: norm, display_label: g.display, category_label: g.catLabel,
      total_qty: g.totalQty, total_spent: g.totalSpent, avg_unit_price: avgP,
      occurrences: g.dates.length, last_date: datesSorted[datesSorted.length - 1] ?? null, price_trend: trend,
    });
  }
  return out.sort((a, b) => b.total_spent - a.total_spent);
}

// ---------- Recettes ----------
export type Service = "midi" | "soir" | "journee" | "autre";
export interface RevenueRow {
  id: string;
  revenue_date: string;
  service: Service;
  amount_cash: number;
  amount_cb: number;
  amount_other: number;
  covers: number | null;
  note: string | null;
}

export async function fetchRevenues(filters: { from?: string; to?: string } = {}): Promise<RevenueRow[]> {
  let q = supabase.from("revenues").select("*").order("revenue_date", { ascending: false }).order("service");
  if (filters.from) q = q.gte("revenue_date", filters.from);
  if (filters.to) q = q.lte("revenue_date", filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RevenueRow[];
}

export async function upsertRevenue(args: {
  establishment_id: string;
  revenue_date: string;
  service: Service;
  amount_cash: number;
  amount_cb: number;
  amount_other: number;
  covers: number | null;
  note: string | null;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase
    .from("revenues")
    .upsert(args, { onConflict: "establishment_id,revenue_date,service" });
  if (error) throw error;
}

export function revenueTotal(r: Pick<RevenueRow, "amount_cash" | "amount_cb" | "amount_other">): number {
  return Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);
}

// ---------- Tâches (À faire) ----------
export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
}

export async function fetchTasks(): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, status, priority, due_date")
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

export async function createTask(args: {
  establishment_id: string;
  title: string;
  priority: TaskPriority;
  due_date: string | null;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase.from("tasks").insert({
    establishment_id: args.establishment_id,
    title: args.title,
    priority: args.priority,
    due_date: args.due_date,
    created_by: args.created_by,
  });
  if (error) throw error;
}

export async function setTaskStatus(id: string, status: TaskStatus, userId: string): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (status === "done") {
    update.completed_at = new Date().toISOString();
    update.completed_by = userId;
  } else {
    update.completed_at = null;
    update.completed_by = null;
  }
  const { error } = await supabase.from("tasks").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Coût IA du mois en cours (USD) ----------
export async function fetchAiCostThisMonth(): Promise<{ total: number; count: number }> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data, error } = await supabase.from("ai_usage").select("cost_usd").gte("created_at", from);
  if (error) return { total: 0, count: 0 }; // table absente / non déployée → 0
  const rows = (data ?? []) as Array<{ cost_usd: number }>;
  return { total: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0), count: rows.length };
}
