// Page Fournisseurs : liste + drill-down sur les factures d'un fournisseur.

import { useEffect, useMemo, useState } from "react";
import { fetchSuppliersWithStats, fetchExpenses, type SupplierStats, type ExpenseListItem } from "../lib/queries";
import { fmtEUR, fmtDate } from "../lib/format";

export function Suppliers() {
  const [stats, setStats] = useState<SupplierStats[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuppliersWithStats().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchExpenses({ supplierId: selectedId }).then(setExpenses);
  }, [selectedId]);

  const selected = useMemo(() => stats.find((s) => s.supplier.id === selectedId), [stats, selectedId]);

  if (loading) return <div className="suppliers-page"><h1>Fournisseurs</h1><p>Chargement…</p></div>;

  return (
    <div className="suppliers-page">
      <h1>Fournisseurs</h1>

      <div className="suppliers-grid">
        {/* Colonne gauche : liste */}
        <div className="card">
          <h2>Tous les fournisseurs</h2>
          {stats.length === 0 ? (
            <p className="muted">Aucun fournisseur. Crée-en un en saisissant une dépense.</p>
          ) : (
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th className="num">Factures</th>
                  <th className="num">Total</th>
                  <th>Dernière</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.supplier.id}
                    className={selectedId === s.supplier.id ? "row-selected" : "row-clickable"}
                    onClick={() => setSelectedId(s.supplier.id)}
                  >
                    <td><b>{s.supplier.name}</b></td>
                    <td className="num">{s.invoice_count}</td>
                    <td className="num">{fmtEUR(s.total_amount)}</td>
                    <td>{s.last_date ? fmtDate(s.last_date) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Colonne droite : détail fournisseur sélectionné */}
        <div className="card">
          {!selected ? (
            <p className="muted">Sélectionne un fournisseur pour voir son historique.</p>
          ) : (
            <>
              <h2>{selected.supplier.name}</h2>
              <div className="supplier-kpis">
                <div><div className="muted">Total dépensé</div><b>{fmtEUR(selected.total_amount)}</b></div>
                <div><div className="muted">Nb factures</div><b>{selected.invoice_count}</b></div>
                <div><div className="muted">Dernière</div><b>{selected.last_date ? fmtDate(selected.last_date) : "—"}</b></div>
              </div>

              <h3>Historique des factures</h3>
              {expenses.length === 0 ? (
                <p className="muted">Aucune dépense.</p>
              ) : (
                <table className="exp-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>N° facture</th>
                      <th>Catégorie</th>
                      <th className="num">TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.expense_date)}</td>
                        <td>{e.invoice_number ?? "—"}</td>
                        <td>{e.category?.label ?? "—"}</td>
                        <td className="num">{fmtEUR(Number(e.amount_ttc))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
