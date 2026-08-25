// ============================================================================
// Edge Function : parse-bank-statement
// ----------------------------------------------------------------------------
// Reçoit { storage_paths: string[] } (pages d'un relevé bancaire PDF/image).
// 1. Télécharge chaque page depuis le bucket `documents`, encode en base64.
// 2. Appelle Claude vision avec un prompt strict JSON.
// 3. Renvoie la liste normalisée des opérations (date, libellé, montant, sens).
//
// La clé ANTHROPIC_API_KEY vit en secret côté Edge Function, jamais côté client.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8":   { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5":  { in: 1, out: 5 },
};

function estimateCostUsd(model: string, usage: Record<string, number> | undefined): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1_000_000;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function isHeic(buf: Uint8Array, mime: string): boolean {
  if (mime === "image/heic" || mime === "image/heif") return true;
  if (buf.length < 12) return false;
  const ftyp = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
  if (ftyp !== "ftyp") return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  return ["heic", "heix", "hevc", "hevx", "heis", "hxis", "mif1", "msf1"].includes(brand);
}

const PROMPT = `Tu es un assistant comptable qui lit un RELEVÉ BANCAIRE (banque française) et en extrait TOUTES les opérations.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte avant/après, pas de balises markdown), avec exactement ce schéma :

{
  "bank_name": string | null,
  "account_holder": string | null,
  "period_start": "YYYY-MM-DD" | null,
  "period_end": "YYYY-MM-DD" | null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "label": string,
      "amount": number,
      "direction": "debit" | "credit"
    }
  ]
}

Règles IMPÉRATIVES :
- Extrais CHAQUE ligne d'opération du relevé, sans en oublier ni en inventer. S'il y a plusieurs pages, lis-les TOUTES et concatène les opérations dans l'ordre chronologique.
- "date" : la date de l'opération (colonne "Date" ou "Date opération"). Si seul un jour/mois est affiché, complète l'année avec celle de la période du relevé. Format ISO YYYY-MM-DD.
- "label" : le libellé COMPLET de l'opération tel qu'écrit (ex "CB CARREFOUR MARSEILLE 12/06", "VIR SEPA SARL SUD PRIMEURS", "PRLV EDF", "RETRAIT DAB"). Garde le texte brut, utile pour reconnaître le fournisseur.
- "amount" : le MONTANT en euros, TOUJOURS POSITIF (valeur absolue), en number (pas de string, pas de "€", point décimal).
- "direction" : "debit" si c'est une sortie d'argent (colonne Débit, paiement, prélèvement, retrait, virement émis), "credit" si c'est une entrée (colonne Crédit, virement reçu, remise).
- Beaucoup de relevés ont deux colonnes Débit / Crédit : utilise la colonne où le montant est inscrit pour déterminer la direction.
- Ne confonds PAS le solde (ancien solde / nouveau solde / solde intermédiaire) avec une opération : n'inclus PAS les lignes de solde dans "transactions".
- Si une valeur est illisible ou absente : utilise null pour les champs d'en-tête ; pour une opération, n'invente jamais — si tu ne peux pas lire le montant ou la date d'une ligne, ignore cette ligne.

Le document peut être pivoté ou de travers : lis-le quelle que soit son orientation.`;

interface RawTx { date?: unknown; label?: unknown; amount?: unknown; direction?: unknown }

function validate(raw: unknown) {
  if (typeof raw !== "object" || raw === null) throw new Error("ai_output_not_object");
  const o = raw as Record<string, unknown>;
  const txIn = Array.isArray(o.transactions) ? (o.transactions as RawTx[]) : [];
  const transactions = txIn
    .map((t) => {
      const date = typeof t.date === "string" ? t.date.slice(0, 10) : null;
      const label = typeof t.label === "string" ? t.label.trim() : "";
      const amount = typeof t.amount === "number" ? Math.abs(t.amount) : null;
      const direction = t.direction === "credit" ? "credit" : "debit";
      return { date, label, amount, direction };
    })
    .filter((t) => t.date && t.amount != null && t.label) as Array<{
      date: string; label: string; amount: number; direction: "debit" | "credit";
    }>;
  return {
    bank_name: typeof o.bank_name === "string" ? o.bank_name : null,
    account_holder: typeof o.account_holder === "string" ? o.account_holder : null,
    period_start: typeof o.period_start === "string" ? o.period_start.slice(0, 10) : null,
    period_end: typeof o.period_end === "string" ? o.period_end.slice(0, 10) : null,
    transactions,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!ANTHROPIC_API_KEY) return json({ error: "missing_anthropic_key" }, 500);

  let body: { storage_path?: string; storage_paths?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const paths = (Array.isArray(body.storage_paths) && body.storage_paths.length)
    ? body.storage_paths
    : (body.storage_path ? [body.storage_path] : []);
  if (!paths.length) return json({ error: "missing_storage_path" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const sources: unknown[] = [];
  for (const path of paths) {
    const { data: fileBlob, error: dlErr } = await admin.storage.from("documents").download(path);
    if (dlErr || !fileBlob) return json({ error: "download_failed", details: dlErr?.message, path }, 404);
    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const mediaType = fileBlob.type || "application/pdf";
    if (isHeic(buf, mediaType)) {
      return json({
        error: "heic_not_supported",
        message: "Les photos HEIC ne sont pas supportées. Exporte ton relevé en PDF.",
      }, 415);
    }
    const b64 = bytesToBase64(buf);
    sources.push(mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image",    source: { type: "base64", media_type: mediaType,         data: b64 } });
  }

  const storagePath = paths[0];
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 150_000);

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
        max_tokens: 8192,
        thinking: { type: "disabled" },
        output_config: { effort: EFFORT },
        system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: [...sources, { type: "text", text: "Extrais toutes les opérations de ce relevé bancaire et renvoie le JSON demandé. Lis toutes les pages." }] },
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
    validated = validate(parsed);
  } catch (e) {
    return json({ error: "ai_output_invalid", details: String(e), raw: parsed }, 422);
  }

  // Suivi du coût (non bloquant).
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
  } catch (_e) { /* non bloquant */ }

  return json({ ok: true, result: validated });
});
