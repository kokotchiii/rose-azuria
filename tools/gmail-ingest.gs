/**
 * Robot Gmail → Rose : pousse les FACTURES et les RAPPORTS LIGHTSPEED reçus par
 * mail vers l'app.
 * ---------------------------------------------------------------------------
 *  - Facture (fournisseur)          → fonction `ingest-email`  → Boîte de réception
 *  - Rapport Lightspeed (recette)   → fonction `ingest-sales`  → Recette du jour
 *
 * Installation (une seule fois) :
 *  1. Va sur https://script.google.com → Nouveau projet → colle ce code.
 *  2. Remplis les valeurs de CONFIG ci-dessous.
 *  3. Menu « Exécuter » → lance `installerRobot` une fois (autorise l'accès
 *     à Gmail quand Google le demande — c'est TON compte, TON script).
 *  4. C'est tout : chaque jour, factures ET recettes Lightspeed partent
 *     tout seuls vers l'app.
 *
 * Sécurité : ce script tourne sur TON compte Google. Le secret ci-dessous doit
 * être identique à celui posé côté Supabase (INGEST_SECRET). Ne partage pas ce
 * fichier une fois rempli.
 */

// ===== CONFIG À REMPLIR =====================================================
var FUNCTION_URL       = 'https://srqabjdczvckjtvftvit.supabase.co/functions/v1/ingest-email';
var SALES_FUNCTION_URL = 'https://srqabjdczvckjtvftvit.supabase.co/functions/v1/ingest-sales';
var INGEST_SECRET      = 'REMPLACE_PAR_LE_SECRET';      // = INGEST_SECRET côté Supabase
var ESTABLISHMENT_ID   = 'REMPLACE_PAR_TON_ESTABLISHMENT_ID';
var SOURCE_LABEL       = 'Facture';                     // libellé optionnel pour forcer un mail
var DONE_LABEL         = 'Rose-Importe';                // posé après import (anti-doublon)

// Fenêtre de recherche (ex '1y' = 12 mois, '6m' = 6 mois, '30d' = 30 jours).
// 120j pour rattraper TOUS les rapports Lightspeed déjà reçus (les doublons
// sont ignorés côté serveur, donc aucun risque de re-import).
var NEWER_THAN  = '120d';
// Nb de fils traités par passage.
var MAX_THREADS = 80;
// On ignore les pièces jointes IMAGE plus petites que ça (logos, signatures).
var MIN_BYTES   = 15000;
// Liste blanche d'expéditeurs "toujours factures" (une partie de l'email/domaine).
var SENDERS = [];
// ===========================================================================

// Vrai si le mail est un rapport Lightspeed (recette du jour), pas une facture.
// Détection : expéditeur lightspeedhq.com + sujet « rapport » (ou nom de fichier
// « business_report »).
function looksLikeLightspeedReport(subject, from, filename) {
  var f = (from || '').toLowerCase();
  if (f.indexOf('lightspeedhq.com') === -1 && f.indexOf('lightspeed') === -1) return false;
  var s = ((subject || '') + ' ' + (filename || '')).toLowerCase();
  return s.indexOf('rapport') !== -1 || s.indexOf('report') !== -1 || s.indexOf('business_report') !== -1;
}

// Vrai si le sujet / nom de fichier / expéditeur évoque une facture.
function looksLikeInvoice(subject, from, filename) {
  var s = ((subject || '') + ' ' + (filename || '')).toLowerCase();
  var kw = ['facture','factures','invoice','factura','fattura','recu','reçu','quittance',
            'echeance','échéance','avoir','abonnement','billing','receipt','note de frais',
            'bon de commande','bon de livraison','releve','relevé','paiement','règlement',
            'reglement','honoraires','cotisation'];
  for (var i = 0; i < kw.length; i++) { if (s.indexOf(kw[i]) !== -1) return true; }
  if (/\b(inv|fac|f)[-\s]?\d{3,}/.test(s)) return true;   // INV-1234, FAC 5678…
  if (/n[°o]\s?\d{3,}/.test(s)) return true;               // n° 12345
  var f = (from || '').toLowerCase();
  for (var j = 0; j < SENDERS.length; j++) { if (SENDERS[j] && f.indexOf(SENDERS[j].toLowerCase()) !== -1) return true; }
  return false;
}

