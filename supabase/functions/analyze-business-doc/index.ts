// ============================================================================
// Edge Function : analyze-business-doc
// ----------------------------------------------------------------------------
// Lit un document important du restaurant (bail, prêt bancaire, assurance,
// honoraires expert/avocat, statuts, bilan…) et en extrait :
//  - doc_type, un titre, un résumé lisible,
//  - proposed_overrides : chiffres prêts à injecter dans le prévisionnel
//    (clés = champs des hypothèses : loyerMensuelHC, pretFonds, tauxFonds…).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL             = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
const EFFORT            = Deno.env.get("ANTHROPIC_EFFORT") ?? "low";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 }, "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 }, "claude-haiku-4-5": { in: 1, out: 5 },
};
function estimateCostUsd(model: string, usage: Record<string, number> | undefined): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  return ((usage?.input_tokens ?? 0) * p.in + (usage?.output_tokens ?? 0) * p.out
    + (usage?.cache_read_input_tokens ?? 0) * p.in * 0.1 + (usage?.cache_creation_input_tokens ?? 0) * p.in * 1.25) / 1_000_000;
}
function bytesToBase64(bytes: Uint8Array): string {
  let b = ""; for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]); return btoa(b);
}

const PROMPT = `Tu es un assistant qui lit un DOCUMENT IMPORTANT d'un restaurant français (bail commercial, offre/contrat de PRÊT bancaire, attestation d'ASSURANCE, honoraires d'expert-comptable ou d'avocat, statuts, Kbis, bilan comptable, devis…) et en extrait les informations utiles au budget prévisionnel.

Réponds UNIQUEMENT par un objet JSON valide (pas de texte, pas de markdown), schéma EXACT :

{
  "doc_type": "bail" | "pret_bancaire" | "assurance" | "honoraires" | "statuts" | "kbis" | "bilan" | "devis" | "autre",
  "title": string,                 // titre court et parlant (ex: "Bail commercial 12 rue X", "Prêt BNP fonds de commerce")
  "category": "juridique" | "banque" | "comptable" | "bail" | "assurance" | "rh" | "autre",
  "summary": string,               // 2-4 phrases résumant le document et ses points clés
  "parties": string[] | null,      // parties au contrat
  "dates": string[] | null,        // dates clés (signature, échéance, début/fin) au format lisible
  "proposed_overrides": {          // UNIQUEMENT les clés que tu peux remplir avec certitude (sinon omets-les)
    "loyerMensuelHC": number,      // loyer mensuel HORS CHARGES (bail)
    "chargesLocMensuel": number,   // charges locatives mensuelles (bail)
    "indexationLoyer": number,     // indexation annuelle en décimal (ex 0.02)
    "assurancePro": number,        // prime d'assurance ANNUELLE
    "comptable": number,           // honoraires comptable ANNUELS
    "eauElecGaz": number,          // énergie/fluides ANNUEL
    "pretFonds": number,           // capital emprunté (prêt fonds de commerce)
    "tauxFonds": number,           // taux annuel en décimal (ex 0.035)
    "moisFonds": number,           // durée en MOIS
    "pretMateriel": number,        // capital (prêt matériel)
    "tauxMat": number,
    "moisMat": number
  }
}

Règles :
- Mets dans "proposed_overrides" SEULEMENT les valeurs réellement présentes dans le document, sinon n'inclus pas la clé (objet vide {} si rien).
- Pour un PRÊT : range-le dans pretFonds/tauxFonds/moisFonds si c'est un prêt fonds de commerce/création, sinon pretMateriel/tauxMat/moisMat. Convertis un taux en décimal (4,5% → 0.045), une durée en MOIS (7 ans → 84).
- Pour un BAIL : loyer mensuel hors charges, charges, indexation si indiquée.
- Montants en euros, en number (pas de "€", point décimal). Si illisible : omets la clé.
- Le document peut être pivoté/multi-pages : lis tout.`;

function validate(raw: unknown) {
  if (typeof raw !== "object" || raw === null) throw new Error("ai_output_not_object");
  const o = raw as Record<string, unknown>;
  const cats = ["juridique", "banque", "comptable", "bail", "assurance", "rh", "autre"];
  const types = ["bail", "pret_bancaire", "assurance", "honoraires", "statuts", "kbis", "bilan", "devis", "autre"];
  if (typeof o.doc_type !== "string" || !types.includes(o.doc_type)) o.doc_type = "autre";
  if (typeof o.category !== "string" || !cats.includes(o.category)) o.category = "autre";
  if (typeof o.title !== "string" || !o.title) o.title = "Document";
  if (typeof o.summary !== "string") o.summary = "";
  // proposed_overrides : ne garder que des nombres finis.
  const po = (typeof o.proposed_overrides === "object" && o.proposed_overrides) ? o.proposed_overrides as Record<string, unknown> : {};
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(po)) if (typeof v === "number" && isFinite(v)) clean[k] = v;
  o.proposed_overrides = clean;
  return o;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!ANTHROPIC_API_KEY) return json({ error: "missing_anthropic_key" }, 500);

  let body: { storage_path?: string; storage_paths?: string[] };
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const paths = (Array.isArray(body.storage_paths) && body.storage_paths.length) ? body.storage_paths : (body.storage_path ? [body.storage_path] : []);
  if (!paths.length) return json({ error: "missing_storage_path" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const sources: unknown[] = [];
  for (const path of paths) {
    const { data: blob, error } = await admin.storage.from("documents").download(path);
    if (error || !blob) return json({ error: "download_failed", details: error?.message, path }, 404);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const mt = blob.type || "application/pdf";
    const b64 = bytesToBase64(buf);
    sources.push(mt === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mt, data: b64 } });
  }
  const storagePath = paths[0];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: controller.signal,
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4096, thinking: { type: "disabled" }, output_config: { effort: EFFORT },
        system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [...sources, { type: "text", text: "Analyse ce document et renvoie le JSON demandé." }] }],
      }),
    });
  } catch (e) { clearTimeout(timeout); return json({ error: "anthropic_request_failed", details: String(e) }, 502); }
  clearTimeout(timeout);
  if (!resp.ok) { const t = await resp.text(); return json({ error: "anthropic_http_error", status: resp.status, details: t }, 502); }

  const data = await resp.json();
  const text = (data?.content?.[0]?.text ?? "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()); }
  catch { return json({ error: "ai_output_not_json", raw: text }, 422); }
  let validated: unknown;
  try { validated = validate(parsed); } catch (e) { return json({ error: "ai_output_invalid", details: String(e) }, 422); }

  try {
    const establishmentId = storagePath.split("/")[0];
    const usage = data?.usage as Record<string, number> | undefined;
    if (establishmentId) {
      await admin.from("ai_usage").insert({
        establishment_id: establishmentId, model: MODEL,
        input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0,
        cache_read_tokens: usage?.cache_read_input_tokens ?? 0, cache_write_tokens: usage?.cache_creation_input_tokens ?? 0,
        cost_usd: estimateCostUsd(MODEL, usage),
      });
    }
  } catch (_e) { /* non bloquant */ }

  return json({ ok: true, result: validated });
});
