/**
 * Robot Gmail → Rose : pousse les factures reçues par mail vers l'app.
 * ---------------------------------------------------------------------------
 * Installation (une seule fois) :
 *  1. Dans Gmail, crée un libellé « Factures » et un filtre qui l'applique
 *     (ex. : e-mails avec pièce jointe venant de tes fournisseurs).
 *  2. Va sur https://script.google.com → Nouveau projet → colle ce code.
 *  3. Remplis les 3 valeurs de CONFIG ci-dessous.
 *  4. Menu « Exécuter » → lance `installerRobot` une fois (autorise l'accès
 *     à Gmail quand Google le demande — c'est TON compte, TON script).
 *  5. C'est tout : toutes les 15 min, les nouvelles factures partent vers
 *     « Boîte de réception » dans l'app, où tu les valides.
 *
 * Sécurité : ce script tourne sur TON compte Google. Il ne lit QUE le libellé
 * « Factures ». Le secret ci-dessous doit être identique à celui posé côté
 * Supabase (INGEST_SECRET). Ne partage pas ce fichier une fois rempli.
 */

// ===== CONFIG À REMPLIR =====================================================
var FUNCTION_URL     = 'https://srqabjdczvckjtvftvit.supabase.co/functions/v1/ingest-email';
var INGEST_SECRET    = 'REMPLACE_PAR_LE_SECRET';      // = INGEST_SECRET côté Supabase
var ESTABLISHMENT_ID = 'REMPLACE_PAR_TON_ESTABLISHMENT_ID';
var SOURCE_LABEL     = 'Facture';                     // libellé optionnel pour forcer un mail
var DONE_LABEL       = 'Rose-Importe';                // posé après import (anti-doublon)

// Fenêtre de recherche (ex '1y' = 12 mois, '6m' = 6 mois, '30d' = 30 jours).
// 30j = on ne ramène que les nouvelles factures au fil de l'eau (l'historique
// se traite à part, à partir des PDF, sans crédits IA).
var NEWER_THAN  = '30d';
// Nb de fils traités par passage.
var MAX_THREADS = 50;
// On ignore les pièces jointes plus petites que ça (logos/signatures, pas des factures).
var MIN_BYTES   = 15000;
// Liste blanche d'expéditeurs "toujours factures" (une partie de l'email/domaine
// suffit). Ex : ['sysco','metro','promocash','lightspeed','engie','bouygues'].
var SENDERS = [];
// ===========================================================================

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

function ingestInvoices() {
  var doneLabel = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  // Candidats : PDF des 12 derniers mois + tout ce que tu tagues « Facture ».
  var query = '(has:attachment filename:pdf newer_than:' + NEWER_THAN + ' OR label:' + SOURCE_LABEL + ') -label:' + DONE_LABEL;
  var threads = GmailApp.search(query, 0, MAX_THREADS);

  for (var i = 0; i < threads.length; i++) {
    // Un fil tagué « Facture » est traité de force ; sinon on filtre au sujet/nom.
    var forced = threadHasSourceLabel(threads[i]);
    var msgs = threads[i].getMessages();
    var pushed = false;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var subject = m.getSubject();
      var from = m.getFrom();
      var atts = m.getAttachments();
      for (var k = 0; k < atts.length; k++) {
        var a = atts[k];
        var mime = a.getContentType() || '';
        // On ne pousse que les PDF et images (les vraies factures).
        if (mime.indexOf('pdf') === -1 && mime.indexOf('image') === -1) continue;
        // Ignore les petites images (logos, signatures, pixels de suivi).
        if (mime.indexOf('image') !== -1 && a.getSize() < MIN_BYTES) continue;
        // TRI EN AMONT : on n'envoie à l'IA que ce qui ressemble à une facture.
        if (!forced && !looksLikeInvoice(subject, from, a.getName())) continue;

        var payload = {
          secret: INGEST_SECRET,
          establishment_id: ESTABLISHMENT_ID,
          message_id: m.getId(),
          from: m.getFrom(),
          subject: m.getSubject(),
          received_at: m.getDate().toISOString(),
          filename: a.getName(),
          mime: mime,
          data_base64: Utilities.base64Encode(a.getBytes())
        };

        var resp = UrlFetchApp.fetch(FUNCTION_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        Logger.log(a.getName() + ' -> HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText());
        pushed = true;
      }
    }
    // Marque le fil comme importé pour ne pas le renvoyer au prochain passage.
    if (pushed) threads[i].addLabel(doneLabel);
  }
}

/** À lancer UNE fois : programme le robot UNE FOIS PAR JOUR (vers 7h). */
function installerRobot() {
  // Nettoie d'éventuels anciens déclencheurs du même robot.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestInvoices') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('ingestInvoices').timeBased().everyDays(1).atHour(7).create();
  // Premier passage immédiat.
  ingestInvoices();
}

/** Retire le libellé « Rose-Importe » de tous les fils pour repartir propre
 *  (à lancer une fois si tu veux que le robot reconsidère les mails avec le
 *  nouveau filtre). Après, relance `installerRobot` ou `ingestInvoices`. */
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
