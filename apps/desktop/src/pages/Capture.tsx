// PAGE PHARE : upload d'un justificatif → IA → formulaire pré-rempli → save.

import { useEffect, useState } from "react";
import { uploadAndClassify, PAYMENT_SOURCES } from "@resto/shared";
import type { AiExtraction, Category, Supplier, PaymentSource, Profile } from "@resto/shared";
import { supabase } from "../supabaseClient";
import {
  fetchCategories,
  fetchSuppliers,
  fetchProfiles,
  findOrCreateSupplier,
  findDuplicateByHash,
  findDuplicateByInvoiceNumber,
  insertExpenseItems,
} from "../lib/queries";
import { fmtEUR, todayISO } from "../lib/format";
import { compressImage } from "../lib/compressImage";
import { sha256Hex } from "../lib/normalize";

interface Props {
  profile: Profile;
}

interface FormState {
  expense_date: string;
  supplier_name: string;
  category_id: string;
  amount_ttc: string;
  tva_rate: string;
  amount_tva: string;
  invoice_number: string;
  payer_id: string;
  payment_source: PaymentSource;
  note: string;
}

// Sentinel pour "c'est Azuria (la société) qui paie" — payer_id sera null en base
const AZURIA = "AZURIA";

const EMPTY_FORM = (_profileId: string): FormState => ({
  expense_date: todayISO(),
  supplier_name: "",
  category_id: "",
  amount_ttc: "",
  tva_rate: "",
  amount_tva: "",
  invoice_number: "",
  payer_id: AZURIA,            // par défaut : Azuria paie directement (CB pro)
  payment_source: "cb_pro",
  note: "",
});

