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
var SOURCE_LABEL     = 'Factures';                    // libellé optionnel pour forcer un mail
var DONE_LABEL       = 'Rose-Importe';                // posé après import (anti-doublon)

// Détection AUTOMATIQUE : mails avec pièce jointe contenant un de ces mots.
// (La file « à valider » sert de filet : un non-facture qui passe = tu l'ignores.)
var AUTO_QUERY = 'has:attachment newer_than:30d (facture OR factures OR invoice OR factura OR quittance OR "avis d\'échéance" OR échéance OR abonnement OR "reçu" OR reglement OR règlement)';
// ===========================================================================

function ingestInvoices() {
  var doneLabel = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  // Auto-détection OU mails que tu tagues « Factures », en excluant le déjà-importé.
  var query = '(' + AUTO_QUERY + ' OR label:' + SOURCE_LABEL + ') -label:' + DONE_LABEL;
  var threads = GmailApp.search(query, 0, 25);

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    var pushed = false;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var atts = m.getAttachments();
      for (var k = 0; k < atts.length; k++) {
        var a = atts[k];
        var mime = a.getContentType() || '';
        // On ne pousse que les PDF et images (les vraies factures).
        if (mime.indexOf('pdf') === -1 && mime.indexOf('image') === -1) continue;

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

/** À lancer UNE fois : programme le robot toutes les 15 minutes. */
function installerRobot() {
  // Nettoie d'éventuels anciens déclencheurs du même robot.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestInvoices') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('ingestInvoices').timeBased().everyMinutes(15).create();
  // Premier passage immédiat.
  ingestInvoices();
}
