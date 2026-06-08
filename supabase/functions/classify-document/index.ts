// ============================================================================
// Edge Function : classify-document
// ----------------------------------------------------------------------------
// Reçoit { storage_path: string, categories: string[] } depuis le client.
// 1. Génère une URL signée pour le fichier dans le bucket `documents`.
// 2. Télécharge le fichier, l'encode en base64.
// 3. Si HEIC (iPhone) → convertit en JPEG côté serveur.
// 4. Appelle l'API Anthropic (Claude vision) avec un prompt strict JSON.
// 5. Parse / valide / renvoie le JSON structuré au client.
//
// La clé ANTHROPIC_API_KEY n'est JAMAIS exposée au client : elle vit en
// secret côté Edge Function (`supabase secrets set ANTHROPIC_API_KEY=...`).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Sonnet 4.6 : meilleur compromis vitesse/intelligence, supporte effort + prompt caching.
// Pour aller PLUS VITE encore : ANTHROPIC_MODEL=claude-haiku-4-5 (moins précis sur factures complexes).
const MODEL             = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
// effort : low (rapide, défaut) | medium | high. Monte d'un cran si des factures complexes passent mal.
const EFFORT            = Deno.env.get("ANTHROPIC_EFFORT") ?? "low";

const DEFAULT_CATEGORIES = [
  "Matières premières (food)",
  "Boissons",
  "Loyer",
  "Énergie / fluides",
  "Équipement / entretien",
  "Fournitures",
  "Marketing",
  "Frais bancaires",
  "Transport / déplacements",
  "Honoraires (comptable…)",
  "Taxes",
  "Autres",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Tarifs API Anthropic en USD / million de tokens (input, output).
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8":   { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5":  { in: 1, out: 5 },
};

