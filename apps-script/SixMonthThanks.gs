/**
 * ARC CRM — Six-Month Thank-You Email (Good Neighbors referral program)
 * Google Apps Script that runs in Orlando's Google account (orlando.montanez@agencyroofingco.com) once a day, even when the
 * CRM is closed:
 *   1. Asks Supabase for Closed jobs whose close date was 6+ months ago and that haven't had this email (arc_thanks_due).
 *   2. Emails each customer the branded thank-you + Good Neighbors referral email from orlando.montanez@agencyroofingco.com
 *      (so it sits in his Gmail Sent and replies come straight to him). A seasonal line fits the day it goes out.
 *   3. Records it (arc_thanks_sent) so each job gets it once.
 * Skipped: Declined and open jobs, jobs with no email, and any customer with "Six-month thank-you email" switched off in the CRM.
 * At most MAX_PER_DAY a day.
 *
 * SETUP (once, on a computer, signed in to Google as orlando.montanez@agencyroofingco.com):
 *   a. Run supabase/thanks.sql in Supabase (SQL Editor → New query → paste → Run). It uses the same ARC_KEY as Signed Alerts.
 *   b. script.google.com → New project → name it "ARC Six-Month Thanks" → replace everything in Code.gs with this file → Save.
 *   c. Project Settings (gear) → Script Properties → Add script property: ARC_KEY = the same key as in "ARC Signed Alerts" → Save.
 *   d. Pick the function "sendTest" → Run → allow the permissions. It emails ONLY you: a sample of the email and the list of
 *      customers who would get it on the first run. Nothing goes to a customer.
 *   e. When you're happy, pick "setup" → Run. From then on it runs every morning around 9 AM and sends to customers.
 *   To stop it: run "stop".
 *
 * No passwords or secret keys live in this file. The Supabase key below is the public (publishable) one.
 * Wording lives in build_() and season_(): keep it in step with the preview Orlando approved. Always "Christmas", never
 * "Happy Holidays" (his rule).
 */
var SB_URL = 'https://xndcntpxhzfaqtmzcuje.supabase.co';
var SB_KEY = 'sb_publishable_KuUPSNQGagKSNL2_GDLbZw_eEPwlTWc';
var OWNER_EMAIL = 'orlando.montanez@agencyroofingco.com';
var PHONE = '505-900-1711';
var SITE = 'https://orlandobmontanez-cpu.github.io/arccrm/';
var TZ = 'America/Denver';
var MAX_PER_DAY = 10;

function setup() {
  if (!key_()) throw new Error('Add the Script property ARC_KEY first (Project Settings → Script Properties).');
  stop();
  ScriptApp.newTrigger('sendDue').timeBased().everyDays(1).atHour(9).inTimezone(TZ).create();
  rpc_('arc_thanks_due', { p_key: key_() });   // fails here if the key or the SQL is wrong
  Logger.log('ARC Six-Month Thanks is on: every morning around 9 AM, up to ' + MAX_PER_DAY + ' customers a day.');
}

function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDue') ScriptApp.deleteTrigger(t);
  });
}

// Emails only Orlando: a sample (first customer due, or Pat Sample) plus who would get it on the next run. Records nothing.
function sendTest() {
  var rows = rpc_('arc_thanks_due', { p_key: key_() }) || [];
  var sample = rows[0] || { first: 'Pat', address: '123 Sample St NW', closed_at: '2026-06-01' };
  var m = build_(sample, today_());
  var list = rows.length
    ? rows.map(function (r) { return '• ' + [r.first, r.last].join(' ').trim() + ' (' + r.email + '), closed ' + r.closed_at; }).join('\n')
    : 'Nobody is due right now.';
  var note = 'TEST: this went only to you.\n\nCustomers due on the next run (' + rows.length + ', up to ' + MAX_PER_DAY + ' a day):\n' + list + '\n\n';
  GmailApp.sendEmail(OWNER_EMAIL, '[Test] ' + m.subject, note + m.text, {
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#1C1A18;background:#F0C8C2;padding:12px 16px;white-space:pre-line">' +
      esc_(note) + '</div>' + m.html,
    name: 'Orlando Montanez'
  });
  Logger.log('Test sent to ' + OWNER_EMAIL + '. ' + rows.length + ' customer(s) due.');
}