export function Capture({ profile }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [, setSuppliers] = useState<Supplier[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [extraction, setExtraction] = useState<AiExtraction | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM(profile.id));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicateAck, setDuplicateAck] = useState(false); // l'utilisateur a confirmé qu'il veut quand même enregistrer

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
    fetchSuppliers().then(setSuppliers).catch(console.error);
    fetchProfiles().then(setProfiles).catch(console.error);
  }, []);

  function onSelectFile(f: File | null) {
    setFile(f);
    setExtraction(null);
    setError(null);
    setWarning(null);
    setSuccess(null);
    setDuplicateAck(false);
    if (f) setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl(null);
  }

  async function runClassification() {
    if (!file) return;
    setClassifying(true);
    setError(null);
    setWarning(null);
    try {
      // Compresse l'image si elle dépasse 1 Mo (rester < 5 Mo côté API Anthropic)
      const compressed = await compressImage(file);

      // 1) Dedup par hash du fichier — détecte un upload strictement identique
      const fileHash = await sha256Hex(compressed);
      const dupHash = await findDuplicateByHash(fileHash);
      if (dupHash) {
        setWarning(
          dupHash.expenseId
            ? "⚠ Ce fichier exact a déjà été uploadé et lié à une dépense. Vérifie l'historique avant de continuer."
            : "⚠ Ce fichier exact a déjà été uploadé (mais pas encore lié à une dépense).",
        );
        // On laisse quand même l'utilisateur continuer s'il insiste — il devra cliquer 2x.
      }

      const res = await uploadAndClassify({
        client: supabase,
        establishmentId: profile.establishment_id,
        file: compressed,
        fileName: compressed.name,
        uploadedBy: profile.id,
      });

      // Stocke le hash sur le document pour les futurs dedup
      await supabase.from("documents").update({ file_hash: fileHash }).eq("id", res.documentId);

      setExtraction(res.extraction);
      setDocumentId(res.documentId);

      // Pré-remplit le formulaire avec ce que l'IA a extrait
      const ex = res.extraction;
      const matchedCat = categories.find((c) => c.label === ex.suggested_category);
      setForm((prev) => ({
        ...prev,
        expense_date: ex.document_date ?? prev.expense_date,
        supplier_name: ex.supplier_name ?? "",
        category_id: matchedCat?.id ?? "",
        amount_ttc: ex.amount_ttc != null ? String(ex.amount_ttc) : "",
        tva_rate: ex.tva_rate != null ? String(ex.tva_rate) : "",
        amount_tva: ex.amount_tva != null ? String(ex.amount_tva) : "",
        invoice_number: ex.invoice_number ?? "",
      }));
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setClassifying(false);
    }
  }

  async function saveExpense() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const supplierId = form.supplier_name.trim()
        ? await findOrCreateSupplier(form.supplier_name, profile.establishment_id)
        : null;

      // 2) Dedup par n° de facture — si même fournisseur + même n° on alerte.
      if (!duplicateAck && supplierId && form.invoice_number) {
        const dup = await findDuplicateByInvoiceNumber(supplierId, form.invoice_number);
        if (dup) {
          setWarning(
            `⚠ Une dépense existe déjà chez ce fournisseur avec le n° ${form.invoice_number} (montant ${fmtEUR(Number(dup.amount_ttc))} du ${dup.expense_date}). Clique à nouveau sur Enregistrer pour confirmer le doublon.`,
          );
          setDuplicateAck(true);
          setSaving(false);
          return;
        }
      }

      // payer_id = null veut dire "Azuria (société) a payé directement"
      const payerId = form.payer_id === AZURIA ? null : form.payer_id;

      const { data: inserted, error } = await supabase
        .from("expenses")
        .insert({
          establishment_id: profile.establishment_id,
          expense_date: form.expense_date,
          supplier_id: supplierId,
          category_id: form.category_id || null,
          amount_ttc: Number(form.amount_ttc),
          tva_rate: form.tva_rate ? Number(form.tva_rate) : null,
          amount_tva: form.amount_tva ? Number(form.amount_tva) : null,
          payer_id: payerId,
          payment_source: form.payment_source,
          invoice_number: form.invoice_number || null,
          document_id: documentId,
          note: form.note || null,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      // 3) Stocke les line_items extraits par l'IA dans expense_items
      if (extraction && inserted) {
        await insertExpenseItems({
          establishmentId: profile.establishment_id,
          expenseId:       inserted.id as string,
          expenseDate:     form.expense_date,
          supplierId,
          categoryId:      form.category_id || null,
          items:           extraction.line_items,
        });
      }

      setSuccess("Dépense enregistrée ✅");
      // Reset
      setFile(null);
      setPreviewUrl(null);
      setExtraction(null);
      setDocumentId(null);
      setWarning(null);
      setDuplicateAck(false);
      setForm(EMPTY_FORM(profile.id));
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  // Détermine la "couleur" d'un champ selon la confiance globale de l'IA
  function confidenceTone(): "high" | "mid" | "low" {
    const c = extraction?.confidence ?? 0;
    if (c >= 0.8) return "high";
    if (c >= 0.5) return "mid";
    return "low";
  }

  return (
    <div className="capture-page">
      <h1>Capturer un justificatif</h1>

      <div className="capture-grid">
        {/* Colonne gauche : drop / preview */}
        <div className="capture-left">
          <FileDrop file={file} onChange={onSelectFile} previewUrl={previewUrl} />
          {file && !extraction && (
            <button className="primary" onClick={runClassification} disabled={classifying}>
              {classifying ? "Analyse IA en cours..." : "📤 Analyser avec l'IA"}
            </button>
          )}
          {extraction && (
            <div className={`confidence ${confidenceTone()}`}>
              Confiance IA : {Math.round(extraction.confidence * 100)}%
              <br />
              Document détecté : <b>{extraction.document_type}</b>
            </div>
          )}
        </div>

        {/* Colonne droite : formulaire */}
        <div className="capture-right">
          <h2>Détails de la dépense</h2>
          <div className="grid-2">
            <label>
              Date
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </label>
            <label>
              Fournisseur
              <input
                value={form.supplier_name}
                onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                placeholder="ex: Metro Toulon"
              />
            </label>
            <label>
              Catégorie
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">— choisir —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              N° facture
              <input
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              />
            </label>
            <label>
              Montant TTC (€)
              <input
                type="number"
                step="0.01"
                value={form.amount_ttc}
                onChange={(e) => setForm({ ...form, amount_ttc: e.target.value })}
              />
            </label>
            <label>
              TVA (€)
              <input
                type="number"
                step="0.01"
                value={form.amount_tva}
                onChange={(e) => setForm({ ...form, amount_tva: e.target.value })}
              />
            </label>
            <label>
              Taux TVA (%)
              <input
                type="number"
                step="0.1"
                value={form.tva_rate}
                onChange={(e) => setForm({ ...form, tva_rate: e.target.value })}
              />
            </label>
            <label>
              Qui a payé ?
              <select
                value={form.payer_id}
                onChange={(e) => {
                  const v = e.target.value;
                  // Si Azuria paie → CB pro par défaut. Sinon → CB perso (à rembourser).
                  const defaultSource: PaymentSource = v === AZURIA ? "cb_pro" : "cb_perso";
                  setForm({ ...form, payer_id: v, payment_source: defaultSource });
                }}
              >
                <option value={AZURIA}>Azuria (société)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id.slice(0, 6)} (perso)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source de paiement
              <select
                value={form.payment_source}
                onChange={(e) =>
                  setForm({ ...form, payment_source: e.target.value as PaymentSource })
                }
              >
                {PAYMENT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {labelPaymentSource(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Description / nature de la dépense
              <textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                rows={2}
                placeholder="à préciser si pas clair sur la facture — ex: péage A10, pourboire serveur, achat couteaux cuisine…"
              />
            </label>
          </div>

          {extraction && extraction.amount_ttc !== Number(form.amount_ttc) && (
            <div className="hint">
              IA proposait : {fmtEUR(extraction.amount_ttc)} TTC
            </div>
          )}

          {warning && <div className="warn-box">{warning}</div>}
          {error && <div className="error">⚠ {error}</div>}
          {success && <div className="success">{success}</div>}

          <button className="primary big" onClick={saveExpense} disabled={saving || !form.amount_ttc}>
            {saving ? "Enregistrement..." : "Enregistrer la dépense"}
          </button>
        </div>
      </div>
    </div>
  );
}

function labelPaymentSource(s: PaymentSource): string {
  switch (s) {
    case "cb_pro":   return "CB pro";
    case "cb_perso": return "CB perso (→ note de frais)";
    case "especes":  return "Espèces";
    case "virement": return "Virement";
  }
}

// --- Sous-composant : zone drop / sélection fichier ---
function FileDrop({
  file,
  onChange,
  previewUrl,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  previewUrl: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`file-drop ${dragOver ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
    >
      {previewUrl ? (
        file?.type === "application/pdf" ? (
          <div className="preview pdf">📄 {file.name}</div>
        ) : (
          <img src={previewUrl} alt="preview" />
        )
      ) : (
        <div className="dropzone-empty">
          <p>Glisse-dépose une photo ou un PDF de facture ici</p>
          <p className="muted">ou</p>
        </div>
      )}
      <input
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && (
        <button className="link" onClick={() => onChange(null)}>
          ✖ retirer
        </button>
      )}
    </div>
  );
}