function threadHasSourceLabel(thread) {
  var ls = thread.getLabels();
  for (var i = 0; i < ls.length; i++) { if (ls[i].getName() === SOURCE_LABEL) return true; }
  return false;
}

// Envoie une pièce jointe à une fonction Supabase et logue la réponse.
function pushAttachment(url, att, m, extra) {
  var payload = {
    secret: INGEST_SECRET,
    establishment_id: ESTABLISHMENT_ID,
    message_id: m.getId(),
    from: m.getFrom(),
    subject: m.getSubject(),
    received_at: m.getDate().toISOString(),
    filename: att.getName(),
    mime: att.getContentType() || '',
    data_base64: Utilities.base64Encode(att.getBytes())
  };
  if (extra) { for (var k in extra) payload[k] = extra[k]; }
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  Logger.log(att.getName() + ' -> HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText());
}

function ingestInvoices() {
  var doneLabel = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  // Candidats : PDF récents + tout ce que tu tagues « Facture ».
  var query = '(has:attachment filename:pdf newer_than:' + NEWER_THAN + ' OR label:' + SOURCE_LABEL + ') -label:' + DONE_LABEL;
  var threads = GmailApp.search(query, 0, MAX_THREADS);

  for (var i = 0; i < threads.length; i++) {
    var forced = threadHasSourceLabel(threads[i]);
    var msgs = threads[i].getMessages();
    var pushed = false;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var subject = m.getSubject();
      var from = m.getFrom();
      var atts = m.getAttachments();

      // --- 1) RAPPORT LIGHTSPEED (recette) : route vers ingest-sales. ---
      if (looksLikeLightspeedReport(subject, from, '')) {
        for (var lk = 0; lk < atts.length; lk++) {
          var la = atts[lk];
          if ((la.getContentType() || '').indexOf('pdf') === -1) continue;
          pushAttachment(SALES_FUNCTION_URL, la, m, null);
          pushed = true;
        }
        continue; // ce message est une recette, pas une facture → on ne va pas plus loin
      }

      // --- 2) FACTURE fournisseur : route vers ingest-email. ---
      for (var k = 0; k < atts.length; k++) {
        var a = atts[k];
        var mime = a.getContentType() || '';
        if (mime.indexOf('pdf') === -1 && mime.indexOf('image') === -1) continue;
        if (mime.indexOf('image') !== -1 && a.getSize() < MIN_BYTES) continue;
        if (!forced && !looksLikeInvoice(subject, from, a.getName())) continue;
        pushAttachment(FUNCTION_URL, a, m, null);
        pushed = true;
      }
    }
    if (pushed) threads[i].addLabel(doneLabel);
  }
}

/** À lancer UNE fois : programme le robot UNE FOIS PAR JOUR (vers 8h). */
function installerRobot() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestInvoices') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('ingestInvoices').timeBased().everyDays(1).atHour(8).create();
  ingestInvoices(); // premier passage immédiat
}

/** Retire le libellé « Rose-Importe » de tous les fils pour repartir propre
 *  (utile pour reconsidérer les mails déjà reçus avec la nouvelle règle
 *  Lightspeed). Après, relance `ingestInvoices`. */
function reinitialiser() {
  var l = GmailApp.getUserLabelByName(DONE_LABEL);
  if (!l) { Logger.log('Aucun libellé ' + DONE_LABEL); return; }
  var total = 0, batch;
  do {
    batch = l.getThreads(0, 100);
    for (var i = 0; i < batch.length; i++) batch[i].removeLabel(l);
    total += batch.length;
  } while (batch.length === 100);
  Logger.log('Libellé ' + DONE_LABEL + ' retiré de ' + total + ' fils.');
}
