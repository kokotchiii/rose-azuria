// Page Produits : aggregat des items récurrents extraits par l'IA.
// Affiche : quantité totale, prix moyen, min/max, fréquence d'achat, tendance.

import { useEffect, useMemo, useState } from "react";
import { fetchCategories, fetchProductStats, type ProductStats } from "../lib/queries";
import type { Category } from "@resto/shared";
import { fmtEUR, fmtDate, startOfMonthISO, todayISO } from "../lib/format";

export function Products() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<ProductStats[]>([]);
  const [from, setFrom] = useState(monthsAgoISO(3));
  const [to, setTo] = useState(todayISO());
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCategories().then(setCategories);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProductStats({ from, to, categoryId })
      .then(setStats)
      .finally(() => setLoading(false));
  }, [from, to, categoryId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stats;
    return stats.filter((s) => s.display_label.toLowerCase().includes(q));
  }, [stats, search]);

  return (
    <div className="products-page">
      <h1>Produits récurrents</h1>
      <p className="muted">
        Données extraites automatiquement par l'IA sur tes factures. Plus tu en enregistres,
        plus les stats deviennent fiables (variations de prix, fréquence, etc).
      </p>

      <div className="filters">
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          Catégorie
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">toutes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={{ minWidth: 220 }}>
          Recherche
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex: lait, poulet…" />
        </label>
      </div>

      <div className="table-wrap">
        <table className="exp-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Catégorie</th>
              <th className="num">Qté totale</th>
              <th className="num">Prix unité moy.</th>
              <th className="num">Min / Max</th>
              <th className="num">Total dépensé</th>
              <th className="num">Achats</th>
              <th>Fréquence</th>
              <th>Tendance</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="muted">Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="muted">Aucun produit trouvé. Enregistre des factures avec articles détectés par l'IA pour alimenter cette vue.</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.normalized_label}>
                <td><b>{p.display_label}</b></td>
                <td>{p.category_label ?? "—"}</td>
                <td className="num">{p.total_qty || "—"}</td>
                <td className="num">{p.avg_unit_price != null ? fmtEUR(p.avg_unit_price) : "—"}</td>
                <td className="num">
                  {p.min_unit_price != null && p.max_unit_price != null
                    ? `${fmtEUR(p.min_unit_price)} / ${fmtEUR(p.max_unit_price)}`
                    : "—"}
                </td>
                <td className="num">{fmtEUR(p.total_spent)}</td>
                <td className="num">{p.occurrences}</td>
                <td>
                  {p.avg_days_between != null ? `~ tous les ${p.avg_days_between} j` : "—"}
                  {p.last_date && <div className="muted small">dernier : {fmtDate(p.last_date)}</div>}
                </td>
                <td>
                  <TrendBadge trend={p.price_trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: ProductStats["price_trend"] }) {
  switch (trend) {
    case "up":     return <span className="badge warn">↗ Prix en hausse</span>;
    case "down":   return <span className="badge ok">↘ Prix en baisse</span>;
    case "stable": return <span className="badge">— Stable</span>;
    default:       return <span className="muted small">données insuff.</span>;
  }
}

function monthsAgoISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// éviter warning eslint
void startOfMonthISO;
