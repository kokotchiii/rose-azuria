// Coffre à documents : upload d'un document important + analyse IA
// (Edge Function analyze-business-doc) qui propose des chiffres pour le prévisionnel.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface BusinessDocExtraction {
  doc_type: string;     // bail, pret_bancaire, assurance, honoraires, statuts, kbis, bilan, devis, autre
  title: string;
  category: string;     // juridique, banque, comptable, bail, assurance, rh, autre
  summary: string;
  parties: string[] | null;
  dates: string[] | null;
  proposed_overrides: Record<string, number>; // clés = champs Hypotheses (loyerMensuelHC, pretFonds…)
}

function buildPath(establishmentId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${establishmentId}/coffre/${yyyy}/${mm}/${now.getTime()}-${safe}`;
}

export interface AnalyzeBusinessDocParams {
  client: SupabaseClient;
  establishmentId: string;
  pages: Array<{ file: Blob | File | ArrayBuffer | Uint8Array; contentType?: string }>;
  fileBaseName: string;
}

export async function uploadAndAnalyzeBusinessDoc(
  params: AnalyzeBusinessDocParams,
): Promise<{ extraction: BusinessDocExtraction; storagePath: string; fileType: string }> {
  const { client, establishmentId, pages, fileBaseName } = params;
  if (!pages.length) throw new Error("no_pages");

  const storagePaths: string[] = [];
  let firstType = "application/pdf";
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const ct = p.contentType ?? (p.file as File).type ?? "application/pdf";
    if (i === 0) firstType = ct;
    const ext = ct === "application/pdf" ? "pdf" : ct === "image/png" ? "png" : "jpg";
    const name = pages.length > 1 ? `${fileBaseName}-p${i + 1}.${ext}` : `${fileBaseName}.${ext}`;
    const path = buildPath(establishmentId, name);
    const { error } = await client.storage.from("documents").upload(path, p.file, { upsert: false, contentType: ct });
    if (error) throw new Error(`upload_failed: ${error.message}`);
    storagePaths.push(path);
  }

  const { data: fnData, error: fnErr } = await client.functions.invoke("analyze-business-doc", {
    body: { storage_paths: storagePaths, storage_path: storagePaths[0] },
  });
  if (fnErr || !fnData?.ok) {
    let detail = "";
    const ctx = (fnErr as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.text === "function") { try { detail = await ctx.text(); } catch { /* ignore */ } }
    else if (fnData) detail = JSON.stringify(fnData);
    throw new Error(`analyze_failed: ${fnErr?.message ?? "error"}${detail ? ` — ${detail}` : ""}`);
  }

  return { extraction: fnData.result as BusinessDocExtraction, storagePath: storagePaths[0]!, fileType: firstType };
}