function sendDue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var rows = (rpc_('arc_thanks_due', { p_key: key_() }) || []).slice(0, MAX_PER_DAY);
    var failed = [];
    rows.forEach(function (r) {
      var m = build_(r, today_());
      try {
        GmailApp.sendEmail(r.email, m.subject, m.text, { htmlBody: m.html, name: 'Orlando Montanez' });
        rpc_('arc_thanks_sent', { p_key: key_(), p_owner: r.owner, p_cid: r.cid, p_email: r.email, p_status: 'sent', p_note: '' });
      } catch (e) {
        var msg = String(e && e.message || e).slice(0, 300);
        failed.push(([r.first, r.last].join(' ').trim() || r.cid) + ' (' + r.email + '): ' + msg);
        // Recorded as failed so a bad address isn't retried every day; delete its row in arc_thanks to try again.
        try { rpc_('arc_thanks_sent', { p_key: key_(), p_owner: r.owner, p_cid: r.cid, p_email: r.email, p_status: 'failed', p_note: msg }); } catch (e2) {}
      }
    });
    if (failed.length) {
      GmailApp.sendEmail(OWNER_EMAIL, 'Six-month thank-you email: ' + failed.length + ' didn’t send',
        'These customers did not get their six-month thank-you email:\n\n' + failed.join('\n') +
        '\n\nCheck their email address in the CRM.', { name: 'ARC CRM' });
    }
  } finally {
    lock.releaseLock();
  }
}

// ── The seasonal line, from the day the email goes out (Albuquerque, Orlando's voice) ──
function season_(d) {
  var m = d.getMonth() + 1, day = d.getDate(), y = d.getFullYear();
  if (m === 12 && day <= 25) return 'Merry Christmas! I hope this season brings you and your family plenty of warmth and rest.';
  if (m === 12) return 'I hope you had a Merry Christmas, and I wish you a great start to the new year.';
  if (m === 1 && day <= 15) return 'Happy New Year! I hope ' + y + ' is off to a good start for you and your family.';
  if (m === 1 || m === 2) return 'I hope you’re staying warm through these chilly Albuquerque mornings.';
  if (m >= 3 && m <= 5) return 'Spring winds are picking up around Albuquerque, and I hope the season is treating you well.';
  if (m === 6) return 'Summer is here, and I hope you’re finding some shade and a little time to slow down.';
  if (m === 7 && day <= 7) return 'I hope you had a great Fourth of July.';
  if (m === 7 || (m === 8 && day <= 14)) return 'Monsoon season is here, and I hope the rain has been kind to you and your home.';
  if (m === 8 || m === 9) return 'Green chile roasting season is here, one of my favorite times of year in New Mexico.';
  if (m === 10 && day <= 14) return 'Balloon season is here, and there’s nothing like those mornings over Albuquerque.';
  if (m === 10) return 'Fall has settled in, and I hope you’re enjoying the cooler days.';
  // November: Thanksgiving is the fourth Thursday
  var first = new Date(y, 10, 1).getDay(), thanks = 1 + ((4 - first + 7) % 7) + 21;
  if (day <= thanks) return 'As Thanksgiving gets close, I’m especially grateful for customers like you.';
  return 'I hope you had a wonderful Thanksgiving.';
}

// ── The email (subject, plain text, branded HTML) ──
// Kept short on purpose (Orlando, Nov 27 2026: "I just don't want it to be overwhelming"): thanks, a roof check, one
// Good Neighbors teaser and a button. The reward table and rules live on the program page (good-neighbors.html).
var PROGRAM_URL = SITE + 'good-neighbors.html';

function build_(r, today) {
  var first = String(r.first || '').trim();
  var address = String(r.address || '').trim();
  var subject = first ? first + ', thank you for trusting us' : 'Thank you for trusting us';
  var hello = first ? 'Thank you, ' + first + '.' : 'Thank you.';
  var seasonal = season_(today);
  var p1 = 'It’s been six months since we finished your roof' + (address ? ' at ' + address : '') +
    '. Thank you for trusting us with your home. That isn’t something I take lightly.';
  var p2a = 'Has anything come up with the roof that you’ve been meaning to mention? Reply here or call me at ';
  var promise = 'Every roof we touch is someone’s safety, peace of mind, and home. We treat it that way. Every time.';
  var ask = 'You may know a neighbor who’s been putting off their roof. Would it be a bad idea to pass our name along?';
  var optout = 'You’re getting this because we worked on your roof. Prefer not to hear from us this way? Just reply “no thanks.”';

  var text = [hello, '', seasonal, '', p1, '', p2a + PHONE + '.', '', promise, '',
    'GOOD NEIGHBORS REFERRAL PROGRAM', 'Good neighbors. Good roofs. Local rewards.', '', ask, '',
    '$15: coffee on us for every neighbor you introduce.', 'Up to $265: when they hire us.', '',
    'See how it works: ' + PROGRAM_URL, '',
    'With gratitude,', 'Orlando', '', 'Orlando Montanez, Owner', 'Agency Roofing Co.', PHONE,
    OWNER_EMAIL, 'agencyroofingco.com', '', 'Built with agency. Driven by obligation.',
    'Agency Roofing Co. LLC · Albuquerque, New Mexico · Flat Roof Specialists', '', optout].join('\n');

  return { subject: subject, text: text, html: html_({ hello: hello, seasonal: seasonal, p1: p1, p2a: p2a, promise: promise,
    ask: ask, optout: optout }) };
}

