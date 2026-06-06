// Queries pour la To-do list.

import { supabase } from "../supabaseClient";

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface TaskRow {
  id: string;
  establishment_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  assignee?: { full_name: string | null } | null;
}

export async function fetchTasks(filters: { status?: TaskStatus | "all" } = {}): Promise<TaskRow[]> {
  let q = supabase
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(full_name)")
    .order("priority", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (filters.status && filters.status !== "all") {
    q = q.eq("status", filters.status);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TaskRow[];
}

export async function createTask(args: {
  establishment_id: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  assignee_id?: string | null;
  created_by: string;
}): Promise<TaskRow> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      establishment_id: args.establishment_id,
      title:            args.title,
      description:      args.description ?? null,
      priority:         args.priority ?? "normal",
      due_date:         args.due_date ?? null,
      assignee_id:      args.assignee_id ?? null,
      created_by:       args.created_by,
    })
    .select("*, assignee:profiles!tasks_assignee_id_fkey(full_name)")
    .single();
  if (error || !data) throw error ?? new Error("create_task_failed");
  return data as unknown as TaskRow;
}

export async function updateTaskStatus(id: string, status: TaskStatus, userId: string): Promise<void> {
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
