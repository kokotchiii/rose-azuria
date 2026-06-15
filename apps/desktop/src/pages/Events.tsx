// Page « Événements » : liste avec rentabilité (recettes − dépenses), création,
// détail avec rattachement/détachement de dépenses et recettes.

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@resto/shared";
import {
  createEvent,
  fetchEvents,
  fetchExpensesForEvent,
  fetchRevenuesForEvent,
  setExpenseEvent,
  setRevenueEvent,
  type EventWithTotals,
  type ExpenseListItem,
  type EventRevenue,
} from "../lib/queries";
import { fmtEUR, fmtDate, todayISO } from "../lib/format";

interface Props { profile: Profile; }

const SERVICE_LABEL: Record<string, string> = { midi: "Midi", soir: "Soir", journee: "Journée", autre: "Autre" };

export function Events({ profile }: Props) {
  const [list, setList] = useState<EventWithTotals[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventWithTotals | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setList(await fetchEvents());
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createEvent(profile.establishment_id, name, date || null, profile.id);
      setName("");
      setDate(todayISO());
      setShowForm(false);
      await loadList();
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return <EventDetail event={selected} onBack={() => { setSelected(null); loadList(); }} />;
  }

  return (
    <div className="events-page">
      <div className="todos-head">
        <h1>Événements</h1>
        {!showForm && <button className="primary" onClick={() => setShowForm(true)}>+ Nouvel événement</button>}
      </div>

      {showForm && (
        <form className="card todo-form" onSubmit={create}>
          <h2>Nouvel événement</h2>
          <div className="grid-2">
            <label>
              Nom
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Mariage Durand" />
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button className="primary" type="submit" disabled={creating || !name.trim()}>
              {creating ? "Création…" : "Créer"}
            </button>
            <button className="link" type="button" onClick={() => setShowForm(false)}>Annuler</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="muted">Aucun événement. Crée-en un pour regrouper des factures et des recettes.</p>
      ) : (
        <div className="table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>Événement</th>
                <th>Date</th>
                <th className="num">Recettes</th>
                <th className="num">Dépenses</th>
                <th className="num">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {list.map((ev) => (
                <tr key={ev.id} className="row-clickable" onClick={() => setSelected(ev)}>
                  <td><b>{ev.name}</b></td>
                  <td>{ev.event_date ? fmtDate(ev.event_date) : "—"}</td>
                  <td className="num" style={{ color: "var(--ok)" }}>{fmtEUR(ev.revenue)}</td>
                  <td className="num" style={{ color: "var(--error)" }}>{fmtEUR(ev.expense)}</td>
                  <td className="num"><b style={{ color: ev.net >= 0 ? "var(--ok)" : "var(--error)" }}>{fmtEUR(ev.net)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Détail d'un événement ----------
function EventDetail({ event, onBack }: { event: EventWithTotals; onBack: () => void }) {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<EventRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<null | "expense" | "revenue">(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ex, rv] = await Promise.all([fetchExpensesForEvent(event.id), fetchRevenuesForEvent(event.id)]);
      setExpenses(ex);
      setRevenues(rv);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const totalRev = revenues.reduce((s, r) => s + r.total, 0);
  const totalExp = expenses.reduce((s, e) => s + Number(e.amount_ttc), 0);
  const net = totalRev - totalExp;

  async function detachExpense(id: string) {
    setBusy(id);
    try { await setExpenseEvent(id, null); await load(); } finally { setBusy(null); }
  }
  async function detachRevenue(id: string) {
    setBusy(id);
    try { await setRevenueEvent(id, null); await load(); } finally { setBusy(null); }
  }

  return (
    <div className="events-page">
      <button className="link" onClick={onBack}>← Tous les événements</button>

      <div className="card" style={{ margin: "0.75rem 0 1.25rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>{event.name}</h1>
        {event.event_date && <div className="muted">{fmtDate(event.event_date)}</div>}
        <div className="supplier-kpis">
          <div><div className="muted">Recettes</div><b style={{ color: "var(--ok)" }}>{fmtEUR(totalRev)}</b></div>
          <div><div className="muted">Dépenses</div><b style={{ color: "var(--error)" }}>{fmtEUR(totalExp)}</b></div>
          <div><div className="muted">Résultat</div><b style={{ color: net >= 0 ? "var(--ok)" : "var(--error)" }}>{fmtEUR(net)}</b></div>
        </div>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          {/* Recettes */}
          <div className="group-head">
            <span>Recettes</span>
            <button className="link" onClick={() => setPicker("revenue")}>+ Ajouter</button>
          </div>
          <div className="table-wrap" style={{ marginBottom: "1.25rem", borderRadius: "0 0 8px 8px", borderTop: "none" }}>
            <table className="exp-table">
              <tbody>
                {revenues.length === 0 ? (
                  <tr><td className="muted">Aucune recette rattachée.</td></tr>
                ) : revenues.map((r) => (
                  <tr key={r.id}>
                    <td><b>{SERVICE_LABEL[r.service] ?? r.service}</b></td>
                    <td>{fmtDate(r.revenue_date)}</td>
                    <td className="num" style={{ color: "var(--ok)" }}>{fmtEUR(r.total)}</td>
                    <td><button className="link danger" disabled={busy !== null} onClick={() => detachRevenue(r.id)}>× Détacher</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dépenses */}
          <div className="group-head">
            <span>Dépenses</span>
            <button className="link" onClick={() => setPicker("expense")}>+ Ajouter</button>
          </div>
          <div className="table-wrap" style={{ borderRadius: "0 0 8px 8px", borderTop: "none" }}>
            <table className="exp-table">
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td className="muted">Aucune dépense rattachée.</td></tr>
                ) : expenses.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.supplier?.name ?? "Sans fournisseur"}</b></td>
                    <td>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</td>
                    <td className="num" style={{ color: "var(--error)" }}>{fmtEUR(Number(e.amount_ttc))}</td>
                    <td><button className="link danger" disabled={busy !== null} onClick={() => detachExpense(e.id)}>× Détacher</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {picker && (
        <AttachPicker
          kind={picker}
          eventId={event.id}
          onClose={() => setPicker(null)}
          onAttached={() => { setPicker(null); load(); }}
        />
      )}
    </div>
  );
}

// Modale : liste les dépenses/recettes LIBRES (event_id null) à rattacher.
function AttachPicker({
  kind, eventId, onClose, onAttached,
}: {
  kind: "expense" | "revenue";
  eventId: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [revenues, setRevenues] = useState<EventRevenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    if (kind === "expense") {
      fetchExpensesForEvent(null).then(setExpenses).finally(() => setLoading(false));
    } else {
      fetchRevenuesForEvent(null).then(setRevenues).finally(() => setLoading(false));
    }
  }, [kind]);

  async function attachExpense(id: string) {
    setBusy(id);
    try { await setExpenseEvent(id, eventId); onAttached(); } finally { setBusy(null); }
  }
  async function attachRevenue(id: string) {
    setBusy(id);
    try { await setRevenueEvent(id, eventId); onAttached(); } finally { setBusy(null); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{kind === "expense" ? "Ajouter des dépenses" : "Ajouter des recettes"}</h2>
          <button className="link" onClick={onClose}>Fermer</button>
        </div>
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : kind === "expense" ? (
          expenses.length === 0 ? (
            <p className="muted">Aucune dépense libre à rattacher.</p>
          ) : (
            <table className="exp-table">
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="row-clickable" onClick={() => attachExpense(e.id)}>
                    <td><b>{e.supplier?.name ?? "Sans fournisseur"}</b></td>
                    <td>{fmtDate(e.expense_date)} · {e.category?.label ?? "—"}</td>
                    <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                    <td>{busy === e.id ? "…" : "+"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : revenues.length === 0 ? (
          <p className="muted">Aucune recette libre à rattacher.</p>
        ) : (
          <table className="exp-table">
            <tbody>
              {revenues.map((r) => (
                <tr key={r.id} className="row-clickable" onClick={() => attachRevenue(r.id)}>
                  <td><b>{SERVICE_LABEL[r.service] ?? r.service}</b></td>
                  <td>{fmtDate(r.revenue_date)}</td>
                  <td className="num">{fmtEUR(r.total)}</td>
                  <td>{busy === r.id ? "…" : "+"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
