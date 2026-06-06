// Page To-do list — vue Kanban (À faire / En cours / Fait) + saisie rapide.

import { useEffect, useMemo, useState } from "react";
import type { Profile } from "@resto/shared";
import { fetchProfiles } from "../lib/queries";
import {
  fetchTasks,
  createTask,
  updateTaskStatus,
  deleteTask,
  type TaskRow,
  type TaskStatus,
  type TaskPriority,
} from "../lib/tasks";
import { fmtDate, todayISO } from "../lib/format";

interface Props {
  profile: Profile;
}

const COLUMNS: Array<{ key: TaskStatus; label: string; color: string }> = [
  { key: "todo",  label: "À faire", color: "#6b7280" },
  { key: "doing", label: "En cours", color: "#2563eb" },
  { key: "done",  label: "Fait",    color: "#16a34a" },
];

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low:     "Basse",
  normal:  "Normale",
  high:    "Haute",
  urgent:  "Urgente",
};
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low:     "#d1d5db",
  normal:  "#9ca3af",
  high:    "#f59e0b",
  urgent:  "#dc2626",
};

export function Todos({ profile }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Quick-add form
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  useEffect(() => {
    Promise.all([fetchTasks({ status: "all" }), fetchProfiles()])
      .then(([t, p]) => {
        setTasks(t);
        setProfiles(p);
      })
      .finally(() => setLoading(false));
  }, []);

  async function reload() {
    setTasks(await fetchTasks({ status: "all" }));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createTask({
      establishment_id: profile.establishment_id,
      title:            title.trim(),
      description:      description.trim() || null,
      priority,
      due_date:         dueDate || null,
      assignee_id:      assigneeId || null,
      created_by:       profile.id,
    });
    setTitle("");
    setDescription("");
    setDueDate("");
    setAssigneeId("");
    setPriority("normal");
    setShowForm(false);
    await reload();
  }

  async function onChangeStatus(t: TaskRow, status: TaskStatus) {
    await updateTaskStatus(t.id, status, profile.id);
    await reload();
  }

  async function onDelete(t: TaskRow) {
    if (!confirm(`Supprimer "${t.title}" ?`)) return;
    await deleteTask(t.id);
    await reload();
  }

  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, TaskRow[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) m[t.status].push(t);
    return m;
  }, [tasks]);

  if (loading) {
    return <div className="todos-page"><h1>À faire</h1><p>Chargement…</p></div>;
  }

  return (
    <div className="todos-page">
      <div className="todos-head">
        <h1>À faire</h1>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Annuler" : "+ Nouvelle tâche"}
        </button>
      </div>

      {showForm && (
        <form className="card todo-form" onSubmit={onCreate}>
          <div className="grid-2">
            <label className="full">
              Titre
              <input
                autoFocus
                placeholder="ex: Commander viande à Promocash"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Échéance
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label>
              Priorité
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </label>
            <label>
              Pour qui ?
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Tout le monde</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 6)}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Détails (optionnel)
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="précisions, lien, contact…"
              />
            </label>
          </div>
          <button className="primary" type="submit">Créer la tâche</button>
        </form>
      )}

      <div className="kanban">
        {COLUMNS.map((col) => (
          <div className="kanban-col" key={col.key}>
            <div className="kanban-head" style={{ borderTopColor: col.color }}>
              {col.label} <span className="muted">({byStatus[col.key].length})</span>
            </div>
            {byStatus[col.key].length === 0 ? (
              <div className="muted small kanban-empty">— vide —</div>
            ) : byStatus[col.key].map((t) => (
              <div className="todo-card" key={t.id}>
                <div className="todo-title">
                  <span
                    className="prio-dot"
                    style={{ background: PRIORITY_COLOR[t.priority] }}
                    title={`Priorité : ${PRIORITY_LABEL[t.priority]}`}
                  />
                  <span style={t.status === "done" ? { textDecoration: "line-through", color: "var(--muted)" } : {}}>
                    {t.title}
                  </span>
                </div>
                {t.description && <div className="todo-desc">{t.description}</div>}
                <div className="todo-meta">
                  {t.due_date && (
                    <span className={isOverdue(t.due_date, t.status) ? "due overdue" : "due"}>
                      {fmtDate(t.due_date)}
                    </span>
                  )}
                  <span className="assignee">
                    {t.assignee?.full_name ?? "tous"}
                  </span>
                </div>
                <div className="todo-actions">
                  {t.status !== "todo"  && <button className="link" onClick={() => onChangeStatus(t, "todo")}>← À faire</button>}
                  {t.status !== "doing" && <button className="link" onClick={() => onChangeStatus(t, "doing")}>En cours</button>}
                  {t.status !== "done"  && <button className="link" onClick={() => onChangeStatus(t, "done")}>Fait ✓</button>}
                  <button className="link danger" onClick={() => onDelete(t)}>Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function isOverdue(due: string, status: TaskStatus): boolean {
  if (status === "done") return false;
  return due < todayISO();
}
