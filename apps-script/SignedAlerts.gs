/**
 * ARC CRM — Signed Alerts
 * Google Apps Script that runs in Orlando's Google account (orlando.montanez@agencyroofingco.com), every minute,
 * even when the CRM is closed:
 *   1. Asks Supabase for documents customers signed online (arc_sign_outbox, locked with a secret key).
 *   2. Files the signed PDF in Google Drive:  Agency Roofing › Customers › Last, First · ARC-00015
 *   3. Emails orlando.montanez@agencyroofingco.com with the signed PDF attached (shows as a Gmail push on the iPhone).
 *   4. Marks it done (arc_sign_notified) so it's only sent once.
 *
 * SETUP (once, on a computer, signed in to Google as orlando.montanez@agencyroofingco.com):
 *   a. Run supabase/sign.sql in Supabase. The last result shows your ARC_KEY. Copy it.
 *   b. script.google.com → New project → name it "ARC Signed Alerts" → replace everything in Code.gs with this file → Save.
 *   c. Project Settings (gear) → Script Properties → Add script property: ARC_KEY = the key from step a → Save.
 *   d. Back in the editor pick the function "setup" → Run → allow the permissions (Gmail send, Drive, external requests).
 *      It sends nothing unless something was signed; it says "ARC Signed Alerts is on" in the log.
 *   To stop it: run "stop".
 *
 * No passwords or secret keys live in this file. The Supabase key below is the public (publishable) one.
 */
var SB_URL = 'https://xndcntpxhzfaqtmzcuje.supabase.co';
var SB_KEY = 'sb_publishable_KuUPSNQGagKSNL2_GDLbZw_eEPwlTWc';
var TO = 'orlando.montanez@agencyroofingco.com';
var CRM_URL = 'https://orlandobmontanez-cpu.github.io/arccrm/';
var TZ = 'America/Denver';

function setup() {
  if (!key_()) throw new Error('Add the Script property ARC_KEY first (Project Settings → Script Properties).');
  stop();
  ScriptApp.newTrigger('checkSigned').timeBased().everyMinutes(1).create();
  rpc_('arc_sign_outbox', { p_key: key_() });   // fails here if the key or the SQL is wrong
  checkSigned();
  Logger.log('ARC Signed Alerts is on: checking every minute and emailing ' + TO + '.');
}

function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkSigned') ScriptApp.deleteTrigger(t);
  });
}

function checkSigned() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var rows = rpc_('arc_sign_outbox', { p_key: key_() }) || [];
    rows.forEach(function (row) {
      var file = null, driveErr = '';
      try { if (row.pdf) file = fileInDrive_(row); } catch (e) { driveErr = String(e && e.message || e); }
      sendAlert_(row, file, driveErr);                       // throws → not marked, retried next minute
      rpc_('arc_sign_notified', { p_key: key_(), p_token: row.token });
    });
  } finally {
    lock.releaseLock();
  }
}

