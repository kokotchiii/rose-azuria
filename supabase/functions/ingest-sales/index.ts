// ============================================================================
// Edge Function : ingest-sales
// ----------------------------------------------------------------------------
// Reçoit le "Rapport opérationnel (complet)" quotidien de Lightspeed (PDF)
// poussé par le robot Gmail, en extrait le texte (sans IA), et crée/actualise
// la RECETTE du jour dans `revenues` :
//   couverts, CA (espèces / carte / autre), TVA.
// Authentifié par le secret partagé INGEST_SECRET.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SECRET    = Deno.env.get("INGEST_SECRET");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors() } });
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// "1 119,50" -> 1119.50
function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const v = parseFloat(s.replace(/[\s ]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
  return isNaN(v) ? null : v;
}
const MOIS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04", mai: "05", juin: "06",
  juillet: "07", août: "08", aout: "08", septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

// Extrait les champs de la recette depuis le texte du rapport.
function parseReport(text: string, filename: string) {
  const t = text.replace(/ /g, " ");
  // Date : d'abord le nom de fichier (..._day_YYYYMMDD_...), sinon le texte.
  let date: string | null = null;
  const fnDate = filename.match(/_day_(\d{4})(\d{2})(\d{2})/);
  if (fnDate) date = `${fnDate[1]}-${fnDate[2]}-${fnDate[3]}`;
  if (!date) {
    const m = t.match(/pour\s+\w+\s+(\d{1,2})\s+([a-zéûôA-Zéèàç]+)\s+(\d{4})/i);
    if (m) { const mo = MOIS[m[2].toLowerCase()]; if (mo) date = `${m[3]}-${mo}-${m[1].padStart(2, "0")}`; }
  }
  const grab = (re: RegExp): number | null => { const m = t.match(re); return m ? num(m[1]) : null; };

  const covers = grab(/(\d+)\s*couverts/);
  const caTtc  = grab(/CA net sans les pourboires\s*[\r\n]*\s*([\d ., ]+,\d\d)/i);
  const caHt   = grab(/CA net,?\s*sans les taxes\s*[\r\n]*\s*([\d ., ]+,\d\d)/i);
  const especes = grab(/Esp[èe]ces\s*[\r\n]*\s*([\d ., ]+,\d\d)/i);
  const carte  = grab(/Carte[^\n]*\(Moins les pourboires\)\s*[\r\n]*\s*([\d ., ]+,\d\d)/i)
              ?? grab(/Carte bleue[^\n]*[\r\n]*\s*([\d ., ]+,\d\d)/i);

  const cash = especes ?? 0;
  const cb = carte ?? 0;
  const total = caTtc ?? (cash + cb);
  const other = Math.max(0, Math.round((total - cash - cb) * 100) / 100);
  const tva = (caTtc != null && caHt != null) ? Math.round((caTtc - caHt) * 100) / 100 : null;

  return { date, covers, cash, cb, other, tva, total };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (!INGEST_SECRET) return json({ error: "missing_ingest_secret_config" }, 500);

  let body: { secret?: string; establishment_id?: string; filename?: string; data_base64?: string; subject?: string; message_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  if (body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);
  const establishmentId = body.establishment_id;
  if (!establishmentId || !body.data_base64) return json({ error: "missing_fields" }, 400);

  // 1) Extrait le texte du PDF (sans IA) en RECONSTRUISANT l'ordre de lecture
  //    par position (y puis x). unpdf/extractText rend parfois le texte dans le
  //    désordre (colonnes mélangées) → les regex récupèrent de mauvais nombres.
  //    En regroupant les items par ligne (même y) triés de gauche à droite, on
  //    obtient un texte fiable "label … valeur" sur la même ligne.
  let text = "";
  try {
    const bytes = b64ToBytes(body.data_base64);
    const pdf = await getDocumentProxy(bytes);
    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; s: string }>>();
      for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
        const s = it.str ?? "";
        if (!s.trim() || !it.transform) continue;
        const x = it.transform[4];
        const yKey = Math.round(it.transform[5] / 2) * 2; // tolérance ~2px/ligne
        const arr = rows.get(yKey) ?? [];
        arr.push({ x, s });
        rows.set(yKey, arr);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        const parts = rows.get(y)!.sort((a, b) => a.x - b.x).map((e) => e.s);
        lines.push(parts.join(" "));
      }
    }
    text = lines.join("\n");
    // Filet de sécurité : si l'extraction positionnelle rend trop peu de texte,
    // on retombe sur l'extraction simple d'unpdf.
    if (text.replace(/\s/g, "").length < 50) {
      const res = await extractText(pdf, { mergePages: true });
      text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
    }
  } catch (e) {
    return json({ error: "pdf_extract_failed", details: String(e) }, 422);
  }

  const r = parseReport(text, body.filename ?? "");
  if (!r.date) return json({ error: "date_not_found", sample: text.slice(0, 300) }, 422);
  if (r.total <= 0) return json({ error: "no_sales_found", parsed: r, sample: text.slice(0, 300) }, 422);

  // Garde-fou anti-parse foireux : sur certains PDF, l'extraction texte (unpdf)
  // brouille l'ordre et les regex récupèrent de mauvais nombres. On refuse (sans
  // écrire) quand le résultat est invraisemblable, pour ne JAMAIS écraser une
  // recette correcte par une valeur fausse. Le jour reste à vérifier à la main.
  //  - CA incohérent avec les couverts (< 10 €/couvert alors qu'il y a des couverts)
  //  - paiements (espèces + CB + autre) qui ne réconcilient pas avec le CA net
  const paySum = r.cash + r.cb + r.other;
  const reconcileOff = Math.abs(paySum - r.total) > Math.max(2, r.total * 0.1);
  const vsCovers = r.covers != null && r.covers > 0 && r.total < r.covers * 10;
  if (vsCovers || reconcileOff) {
    return json({ error: "parse_uncertain", parsed: r, sample: text.slice(0, 500) }, 422);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 2) Upsert de la recette du jour (service "journee", source Lightspeed).
  const { data: existing } = await admin
    .from("revenues").select("id")
    .eq("establishment_id", establishmentId)
    .eq("revenue_date", r.date)
    .eq("service", "journee")
    .ilike("note", "%Lightspeed%")
    .maybeSingle();

  const payload = {
    establishment_id: establishmentId,
    revenue_date: r.date,
    service: "journee",
    amount_cash: r.cash,
    amount_cb: r.cb,
    amount_other: r.other,
    tva_amount: r.tva,
    covers: r.covers,
    note: "Import Lightspeed (auto)",
  };

  if (existing) {
    await admin.from("revenues").update(payload).eq("id", existing.id);
    return json({ ok: true, action: "updated", parsed: r });
  } else {
    await admin.from("revenues").insert(payload);
    return json({ ok: true, action: "created", parsed: r });
  }
});
