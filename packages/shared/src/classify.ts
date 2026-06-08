// Helper : upload d'un fichier vers Storage + appel à l'Edge Function
// `classify-document`. Renvoie le JSON pré-rempli pour le formulaire de dépense.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CATEGORIES } from "./constants";
import type { AiExtraction } from "./types";

export interface UploadAndClassifyParams {
  client: SupabaseClient;
  establishmentId: string;
  // Web : Blob/File. React Native : on lit la photo en octets bruts (Uint8Array).
  file: Blob | File | ArrayBuffer | Uint8Array;
  fileName: string;             // ex: "facture-metro.jpg"
  uploadedBy: string;            // profile.id
  categories?: string[];         // sinon DEFAULT_CATEGORIES
  // Type MIME explicite. Obligatoire quand `file` n'est pas un Blob/File
  // (un Uint8Array n'a pas de propriété `.type`), ex: "image/jpeg".
  contentType?: string;
}

export interface UploadAndClassifyResult {
  documentId: string;
  storagePath: string;
  extraction: AiExtraction;
}

// Chemin Storage : <establishmentId>/<YYYY>/<MM>/<timestamp>-<name>
function buildStoragePath(establishmentId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const stamp = now.getTime();
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${establishmentId}/${yyyy}/${mm}/${stamp}-${safe}`;
}

export async function uploadAndClassify(
  params: UploadAndClassifyParams,
): Promise<UploadAndClassifyResult> {
  const { client, establishmentId, file, fileName, uploadedBy } = params;
  const categories = params.categories ?? [...DEFAULT_CATEGORIES];
  const contentType = params.contentType ?? (file as File).type ?? undefined;

  const storagePath = buildStoragePath(establishmentId, fileName);

  // 1) Upload
  const { error: upErr } = await client
    .storage
    .from("documents")
    .upload(storagePath, file, { upsert: false, contentType });
  if (upErr) throw new Error(`upload_failed: ${upErr.message}`);

  // 2) Crée la ligne `documents` en statut pending
  const { data: docRow, error: docErr } = await client
    .from("documents")
    .insert({
      establishment_id: establishmentId,
      storage_path: storagePath,
      file_type: contentType ?? null,
      uploaded_by: uploadedBy,
      ai_status: "pending",
    })
    .select("id")
    .single();
  if (docErr || !docRow) throw new Error(`document_insert_failed: ${docErr?.message}`);

  // 3) Appelle l'Edge Function
  const { data: fnData, error: fnErr } = await client.functions.invoke("classify-document", {
    body: { storage_path: storagePath, categories },
  });

  if (fnErr || !fnData?.ok) {
    // Récupère le corps de la réponse d'erreur si disponible
    let detail = "";
    const ctx = (fnErr as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = await ctx.text(); } catch { /* ignore */ }
    } else if (fnData) {
      detail = JSON.stringify(fnData);
    }
    await client.from("documents").update({ ai_status: "failed" }).eq("id", docRow.id);
    throw new Error(`ai_failed: ${fnErr?.message ?? "error"}${detail ? ` — ${detail}` : ""}`);
  }

  const extraction = fnData.result as AiExtraction;

  // 4) Stocke le JSON brut pour audit
  await client.from("documents")
    .update({ ai_status: "done", ai_raw_json: extraction })
    .eq("id", docRow.id);

  return {
    documentId: docRow.id,
    storagePath,
    extraction,
  };
}

// ---------------------------------------------------------------------------
// Multi-pages : un même justificatif en plusieurs photos (ou un PDF).
// Chaque page est uploadée séparément ; l'Edge Function les envoie TOUTES à
// Claude dans un seul message → extraction unique consolidée.
// ---------------------------------------------------------------------------

export interface PageInput {
  file: Blob | File | ArrayBuffer | Uint8Array;
  contentType?: string; // ex "image/jpeg" | "application/pdf"
}

export interface UploadAndClassifyPagesParams {
  client: SupabaseClient;
  establishmentId: string;
  pages: PageInput[];
  fileBaseName: string;   // ex "facture-2026-06-08" (sans extension)
  uploadedBy: string;
  categories?: string[];
}

export async function uploadAndClassifyPages(
  params: UploadAndClassifyPagesParams,
): Promise<UploadAndClassifyResult & { storagePaths: string[] }> {
  const { client, establishmentId, pages, fileBaseName, uploadedBy } = params;
  const categories = params.categories ?? [...DEFAULT_CATEGORIES];
  if (!pages.length) throw new Error("no_pages");

  // 1) Upload de chaque page
  const storagePaths: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const ct = p.contentType ?? (p.file as File).type ?? "image/jpeg";
    const ext = ct === "application/pdf" ? "pdf" : ct === "image/png" ? "png" : "jpg";
    const name = pages.length > 1 ? `${fileBaseName}-p${i + 1}.${ext}` : `${fileBaseName}.${ext}`;
    const path = buildStoragePath(establishmentId, name);
    const { error: upErr } = await client.storage.from("documents").upload(path, p.file, { upsert: false, contentType: ct });
    if (upErr) throw new Error(`upload_failed: ${upErr.message}`);
    storagePaths.push(path);
  }

  // 2) Une seule ligne `documents` (la 1re page sert de référence/aperçu).
  const firstPath = storagePaths[0]!;
  const firstType = pages[0]!.contentType ?? null;
  const { data: docRow, error: docErr } = await client
    .from("documents")
    .insert({
      establishment_id: establishmentId,
      storage_path: firstPath,
      file_type: firstType,
      uploaded_by: uploadedBy,
      ai_status: "pending",
    })
    .select("id")
    .single();
  if (docErr || !docRow) throw new Error(`document_insert_failed: ${docErr?.message}`);

  // 3) Edge Function — on envoie le tableau ET la 1re page (rétro-compat avec
  //    une fonction pas encore redéployée : elle classifiera au moins la page 1).
  const { data: fnData, error: fnErr } = await client.functions.invoke("classify-document", {
    body: { storage_paths: storagePaths, storage_path: firstPath, categories },
  });

  if (fnErr || !fnData?.ok) {
    let detail = "";
    const ctx = (fnErr as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = await ctx.text(); } catch { /* ignore */ }
    } else if (fnData) {
      detail = JSON.stringify(fnData);
    }
    await client.from("documents").update({ ai_status: "failed" }).eq("id", docRow.id);
    throw new Error(`ai_failed: ${fnErr?.message ?? "error"}${detail ? ` — ${detail}` : ""}`);
  }

  const extraction = fnData.result as AiExtraction;
  await client.from("documents").update({ ai_status: "done", ai_raw_json: extraction }).eq("id", docRow.id);

  return { documentId: docRow.id, storagePath: firstPath, storagePaths, extraction };
}
