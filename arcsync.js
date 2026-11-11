/*
  ARC Sync — keeps the CRM the same on every device (iPhone, Mac) through Supabase.

  How it works
  - The CRM keeps saving to this device's localStorage exactly as before (works with no signal).
  - This file watches those saves and mirrors each record to the cloud table `arc_records`:
      c:<customerId>  → { v3: record as stored in arc_v3, ext: arc_ext[id], fol: arc_follow[id] }
      settings        → arc_settings
      ownersig        → arc_owner_sig
      r:<customerId>  → arc_receipt_<customerId>
  - Job costing (scanned receipts/invoices per job) syncs through its own table `arc_costs`
    (one row per customer: arc_costs[id] = list of expenses). It is separate on purpose: an older
    version of this file would delete records it doesn't know about, and it never reads arc_costs.
  - Billing (Invoices screen: companies, invoices, payments) syncs through `arc_docs`:
      co:<id> → company, inv:<id> → invoice, billing-seq → { n: highest invoice number used } (merged as max)
    Each channel only handles the keys it owns (`owns`), so a newer version can add record types to
    arc_docs later without this version ever applying or deleting them.
  - It pulls changes made on the other device and writes them back into localStorage, then fires
    `arc:synced` so the page re-reads its data. Pages can block that (canApply) while you're mid-edit.
  - Last edit wins per record (customers sync separately, so different customers never collide).
  - Deleting a customer on one device deletes it on the other (tombstone rows).

  Security: the key below is Supabase's *publishable* key (safe in a public page). Every row is
  locked to the signed-in owner by Row Level Security, and new sign-ups are turned off.
*/
(function () {
  'use strict';
  var SB_URL = 'https://xndcntpxhzfaqtmzcuje.supabase.co';
  var SB_KEY = 'sb_publishable_KuUPSNQGagKSNL2_GDLbZw_eEPwlTWc';
  var TABLE = 'arc_records';
  var AUTH_KEY = 'arc_auth', META_KEY = 'arc_sync';
  var COSTS = 'arc_costs', COST_META = 'arc_sync_costs', BILL = 'arc_billing', BILL_META = 'arc_sync_docs';
  var WATCH = { arc_v3: 1, arc_ext: 1, arc_follow: 1, arc_settings: 1, arc_owner_sig: 1, arc_costs: 1, arc_billing: 1 };
  function watched(k) { return WATCH[k] === 1 || String(k).indexOf('arc_receipt_') === 0; }

  var LS = window.localStorage;
  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  function get(k) { try { return LS.getItem(k); } catch (e) { return null; } }
  function put(k, v) { rawSet.call(LS, k, v); }
  function del(k) { rawRemove.call(LS, k); }
  function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }

  // ── Stable hashing (Postgres jsonb reorders keys, so sort them first) ──
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function hash(v) {
    if (v == null) return null;
    var s = stable(v), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }

  // ── Local records ──
  function localRecords() {
    var out = {};
    var list = parse(get('arc_v3'), []), ext = parse(get('arc_ext'), {}), fol = parse(get('arc_follow'), {});
    if (Array.isArray(list)) list.forEach(function (c) {
      if (c && c.id) out['c:' + c.id] = { v3: c, ext: ext[c.id] || null, fol: fol[c.id] || null };
    });
    var st = parse(get('arc_settings'), null); if (st) out.settings = st;
    var sig = parse(get('arc_owner_sig'), null); if (sig) out.ownersig = sig;
    for (var i = 0; i < LS.length; i++) {
      var k = LS.key(i);
      if (k && k.indexOf('arc_receipt_') === 0) { var r = parse(get(k), null); if (r) out['r:' + k.slice(12)] = r; }
    }
    return out;
  }

  // Write remote records into localStorage in the formats the CRM reads
  function applyRecords(rows) {
    var list = parse(get('arc_v3'), []), ext = parse(get('arc_ext'), {}), fol = parse(get('arc_follow'), {});
    if (!Array.isArray(list)) list = [];
    var touchC = false;
    rows.forEach(function (r) {
      var k = r.key, v = r.deleted ? null : r.value;
      if (k.indexOf('c:') === 0) {
        var id = k.slice(2), idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) { idx = i; break; }
        if (!v || !v.v3) { if (idx > -1) list.splice(idx, 1); delete ext[id]; delete fol[id]; }
        else {
          if (idx > -1) list[idx] = v.v3; else list.unshift(v.v3);
          if (v.ext) ext[id] = v.ext; else delete ext[id];
          if (v.fol) fol[id] = v.fol; else delete fol[id];
        }
        touchC = true;
      } else if (k === 'settings') { if (v) put('arc_settings', JSON.stringify(v)); else del('arc_settings'); }
      else if (k === 'ownersig') { if (v) put('arc_owner_sig', JSON.stringify(v)); else del('arc_owner_sig'); }
      else if (k.indexOf('r:') === 0) { if (v) put('arc_receipt_' + k.slice(2), JSON.stringify(v)); else del('arc_receipt_' + k.slice(2)); }
    });
    if (touchC) {
      put('arc_ext', JSON.stringify(ext));
      put('arc_follow', JSON.stringify(fol));
      put('arc_v3', JSON.stringify(list));
    }
  }

  // Job costing records: key = customer id, value = { list: [expenses] }
  function localCosts() {
    var all = parse(get(COSTS), {}), out = {};
    Object.keys(all || {}).forEach(function (id) { if (Array.isArray(all[id])) out[id] = { list: all[id] }; });
    return out;
  }
  function applyCosts(rows) {
    var all = parse(get(COSTS), {}) || {};
    rows.forEach(function (r) { var v = r.deleted ? null : r.value; if (v && Array.isArray(v.list)) all[r.key] = v.list; else delete all[r.key]; });
    put(COSTS, JSON.stringify(all));
  }
  // Billing: arc_billing = { co: { [id]: company }, inv: { [id]: invoice }, seq: n }
  function billOwns(k) { return /^(co|inv):/.test(k) || k === 'billing-seq'; }
  function localBilling() {
    var b = parse(get(BILL), {}) || {}, out = {};
    Object.keys(b.co || {}).forEach(function (id) { if (b.co[id]) out['co:' + id] = b.co[id]; });
    Object.keys(b.inv || {}).forEach(function (id) { if (b.inv[id]) out['inv:' + id] = b.inv[id]; });
    if (b.seq) out['billing-seq'] = { n: b.seq };
    return out;
  }
  function applyBilling(rows) {
    var b = parse(get(BILL), {}) || {};
    b.co = b.co || {}; b.inv = b.inv || {};
    rows.forEach(function (r) {
      var v = r.deleted ? null : r.value, k = r.key;
      if (k === 'billing-seq') { if (v && +v.n > (+b.seq || 0)) b.seq = +v.n; return; }   // never goes down
      var m = /^(co|inv):(.+)$/.exec(k); if (!m) return;
      if (v) b[m[1]][m[2]] = v; else delete b[m[1]][m[2]];
    });
    put(BILL, JSON.stringify(b));
  }
  function costMod(v) { var m = 0; (v && v.list || []).forEach(function (x) { m = Math.max(m, x && (x.upd || x.at) || 0); }); return m; }

  // ── Meta: what this device last synced ──
  var meta = parse(get(META_KEY), null) || {};
  function freshMeta(uid) { return { uid: uid || null, hashes: {}, queue: {}, cursor: null, lastSync: 0 }; }
  if (!meta.hashes) meta = freshMeta(meta.uid);
  var cmeta = parse(get(COST_META), null) || {};
  if (!cmeta.hashes) cmeta = freshMeta(cmeta.uid);
  var dmeta = parse(get(BILL_META), null) || {};
  if (!dmeta.hashes) dmeta = freshMeta(dmeta.uid);
  function saveMeta() { try { put(META_KEY, JSON.stringify(meta)); put(COST_META, JSON.stringify(cmeta)); put(BILL_META, JSON.stringify(dmeta)); } catch (e) {} }

  // ── Auth (Supabase GoTrue, password sign-in) ──
  var auth = parse(get(AUTH_KEY), null);
  function saveAuth(a) { auth = a; if (a) put(AUTH_KEY, JSON.stringify(a)); else del(AUTH_KEY); }
  function tokenFrom(j) {
    return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || (auth && auth.email) || '', uid: (j.user && j.user.id) || (auth && auth.uid) || '' };
  }
  function authFetch(grant, body) {
    return fetch(SB_URL + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  var refreshing = null;
  function refresh() {
    if (!auth || !auth.refresh) return Promise.reject(new Error('signed-out'));
    if (refreshing) return refreshing;
    refreshing = authFetch('refresh_token', { refresh_token: auth.refresh }).then(function (res) {
      refreshing = null;
      if (!res.ok) {
        var bad = res.j && /invalid|not found|revoked|expired/i.test(res.j.error_description || res.j.msg || res.j.error || '');
        if (bad) { saveAuth(null); setStatus({ error: 'Signed out. Sign in again to keep syncing.' }); }
        throw new Error('refresh-failed');
      }
      saveAuth(tokenFrom(res.j));
      return auth.access;
    }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function token() {
    if (!auth) return Promise.reject(new Error('signed-out'));
    if (auth.exp - 60000 > Date.now()) return Promise.resolve(auth.access);
    return refresh();
  }
  function api(path, opts, retried) {
    return token().then(function (t) {
      var h = Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
      return fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers: h }));
    }).then(function (r) {
      if (r.status === 401 && !retried) return refresh().then(function () { return api(path, opts, true); });
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); });
      return r.status === 204 || r.status === 201 ? null : r.json();
    });
  }

  // ── Status for the page ──
  var status = { busy: false, error: '', waiting: false, costsSetup: false, docsSetup: false };
  var listeners = [];
  function setStatus(p) { Object.assign(status, p || {}); var s = getStatus(); listeners.forEach(function (f) { try { f(s); } catch (e) {} }); }
  function getStatus() {
    return { signedIn: !!auth, email: auth ? auth.email : '', online: navigator.onLine !== false, busy: status.busy,
      error: status.error, waiting: status.waiting, costsSetup: status.costsSetup, docsSetup: status.docsSetup,
      pending: Object.keys(meta.queue || {}).length + Object.keys(cmeta.queue || {}).length + Object.keys(dmeta.queue || {}).length, lastSync: meta.lastSync || 0 };
  }

  // ── Sync cycle: pull → (apply) → scan → push, for each table ──
  var cfg = { pull: true, canApply: function () { return true; } };
  var running = false, again = false;
  var CH = [
    { table: TABLE, m: function () { return meta; }, local: localRecords, apply: applyRecords,
      first: function (k, v) { return k.indexOf('c:') === 0 ? (v.v3.updatedAt || v.v3.createdAt || 0) : 0; } },
    { table: 'arc_costs', costs: true, m: function () { return cmeta; }, local: localCosts, apply: applyCosts,
      first: function (k, v) { return costMod(v); } },
    { table: 'arc_docs', prefix: 'd:', owns: billOwns, m: function () { return dmeta; }, local: localBilling, apply: applyBilling,
      first: function (k, v) { return (v && (v.upd || v.at)) || 0; } }
  ];

  function scan(ch) {
    if (!ch) { CH.forEach(scan); return; }
    var M = ch.m(), local = ch.local(), q = M.queue, now = Date.now();
    Object.keys(local).forEach(function (k) {
      var h = hash(local[k]);
      if (M.hashes[k] === h) { delete q[k]; return; }
      // First sync of a record: use its own edit time so the newer copy wins between devices
      var mod = M.hashes[k] === undefined ? ch.first(k, local[k]) : now;
      if (!q[k] || q[k].h !== h) q[k] = { h: h, mod: mod };
    });
    Object.keys(M.hashes).forEach(function (k) {
      if (!(k in local) && M.hashes[k] !== null) q[k] = { h: null, mod: now, deleted: true };
    });
    saveMeta();
    return local;
  }

  function pull(ch) {
    var M = ch.m(), rows = [], cursor = M.cursor;
    function page() {
      var p = ch.table + '?select=key,value,mod,deleted,updated_at&order=updated_at.asc&limit=500' + (cursor ? '&updated_at=gte.' + encodeURIComponent(cursor) : '');
      return api(p, { method: 'GET' }).then(function (batch) {
        batch = batch || [];
        rows = rows.concat(batch);
        if (batch.length === 500) {
          var last = batch[batch.length - 1].updated_at;
          if (last !== cursor) { cursor = last; return page(); }
        }
        return rows;
      });
    }
    return page().then(function (all) {
      if (ch.owns) all = all.filter(function (r) { return ch.owns(r.key); });   // rows from newer versions: leave them alone
      var seen = {};
      for (var i = all.length - 1; i >= 0; i--) { if (!seen[all[i].key]) seen[all[i].key] = all[i]; }
      var latest = Object.keys(seen).map(function (k) { return seen[k]; });
      var maxTs = all.length ? all[all.length - 1].updated_at : M.cursor;
      var local = ch.local(), toApply = [];
      latest.forEach(function (r) {
        var lh = hash(local[r.key]), rh = r.deleted ? null : hash(r.value), sh = M.hashes[r.key];
        if (lh === rh) { M.hashes[r.key] = rh; delete M.queue[r.key]; return; }
        var localChanged = lh !== (sh === undefined ? null : sh) && !(lh === null && sh === undefined);
        if (!localChanged) { toApply.push(r); return; }
        var q = M.queue[r.key];
        var lmod = q ? q.mod : (sh === undefined ? (local[r.key] ? ch.first(r.key, local[r.key]) : 0) : Date.now());
        if ((r.mod || 0) > lmod) { toApply.push(r); delete M.queue[r.key]; }
      });
      if (toApply.length) {
        if (!cfg.canApply()) { setStatus({ waiting: true }); return false; }   // try again when it's safe
        ch.apply(toApply);
        toApply.forEach(function (r) { M.hashes[r.key] = r.deleted ? null : hash(r.value); delete M.queue[r.key]; });
        M.cursor = maxTs; saveMeta();
        setStatus({ waiting: false });
        var keys = toApply.map(function (r) { return (ch.costs ? 'x:' : ch.prefix || '') + r.key; });
        try { window.dispatchEvent(new CustomEvent('arc:synced', { detail: { keys: keys } })); } catch (e) {}
        return true;
      }
      M.cursor = maxTs; saveMeta();
      setStatus({ waiting: false });
      return true;
    });
  }

  function push(ch) {
    var M = ch.m(), local = ch.local(), keys = Object.keys(M.queue);
    if (!keys.length) return Promise.resolve();
    var rows = keys.map(function (k) {
      var q = M.queue[k], gone = !(k in local);
      return { owner: auth.uid, key: k, value: gone ? null : local[k], mod: q.mod || Date.now(), deleted: gone };
    });
    var chunks = [];
    for (var i = 0; i < rows.length; i += 25) chunks.push(rows.slice(i, i + 25));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return api(ch.table + '?on_conflict=owner,key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(chunk) })
          .then(function () {
            chunk.forEach(function (r) {
              var nowH = r.deleted ? null : hash(r.value);
              M.hashes[r.key] = nowH;
              if (M.queue[r.key] && M.queue[r.key].h === nowH) delete M.queue[r.key];
            });
            saveMeta();
          });
      });
    }, Promise.resolve());
  }

  // The costs table not existing yet (setup step not run) must never stop the main sync
  function missingTable(e) { return /HTTP 404|PGRST205|relation .* does not exist|Could not find the table/i.test(String(e && e.message || e)); }
  function runChannel(ch) {
    return (cfg.pull ? pull(ch) : Promise.resolve(true)).then(function (ok) { scan(ch); return push(ch).then(function () { return ok; }); });
  }

  function cycle() {
    if (!auth) { setStatus({}); return Promise.resolve(); }
    if (running) { again = true; return Promise.resolve(); }
    if (navigator.onLine === false) { scan(); setStatus({ error: '' }); return Promise.resolve(); }
    running = true; setStatus({ busy: true });
    var applied = true;
    return runChannel(CH[0])
      .then(function (ok) {
        applied = ok;
        return runChannel(CH[1]).then(function (ok2) { if (ok2 === false) applied = false; setStatus({ costsSetup: false }); },
          function (e) { if (missingTable(e)) { setStatus({ costsSetup: true }); return; } throw e; })
          .then(function () {
            return runChannel(CH[2]).then(function (ok3) { if (ok3 === false) applied = false; setStatus({ docsSetup: false }); },
              function (e) { if (missingTable(e)) { setStatus({ docsSetup: true }); return; } throw e; });
          });
      })
      .then(function () {
        if (applied !== false) meta.lastSync = Date.now();
        saveMeta();
        setStatus({ busy: false, error: '' });
      }, function (e) {
        try { scan(); } catch (x) {}   // count local changes even when the network failed
        var msg = String(e && e.message || e);
        setStatus({ busy: false, error: msg === 'signed-out' ? '' : (/Failed to fetch|NetworkError|Load failed/i.test(msg) ? 'Offline. Changes are saved on this device and will sync.' : 'Sync problem: ' + msg) });
      })
      .then(function () { running = false; if (again) { again = false; schedule(800); } });
  }

  var timer = null;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(cycle, ms == null ? 1500 : ms); }

  // Watch the CRM's own saves
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === LS && watched(k) && auth) schedule();
  };
  Storage.prototype.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === LS && watched(k) && auth) schedule();
  };

  window.addEventListener('online', function () { schedule(300); });
  window.addEventListener('offline', function () { setStatus({}); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(300); });
  setInterval(function () { if (document.visibilityState !== 'hidden') cycle(); }, 30000);

  window.ARCSync = {
    init: function (o) {
      Object.assign(cfg, o || {});
      if (auth) schedule(cfg.pull ? 200 : 1500);
      setStatus({});
    },
    signIn: function (email, password) {
      return authFetch('password', { email: String(email || '').trim(), password: password }).then(function (res) {
        if (!res.ok) throw new Error((res.j && (res.j.error_description || res.j.msg || res.j.message)) || 'Sign-in failed');
        var a = tokenFrom(res.j);
        if (meta.uid && meta.uid !== a.uid) meta = freshMeta(a.uid);   // different account: start clean
        if (cmeta.uid && cmeta.uid !== a.uid) cmeta = freshMeta(a.uid);
        if (dmeta.uid && dmeta.uid !== a.uid) dmeta = freshMeta(a.uid);
        meta.uid = a.uid; cmeta.uid = a.uid; dmeta.uid = a.uid; saveMeta();
        saveAuth(a);
        setStatus({ error: '' });
        return cycle();
      });
    },
    signOut: function () {
      var t = auth && auth.access;
      saveAuth(null);
      meta = freshMeta(null); cmeta = freshMeta(null); dmeta = freshMeta(null); saveMeta();
      if (t) fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + t } }).catch(function () {});
      setStatus({ error: '', waiting: false });
    },
    syncNow: function () { return cycle(); },
    applyWhenReady: function () { schedule(50); },
    status: getStatus,
    onStatus: function (f) { listeners.push(f); try { f(getStatus()); } catch (e) {} }
  };
})();
