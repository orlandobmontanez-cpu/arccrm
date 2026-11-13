// Runs apps-script/SignedAlerts.gs with fake Gmail / Drive / Supabase. node tests/signed-alerts.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../apps-script/SignedAlerts.gs'), 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function world(rows, opts = {}) {
  const sent = [], notified = [], files = [], folders = {};
  let nextId = 1;
  function Folder(name, parent) { this.name = name; this.parent = parent; this.files = []; this.subs = []; this.id = nextId++; folders[this.id] = this; }
  Folder.prototype.getFoldersByName = function (n) { return iter(this.subs.filter(f => f.name === n)); };
  Folder.prototype.createFolder = function (n) { const f = new Folder(n, this); this.subs.push(f); return f; };
  Folder.prototype.isTrashed = () => false;
  Folder.prototype.getFilesByName = function (n) { return iter(this.files.filter(f => f.name === n && !f.trashed)); };
  Folder.prototype.createFile = function (blob) {
    if (opts.driveFails) throw new Error('Drive is down');
    const f = { name: blob.name, bytes: blob.bytes, trashed: false, desc: '', setTrashed(v) { this.trashed = v; }, setDescription(d) { this.desc = d; }, getUrl() { return 'https://drive.google.com/file/' + this.name; } };
    this.files.push(f); files.push(f); return f;
  };
  const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
  const root = new Folder('My Drive');
  if (opts.existing) { const ar = root.createFolder('Agency Roofing').createFolder('Customers'); ar.createFolder(opts.existing); }
  const all = () => Object.values(folders);
  const g = {
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'ARC_KEY' ? 'KEY' : null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    Utilities: { newBlob: (bytes, type, name) => ({ bytes, type, name }), base64Decode: s => Buffer.from(s, 'base64'), formatDate: d => d.toISOString() },
    DriveApp: { getRootFolder: () => root, getFoldersByName: n => iter(all().filter(f => f.name === n)), createFolder: n => root.createFolder(n) },
    GmailApp: { sendEmail(to, subject, body, o) { if (o.noReply && opts.noReplyFails) throw new Error('noReply not allowed'); sent.push({ to, subject, body, o }); } },
    UrlFetchApp: { fetch(url, o) {
      const name = url.split('/rpc/')[1], b = JSON.parse(o.payload);
      const res = (code, j) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(j) });
      if (b.p_key !== 'KEY') return res(403, { message: 'not allowed' });
      if (name === 'arc_sign_outbox') return res(200, rows.filter(r => !notified.includes(r.token)));
      if (name === 'arc_sign_notified') { notified.push(b.p_token); return res(200, { ok: true }); }
      return res(404, {});
    } },
  };
  vm.createContext(g); vm.runInContext(code, g);
  return { g, sent, notified, files, root, all };
}
const PDF = Buffer.from('%PDF-1.3 fake').toString('base64');
const row = (o = {}) => Object.assign({ token: 't'.repeat(48), cid: 'c15', kind: 'proposal', num: 'ARC-00015', name: 'Ray Scott', at: '2026-11-13T02:10:00.000Z', ip: '203.0.113.9',
  info: { what: 'repair quote', amount: '$1,867.24', amountLabel: 'Final investment', address: '8011 Camino Paisano NW, Albuquerque, NM 87120', driveFolder: 'Scott, Ray · ARC-00015', pdfName: 'ARC Proposal - Scott - ARC-00015 - Signed.pdf', docId: 'ABCD-1234-EF56' }, pdf: PDF }, o);

// 1. Normal: existing CRM folder
let w = world([row()], { existing: 'Scott, Ray · ARC-00015' });
w.g.checkSigned();
ok(w.sent.length === 1 && w.sent[0].to === 'orlando.montanez@agencyroofingco.com', 'emails orlando.montanez@agencyroofingco.com');
ok(w.sent[0].subject === '✍ Ray Scott signed repair quote ARC-00015', 'subject: ' + w.sent[0].subject);
ok(w.sent[0].o.noReply === true && w.sent[0].o.attachments.length === 1 && w.sent[0].o.attachments[0].name.endsWith('- Signed.pdf'), 'from no-reply with the signed PDF attached');
ok(w.files.length === 1 && w.all().filter(f => f.name === 'Scott, Ray · ARC-00015').length === 1, 'PDF filed in the existing customer folder (no duplicate folder)');
ok(w.sent[0].o.htmlBody.includes('?open=c15') && w.sent[0].o.htmlBody.includes('VIEW IN DRIVE'), 'email has Open in CRM + View in Drive');
ok(w.notified.length === 1, 'marked as sent');
w.g.checkSigned(); ok(w.sent.length === 1, 'never sent twice');

// 2. No folder yet → creates Agency Roofing › Customers › folder
w = world([row()]); w.g.checkSigned();
const f = w.all().find(x => x.name === 'Scott, Ray · ARC-00015');
ok(f && f.parent.name === 'Customers' && f.parent.parent.name === 'Agency Roofing', 'creates Agency Roofing › Customers › Scott, Ray · ARC-00015');

// 3. No PDF (customer closed the page) → still emails, says so
w = world([row({ pdf: null })]); w.g.checkSigned();
ok(w.sent.length === 1 && !w.sent[0].o.attachments && /didn’t save a signed copy/.test(w.sent[0].body), 'no PDF: still alerts and says to make it in the CRM');

// 4. Drive fails → still emails with attachment
w = world([row()], { driveFails: true }); w.g.checkSigned();
ok(w.sent.length === 1 && w.sent[0].o.attachments && /could not be saved to Google Drive/.test(w.sent[0].body) && w.notified.length === 1, 'Drive down: email still goes, with the PDF');

// 5. noReply not allowed → falls back to normal send
w = world([row()], { noReplyFails: true }); w.g.checkSigned();
ok(w.sent.length === 1 && !w.sent[0].o.noReply, 'falls back if no-reply sending is not allowed');

// 6. Email fails → not marked, retried next run
w = world([row()]); w.g.GmailApp.sendEmail = () => { throw new Error('quota'); };
try { w.g.checkSigned(); } catch (e) {}
ok(w.notified.length === 0, 'email failure is retried next minute (not marked sent)');

// 7. Same file name replaces the old copy
w = world([row(), row({ token: 'u'.repeat(48) })], { existing: 'Scott, Ray · ARC-00015' }); w.g.checkSigned();
ok(w.files.filter(x => !x.trashed).length === 1, 'same name replaces the older copy');

// 8. Wrong key → clear error
w = world([row()]); w.g.PropertiesService.getScriptProperties = () => ({ getProperty: () => 'WRONG' });
let msg = ''; try { w.g.checkSigned(); } catch (e) { msg = e.message; }
ok(/check ARC_KEY/.test(msg), 'wrong key says to check ARC_KEY');
console.log('\n' + fails + ' failure(s)'); process.exit(fails ? 1 : 0);