function html_(v) {
  var SANS = "Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
  var SERIF = "Lora,Georgia,'Times New Roman',serif";
  var ANTON = "Anton,Impact,'Arial Narrow Bold','Helvetica Neue',Arial,sans-serif";
  var BEBAS = "'Bebas Neue','Arial Narrow',Arial,sans-serif";
  var INK = '#1C1A18', COPPER = '#974930', MID = '#C97E78', HI = '#F0C8C2', STONE = '#EAE4DA', MUTED = '#5E5852';
  var tel = 'tel:+15059001711';
  var phoneLink = '<a href="' + tel + '" style="color:' + COPPER + ';text-decoration:none;font-weight:bold">' + PHONE + '</a>';
  var px = 'padding-left:32px;padding-right:32px';
  var stat = function (big, small) {
    return '<td width="50%" valign="top" style="padding:0 6px"><div style="font-family:' + ANTON + ';font-size:40px;line-height:44px;color:' + HI + '">' + big + '</div>' +
      '<div style="font-family:' + SANS + ';font-size:13px;line-height:18px;color:' + STONE + ';padding-top:4px">' + small + '</div></td>';
  };
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>Thank you from Agency Roofing Co.</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Inter:wght@400;700&family=Lora:ital@1&display=swap" rel="stylesheet">' +
    '<style>@media (max-width:620px){.px{padding-left:22px !important;padding-right:22px !important}.h1{font-size:30px !important;line-height:36px !important}.gn{padding:26px 20px !important}}</style></head>' +
    '<body style="margin:0;padding:0;background:' + STONE + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:' + STONE + '">Six months since we finished your roof. Thank you for trusting us with your home.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + STONE + '"><tr><td align="center" style="padding:0 0 30px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">' +
    // Logo: the approved lockup (shield, AGENCY, ROOFING CO.) as a PNG on stone (email/agency-lockup.png)
    '<tr><td align="center" style="padding:34px 24px 26px"><img src="' + SITE + 'email/agency-lockup.png" width="230" alt="AGENCY ROOFING CO." ' +
      'style="display:block;border:0;width:230px;max-width:70%;height:auto;font-family:' + ANTON + ';font-size:28px;letter-spacing:2px;color:' + INK + '"></td></tr>' +
    // Tagline band
    '<tr><td align="center" style="background:' + INK + ';border-bottom:3px solid ' + COPPER + ';padding:14px 20px;font-family:' + SERIF + ';font-style:italic;font-size:15px;line-height:20px;color:' + HI + '">Built with agency. Driven by obligation.</td></tr>' +
    // Letter
    '<tr><td style="background:#FDFCFA"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td class="px" style="padding-top:36px;' + px + '"><div class="h1" style="font-family:' + SERIF + ';font-style:italic;font-size:34px;line-height:40px;color:' + INK + '">' + esc_(v.hello) + '</div></td></tr>' +
      '<tr><td class="px" style="padding-top:16px;' + px + ';font-family:' + SANS + ';font-size:16px;line-height:26px;color:' + INK + '">' +
        '<p style="margin:0 0 16px;font-family:' + SERIF + ';font-style:italic;font-size:17px;color:' + COPPER + '">' + esc_(v.seasonal) + '</p>' +
        '<p style="margin:0 0 16px">' + esc_(v.p1) + '</p>' +
        '<p style="margin:0 0 16px">' + esc_(v.p2a) + phoneLink + '.</p></td></tr>' +
      '<tr><td class="px" style="padding-top:4px;padding-bottom:30px;' + px + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td width="3" style="background:' + MID + ';font-size:0;line-height:0">&nbsp;</td>' +
        '<td style="padding:4px 0 4px 18px;font-family:' + SERIF + ';font-style:italic;font-size:18px;line-height:28px;color:' + COPPER + '">' + esc_(v.promise) + '</td></tr></table></td></tr>' +
      // Good Neighbors card (ink, rose gold)
      '<tr><td class="px" style="' + px + ';padding-bottom:32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + INK + ';border-radius:14px">' +
        '<tr><td class="gn" style="padding:30px 28px">' +
          '<div style="font-family:' + BEBAS + ';font-size:15px;line-height:18px;letter-spacing:3px;color:' + MID + '">GOOD NEIGHBORS REFERRAL PROGRAM</div>' +
          '<div style="font-family:' + SERIF + ';font-style:italic;font-size:23px;line-height:30px;color:' + STONE + ';padding-top:8px">Good neighbors. Good roofs. Local rewards.</div>' +
          '<div style="font-family:' + SANS + ';font-size:15px;line-height:24px;color:' + STONE + ';padding-top:12px">' + esc_(v.ask) + '</div>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid #3A3532"><tr><td style="padding-top:18px">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
              stat('$15', 'Coffee on us for every neighbor you introduce') + stat('$265', 'Up to, when they hire us') +
            '</tr></table></td></tr></table>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr>' +
            '<td align="center" style="background:' + HI + ';border-radius:999px"><a href="' + esc_(PROGRAM_URL) + '" style="display:inline-block;padding:15px 28px;font-family:' + BEBAS +
            ';font-size:17px;line-height:18px;letter-spacing:3px;color:' + INK + ';text-decoration:none">SEE HOW IT WORKS</a></td></tr></table>' +
        '</td></tr></table></td></tr>' +
      // Sign-off
      '<tr><td class="px" style="padding-bottom:32px;' + px + ';font-family:' + SANS + ';font-size:16px;line-height:26px;color:' + INK + '">' +
        '<p style="margin:0 0 6px">With gratitude,</p>' +
        '<div style="font-family:' + SERIF + ';font-style:italic;font-size:22px;line-height:28px">Orlando</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E3DCD1;margin-top:14px"><tr><td style="padding-top:14px;font-size:14px;line-height:22px">' +
          '<strong>Orlando Montanez</strong>, Owner<br>Agency Roofing Co.<br>' +
          '<a href="' + tel + '" style="color:' + COPPER + ';text-decoration:none">' + PHONE + '</a><br>' +
          '<a href="mailto:' + OWNER_EMAIL + '" style="color:' + COPPER + ';text-decoration:none">' + OWNER_EMAIL + '</a><br>' +
          '<a href="https://agencyroofingco.com" style="color:' + COPPER + ';text-decoration:none">agencyroofingco.com</a></td></tr></table></td></tr>' +
    '</table></td></tr>' +
    // Footer
    '<tr><td align="center" style="border-top:3px solid ' + COPPER + ';padding:22px 18px 0">' +
      '<div style="font-family:' + SANS + ';font-size:11px;line-height:17px;letter-spacing:1px;color:' + MUTED + '">Agency Roofing Co. LLC &middot; Albuquerque, New Mexico &middot; Flat Roof Specialists</div>' +
      '<div style="font-family:' + SANS + ';font-size:11px;line-height:17px;color:' + MUTED + ';padding-top:8px">' + esc_(v.optout) + '</div></td></tr>' +
    '</table></td></tr></table></body></html>';
}

// ── Helpers ──
// Today in Albuquerque (Orlando's day), whatever time zone the script project is set to
function today_() {
  var p = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function key_() { return PropertiesService.getScriptProperties().getProperty('ARC_KEY'); }
function rpc_(name, body) {
  var r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + name, {
    method: 'post', contentType: 'application/json', headers: { apikey: SB_KEY },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = r.getResponseCode(), text = r.getContentText();
  if (code >= 300) throw new Error('Supabase ' + name + ' ' + code + ': ' + text.slice(0, 200) +
    (code === 403 || /not allowed/.test(text) ? ' — check ARC_KEY in Script Properties.' : code === 404 ? ' — run supabase/thanks.sql in Supabase.' : ''));
  return text ? JSON.parse(text) : null;
}
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

if (typeof module !== 'undefined') module.exports = { build_: build_, season_: season_ };   // tests (Node) only