// Coût estimé d'un appel à partir de l'objet `usage` renvoyé par l'API.
function estimateCostUsd(model: string, usage: Record<string, number> | undefined): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  // cache read ≈ 0.1× input, cache write ≈ 1.25× input
  return (
    (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1_000_000
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Détection HEIC : on renvoie un message clair au lieu d'essayer de décoder
// (la conversion HEIC nécessite >150 Mo, au-dessus de la limite Edge Function).
function isHeic(buf: Uint8Array, mime: string): boolean {
  if (mime === "image/heic" || mime === "image/heif") return true;
  if (buf.length < 12) return false;
  const ftyp = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
  if (ftyp !== "ftyp") return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  return ["heic", "heix", "hevc", "hevx", "heis", "hxis", "mif1", "msf1"].includes(brand);
}

function buildPrompt(categories: string[]): string {
  return `Tu es un assistant qui extrait les informations d'un justificatif (facture, bon de livraison, ticket ou note de frais) d'un restaurant français.

Réponds UNIQUEMENT par un objet JSON valide (pas de texte avant ou après, pas de balises markdown), avec exactement ce schéma :

{
  "document_type": "facture" | "bon_de_livraison" | "ticket" | "note_de_frais" | "autre",
  "supplier_name": string | null,
  "supplier_siret": string | null,
  "document_date": "YYYY-MM-DD" | null,
  "invoice_number": string | null,
  "currency": "EUR",
  "amount_ht": number | null,
  "amount_tva": number | null,
  "amount_ttc": number | null,
  "tva_rate": number | null,
  "suggested_category": string,
  "line_items": [
    { "description": string, "quantity": number | null, "unit_price": number | null }
  ],
  "confidence": number
}

IMPORTANT — le restaurant qui REÇOIT la facture est le CLIENT (destinataire). Tu extrais toujours les infos du FOURNISSEUR (émetteur du document), jamais celles du restaurant client.

Règles d'ANCRAGE des champs (c'est ICI que se produisent les erreurs — lis très attentivement) :
- "supplier_name" : raison sociale de l'ÉMETTEUR (en-tête, en haut, près du logo). JAMAIS le restaurant destinataire, JAMAIS "Azuria".
- "supplier_siret" : SIRET à 14 chiffres du fournisseur. PAS le SIREN (9 chiffres), PAS le n° de TVA intracommunautaire, PAS un code client.
- "document_date" : date d'ÉMISSION de la facture. PAS la date d'échéance, PAS la date de livraison (sauf si c'est un bon de livraison).
- "invoice_number" : n° de FACTURE du fournisseur (libellé "Facture n°", "N° facture", "Invoice"). PAS un n° de commande, de bon de livraison, de client, ni un n° de TVA.
- "amount_ttc" : le total FINAL à payer ("Total TTC", "Net à payer", "Montant dû", "Total à régler"), en général en bas / dernière page. JAMAIS un sous-total, un montant de ligne, ni le total HT.
- "amount_ht" : total hors taxes. "amount_tva" : montant total de TVA (somme si plusieurs taux).
- "tva_rate" : taux principal en % (ex 5.5, 10, 20) ; si plusieurs taux, le taux dominant.

Règles strictes :
- Si une valeur est illisible ou absente : null (NE JAMAIS inventer).
- Si le document a PLUSIEURS PAGES : lis et accumule les items de TOUTES les pages (les factures Metro/Promocash listent souvent les articles sur 2-5 pages). Le total TTC se trouve souvent en dernière page : c'est lui qui fait foi.
- "suggested_category" DOIT appartenir EXACTEMENT à cette liste : ${JSON.stringify(categories)}.
- "confidence" est un nombre entre 0 et 1 reflétant ta certitude globale.
- Les montants sont en euros, en number (pas de string avec "€").
- "document_date" au format ISO YYYY-MM-DD.
- "line_items" peut être un tableau vide si non détectable.

Règles CRUCIALES sur "quantity" (très important, lis bien) :
- "quantity" = le nombre d'UNITÉS / EXEMPLAIRES achetés sur la facture, PAS une caractéristique du produit.
- Si le libellé contient un nombre qui fait partie de la DESCRIPTION du produit (lot, pack, conditionnement), la quantité = 1.
- Exemples (lis-les attentivement) :
   • "250 cartes de visite premium 8,5x5,5cm" → quantity = 1 (et description = "250 cartes de visite premium 8,5x5,5cm")
   • "Pack 100 enveloppes blanches" → quantity = 1
   • "Lot de 12 verres" → quantity = 1
   • "Flyer A5 x 500" → quantity = 1
   • "3 baguettes" → quantity = 3
   • "10 kg farine T55" → quantity = 10
   • "Bouteille eau gazeuse 1L" → quantity = 1
- VÉRIFICATION FINALE OBLIGATOIRE : la somme des (quantity × unit_price) des line_items doit être proche de amount_ttc (à 5-10% près, tolérance TVA/frais). Si tu obtiens un total 10x ou 100x amount_ttc, tu as TRÈS PROBABLEMENT mis une quantité incluse dans le libellé : recommence et mets quantity = 1 pour ce produit.`;
}

function validateAiJson(raw: unknown, categories: string[]) {
  if (typeof raw !== "object" || raw === null) throw new Error("ai_output_not_object");
  const o = raw as Record<string, unknown>;

  const docTypes = ["facture", "bon_de_livraison", "ticket", "note_de_frais", "autre"];
  if (typeof o.document_type !== "string" || !docTypes.includes(o.document_type)) o.document_type = "autre";
  if (typeof o.suggested_category !== "string" || !categories.includes(o.suggested_category)) o.suggested_category = "Autres";
  if (typeof o.confidence !== "number" || o.confidence < 0 || o.confidence > 1) o.confidence = 0;
  if (!Array.isArray(o.line_items)) o.line_items = [];
  o.currency = "EUR";

  // Filet de sécu : si la somme des items > 2x amount_ttc → quantité incluse dans
  // le libellé (cas "250 cartes de visite"). On force quantity=1 partout.
  const ttc = typeof o.amount_ttc === "number" ? o.amount_ttc : null;
  if (ttc && ttc > 0) {
    const items = o.line_items as Array<{ quantity: number | null; unit_price: number | null }>;
    const sum = items.reduce((s, it) => {
      const q = typeof it.quantity === "number" ? it.quantity : 1;
      const u = typeof it.unit_price === "number" ? it.unit_price : 0;
      return s + q * u;
    }, 0);
    if (sum > ttc * 2) {
      for (const it of items) if (it.quantity != null && it.quantity > 1) it.quantity = 1;
    }
  }

  return o;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!ANTHROPIC_API_KEY) return json({ error: "missing_anthropic_key" }, 500);

  let body: { storage_path?: string; storage_paths?: string[]; categories?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  // Accepte un tableau de pages (multi-photos) OU un chemin unique (rétro-compat).
  const paths = (Array.isArray(body.storage_paths) && body.storage_paths.length)
    ? body.storage_paths
    : (body.storage_path ? [body.storage_path] : []);
  const categories  = body.categories?.length ? body.categories : DEFAULT_CATEGORIES;
  if (!paths.length) return json({ error: "missing_storage_path" }, 400);

  // 1) Service-role pour lire les fichiers dans Storage ; on construit un bloc
  //    de contenu par page (image ou PDF) → toutes envoyées dans un seul message.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const sources: unknown[] = [];
  for (const path of paths) {
    const { data: fileBlob, error: dlErr } = await admin.storage.from("documents").download(path);
    if (dlErr || !fileBlob) {
      return json({ error: "download_failed", details: dlErr?.message, path }, 404);
    }
    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const mediaType = fileBlob.type || "image/jpeg";

    // HEIC : pas supporté côté serveur (limite mémoire). Message clair au client.
    if (isHeic(buf, mediaType)) {
      return json({
        error: "heic_not_supported",
        message: "Les photos HEIC (iPhone par défaut) ne sont pas supportées. Active 'Le plus compatible' dans Réglages → Appareil photo → Formats sur l'iPhone, ou envoie une capture d'écran.",
      }, 415);
    }

    const b64 = bytesToBase64(buf);
    sources.push(mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image",    source: { type: "base64", media_type: mediaType,         data: b64 } });
  }

  // 1er chemin : sert pour l'establishment_id (suivi coût).
  const storagePath = paths[0];

  // 3) Appel Anthropic (timeout 60s)
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 60_000);

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        // Pas de réflexion étendue pour une extraction bornée → plus rapide.
        thinking: { type: "disabled" },
        // effort bas = moins de sur-réflexion = latence réduite (réglable via ANTHROPIC_EFFORT).
        output_config: { effort: EFFORT },
        // Prompt d'instructions placé en system + mis en cache : réutilisé d'un appel à l'autre.
        system: [
          { type: "text", text: buildPrompt(categories), cache_control: { type: "ephemeral" } },
        ],
        // Le message contient toutes les pages/photos (seule partie qui change à chaque appel).
        messages: [
          { role: "user", content: [...sources, { type: "text", text: "Analyse ce justificatif et renvoie le JSON demandé. Toutes les images/pages fournies forment UN SEUL document : consolide-les (le total TTC est en général sur la dernière page)." }] },
        ],
      }),
    });
  } catch (e) {
    clearTimeout(timeout);
    return json({ error: "anthropic_request_failed", details: String(e) }, 502);
  }
  clearTimeout(timeout);

  if (!anthropicResp.ok) {
    const text = await anthropicResp.text();
    return json({ error: "anthropic_http_error", status: anthropicResp.status, details: text }, 502);
  }

  const data = await anthropicResp.json();
  const text = (data?.content?.[0]?.text ?? "").trim();

  let parsed: unknown;
  try {
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return json({ error: "ai_output_not_json", raw: text }, 422);
  }

  let validated: unknown;
  try {
    validated = validateAiJson(parsed, categories);
  } catch (e) {
    return json({ error: "ai_output_invalid", details: String(e), raw: parsed }, 422);
  }

  // Suivi du coût (non bloquant) : establishment_id = 1er segment du storage_path.
  try {
    const establishmentId = storagePath.split("/")[0];
    const usage = data?.usage as Record<string, number> | undefined;
    if (establishmentId) {
      await admin.from("ai_usage").insert({
        establishment_id:   establishmentId,
        model:              MODEL,
        input_tokens:       usage?.input_tokens ?? 0,
        output_tokens:      usage?.output_tokens ?? 0,
        cache_read_tokens:  usage?.cache_read_input_tokens ?? 0,
        cache_write_tokens: usage?.cache_creation_input_tokens ?? 0,
        cost_usd:           estimateCostUsd(MODEL, usage),
      });
    }
  } catch (_e) {
    // Le suivi de coût ne doit jamais bloquer la réponse au client.
  }

  return json({ ok: true, result: validated });
});
