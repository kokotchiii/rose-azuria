// Couche données mobile : requêtes Supabase pour tous les écrans.
// (Réplique l'essentiel de apps/desktop/src/lib — à consolider dans @resto/shared plus tard.)

import { supabase } from "../supabaseClient";
import type {
  Expense, Supplier, ReconcileExpense, ParsedBankTx, BankTxDirection, BankTxStatus,
  AiExtraction, PaymentSource,
} from "@resto/shared";

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

// Pointe (ou dé-pointe) la vérification du justificatif papier d'une note de frais.
export async function setExpenseJustifVerified(expenseId: string, verified: boolean): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ justif_verified: verified, justif_verified_at: verified ? new Date().toISOString() : null })
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

// Créer une dépense d'événement avec juste un montant (pas de justificatif).
export async function createEventExpense(args: {
  establishmentId: string; createdBy: string; eventId: string;
  amount: number; label: string | null; date: string;
}): Promise<void> {
  const { error } = await supabase.from("expenses").insert({
    establishment_id: args.establishmentId, kind: "depannage", expense_date: args.date,
    amount_ttc: args.amount, note: args.label, event_id: args.eventId,
    payment_source: "especes", paid: true, paid_at: args.date, reimbursable: false,
    created_by: args.createdBy,
  });
  if (error) throw error;
}

