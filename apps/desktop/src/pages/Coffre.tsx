// Coffre à documents : dépôt + classement des documents importants (bail, prêt,
// assurance, expert, avocat…) avec lecture IA qui propose des chiffres à injecter
// dans le prévisionnel.

import { useEffect, useMemo, useState } from "react";
import type { Profile, BusinessDocExtraction } from "@resto/shared";
import { uploadAndAnalyzeBusinessDoc } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchLibraryDocuments, insertLibraryDocument, deleteLibraryDocument,
  getLibrarySignedUrl, applyPrevisionnelOverrides, type LibraryDoc,
} from "../lib/queries";
import { fmtDate } from "../lib/format";

interface Props { profile: Profile }

const CATEGORIES = ["bail", "banque", "assurance", "comptable", "juridique", "rh", "autre"];
const CAT_LABEL: Record<string, string> = {
  bail: "Bail / local", banque: "Banque / prêt", assurance: "Assurance",
  comptable: "Comptable", juridique: "Juridique", rh: "RH / personnel", autre: "Autre",
};
const OVERRIDE_LABEL: Record<string, string> = {
  loyerMensuelHC: "Loyer mensuel HC (€)", chargesLocMensuel: "Charges loc. mensuelles (€)",
  indexationLoyer: "Indexation loyer", assurancePro: "Assurance annuelle (€)",
  comptable: "Comptable annuel (€)", eauElecGaz: "Énergie annuelle (€)",
  pretFonds: "Prêt fonds (€)", tauxFonds: "Taux prêt fonds", moisFonds: "Durée prêt fonds (mois)",
  pretMateriel: "Prêt matériel (€)", tauxMat: "Taux prêt matériel", moisMat: "Durée prêt matériel (mois)",
};

export function Coffre({ profile }: Props) {
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string>("all");

  // résultat d'analyse en attente de validation
  const [pending, setPending] = useState<{ extraction: BusinessDocExtraction; storagePath: string; fileType: string } | null>(null);
  const [applyOverrides, setApplyOverrides] = useState(true);

  function load() {
    fetchLibraryDocuments().then(setDocs).catch((e) => setError(String(e))).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError(null); setInfo(null); setPending(null);
    try {
      const buf = await file.arrayBuffer();
      const ct = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const res = await uploadAndAnalyzeBusinessDoc({
        client: supabase, establishmentId: profile.establishment_id,
        pages: [{ file: buf, contentType: ct }],
        fileBaseName: `doc-${file.name.replace(/\.[^.]+$/, "")}`,
      });
      setPending(res);
      setApplyOverrides(Object.keys(res.extraction.proposed_overrides ?? {}).length > 0);
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSave() {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      const ex = pending.extraction;
      await insertLibraryDocument({
        establishmentId: profile.establishment_id, createdBy: profile.id,
        title: ex.title, category: ex.category, docType: ex.doc_type,
        storagePath: pending.storagePath, fileType: pending.fileType,
        summary: ex.summary, extracted: ex,
      });
      let msg = "Document enregistré.";
      const ov = ex.proposed_overrides ?? {};
      if (applyOverrides && Object.keys(ov).length) {
        await applyPrevisionnelOverrides(profile.establishment_id, ov);
        msg += ` ${Object.keys(ov).length} valeur(s) injectée(s) dans le prévisionnel.`;
      }
      setInfo(msg);
      setPending(null);
      load();
    } catch (err: unknown) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(d: LibraryDoc) {
    const url = await getLibrarySignedUrl(d.storage_path);
    if (url) window.open(url, "_blank");
  }

  async function onDelete(d: LibraryDoc) {
    if (!window.confirm(`Supprimer « ${d.title} » ?`)) return;
    try { await deleteLibraryDocument(d.id, d.storage_path); load(); }
    catch (err: unknown) { setError(String((err as Error).message ?? err)); }
  }

  const visible = useMemo(
    () => (catFilter === "all" ? docs : docs.filter((d) => d.category === catFilter)),
    [docs, catFilter],
  );

  return (
    <div className="page">
      <h1>Coffre à documents</h1>
      <p className="muted">
        Range ici les documents importants (bail, prêt, assurance, expert-comptable, avocat, statuts…).
        L'IA en extrait les chiffres clés et peut les <b>injecter dans le prévisionnel</b>.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label className={`primary import-btn ${busy ? "disabled" : ""}`}>
          <input type="file" accept="application/pdf,image/*" onChange={onFile} disabled={busy} style={{ display: "none" }} />
          {busy ? "Analyse en cours…" : "📎 Ajouter un document (PDF / photo)"}
        </label>
        {info && <span className="badge ok" style={{ marginLeft: 12 }}>{info}</span>}
        {error && <div className="danger" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {/* Fiche d'analyse à valider */}
      {pending && (
        <div className="card" style={{ marginBottom: "1.25rem", borderColor: "var(--primary)" }}>
          <h2 style={{ marginTop: 0 }}>{pending.extraction.title}</h2>
          <div className="muted">{CAT_LABEL[pending.extraction.category] ?? pending.extraction.category} · {pending.extraction.doc_type}</div>
          <p>{pending.extraction.summary}</p>
          {pending.extraction.dates?.length ? <div className="muted">Dates : {pending.extraction.dates.join(" · ")}</div> : null}

          {Object.keys(pending.extraction.proposed_overrides ?? {}).length > 0 ? (
            <>
              <h3>Chiffres détectés pour le prévisionnel</h3>
              <table className="exp-table">
                <tbody>
                  {Object.entries(pending.extraction.proposed_overrides).map(([k, v]) => (
                    <tr key={k}><td>{OVERRIDE_LABEL[k] ?? k}</td><td className="num"><b>{v}</b></td></tr>
                  ))}
                </tbody>
              </table>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <input type="checkbox" checked={applyOverrides} onChange={(e) => setApplyOverrides(e.target.checked)} />
                Injecter ces valeurs dans le prévisionnel
              </label>
            </>
          ) : (
            <div className="muted">Aucun chiffre exploitable détecté pour le prévisionnel — le document sera juste archivé.</div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="primary" disabled={busy} onClick={confirmSave}>Enregistrer dans le coffre</button>
            <button className="link" disabled={busy} onClick={() => setPending(null)}>Annuler</button>
          </div>
        </div>
      )}

      {/* Filtre catégories */}
      <div className="filters">
        <label>Catégorie
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">toutes</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Aucun document. Ajoute ton premier document ci-dessus.</p>
      ) : (
        <table className="exp-table">
          <thead>
            <tr><th>Titre</th><th>Catégorie</th><th>Type</th><th>Ajouté le</th><th></th></tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id}>
                <td><button className="link" onClick={() => openDoc(d)}>{d.title}</button>
                  {d.summary ? <div className="muted small">{d.summary}</div> : null}</td>
                <td>{CAT_LABEL[d.category] ?? d.category}</td>
                <td>{d.doc_type ?? "—"}</td>
                <td>{fmtDate(d.created_at)}</td>
                <td><button className="link danger" onClick={() => onDelete(d)}>Supprimer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
