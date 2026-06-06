// Queries pour les recettes (CA quotidien par service).

import { supabase } from "../supabaseClient";

export type Service = "midi" | "soir" | "journee" | "autre";

export interface RevenueRow {
  id: string;
  establishment_id: string;
  revenue_date: string;
  service: Service;
  amount_cash: number;
  amount_cb: number;
  amount_other: number;
  covers: number | null;
  tables_count: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export async function fetchRevenues(filters: { from?: string; to?: string } = {}): Promise<RevenueRow[]> {
  let q = supabase.from("revenues").select("*").order("revenue_date", { ascending: false }).order("service");
  if (filters.from) q = q.gte("revenue_date", filters.from);
  if (filters.to)   q = q.lte("revenue_date", filters.to);
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
  tables_count: number | null;
  note: string | null;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase
    .from("revenues")
    .upsert(args, { onConflict: "establishment_id,revenue_date,service" });
  if (error) throw error;
}

export async function deleteRevenue(id: string): Promise<void> {
  const { error } = await supabase.from("revenues").delete().eq("id", id);
  if (error) throw error;
}

// Total cash+cb+other pour une ligne
export function totalOf(r: Pick<RevenueRow, "amount_cash" | "amount_cb" | "amount_other">): number {
  return Number(r.amount_cash) + Number(r.amount_cb) + Number(r.amount_other);
}