// Upload simple d'un fichier (facture émise) → ligne documents, renvoie l'id.
export async function uploadEventDocument(args: {
  establishmentId: string; uploadedBy: string;
  file: Uint8Array | ArrayBuffer | Blob; fileName: string; contentType: string;
}): Promise<string> {
  const now = new Date();
  const safe = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${args.establishmentId}/events/${now.getFullYear()}/${now.getTime()}-${safe}`;
  const { error: upErr } = await supabase.storage.from("documents").upload(path, args.file, { contentType: args.contentType, upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from("documents")
    .insert({ establishment_id: args.establishmentId, storage_path: path, file_type: args.contentType, uploaded_by: args.uploadedBy, ai_status: "done" })
    .select("id").single();
  if (error || !data) throw error ?? new Error("doc_insert_failed");
  return (data as { id: string }).id;
}

// Créer une recette d'événement (facture émise) : montant + date + document optionnel.
export async function createEventRevenue(args: {
  establishmentId: string; createdBy: string; eventId: string;
  amount: number; date: string; documentId: string | null;
}): Promise<void> {
  const { error } = await supabase.from("revenues").insert({
    establishment_id: args.establishmentId, revenue_date: args.date, service: "autre",
    amount_cash: 0, amount_cb: 0, amount_other: args.amount, covers: null, tables_count: null,
    event_id: args.eventId, document_id: args.documentId, created_by: args.createdBy,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("Une recette « autre » existe déjà à cette date. Change la date.");
    throw error;
  }
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
  tva_rate: number | null;   // taux TVA (%) ; null = taux par défaut de l'app
  tva_amount: number | null; // TVA collectée saisie en € ; prime sur tva_rate si renseigné
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
  tva_rate: number | null;
  tva_amount: number | null;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase
    .from("revenues")
    .upsert(args, { onConflict: "establishment_id,revenue_date,service" });
  if (error) throw error;
}

// CA TTC d'une recette (somme des encaissements).
export function revenueTotal(r: Pick<RevenueRow, "amount_cash" | "amount_cb" | "amount_other">): number {
  return Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);
}

// Nombre de services que représente une saisie : une « journée » couvre midi + soir (2).
export function serviceUnits(service: Service): number {
  return service === "journee" ? 2 : 1;
}

// TVA collectée : montant saisi manuellement s'il existe, sinon calculé depuis le taux.
export function revenueTVA(r: RevenueRow, defaultRate: number): number {
  if (r.tva_amount != null) return Number(r.tva_amount);
  const rate = r.tva_rate ?? defaultRate;
  const ttc = revenueTotal(r);
  return ttc - ttc / (1 + rate / 100);
}

// CA HT = TTC − TVA collectée.
export function revenueHT(r: RevenueRow, defaultRate: number): number {
  return revenueTotal(r) - revenueTVA(r, defaultRate);
}

// HT d'une dépense : TTC − TVA (si la TVA est connue, sinon HT inconnu → null).
export function expenseHT(e: Pick<Expense, "amount_ttc" | "amount_tva">): number | null {
  if (e.amount_tva == null) return null;
  return Number(e.amount_ttc) - Number(e.amount_tva);
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
    tva_rate: number | null;
    tva_amount: number | null;
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

// ---------- Travaux & dépenses à prévoir ----------
export type PlanStatus = "idea" | "planned" | "done";
export interface PlannedExpense {
  id: string;
  label: string;
  description: string | null;
  estimated_amount: number;
  category: string | null;
  priority: TaskPriority;
  target_date: string | null;
  status: PlanStatus;
}

// Lecture résiliente : si la table n'est pas encore migrée, renvoie [].
export async function fetchPlannedExpenses(): Promise<PlannedExpense[]> {
  const { data, error } = await supabase
    .from("planned_expenses")
    .select("id, label, description, estimated_amount, category, priority, target_date, status")
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("target_date", { ascending: true, nullsFirst: false });
  if (error) return []; // table absente / non déployée
  return (data ?? []) as PlannedExpense[];
}

export async function createPlannedExpense(args: {
  establishment_id: string;
  label: string;
  estimated_amount: number;
  category: string | null;
  priority: TaskPriority;
  target_date: string | null;
  status: PlanStatus;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase.from("planned_expenses").insert(args);
  if (error) throw error;
}

export async function updatePlannedExpense(
  id: string,
  fields: Partial<{
    label: string;
    description: string | null;
    estimated_amount: number;
    category: string | null;
    priority: TaskPriority;
    target_date: string | null;
    status: PlanStatus;
  }>,
): Promise<void> {
  const { error } = await supabase.from("planned_expenses").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deletePlannedExpense(id: string): Promise<void> {
  const { error } = await supabase.from("planned_expenses").delete().eq("id", id);
  if (error) throw error;
}

// Épargne mensuelle estimée = (recettes − dépenses) moyennées sur les N derniers mois.
export async function fetchMonthlyNet(months = 3): Promise<{ monthlyNet: number; revenue: number; expense: number }> {
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const fromIso = from.toISOString().slice(0, 10);
  const [{ data: exp }, { data: rev }] = await Promise.all([
    supabase.from("expenses").select("amount_ttc").gte("expense_date", fromIso),
    supabase.from("revenues").select("amount_cash, amount_cb, amount_other").gte("revenue_date", fromIso),
  ]);
  const expense = ((exp ?? []) as Array<{ amount_ttc: number }>).reduce((s, e) => s + Number(e.amount_ttc ?? 0), 0);
  const revenue = ((rev ?? []) as Array<{ amount_cash: number; amount_cb: number; amount_other: number }>).reduce((s, r) => s + revenueTotal(r), 0);
  return { monthlyNet: (revenue - expense) / months, revenue, expense };
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

// ---------- Justificatif (document) d'une dépense ----------
// Le bucket "documents" est privé → on génère une URL signée temporaire (1 h).
export async function getDocumentSignedUrl(
  documentId: string,
): Promise<{ url: string; type: string | null } | null> {
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, file_type")
    .eq("id", documentId)
    .maybeSingle();
  const d = doc as { storage_path?: string; file_type?: string | null } | null;
  if (!d?.storage_path) return null;
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 3600);
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, type: d.file_type ?? null };
}

// ---------- Rapprochement de fournisseurs (doublons) ----------
// Normalise un nom pour repérer les doublons : minuscules, sans accents, sans
// forme juridique (EURL/SARL/SAS…), sans ponctuation. "EURL Sud Primeurs" et
// "Sud Primeurs" donnent la même clé.
export function normalizeSupplierName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(eurl|sarl|sasu|sas|sa|sci|eirl|ets|ets\.|etablissement|etablissements|snc|scop|scea|gaec|earl)\b/g, " ")
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
// les doublons. (expenses.supplier_id → on delete set null, mais on réaffecte avant.)
export async function mergeSuppliers(keepId: string, dropIds: string[]): Promise<void> {
  for (const dropId of dropIds) {
    if (dropId === keepId) continue;
    const { error: e1 } = await supabase.from("expenses").update({ supplier_id: keepId }).eq("supplier_id", dropId);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("suppliers").delete().eq("id", dropId);
    if (e2) throw e2;
  }
}

// ---------- Suppression d'une dépense (+ son justificatif) ----------
export async function deleteExpense(expenseId: string, documentId?: string | null): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
  // Supprime aussi le justificatif lié (fichier Storage + ligne documents).
  if (documentId) {
    const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", documentId).maybeSingle();
    const path = (doc as { storage_path?: string } | null)?.storage_path;
    if (path) { try { await supabase.storage.from("documents").remove([path]); } catch { /* best effort */ } }
    await supabase.from("documents").delete().eq("id", documentId);
  }
}

// ---------- Doublons de DÉPENSES (même facture saisie 2 fois) ----------
// Signature : même fournisseur + (même n° de facture) OU (même montant + même date).
export interface ExpenseDupGroup {
  key: string;
  items: ExpenseListItem[];
}

export function findExpenseDuplicates(items: ExpenseListItem[]): ExpenseDupGroup[] {
  const map = new Map<string, ExpenseListItem[]>();
  for (const e of items) {
    const sup = e.supplier_id ?? (e.supplier?.name ?? "?").toLowerCase();
    const inv = (e.invoice_number ?? "").trim().toLowerCase();
    const amount = Number(e.amount_ttc || 0).toFixed(2);
    // Si un n° de facture est connu, il prime (le plus fiable). Sinon montant + date.
    const key = inv ? `${sup}|inv:${inv}` : `${sup}|${amount}|${e.expense_date}`;
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()]
    .filter(([, a]) => a.length > 1)
    .map(([key, dupItems]) => ({ key, items: dupItems }));
}

// ---------- Détection de doublons à la saisie ----------
export async function findDuplicateByInvoiceNumber(
  supplierId: string, invoiceNumber: string,
): Promise<{ id: string; expense_date: string; amount_ttc: number } | null> {
  const { data } = await supabase
    .from("expenses")
    .select("id, expense_date, amount_ttc")
    .eq("supplier_id", supplierId)
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();
  return (data as unknown as { id: string; expense_date: string; amount_ttc: number } | null) ?? null;
}

// Même fournisseur + même montant + date proche (± windowDays), sans n° de facture.
export async function findDuplicateBySupplierAmount(
  supplierId: string, amountTtc: number, date: string, windowDays = 4,
): Promise<{ id: string; expense_date: string; amount_ttc: number } | null> {
  const d = new Date(date + "T00:00:00");
  const from = new Date(d); from.setDate(d.getDate() - windowDays);
  const to = new Date(d); to.setDate(d.getDate() + windowDays);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const { data } = await supabase
    .from("expenses")
    .select("id, expense_date, amount_ttc")
    .eq("supplier_id", supplierId)
    .gte("expense_date", iso(from)).lte("expense_date", iso(to))
    .gte("amount_ttc", amountTtc - 0.01).lte("amount_ttc", amountTtc + 0.01)
    .limit(1);
  return ((data ?? [])[0] as { id: string; expense_date: string; amount_ttc: number } | undefined) ?? null;
}

// ---------- Factures fournisseurs ----------
// Toutes les factures (kind=facture), payées ou non.
export async function fetchInvoices(): Promise<ExpenseListItem[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(REIMB_SELECT)
    .eq("kind", "facture")
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseListItem[];
}

// ---------- Échéances / À payer ----------
// Factures avec une date d'échéance, non encore réglées (triées par échéance).
export async function fetchPayables(): Promise<ExpenseListItem[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(REIMB_SELECT)
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

// ---------- Rapprochement bancaire ----------

// Dépenses candidates au pointage : non rapprochées, avec nom fournisseur.
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

export async function fetchBankTransactions(): Promise<BankTxRow[]> {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("id, tx_date, label, amount, direction, status, matched_expense_id")
    .order("tx_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BankTxRow[];
}

// Contrôle des recettes : les crédits du relevé = l'argent réellement encaissé.
export interface BankCreditRow { tx_date: string; label: string; amount: number; }

export async function fetchBankCredits(from: string, to: string): Promise<BankCreditRow[]> {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("tx_date, label, amount")
    .eq("direction", "credit")
    .gte("tx_date", from)
    .lte("tx_date", to)
    .order("tx_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BankCreditRow[];
}

export type CreditKind = "carte" | "especes" | "autre";

export function classifyCredit(label: string): CreditKind {
  const l = (label || "").toUpperCase();
  if (/REMISE\s*(C\.?\s*B|CARTE|COMMER|TPE|BANCAIRE)/.test(l) || /\bTPE\b/.test(l)) return "carte";
  if (/VERST|VERSEMENT|VERS\.?\s*ESP|REMISE\s*ESP|DEPOT\s*ESP|ESPECES|NUMERAIRE/.test(l)) return "especes";
  return "autre";
}

// Rapprochement inversé : pointe les justificatifs qui correspondent à une
// opération non pointée (même montant, date proche).
// Paiement plausible : entre ~1 semaine avant la facture et ~120 jours après
// (délais fournisseurs 30/60/90 j). Plus réaliste qu'un simple ±5 jours.
function paymentPlausible(expenseDate: string, txDate: string): boolean {
  const inv = new Date(expenseDate + "T00:00:00").getTime();
  const pay = new Date(txDate + "T00:00:00").getTime();
  const diffDays = Math.round((pay - inv) / 86_400_000);
  return Math.abs(diffDays) <= 150;
}

function guessPaymentSource(label: string): "cb_pro" | "virement" | "especes" | null {
  const l = (label || "").toUpperCase();
  if (/\bCARTE\b|\bCB\b/.test(l)) return "cb_pro";
  if (/PRLV|PRELEV|\bVIR\b|VIREMENT|ECHEANCE\s*PRET/.test(l)) return "virement";
  if (/RETRAIT|\bDAB\b|ESPECES/.test(l)) return "especes";
  return null;
}

export interface AutoReconcileResult {
  matched: number;
  details: Array<{ label: string; amount: number; date: string; supplier: string | null }>;
}

export async function autoReconcileUnmatched(toleranceDays = 5): Promise<AutoReconcileResult> {
  const { data: txs, error: e1 } = await supabase
    .from("bank_transactions")
    .select("id, tx_date, label, amount, direction, status")
    .eq("direction", "debit").eq("status", "unmatched")
    .order("tx_date", { ascending: true });
  if (e1) throw e1;
  const { data: exps, error: e2 } = await supabase
    .from("expenses")
    .select("id, expense_date, amount_ttc, reconciled, supplier:suppliers(name)")
    .eq("reconciled", false);
  if (e2) throw e2;

  const expenses = (exps ?? []) as unknown as Array<{
    id: string; expense_date: string; amount_ttc: number; supplier: { name: string } | null;
  }>;
  const used = new Set<string>();
  const details: AutoReconcileResult["details"] = [];
  for (const tx of (txs ?? []) as Array<{ id: string; tx_date: string; label: string; amount: number }>) {
    const amt = Number(tx.amount);
    const cands = expenses.filter(
      (e) => !used.has(e.id) && Math.abs(Number(e.amount_ttc) - amt) < 0.01 && paymentPlausible(e.expense_date, tx.tx_date),
    );
    if (cands.length !== 1) continue;
    const e = cands[0];
    if (!e) continue;
    used.add(e.id);
    const upd: Record<string, unknown> = { reconciled: true, paid: true, paid_at: tx.tx_date };
    const ps = guessPaymentSource(tx.label);
    if (ps) upd.payment_source = ps;
    const { error: uE } = await supabase
      .from("expenses").update(upd).eq("id", e.id);
    if (uE) continue;
    await supabase.from("bank_transactions").update({ status: "matched", matched_expense_id: e.id }).eq("id", tx.id);
    details.push({ label: tx.label, amount: amt, date: tx.tx_date, supplier: e.supplier?.name ?? null });
  }
  return { matched: details.length, details };
}

export async function autoMatchExpense(
  expenseId: string, amount: number, date: string, toleranceDays = 5,
): Promise<{ matched: boolean; label?: string; txDate?: string }> {
  const { data: txs, error } = await supabase
    .from("bank_transactions")
    .select("id, tx_date, label, amount")
    .eq("direction", "debit").eq("status", "unmatched");
  if (error) throw error;
  const cands = ((txs ?? []) as Array<{ id: string; tx_date: string; label: string; amount: number }>)
    .filter((t) => Math.abs(Number(t.amount) - amount) < 0.01 && paymentPlausible(date, t.tx_date));
  if (cands.length !== 1) return { matched: false };
  const tx = cands[0];
  if (!tx) return { matched: false };
  const upd: Record<string, unknown> = { reconciled: true, paid: true, paid_at: tx.tx_date };
  const ps = guessPaymentSource(tx.label);
  if (ps) upd.payment_source = ps;
  const { error: uE } = await supabase
    .from("expenses").update(upd).eq("id", expenseId);
  if (uE) throw uE;
  await supabase.from("bank_transactions").update({ status: "matched", matched_expense_id: expenseId }).eq("id", tx.id);
  return { matched: true, label: tx.label, txDate: tx.tx_date };
}

// ---------------------------------------------------------------------------
// Boîte de réception e-mail (factures reçues par mail, à valider).
// ---------------------------------------------------------------------------
export interface InboxDoc {
  id: string;
  storage_path: string;
  email_from: string | null;
  email_subject: string | null;
  email_received_at: string | null;
  ai_status: "pending" | "done" | "failed";
  extraction: AiExtraction | null;
}

export async function fetchEmailInbox(): Promise<InboxDoc[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, storage_path, email_from, email_subject, email_received_at, ai_status, ai_raw_json")
    .eq("source", "email").eq("review_status", "pending")
    .order("email_received_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((d) => ({
    id: d.id as string,
    storage_path: d.storage_path as string,
    email_from: (d.email_from as string) ?? null,
    email_subject: (d.email_subject as string) ?? null,
    email_received_at: (d.email_received_at as string) ?? null,
    ai_status: (d.ai_status as InboxDoc["ai_status"]) ?? "pending",
    extraction: (d.ai_raw_json as AiExtraction) ?? null,
  }));
}

export async function countEmailInbox(): Promise<number> {
  const { count, error } = await supabase
    .from("documents").select("id", { count: "exact", head: true })
    .eq("source", "email").eq("review_status", "pending");
  if (error) return 0;
  return count ?? 0;
}

export async function ignoreInboxDocument(id: string): Promise<void> {
  const { error } = await supabase.from("documents").update({ review_status: "ignored" }).eq("id", id);
  if (error) throw error;
}

async function inboxFindOrCreateSupplier(name: string, establishmentId: string): Promise<string> {
  const trimmed = name.trim();
  const { data: existing } = await supabase
    .from("suppliers").select("id").eq("establishment_id", establishmentId).ilike("name", trimmed).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("suppliers").insert({ establishment_id: establishmentId, name: trimmed }).select("id").single();
  if (error || !created) throw new Error(`supplier_create_failed: ${error?.message}`);
  return created.id as string;
}

export async function validateInboxDocument(args: {
  documentId: string; establishmentId: string; createdBy: string;
  kind: "facture" | "depannage"; supplierName: string | null; categoryId: string | null;
  expenseDate: string; dueDate: string | null; amountTtc: number; tvaRate: number | null; amountTva: number | null;
  paymentSource: PaymentSource; invoiceNumber: string | null; paid: boolean; note: string | null;
}): Promise<{ matched: boolean; txDate?: string }> {
  let supplierId: string | null = null;
  if (args.supplierName?.trim()) supplierId = await inboxFindOrCreateSupplier(args.supplierName, args.establishmentId);

  const { data: inserted, error } = await supabase.from("expenses").insert({
    establishment_id: args.establishmentId, kind: args.kind, expense_date: args.expenseDate,
    due_date: args.dueDate, paid: args.paid, paid_at: args.paid ? args.expenseDate : null,
    supplier_id: supplierId, category_id: args.categoryId, amount_ttc: args.amountTtc,
    tva_rate: args.tvaRate, amount_tva: args.amountTva, payment_source: args.paymentSource,
    invoice_number: args.invoiceNumber, document_id: args.documentId, note: args.note, created_by: args.createdBy,
  }).select("id").single();
  if (error) throw error;

  await supabase.from("documents").update({ review_status: "validated", expense_id: inserted.id }).eq("id", args.documentId);

  if (args.kind === "facture") {
    try { return await autoMatchExpense((inserted as { id: string }).id, args.amountTtc, args.expenseDate, 5); }
    catch { /* non bloquant */ }
  }
  return { matched: false };
}

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
  // Dépenses rapprochées = pointées ET payées (le débit prouve le paiement),
  // paid_at = date du débit. Elles sortent ainsi de « À payer ».
  for (const r of args.rows) {
    if (!r.matchedExpenseId) continue;
    const { error } = await supabase
      .from("expenses")
      .update({ reconciled: true, paid: true, paid_at: r.tx.date })
      .eq("id", r.matchedExpenseId);
    if (error) throw error;
  }
}

export async function unmatchBankTransaction(txId: string, expenseId: string | null): Promise<void> {
  const { error } = await supabase
    .from("bank_transactions")
    .update({ status: "unmatched", matched_expense_id: null })
    .eq("id", txId);
  if (error) throw error;
  if (expenseId) {
    await supabase.from("expenses").update({ reconciled: false, paid: false, paid_at: null }).eq("id", expenseId);
  }
}

// ---------- Galerie photos du restaurant ----------

export interface GalleryPhotoRow {
  id: string;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
  url: string | null; // URL signée temporaire (1 h)
}

export async function fetchGalleryPhotos(): Promise<GalleryPhotoRow[]> {
  const { data, error } = await supabase
    .from("gallery_photos")
    .select("id, storage_path, caption, taken_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<GalleryPhotoRow, "url">>;
  if (!rows.length) return [];
  const { data: signed } = await supabase.storage
    .from("documents")
    .createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urlByPath = new Map<string, string>();
  (signed ?? []).forEach((s) => { if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl); });
  return rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null }));
}

export async function uploadGalleryPhoto(args: {
  establishmentId: string;
  createdBy: string;
  file: Uint8Array | Blob | ArrayBuffer;
  contentType: string;
  caption?: string | null;
}): Promise<void> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 1e6);
  const ext = args.contentType === "image/png" ? "png" : "jpg";
  const path = `${args.establishmentId}/gallery/${yyyy}/${mm}/${now.getTime()}-${rnd}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, args.file, { contentType: args.contentType, upsert: false });
  if (upErr) throw upErr;
  const { error } = await supabase.from("gallery_photos").insert({
    establishment_id: args.establishmentId,
    storage_path: path,
    caption: args.caption ?? null,
    taken_at: now.toISOString(),
    created_by: args.createdBy,
  });
  if (error) throw error;
}