// ── Google Drive: Agency Roofing › Customers › <customer folder> (same names the CRM uses) ──
function fileInDrive_(row) {
  var info = row.info || {};
  var name = info.driveFolder || 'Customer · ' + row.num;
  var it = DriveApp.getFoldersByName(name), folder = null;
  while (it.hasNext() && !folder) { var f = it.next(); if (!f.isTrashed()) folder = f; }
  if (!folder) folder = child_(child_(root_('Agency Roofing'), 'Customers'), name);
  var pdfName = info.pdfName || ('ARC ' + row.num + ' - Signed.pdf');
  var old = folder.getFilesByName(pdfName);
  while (old.hasNext()) old.next().setTrashed(true);       // same name replaces the old copy, like the CRM
  var blob = Utilities.newBlob(Utilities.base64Decode(row.pdf), 'application/pdf', pdfName);
  var file = folder.createFile(blob);
  file.setDescription('Signed online by ' + row.name + ' on ' + when_(row.at) + (row.ip ? ' (IP ' + row.ip + ')' : '') +
    '. Document ID ' + (info.docId || '') + '. Filed by ARC Signed Alerts.');
  return file;
}
function root_(name) {
  var it = DriveApp.getRootFolder().getFoldersByName(name);
  if (it.hasNext()) return it.next();
  var any = DriveApp.getFoldersByName(name);
  while (any.hasNext()) { var f = any.next(); if (!f.isTrashed()) return f; }
  return DriveApp.createFolder(name);
}
function child_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ── Email to Orlando ──
function sendAlert_(row, file, driveErr) {
  var info = row.info || {};
  var who = row.name || info.name || 'A customer';
  var what = info.what || 'document';
  var subject = '✍ ' + who + ' signed ' + what + ' ' + row.num;
  var open = CRM_URL + '?open=' + encodeURIComponent(row.cid);
  var note = row.pdf
    ? (file ? 'The signed copy is attached and saved in Google Drive.' : 'The signed copy is attached. It could not be saved to Google Drive' + (driveErr ? ' (' + driveErr + ')' : '') + '.')
    : 'Their phone didn’t save a signed copy. Open the customer in the CRM to make the signed PDF and email it to them.';
  var lines = [
    who + ' signed ' + what + ' ' + row.num + ' online.',
    info.amount ? (info.amountLabel || 'Total') + ': ' + info.amount : '',
    info.address || '',
    'Signed ' + when_(row.at) + (row.ip ? ' from IP ' + row.ip : ''),
    '', note,
    'The CRM moves it to Signed and countersigns the next time it’s open.',
    '', 'Open in the CRM: ' + open,
    file ? 'Google Drive: ' + file.getUrl() : ''
  ].filter(function (l, i, a) { return l !== '' || (a[i - 1] !== ''); });
  var btn = function (href, label, primary) {
    return '<a href="' + esc_(href) + '" style="display:inline-block;margin:0 8px 8px 0;padding:13px 20px;border-radius:6px;font-weight:bold;letter-spacing:1px;font-size:14px;text-decoration:none;' +
      (primary ? 'background:#974930;color:#ffffff' : 'background:#1C1A18;color:#EAE4DA') + '">' + label + '</a>';
  };
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1C1A18">' +
    '<div style="background:#1C1A18;padding:14px 18px;border-bottom:3px solid #974930">' +
      '<span style="font-size:20px;font-weight:bold;letter-spacing:1px;color:#EAE4DA">AGENCY</span> ' +
      '<span style="font-size:11px;letter-spacing:3px;color:#C97E78">ROOFING CO.</span></div>' +
    '<div style="background:#EAE4DA;padding:20px 18px">' +
      '<div style="font-size:12px;letter-spacing:2px;color:#974930;font-weight:bold">SIGNED ONLINE · ' + esc_(row.num) + '</div>' +
      '<div style="font-size:24px;font-weight:bold;margin:6px 0 10px">' + esc_(who) + ' signed the ' + esc_(what) + '</div>' +
      (info.amount ? '<div style="font-size:15px;margin-bottom:4px">' + esc_(info.amountLabel || 'Total') + ': <b style="color:#974930">' + esc_(info.amount) + '</b></div>' : '') +
      (info.address ? '<div style="font-size:14px;color:#3A3734;margin-bottom:4px">' + esc_(info.address) + '</div>' : '') +
      '<div style="font-size:13px;color:#6B6560;margin-bottom:16px">Signed ' + esc_(when_(row.at)) + (row.ip ? ' · IP ' + esc_(row.ip) : '') + '</div>' +
      btn(open, 'OPEN IN CRM', true) + (file ? btn(file.getUrl(), 'VIEW IN DRIVE', false) : '') +
      '<p style="font-size:13px;line-height:1.5;color:#3A3734;margin:12px 0 0">' + esc_(note) + ' The CRM moves it to Signed and countersigns the next time it’s open.</p>' +
    '</div>' +
    '<div style="font-size:11px;color:#6B6560;padding:10px 18px;font-style:italic">Built with agency. Driven by obligation.</div></div>';
  var opts = { htmlBody: html, name: 'ARC CRM' };
  if (row.pdf) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(row.pdf), 'application/pdf', info.pdfName || ('ARC ' + row.num + ' - Signed.pdf'))];
  try {
    // From a no-reply address on agencyroofingco.com so it arrives as new mail (Gmail doesn't alert on mail you sent yourself)
    GmailApp.sendEmail(TO, subject, lines.join('\n'), Object.assign({ noReply: true }, opts));
  } catch (e) {
    GmailApp.sendEmail(TO, subject, lines.join('\n'), opts);
  }
}

// ── Helpers ──
function key_() { return PropertiesService.getScriptProperties().getProperty('ARC_KEY'); }
function rpc_(name, body) {
  var r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + name, {
    method: 'post', contentType: 'application/json', headers: { apikey: SB_KEY },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = r.getResponseCode(), text = r.getContentText();
  if (code >= 300) throw new Error('Supabase ' + name + ' ' + code + ': ' + text.slice(0, 200) +
    (code === 403 || /not allowed/.test(text) ? ' — check ARC_KEY in Script Properties.' : code === 404 ? ' — run supabase/sign.sql in Supabase.' : ''));
  return text ? JSON.parse(text) : null;
}
function when_(iso) {
  try { return Utilities.formatDate(new Date(iso), TZ, "MMM d, yyyy 'at' h:mm a z"); } catch (e) { return String(iso || ''); }
}
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
