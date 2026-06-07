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

// ---------- Notes de frais (remboursements) ----------
// Regroupe les dépenses avancées par un membre (reimbursable) par payeur,
// pour voir en temps réel qui doit se faire rembourser combien et pour quoi.
export interface PayerReimbursement {
  payer_id: string;
  payer_name: string;
  items: ExpenseListItem[];
  total: number;
}

const REIMB_SELECT =
  "*, supplier:suppliers(name), category:categories(label), payer:profiles!expenses_payer_id_fkey(full_name)";

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
    .select(REIMB_SELECT)
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
    .select(REIMB_SELECT)
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

// ---------- Événements (dépenses + recettes) ----------
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
    revMap.set(r.event_id, (revMap.get(r.event_id) ?? 0) + revenueTotal(r));
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
  let q = supabase.from("expenses").select(REIMB_SELECT).order("expense_date", { ascending: false });
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
    .map((r) => ({ id: r.id, revenue_date: r.revenue_date, service: r.service, total: revenueTotal(r) }));
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

// Membres de l'établissement (pour le choix « qui a payé »).
export interface Member {
  id: string;
  full_name: string | null;
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase.from("profiles").select("id, full_name");
  if (error) throw error;
  return (data ?? []) as Member[];
}

// Change le payeur d'une dépense. payerId = null → la société (Azuria) a payé.
// On aligne payment_source comme à la saisie : société = cb_pro, membre = cb_perso.
export async function updateExpensePayer(
  expenseId: string,
  payerId: string | null,
): Promise<void> {
  const isCompany = payerId === null;
  const { error } = await supabase
    .from("expenses")
    .update({
      payer_id: payerId,
      payment_source: isCompany ? "cb_pro" : "cb_perso",
      // Société → plus rien à rembourser. (Le trigger remet true si cb_perso.)
      ...(isCompany ? { reimbursable: false, reimbursed: false } : {}),
    })
    .eq("id", expenseId);
  if (error) throw error;
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

// Modifier une recette existante (ex. changer le service soir → journée).
export async function updateRevenue(
  id: string,
  fields: {
    revenue_date: string;
    service: Service;
    amount_cash: number;
    amount_cb: number;
    amount_other: number;
    covers: number | null;
  },
): Promise<void> {
  const { error } = await supabase.from("revenues").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deleteRevenue(id: string): Promise<void> {
  const { error } = await supabase.from("revenues").delete().eq("id", id);
  if (error) throw error;
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
