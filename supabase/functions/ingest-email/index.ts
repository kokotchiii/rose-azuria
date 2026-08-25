// ============================================================================
// Edge Function : ingest-email
// ----------------------------------------------------------------------------
// Reçoit UNE pièce jointe de facture poussée par le robot Gmail (Google Apps
// Script) et la dépose dans la boîte de réception « à valider » :
//   1. Vérifie le secret partagé (INGEST_SECRET).
//   2. Dédoublonne par (établissement, message-id, nom de fichier).
//   3. Upload la pièce jointe dans Storage (bucket `documents`).
//   4. Crée un `document` source='email', review_status='pending'.
//   5. Lance la reconnaissance IA (classify-document) et stocke l'extraction.
//
// Le client (desktop/mobile) affiche ensuite ces documents dans « Boîte de
// réception » : l'utilisateur valide → la dépense est créée. Rien n'est créé
// automatiquement en compta : mode « file à valider ».
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SECRET    = Deno.env.get("INGEST_SECRET");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Nettoie un nom de fichier pour un chemin Storage.
function safeName(name: string): string {
  return (name || "piece.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!INGEST_SECRET) return json({ error: "missing_ingest_secret_config" }, 500);

  let body: {
    secret?: string; establishment_id?: string; message_id?: string;
    from?: string; subject?: string; received_at?: string;
    filename?: string; mime?: string; data_base64?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }

  // 1) Auth par secret partagé.
  if (body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const establishmentId = body.establishment_id;
  const messageId       = body.message_id ?? null;
  const filename        = safeName(body.filename ?? "piece.pdf");
  const mime            = body.mime || "application/pdf";
  if (!establishmentId || !body.data_base64) {
    return json({ error: "missing_fields", need: ["establishment_id", "data_base64"] }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const storagePath = `${establishmentId}/email/${(messageId ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}_${filename}`;

  // 2) Dédoublonnage : ce fichier de cet e-mail est-il déjà entré ?
  if (messageId) {
    const { data: dup } = await admin
      .from("documents").select("id")
      .eq("establishment_id", establishmentId)
      .eq("email_message_id", messageId)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (dup) return json({ ok: true, skipped: "already_ingested", document_id: dup.id });
  }

  // 3) Upload dans Storage.
  const bytes = base64ToBytes(body.data_base64);
  const { error: upErr } = await admin.storage.from("documents").upload(storagePath, bytes, {
    contentType: mime, upsert: true,
  });
  if (upErr) return json({ error: "upload_failed", details: upErr.message }, 500);

  // 4) Crée le document « à valider ».
  const { data: doc, error: insErr } = await admin.from("documents").insert({
    establishment_id:  establishmentId,
    storage_path:      storagePath,
    file_type:         mime,
    ai_status:         "pending",
    source:            "email",
    review_status:     "pending",
    email_from:        body.from ?? null,
    email_subject:     body.subject ?? null,
    email_message_id:  messageId,
    email_received_at: body.received_at ?? null,
  }).select("id").single();
  if (insErr) return json({ error: "insert_failed", details: insErr.message }, 500);

  // 5) Reconnaissance IA EN ARRIÈRE-PLAN : on répond tout de suite au robot
  //    (sinon Apps Script attendrait 5-30 s par pièce jointe et finirait par
  //    bloquer). La classification se poursuit après l'envoi de la réponse.
  const classify = async () => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/classify-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ storage_path: storagePath }),
      });
      if (resp.ok) {
        const out = await resp.json();
        await admin.from("documents")
          .update({ ai_status: "done", ai_raw_json: out?.result ?? null })
          .eq("id", doc.id);
      } else {
        await admin.from("documents").update({ ai_status: "failed" }).eq("id", doc.id);
      }
    } catch (_e) {
      await admin.from("documents").update({ ai_status: "failed" }).eq("id", doc.id);
    }
  };

  // EdgeRuntime.waitUntil garde le worker en vie pour finir la classification
  // après avoir répondu. Si indisponible, on lance sans attendre (best effort).
  try {
    // @ts-ignore - global fourni par le runtime Supabase Edge
    EdgeRuntime.waitUntil(classify());
  } catch (_e) {
    void classify();
  }

  return json({ ok: true, document_id: doc.id, queued: true });
});
