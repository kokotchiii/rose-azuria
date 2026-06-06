// Page Export comptable : pour donner au comptable (ex: import Pennylane).
// Tu choisis une période → tu télécharges :
//  - un CSV récap (toutes les colonnes utiles)
//  - un ZIP avec tous les justificatifs + le CSV à l'intérieur

import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { supabase } from "../supabaseClient";
import { fetchExpenses, type ExpenseListItem } from "../lib/queries";
import { fmtEUR, fmtDate, startOfMonthISO, todayISO } from "../lib/format";

export function Export() {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo]     = useState(todayISO());
  const [rows, setRows] = useState<ExpenseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    fetchExpenses({ from, to })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [from, to]);

  const withDoc = useMemo(() => rows.filter((r) => r.document_id), [rows]);
  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.amount_ttc), 0), [rows]);

  // ----------- CSV -----------
  function buildCsv(): string {
    const header = [
      "date", "fournisseur", "categorie", "n_facture", "montant_ttc", "tva", "taux_tva",
      "payeur", "source_paiement", "remboursable", "remboursee", "note", "fichier_justificatif",
    ].join(";");

    const lines = rows.map((r) => {
      const fileName = r.document_id ? safeName(r) : "";
      const cells = [
        r.expense_date,
        csvEscape(r.supplier?.name ?? ""),
        csvEscape(r.category?.label ?? ""),
        csvEscape(r.invoice_number ?? ""),
        Number(r.amount_ttc).toFixed(2),
        r.amount_tva != null ? Number(r.amount_tva).toFixed(2) : "",
        r.tva_rate ?? "",
        csvEscape(r.payer?.full_name ?? "Azuria"),
        r.payment_source,
        r.reimbursable ? "oui" : "non",
        r.reimbursed   ? "oui" : "non",
        csvEscape(r.note ?? ""),
        csvEscape(fileName),
      ];
      return cells.join(";");
    });

    return "﻿" + [header, ...lines].join("\r\n");  // BOM UTF-8 pour Excel
  }

  function downloadCsvOnly() {
    const csv = buildCsv();
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `export_${from}_au_${to}.csv`);
  }

  // ----------- ZIP -----------
  async function downloadZipPack() {
    setWorking(true);
    setProgress("Préparation du pack…");
    try {
      const zip = new JSZip();
      zip.file(`recap_${from}_au_${to}.csv`, buildCsv());

      const docFolder = zip.folder("justificatifs");
      if (!docFolder) throw new Error("zip_folder_failed");

      for (let i = 0; i < withDoc.length; i++) {
        const r = withDoc[i];
        if (!r) continue;
        setProgress(`Téléchargement justificatif ${i + 1} / ${withDoc.length}…`);

        // On récupère le storage_path via la table documents
        const { data: doc } = await supabase
          .from("documents")
          .select("storage_path")
          .eq("id", r.document_id ?? "")
          .single();

        if (!doc?.storage_path) continue;

        const { data: blob, error } = await supabase.storage
          .from("documents")
          .download(doc.storage_path);
        if (error || !blob) continue;

        const ext = guessExt(doc.storage_path, blob.type);
        docFolder.file(`${safeName(r)}.${ext}`, blob);
      }

      setProgress("Compression du ZIP…");
      const out = await zip.generateAsync({ type: "blob" });
      triggerDownload(out, `pack_comptable_${from}_au_${to}.zip`);
      setProgress("");
    } catch (e: unknown) {
      setProgress("");
      alert("Erreur durant l'export : " + String((e as Error).message ?? e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="export-page">
      <h1>Export comptable</h1>
      <p className="muted">
        Sélectionne une période. Tu peux télécharger le récap seul (CSV) ou le pack complet
        (ZIP avec tous les justificatifs + CSV) — pratique pour l'import Pennylane.
      </p>

      <div className="filters">
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Dépenses sur la période</div>
          <div className="kpi-value">{rows.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avec justificatif</div>
          <div className="kpi-value">{withDoc.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total TTC</div>
          <div className="kpi-value">{fmtEUR(total)}</div>
        </div>
      </div>

      <div className="export-actions card">
        <button className="primary" onClick={downloadCsvOnly} disabled={loading || rows.length === 0}>
          📄 Télécharger récap CSV
        </button>
        <button className="primary big" onClick={downloadZipPack} disabled={working || withDoc.length === 0}>
          {working ? "Préparation…" : `📦 Télécharger le pack ZIP (${withDoc.length} justificatifs)`}
        </button>
        {progress && <div className="muted">{progress}</div>}
      </div>

      <div className="table-wrap">
        <table className="exp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Fournisseur</th>
              <th>Catégorie</th>
              <th>N° facture</th>
              <th className="num">TTC</th>
              <th>Justif.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="muted">Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="muted">Aucune dépense sur cette période.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.expense_date)}</td>
                <td>{r.supplier?.name ?? "—"}</td>
                <td>{r.category?.label ?? "—"}</td>
                <td>{r.invoice_number ?? "—"}</td>
                <td className="num">{fmtEUR(Number(r.amount_ttc))}</td>
                <td>{r.document_id ? "📎" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- helpers ---

function csvEscape(s: string): string {
  if (!s) return "";
  // si contient ; " ou retour à la ligne → entoure de "" et double les "
  if (/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function safeName(r: ExpenseListItem): string {
  const parts = [
    r.expense_date,
    (r.supplier?.name ?? "sansFour").replace(/[^a-zA-Z0-9_-]+/g, "_"),
    (r.invoice_number ?? r.id.slice(0, 6)).replace(/[^a-zA-Z0-9_-]+/g, "_"),
  ];
  return parts.join("_");
}

function guessExt(path: string, mime: string): string {
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  if (m?.[1]) return m[1].toLowerCase();
  if (mime.includes("pdf"))  return "pdf";
  if (mime.includes("png"))  return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