export async function updateGalleryCaption(id: string, caption: string | null): Promise<void> {
  const { error } = await supabase.from("gallery_photos").update({ caption }).eq("id", id);
  if (error) throw error;
}

export async function deleteGalleryPhoto(id: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from("gallery_photos").delete().eq("id", id);
  if (error) throw error;
  try { await supabase.storage.from("documents").remove([storagePath]); } catch { /* best effort */ }
}

// ---------- Coffre à documents + overrides prévisionnel ----------
export interface LibraryDoc {
  id: string; title: string; category: string; doc_type: string | null;
  storage_path: string; file_type: string | null; summary: string | null;
  extracted: unknown | null; created_at: string;
}

export async function fetchLibraryDocuments(): Promise<LibraryDoc[]> {
  const { data, error } = await supabase
    .from("library_documents")
    .select("id, title, category, doc_type, storage_path, file_type, summary, extracted, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LibraryDoc[];
}

export async function insertLibraryDocument(args: {
  establishmentId: string; createdBy: string; title: string; category: string;
  docType: string | null; storagePath: string; fileType: string | null;
  summary: string | null; extracted: unknown;
}): Promise<void> {
  const { error } = await supabase.from("library_documents").insert({
    establishment_id: args.establishmentId, title: args.title, category: args.category,
    doc_type: args.docType, storage_path: args.storagePath, file_type: args.fileType,
    summary: args.summary, extracted: args.extracted, created_by: args.createdBy,
  });
  if (error) throw error;
}

export async function deleteLibraryDocument(id: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from("library_documents").delete().eq("id", id);
  if (error) throw error;
  try { await supabase.storage.from("documents").remove([storagePath]); } catch { /* best effort */ }
}

export async function applyPrevisionnelOverrides(
  establishmentId: string, patch: Record<string, number>,
): Promise<void> {
  const { data } = await supabase.from("previsionnel_settings").select("overrides").maybeSingle();
  const current = ((data as { overrides?: Record<string, number> } | null)?.overrides ?? {});
  const merged = { ...current, ...patch };
  const { error } = await supabase.from("previsionnel_settings")
    .upsert({ establishment_id: establishmentId, overrides: merged, updated_at: new Date().toISOString() }, { onConflict: "establishment_id" });
  if (error) throw error;
}
