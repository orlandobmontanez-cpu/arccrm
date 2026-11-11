/*
  ARC Mail — send a quote or receipt straight from the CRM through Orlando's business Gmail.

  - Tap Email → a panel opens with To, Subject and Message filled in and the PDF attached → tap SEND.
  - Sends with the Gmail API as the signed-in Google account, so the email comes from
    orlando.montanez@agencyroofingco.com and shows in Gmail's Sent folder.
  - Permission asked from Google: "send email" (gmail.send) — it cannot read the inbox — and
    "files this app creates" (drive.file) — it can only see the PDFs and folders it made itself.
  - After a send, the same PDF is filed in Google Drive: Agency Roofing / Customers / Last, First · ARC-00001.
    Resending the same document replaces that file (Drive keeps the old version in its history).
  - No server and no secret: Google's sign-in window gives this page a 1-hour pass, kept for this tab only.
  - If CLIENT_ID is empty, ARCMail.enabled is false and pages keep their Mail-app flow.

  CLIENT_ID is a Google OAuth *Web client ID* (public by design). It only works from the
  site origins listed on it in Google Cloud (https://orlandobmontanez-cpu.github.io).
*/
(function () {
  'use strict';
  var CLIENT_ID = '993318895806-huklkvkfdokb59pkmtaller6l2n0v25e.apps.googleusercontent.com';
  var HINT = 'orlando.montanez@agencyroofingco.com';
  var GMAIL = 'https://www.googleapis.com/auth/gmail.send', DRIVE = 'https://www.googleapis.com/auth/drive.file';
  var SCOPE = GMAIL + ' ' + DRIVE;
  var DAPI = 'https://www.googleapis.com/drive/v3/files', DUP = 'https://www.googleapis.com/upload/drive/v3/files';
  var OK_KEY = 'arc_google_ok2';   // set after the first Allow that includes Drive
  var GIS = 'https://accounts.google.com/gsi/client';
  var SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  var TKEY = 'arc_gtoken';

  // ── Google sign-in (token only lives in this tab) ──
  var gisP = null, tokenClient = null, pending = null;
  function loadGis() {
    if (gisP) return gisP;
    gisP = new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement('script');
      s.src = GIS; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { gisP = null; rej(new Error('offline')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function cached() {
    try {
      var t = JSON.parse(sessionStorage.getItem(TKEY) || 'null');
      if (t && t.exp - 60000 > Date.now() && t.s) return t;
    } catch (e) {}
    return null;
  }
  function forget() { try { sessionStorage.removeItem(TKEY); } catch (e) {} }
  // Must be called directly from a tap (opens Google's window when a new pass is needed)
  function requestToken(needDrive) {
    return new Promise(function (res, rej) {
      var t = cached();
      if (t && (t.d || !needDrive)) return res({ token: t.t, drive: !!t.d });
      if (!gisReady()) return rej(new Error('not-ready'));
      pending = { res: res, rej: rej };
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPE, hint: HINT, login_hint: HINT,
          callback: function (r) {
            var p = pending; pending = null; if (!p) return;
            if (!r || r.error || !r.access_token) return p.rej(new Error(r && r.error === 'access_denied' ? 'denied' : 'google'));
            // Google lists what was allowed in r.scope (Drive can be unticked). No list at all = what was asked for.
            var has = function (sc) { if (!r.scope) return true; try { return google.accounts.oauth2.hasGrantedAllScopes(r, sc); } catch (e) { return String(r.scope).split(' ').indexOf(sc) >= 0; } };
            if (!has(GMAIL)) return p.rej(new Error('denied'));
            var d = has(DRIVE);
            try { sessionStorage.setItem(TKEY, JSON.stringify({ t: r.access_token, d: d, s: 1, exp: Date.now() + (parseInt(r.expires_in, 10) || 3600) * 1000 })); } catch (e) {}
            try { if (d) localStorage.setItem(OK_KEY, '1'); } catch (e) {}
            p.res({ token: r.access_token, drive: d });
          },
          error_callback: function (e) {
            var p = pending; pending = null; if (!p) return;
            p.rej(new Error(e && e.type === 'popup_failed_to_open' ? 'blocked' : e && e.type === 'popup_closed' ? 'closed' : 'google'));
          }
        });
      }
      var known = false;
      try { known = localStorage.getItem(OK_KEY) === '1'; } catch (e) {}
      tokenClient.requestAccessToken({ prompt: known && !(needDrive && t) ? '' : 'consent' });
    });
  }

  // ── Build the email (everything base64, so the message is plain ASCII) ──
  function b64utf8(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function wrap76(b) { return b.replace(/(.{76})/g, '$1\r\n'); }
  // Header text: plain if ASCII, otherwise RFC 2047 encoded-words (each ≤ 75 chars, never splitting a character)
  function hdr(s) {
    if (/^[\x20-\x7E]*$/.test(s)) return s;
    var enc = new TextEncoder(), words = [], chunk = '', size = 0;
    Array.from(s).forEach(function (ch) {
      var n = enc.encode(ch).length;
      if (size + n > 42) { words.push('=?UTF-8?B?' + b64utf8(chunk) + '?='); chunk = ''; size = 0; }
      chunk += ch; size += n;
    });
    if (chunk) words.push('=?UTF-8?B?' + b64utf8(chunk) + '?=');
    return words.join('\r\n ');
  }
  function fileB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(new Error('file')); };
      r.readAsDataURL(file);
    });
  }
  function buildRaw(m) {
    return fileB64(m.file).then(function (pdf) {
      var bd = 'arc_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      var name = (m.file.name || 'document.pdf').replace(/[\r\n"]/g, '');
      var asciiName = name.replace(/[^\x20-\x7E]/g, '-');
      var mime = [
        'To: ' + m.to,
        'Subject: ' + hdr(m.subject),
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' + bd + '"',
        '',
        '--' + bd,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(b64utf8(m.body)),
        '--' + bd,
        'Content-Type: application/pdf;',
        ' name="' + asciiName + '"',
        'Content-Disposition: attachment;',
        ' filename="' + asciiName + '"',
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(pdf),
        '--' + bd + '--',
        ''
      ].join('\r\n');
      return btoa(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    });
  }
  function gmailSend(token, raw) {
    return fetch(SEND, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw }) })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var e = new Error(r.status === 401 ? 'expired' : r.status === 403 ? 'forbidden' : 'http');
          e.detail = r.status + ' ' + t.slice(0, 200);
          throw e;
        });
      }, function () { throw new Error('offline'); });
  }

  // ── Google Drive filing (drive.file: only folders/files this app created are visible to it) ──
  function dfetch(token, url, opt) {
    opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + token }, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (r.ok) return r.json();
      return r.text().then(function (t) { var e = new Error(r.status === 401 ? 'expired' : r.status === 403 ? 'drive-off' : 'drive'); e.detail = r.status + ' ' + t.slice(0, 300); throw e; });
    }, function () { throw new Error('offline'); });
  }
  function qs(v) { return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  var folderIds = {};
  // Finds this app's folder tagged `tag` (appProperties.arc), or creates it under `parent`
  function folder(token, tag, name, parent) {
    if (folderIds[tag]) return Promise.resolve(folderIds[tag]);
    var q = "mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='arc' and value=" + qs(tag) + " }";
    return dfetch(token, DAPI + '?fields=files(id,name)&spaces=drive&pageSize=5&q=' + encodeURIComponent(q)).then(function (r) {
      if (r.files && r.files.length) return r.files[0].id;
      var meta = { name: name, mimeType: 'application/vnd.google-apps.folder', appProperties: { arc: tag } };
      if (parent) meta.parents = [parent];
      return dfetch(token, DAPI + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }).then(function (f) { return f.id; });
    }).then(function (id) { folderIds[tag] = id; return id; });
  }
  function multipart(meta, file) {
    var bd = 'arcd_' + Date.now().toString(36);
    return new Blob(['--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + bd + '\r\nContent-Type: application/pdf\r\n\r\n', file, '\r\n--' + bd + '--'],
      { type: 'multipart/related; boundary=' + bd });
  }
  // Agency Roofing / Customers / <Last, First · ARC-00001>
  function custFolder(token, d) {
    return folder(token, 'root', 'Agency Roofing')
      .then(function (root) { return folder(token, 'customers', 'Customers', root); })
      .then(function (cust) { return folder(token, 'c:' + d.key, d.folder, cust); });
  }
  // d = { key: customer id, folder: 'Last, First · ARC-00001' } → { id, name, link }
  function saveToDrive(token, file, d) {
    var name = file.name || 'document.pdf';
    return custFolder(token, d)
      .then(function (dir) {
        var q = 'name=' + qs(name) + ' and ' + qs(dir) + ' in parents and trashed=false';
        return dfetch(token, DAPI + '?fields=files(id)&spaces=drive&pageSize=1&q=' + encodeURIComponent(q)).then(function (r) {
          var old = r.files && r.files[0];
          if (old) return dfetch(token, DUP + '/' + old.id + '?uploadType=multipart&fields=id,name,webViewLink', { method: 'PATCH', body: multipart({ name: name }, file) });
          return dfetch(token, DUP + '?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', body: multipart({ name: name, parents: [dir], mimeType: 'application/pdf' }, file) });
        });
      })
      .then(function (f) { return { id: f.id, name: f.name, link: f.webViewLink }; });
  }

  // Scanned receipts / supplier invoices: …/<customer>/Receipts & Invoices/<file>
  function uploadScan(token, file, d) {
    var type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
    return custFolder(token, d)
      .then(function (dir) { return folder(token, 'cx:' + d.key, 'Receipts & Invoices', dir); })
      .then(function (dir) {
        var meta = { name: file.name || ('Scan ' + new Date().toISOString().slice(0, 10)), parents: [dir], mimeType: type, appProperties: { arcCost: d.key } };
        var bd = 'arcs_' + Date.now().toString(36);
        var body = new Blob(['--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + bd + '\r\nContent-Type: ' + type + '\r\n\r\n', file, '\r\n--' + bd + '--'],
          { type: 'multipart/related; boundary=' + bd });
        return dfetch(token, DUP + '?uploadType=multipart&fields=id,name,webViewLink,mimeType', { method: 'POST', body: body });
      })
      .then(function (f) { return { id: f.id, name: f.name, link: f.webViewLink, type: f.mimeType }; });
  }
  // Google reads the scan: copy it as a Google Doc (Drive's own text recognition), export the text, delete the copy
  function readText(token, fileId) {
    return dfetch(token, DAPI + '/' + fileId + '/copy?ocrLanguage=en&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ARC text read (temporary)', mimeType: 'application/vnd.google-apps.document' }) })
      .then(function (doc) {
        var gone = function () { return fetch(DAPI + '/' + doc.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(function () {}); };
        return fetch(DAPI + '/' + doc.id + '/export?mimeType=text/plain', { headers: { Authorization: 'Bearer ' + token } })
          .then(function (r) { if (!r.ok) throw new Error('drive'); return r.text(); })
          .then(function (t) { gone(); return t.replace(/^\uFEFF/, ''); }, function (e) { gone(); throw e; });
      });
  }
  // Rename the scan and store its full record in the file's Drive details
  function describe(token, fileId, meta) {
    return dfetch(token, DAPI + '/' + fileId + '?fields=id,name,webViewLink', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })
      .then(function (f) { return { id: f.id, name: f.name, link: f.webViewLink }; });
  }
  function trash(token, fileId) {
    return dfetch(token, DAPI + '/' + fileId + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
  // "Agency Roofing Expenses" Google Sheet, rewritten from the CRM's records (so it always matches them exactly)
  function writeSheet(token, csv) {
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
    return folder(token, 'root', 'Agency Roofing').then(function (root) {
      var q = "trashed=false and appProperties has { key='arc' and value='expenses-sheet' }";
      return dfetch(token, DAPI + '?fields=files(id)&spaces=drive&pageSize=1&q=' + encodeURIComponent(q)).then(function (r) {
        var old = r.files && r.files[0];
        var fresh = function () {
          var meta = { name: 'Agency Roofing Expenses', parents: [root], mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { arc: 'expenses-sheet' } };
          return dfetch(token, DUP + '?uploadType=multipart&fields=id,webViewLink', { method: 'POST', body: multipartType(meta, blob, 'text/csv') });
        };
        if (!old) return fresh();
        // Replace the sheet's contents; if Google won't convert in place, make a new one and bin the old one
        return dfetch(token, DUP + '/' + old.id + '?uploadType=multipart&fields=id,webViewLink', { method: 'PATCH', body: multipartType({ name: 'Agency Roofing Expenses' }, blob, 'text/csv') })
          .catch(function (e) { if (e && (e.message === 'expired' || e.message === 'offline')) throw e; return fresh().then(function (f) { trash(token, old.id).catch(function () {}); return f; }); });
      });
    }).then(function (f) { return { id: f.id, link: f.webViewLink }; });
  }
  function multipartType(meta, blob, type) {
    var bd = 'arct_' + Date.now().toString(36);
    return new Blob(['--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + bd + '\r\nContent-Type: ' + type + '\r\n\r\n', blob, '\r\n--' + bd + '--'],
      { type: 'multipart/related; boundary=' + bd });
  }

  // ── Compose panel ──
  var CSS = '' +
    '#am-scrim{position:fixed;inset:0;z-index:9000;background:rgba(28,26,24,.5);opacity:0;pointer-events:none;transition:opacity .2s}' +
    '#am-scrim.on{opacity:1;pointer-events:auto}' +
    '#am-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9001;max-height:94dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#EAE4DA;color:#1C1A18;' +
      'border-radius:18px 18px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .25s cubic-bezier(.2,.8,.2,1);' +
      'box-shadow:0 -10px 30px rgba(28,26,24,.3);font-family:Inter,-apple-system,sans-serif;text-align:left}' +
    '#am-sheet.on{transform:none}' +
    '@media(min-width:720px){#am-sheet{left:50%;right:auto;width:600px;margin-left:-300px}}' +
    '#am-sheet *{box-sizing:border-box}' +
    '.am-grab{width:40px;height:4px;border-radius:2px;background:#D3C9BB;margin:4px auto 10px}' +
    '.am-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}' +
    '.am-top b{flex:1;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:22px;letter-spacing:.12em}' +
    '.am-x{min-width:48px;min-height:48px;border:1px solid #D3C9BB;background:#FDFBF8;border-radius:10px;font-size:20px;color:#1C1A18;cursor:pointer}' +
    '.am-l{display:block;font-family:"Bebas Neue",sans-serif;letter-spacing:.14em;font-size:13px;color:#974930;margin:10px 0 4px}' +
    '.am-f{display:block;width:100%;min-height:48px;padding:10px 12px;border:1px solid #D3C9BB;border-radius:10px;background:#FDFBF8;font:inherit;font-size:16px;color:#1C1A18;-webkit-appearance:none;appearance:none}' +
    'textarea.am-f{min-height:190px;line-height:1.45;resize:vertical}' +
    '.am-f.bad{border-color:#8A2E26;background:#F8E9E7}' +
    '.am-att{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;border:1px dashed #C9B2A6;border-radius:10px;font-size:13px;color:#3A3734;background:#F3EEE6}' +
    '.am-att span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.am-msg{font-size:13px;line-height:1.45;margin-top:10px;color:#3A3734}' +
    '.am-msg.err{color:#8A2E26;font-weight:600}' +
    '.am-send{display:block;width:100%;min-height:54px;margin-top:12px;border:0;border-radius:10px;background:#974930;color:#FDFBF8;font-family:"Bebas Neue",sans-serif;font-size:20px;letter-spacing:.14em;cursor:pointer}' +
    '.am-send:disabled{opacity:.6}' +
    '.am-alt{display:block;width:100%;min-height:48px;margin-top:6px;border:0;background:none;color:#6B655E;font:inherit;font-size:13px;text-decoration:underline;cursor:pointer}' +
    '.am-from{font-size:12px;color:#6B655E;margin-top:2px}';
  var scrim = null, sheet = null, cur = null, busy = false;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function build() {
    if (sheet) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    scrim = document.createElement('div'); scrim.id = 'am-scrim';
    sheet = document.createElement('div'); sheet.id = 'am-sheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Send email');
    document.body.appendChild(scrim); document.body.appendChild(sheet);
    scrim.addEventListener('click', function () { if (!busy) close(); });
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest('[data-am]'); if (!b) return;
      if (b.dataset.am === 'close') { if (!busy) close(); }
      else if (b.dataset.am === 'send') send();
      else if (b.dataset.am === 'alt') { var o = cur; close(); if (o && o.fallback) o.fallback(); }
    });
    sheet.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur && !busy) close(); });
  }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function open(o) {
    build(); cur = o; busy = false;
    sheet.innerHTML = '<div class="am-grab"></div>' +
      '<div class="am-top"><b>' + esc('EMAIL ' + (o.kind || 'DOCUMENT').toUpperCase()) + '</b><button type="button" class="am-x" data-am="close" aria-label="Close">✕</button></div>' +
      '<div class="am-from">From your Agency Roofing Gmail. A copy lands in your Sent folder.</div>' +
      '<label class="am-l" for="am-to">TO</label>' +
      '<input class="am-f' + (o.to ? '' : ' bad') + '" id="am-to" type="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="customer@email.com" value="' + esc(o.to || '') + '">' +
      '<label class="am-l" for="am-subject">SUBJECT</label>' +
      '<input class="am-f" id="am-subject" type="text" value="' + esc(o.subject || '') + '">' +
      '<label class="am-l" for="am-body">MESSAGE</label>' +
      '<textarea class="am-f" id="am-body">' + esc(o.body || '') + '</textarea>' +
      '<div class="am-att">📎 <span>' + esc(o.file.name) + '</span><em style="font-style:normal;color:#6B655E">' + kb(o.file.size) + '</em></div>' +
      '<div class="am-msg" id="am-msg" role="status" aria-live="polite">' + (o.to ? '' : 'No email on file for this customer. Type it above.') + '</div>' +
      '<button type="button" class="am-send" data-am="send" id="am-send">SEND</button>' +
      '<button type="button" class="am-alt" data-am="alt">Use the Mail app instead</button>';
    sheet.scrollTop = 0;
    sheet.classList.add('on'); scrim.classList.add('on');
    loadGis().catch(function () {});
  }
  function close() {
    if (!sheet) return;
    sheet.classList.remove('on'); scrim.classList.remove('on'); cur = null; busy = false;
  }
  function say(t, err) { var m = document.getElementById('am-msg'); if (m) { m.textContent = t; m.className = 'am-msg' + (err ? ' err' : ''); } }
  function setBusy(b, label) {
    busy = b; var btn = document.getElementById('am-send');
    if (btn) { btn.disabled = b; btn.textContent = label || 'SEND'; }
  }
  var MSG = {
    'not-ready': 'Still connecting to Google. Tap Send again in a second.',
    offline: 'No connection. Check your signal and tap Send again, or use the Mail app.',
    blocked: 'Safari blocked the Google sign-in window. Tap Send again, or allow pop-ups for this site.',
    closed: 'Google sign-in was closed before it finished. Tap Send to try again.',
    denied: 'Google didn’t get permission to send. Tap Send and choose Allow.',
    expired: 'Your Google pass ran out. Tap Send again.',
    forbidden: 'Google refused to send from this account. Make sure you picked your agencyroofingco.com account.',
    file: 'Couldn’t read the PDF. Close this and try again.',
    google: 'Google sign-in didn’t finish. Tap Send to try again.',
    http: 'Gmail couldn’t send that. Tap Send to try again, or use the Mail app.'
  };
  function send() {
    if (busy || !cur) return;
    var o = cur, to = document.getElementById('am-to'), su = document.getElementById('am-subject'), bo = document.getElementById('am-body');
    var addr = to.value.trim();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(addr)) { to.classList.add('bad'); say('Enter the customer’s email address.', true); to.focus(); return; }
    if (!su.value.trim()) { su.classList.add('bad'); say('Add a subject.', true); return; }
    setBusy(true, 'SENDING…'); say('');
    // requestToken() runs inside this tap so Google's window is allowed to open
    var pass = null;
    requestToken().then(function (p) {
      pass = p;
      return buildRaw({ to: addr, subject: su.value.trim(), body: bo.value, file: o.file }).then(function (raw) { return gmailSend(p.token, raw); });
    }).then(function (res) {
      close();
      if (o.onSent) o.onSent({ to: addr, subject: su.value.trim(), id: res && res.id });
      // Then file the same PDF in Drive (never blocks or undoes the send)
      if (o.drive && o.drive.key && o.onDrive) {
        if (!pass.drive) { o.onDrive({ ok: false, why: 'no-permission' }); return; }
        saveToDrive(pass.token, o.file, o.drive).then(function (f) { o.onDrive({ ok: true, name: f.name, link: f.link, folder: o.drive.folder }); },
          function (e) { if (window.console && e && e.detail) console.warn('ARCMail Drive', e.detail); o.onDrive({ ok: false, why: e && e.message }); });
      }
    }, function (e) {
      var k = e && e.message;
      if (k === 'expired') forget();
      setBusy(false);
      say(MSG[k] || MSG.http, true);
      if (window.console && e && e.detail) console.warn('ARCMail', e.detail);
    });
  }

  window.ARCMail = {
    get enabled() { return !!CLIENT_ID; },
    preload: function () { if (CLIENT_ID) loadGis().catch(function () {}); },
    compose: function (o) { if (!o || !o.file) return; open(o); },
    isOpen: function () { return !!cur; },
    // ── Google Drive for job costing (pages call these) ──
    // Is there a Google pass with Drive permission for this tab already? (no tap needed)
    get hasDrivePass() { var t = cached(); return !!(t && t.d); },
    // Must run inside a tap. Resolves { token, drive }.
    connectInTap: function () { return requestToken(true); },
    forget: forget,
    ready: function () { return gisReady(); },
    uploadScan: function (file, d) { var t = cached(); if (!t || !t.d) return Promise.reject(new Error('no-pass')); return uploadScan(t.t, file, d); },
    readText: function (id) { var t = cached(); if (!t || !t.d) return Promise.reject(new Error('no-pass')); return readText(t.t, id); },
    describe: function (id, meta) { var t = cached(); if (!t || !t.d) return Promise.reject(new Error('no-pass')); return describe(t.t, id, meta); },
    trash: function (id) { var t = cached(); if (!t || !t.d) return Promise.reject(new Error('no-pass')); return trash(t.t, id); },
    writeSheet: function (csv) { var t = cached(); if (!t || !t.d) return Promise.reject(new Error('no-pass')); return writeSheet(t.t, csv); },
    driveNote: function (r) {   // one line for a toast when Drive filing didn't work
      return r.why === 'no-permission' ? 'Not saved to Drive: Google Drive permission wasn’t allowed.'
        : r.why === 'drive-off' ? 'Not saved to Drive: turn on the Google Drive API in Google Cloud.'
        : r.why === 'offline' ? 'Not saved to Drive: no connection.' : 'Couldn’t save to Drive this time. The email was sent.';
    },
    _setClientId: function (id) { CLIENT_ID = id; tokenClient = null; }   // tests only
  };
})();
