// Liste des dépenses avec : filtres, tri, groupement, expand pour voir le détail
// (line items extraits par l'IA) + bouton "Ouvrir le justificatif".

import { useEffect, useMemo, useState } from "react";
import {
  fetchCategories, fetchSuppliers, fetchExpenses, fetchProfiles,
  fetchExpenseDetail, getDocumentSignedUrl,
  type ExpenseListItem, type ExpenseItemRow,
} from "../lib/queries";
import type { Category, Supplier, Profile } from "@resto/shared";
import { fmtEUR, fmtDate, startOfMonthISO, todayISO } from "../lib/format";

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
type GroupKey = "none" | "category" | "day" | "supplier";

export function Expenses() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [profiles, setProfiles]   = useState<Profile[]>([]);
  const [rows, setRows]           = useState<ExpenseListItem[]>([]);
  const [loading, setLoading]     = useState(false);

  // Filtres
  const [from, setFrom]           = useState(startOfMonthISO());
  const [to, setTo]               = useState(todayISO());
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [payerId, setPayerId]       = useState("");
  const [minAmount, setMinAmount]   = useState("");
  const [search, setSearch]         = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [groupKey, setGroupKey] = useState<GroupKey>("none");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailCache, setDetailCache] = useState<Record<string, ExpenseItemRow[]>>({});

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
    fetchSuppliers().then(setSuppliers).catch(console.error);
    fetchProfiles().then(setProfiles).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchExpenses({ from, to, categoryId, supplierId, payerId })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [from, to, categoryId, supplierId, payerId]);

  // Recherche textuelle + montant min côté client
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = parseFloat(minAmount) || 0;
    return rows.filter((r) => {
      if (min && Number(r.amount_ttc) < min) return false;
      if (!q) return true;
      const hay = [
        r.supplier?.name,
        r.category?.label,
        r.invoice_number,
        r.note,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, minAmount]);

  // Tri
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortKey) {
      case "date_desc":   arr.sort((a, b) => b.expense_date.localeCompare(a.expense_date)); break;
      case "date_asc":    arr.sort((a, b) => a.expense_date.localeCompare(b.expense_date)); break;
      case "amount_desc": arr.sort((a, b) => Number(b.amount_ttc) - Number(a.amount_ttc)); break;
      case "amount_asc":  arr.sort((a, b) => Number(a.amount_ttc) - Number(b.amount_ttc)); break;
    }
    return arr;
  }, [filtered, sortKey]);

  // Groupement
  const grouped = useMemo((): Array<{ key: string; rows: ExpenseListItem[]; total: number }> => {
    if (groupKey === "none") {
      return [{ key: "", rows: sorted, total: sorted.reduce((s, r) => s + Number(r.amount_ttc), 0) }];
    }
    const map = new Map<string, ExpenseListItem[]>();
    for (const r of sorted) {
      let k = "—";
      if (groupKey === "category") k = r.category?.label ?? "Sans catégorie";
      else if (groupKey === "day") k = r.expense_date;
      else if (groupKey === "supplier") k = r.supplier?.name ?? "Sans fournisseur";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .map(([key, rs]) => ({ key, rows: rs, total: rs.reduce((s, r) => s + Number(r.amount_ttc), 0) }))
      .sort((a, b) => groupKey === "day" ? b.key.localeCompare(a.key) : b.total - a.total);
  }, [sorted, groupKey]);

  const grandTotal = useMemo(() => sorted.reduce((s, r) => s + Number(r.amount_ttc), 0), [sorted]);

  async function toggleExpand(r: ExpenseListItem) {
    const next = new Set(expanded);
    if (next.has(r.id)) {
      next.delete(r.id);
    } else {
      next.add(r.id);
      if (!detailCache[r.id]) {
        const { items } = await fetchExpenseDetail(r.id, r.document_id);
        setDetailCache((prev) => ({ ...prev, [r.id]: items }));
      }
    }
    setExpanded(next);
  }

  async function openDocument(documentId: string) {
    const url = await getDocumentSignedUrl(documentId);
    if (url) window.open(url, "_blank");
    else alert("Impossible d'ouvrir le justificatif.");
  }

  return (
    <div className="expenses-page">
      <h1>Dépenses</h1>

      <div className="filters">
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          Catégorie
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">toutes</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>
          Fournisseur
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">tous</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Payeur
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            <option value="">tous</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 6)}</option>)}
          </select>
        </label>
        <label>
          Montant min (€)
          <input type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" />
        </label>
        <label style={{ minWidth: 200 }}>
          Recherche
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="fournisseur, n° facture, note…" />
        </label>
      </div>

      <div className="toolbar">
        <label>
          Trier par
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="date_desc">Date ↓ (récent)</option>
            <option value="date_asc">Date ↑ (ancien)</option>
            <option value="amount_desc">Montant ↓ (gros)</option>
            <option value="amount_asc">Montant ↑ (petit)</option>
          </select>
        </label>
        <label>
          Grouper par
          <select value={groupKey} onChange={(e) => setGroupKey(e.target.value as GroupKey)}>
            <option value="none">Aucun</option>
            <option value="category">Catégorie</option>
            <option value="day">Jour</option>
            <option value="supplier">Fournisseur</option>
          </select>
        </label>
      </div>

      <div className="totals-bar">
        <span>{sorted.length} dépense{sorted.length > 1 ? "s" : ""}</span>
        <span className="total">Total : <b>{fmtEUR(grandTotal)}</b></span>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : grouped.map((g) => (
        <div key={g.key || "all"} className="group-block">
          {groupKey !== "none" && (
            <div className="group-head">
              <span>{groupKey === "day" ? fmtDate(g.key) : (g.key || "—")}</span>
              <span className="muted">{g.rows.length} dépense{g.rows.length > 1 ? "s" : ""} · <b>{fmtEUR(g.total)}</b></span>
            </div>
          )}
          <div className="table-wrap">
            <table className="exp-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Fournisseur</th>
                  <th>Catégorie</th>
                  <th>Payeur</th>
                  <th>Source</th>
                  <th className="num">TTC</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <ExpenseRowExpandable
                    key={r.id}
                    row={r}
                    expanded={expanded.has(r.id)}
                    items={detailCache[r.id] ?? null}
                    onToggle={() => toggleExpand(r)}
                    onOpenDoc={() => r.document_id && openDocument(r.document_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!loading && sorted.length === 0 && (
        <p className="muted">Aucune dépense ne correspond aux filtres.</p>
      )}
    </div>
  );
}

// --- Sous-composant ligne + détail expand ---

function ExpenseRowExpandable({
  row,
  expanded,
  items,
  onToggle,
  onOpenDoc,
}: {
  row: ExpenseListItem;
  expanded: boolean;
  items: ExpenseItemRow[] | null;
  onToggle: () => void;
  onOpenDoc: () => void;
}) {
  return (
    <>
      <tr className="row-clickable" onClick={onToggle}>
        <td className="caret">{expanded ? "▼" : "▶"}</td>
        <td>{fmtDate(row.expense_date)}</td>
        <td><b>{row.supplier?.name ?? "—"}</b></td>
        <td>{row.category?.label ?? "—"}</td>
        <td>{row.payer?.full_name ?? <span className="badge ok">Azuria</span>}</td>
        <td>{labelSource(row.payment_source)}</td>
        <td className="num">{fmtEUR(Number(row.amount_ttc))}</td>
        <td>
          {row.reimbursable && !row.reimbursed && <span className="badge warn">À rembourser</span>}
          {row.reimbursable && row.reimbursed && <span className="badge ok">Remboursé</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="row-detail">
          <td colSpan={8}>
            <div className="detail-grid">
              <div>
                <div className="detail-section">
                  <div className="muted small">N° facture</div>
                  <div>{row.invoice_number ?? "—"}</div>
                </div>
                <div className="detail-section">
                  <div className="muted small">TVA</div>
                  <div>{row.amount_tva != null ? fmtEUR(Number(row.amount_tva)) : "—"} {row.tva_rate ? `(${row.tva_rate}%)` : ""}</div>
                </div>
                {row.note && (
                  <div className="detail-section">
                    <div className="muted small">Description / nature</div>
                    <div>{row.note}</div>
                  </div>
                )}
                {row.document_id && (
                  <button className="primary" onClick={(e) => { e.stopPropagation(); onOpenDoc(); }}>
                    📎 Ouvrir le justificatif
                  </button>
                )}
              </div>
              <div>
                <div className="muted small">Articles détectés par l'IA</div>
                {items === null ? (
                  <div className="muted">Chargement du détail…</div>
                ) : items.length === 0 ? (
                  <div className="muted">Aucun détail d'articles (le doc ne les listait pas ou pas extraits).</div>
                ) : (
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th>Article</th>
                        <th className="num">Qté</th>
                        <th className="num">PU</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id}>
                          <td>{it.description}</td>
                          <td className="num">{it.quantity ?? "—"}</td>
                          <td className="num">{it.unit_price != null ? fmtEUR(it.unit_price) : "—"}</td>
                          <td className="num">{it.line_total != null ? fmtEUR(it.line_total) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function labelSource(s: string): string {
  switch (s) {
    case "cb_pro":   return "CB pro";
    case "cb_perso": return "CB perso";
    case "especes":  return "Espèces";
    case "virement": return "Virement";
    default: return s;
  }
}
