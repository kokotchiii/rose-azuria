// Boîte de réception : les factures reçues par mail (robot Gmail) atterrissent
// ici, pré-remplies par l'IA. On valide → la dépense est créée (et pointée si
// une opération bancaire correspond). Rien n'entre en compta sans validation.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Profile, Category, PaymentSource, AiExtraction } from "@resto/shared";
import { PAYMENT_SOURCES } from "@resto/shared";
import {
  fetchEmailInbox, validateInboxDocument, ignoreInboxDocument,
  fetchCategories, getLibrarySignedUrl, type InboxDoc,
} from "../lib/queries";
import { supabase } from "../supabaseClient";
import { fmtDate, todayISO } from "../lib/format";

interface Props { profile: Profile; }

const FACTURE_TYPES = ["facture", "bon_de_livraison", "loyer", "taxe_impot", "recouvrement", "assurance", "honoraires", "pret", "fiche_de_paie", "logiciel", "frais_bancaires"];
const PS_LABEL: Record<PaymentSource, string> = { cb_pro: "CB pro", cb_perso: "CB perso", especes: "Espèces", virement: "Virement / prélèvement" };

export function Inbox({ profile }: Props) {
  const [rows, setRows] = useState<InboxDoc[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([fetchEmailInbox(), fetchCategories()]);
      setRows(r);
      setCats(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Temps réel : un nouveau mail entrant fait apparaître la ligne sans recharger.
  useEffect(() => {
    const ch = supabase
      .channel("rt-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  return (
    <div className="page">
      <h1>Boîte de réception</h1>
      <p className="muted">
        Les factures reçues sur ta boîte mail (libellé « Factures ») arrivent ici, lues par l'IA.
        Vérifie, ajuste si besoin, puis <b>valide</b> pour créer la dépense. Rien n'est comptabilisé
        tant que tu n'as pas validé.
      </p>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <div className="card"><p className="muted">Aucune facture en attente. 📭 Les mails traités apparaîtront ici.</p></div>
      ) : (
        rows.map((doc) => (
          <InboxRow key={doc.id} doc={doc} cats={cats} profile={profile} onDone={reload} />
        ))
      )}
    </div>
  );
}

function InboxRow({ doc, cats, profile, onDone }: { doc: InboxDoc; cats: Category[]; profile: Profile; onDone: () => void }) {
  const ex = doc.extraction as AiExtraction | null;
  const defaultKind = ex && FACTURE_TYPES.includes(ex.document_type) ? "facture" : "depannage";

  const [supplierName, setSupplierName] = useState(ex?.supplier_name ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(ex?.invoice_number ?? "");
  const [expenseDate, setExpenseDate] = useState(ex?.document_date ?? todayISO());
  const [dueDate, setDueDate] = useState(ex?.due_date ?? "");
  const [amountTtc, setAmountTtc] = useState(ex?.amount_ttc != null ? String(ex.amount_ttc) : "");
  const [amountTva, setAmountTva] = useState(ex?.amount_tva != null ? String(ex.amount_tva) : "");
  const [tvaRate, setTvaRate] = useState(ex?.tva_rate != null ? String(ex.tva_rate) : "");
  const [kind, setKind] = useState<"facture" | "depannage">(defaultKind);
  const [categoryId, setCategoryId] = useState<string>("");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("virement");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Pré-sélectionne la catégorie suggérée par l'IA (par libellé).
  const suggestedCatId = useMemo(() => {
    if (!ex?.suggested_category) return "";
    return cats.find((c) => c.label.toLowerCase() === ex.suggested_category.toLowerCase())?.id ?? "";
  }, [cats, ex]);
  useEffect(() => { setCategoryId(suggestedCatId); }, [suggestedCatId]);

  async function openPdf() {
    const url = pdfUrl ?? await getLibrarySignedUrl(doc.storage_path);
    if (url) { setPdfUrl(url); window.open(url, "_blank"); }
  }

  async function onValidate() {
    if (!amountTtc || Number(amountTtc) <= 0) { setMsg("⚠ Renseigne le montant TTC."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await validateInboxDocument({
        documentId: doc.id,
        establishmentId: profile.establishment_id,
        createdBy: profile.id,
        kind,
        supplierName: supplierName.trim() || null,
        categoryId: categoryId || null,
        expenseDate,
        dueDate: dueDate || null,
        amountTtc: Number(amountTtc),
        tvaRate: tvaRate ? Number(tvaRate) : null,
        amountTva: amountTva ? Number(amountTva) : null,
        paymentSource,
        invoiceNumber: invoiceNumber.trim() || null,
        paid,
        note: doc.email_subject ? `Reçu par mail : ${doc.email_subject}` : "Reçu par mail",
      });
      setMsg(res.matched ? "✅ Dépense créée et pointée sur le relevé" : "✅ Dépense créée");
      setTimeout(onDone, 600);
    } catch (e: unknown) {
      setMsg("⚠ " + String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onIgnore() {
    if (!confirm("Ignorer cette facture ? Elle ne créera pas de dépense.")) return;
    setBusy(true);
    try { await ignoreInboxDocument(doc.id); onDone(); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <b>{doc.email_subject ?? "(sans objet)"}</b>
          <div className="muted" style={{ fontSize: "0.85em" }}>
            De : {doc.email_from ?? "?"} · reçu {doc.email_received_at ? fmtDate(doc.email_received_at) : "?"}
          </div>
        </div>
        <div>
          {doc.ai_status === "pending" && <span className="badge warn">IA en cours…</span>}
          {doc.ai_status === "failed" && <span className="badge warn">IA : lecture échouée (remplis à la main)</span>}
          {doc.ai_status === "done" && ex && <span className="badge ok">IA · confiance {Math.round((ex.confidence ?? 0) * 100)}%</span>}
          <button className="link" style={{ marginLeft: 8 }} onClick={openPdf}>📎 Voir le PDF</button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <label>Fournisseur
          <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Nom du fournisseur" />
        </label>
        <label>N° de facture
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="—" />
        </label>
        <label>Date
          <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </label>
        <label>Échéance
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label>Montant TTC (€)
          <input type="number" step="0.01" value={amountTtc} onChange={(e) => setAmountTtc(e.target.value)} />
        </label>
        <label>TVA (€)
          <input type="number" step="0.01" value={amountTva} onChange={(e) => setAmountTva(e.target.value)} placeholder="optionnel" />
        </label>
        <label>Taux TVA (%)
          <input type="number" step="0.1" value={tvaRate} onChange={(e) => setTvaRate(e.target.value)} placeholder="20" />
        </label>
        <label>Catégorie
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— non classé —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>Type
          <select value={kind} onChange={(e) => setKind(e.target.value as "facture" | "depannage")}>
            <option value="facture">Facture fournisseur</option>
            <option value="depannage">Achat dépannage</option>
          </select>
        </label>
        <label>Moyen de paiement
          <select value={paymentSource} onChange={(e) => setPaymentSource(e.target.value as PaymentSource)}>
            {PAYMENT_SOURCES.map((p) => <option key={p} value={p}>{PS_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} style={{ width: "auto" }} />
          Déjà payée (sinon elle ira dans « À payer »)
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className="primary" disabled={busy} onClick={onValidate}>✓ Valider et créer la dépense</button>
        <button className="link danger" disabled={busy} onClick={onIgnore}>Ignorer</button>
        {msg && <span className="hint" style={{ marginLeft: 8 }}>{msg}</span>}
      </div>
    </div>
  );
}
