import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__))); import fontroute
# Needs: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, and local copies of jspdf 2.5.1 / html2canvas 1.4.1 / @fontsource fonts in /home/claude/vendor (npm pack) when the CDNs are blocked.
"""End-to-end test of online signing with a fake Supabase + fake Gmail, iPhone size (390x844)."""
import json, re, time, base64, threading, http.server, socketserver, functools, urllib.parse, sys
from playwright.sync_api import sync_playwright

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8123
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = Q(('127.0.0.1', PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/'

SIGN = {}          # token -> row (fake arc_sign)
LOG = []           # requests to arc_sign
SENT = []          # gmail raw messages

def match(row, qs):
    for k, v in qs.items():
        if k in ('select', 'order', 'limit'): continue
        if k == 'or':
            # only form used: (status.eq.open,and(status.eq.signed,applied.is.false))
            ok = row['status'] == 'open' or (row['status'] == 'signed' and not row['applied'])
            if not ok: return False
            continue
        op, _, val = v.partition('.')
        val = urllib.parse.unquote(val)
        if op == 'eq':
            if val.startswith('"'): val = val.strip('"')
            if str(row.get(k, '')) != val: return False
        elif op == 'in':
            if row.get(k) not in val.strip('()').split(','): return False
        elif op == 'is':
            if row.get(k) is not (val == 'true') and not (val == 'false' and row.get(k) is False): return False
    return True

def supabase(route):
    req = route.request
    u = urllib.parse.urlparse(req.url)
    qs = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
    path = u.path
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr)
    if path.startswith('/auth/'):
        return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps({'access_token': 'A', 'refresh_token': 'R', 'expires_in': 3600, 'user': {'id': 'u1', 'email': 'orlando.montanez@agencyroofingco.com'}}))
    if path == '/rest/v1/rpc/arc_sign_get':
        b = json.loads(req.post_data); r = SIGN.get(b['p_token'])
        if not r: out = {'status': 'missing'}
        else:
            if r['status'] == 'open': r['views'] += 1; r['viewed_at'] = r['viewed_at'] or '2026-11-12T20:00:00Z'; r['last_viewed_at'] = '2026-11-12T20:05:00Z'
            out = {'status': r['status'], 'num': r['num'], 'kind': r['kind'], 'info': r['info'], 'signed': ({'name': r['sig']['name'], 'at': r['sig']['at'], 'img': r['sig']['img']} if r['status'] == 'signed' else None)}
        return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps(out))
    if path == '/rest/v1/rpc/arc_sign_submit':
        b = json.loads(req.post_data); r = SIGN.get(b['p_token'])
        if not r or r['status'] != 'open': out = {'ok': False, 'why': 'missing' if not r else r['status']}
        elif r['info'].get('ack') and b.get('p_ack') != r['info']['ack']: out = {'ok': False, 'why': 'ack'}
        elif not b['p_img'].startswith('data:image/png;base64,'): out = {'ok': False, 'why': 'image'}
        else:
            r['status'] = 'signed'
            r['sig'] = {'name': b['p_name'], 'img': b['p_img'], 'at': '2026-11-12T20:10:00.000Z', 'tz': b['p_tz'], 'consent': True, 'ackRead': b['p_ack'], 'method': 'Signed online', 'ip': '203.0.113.9'}
            out = {'ok': True, 'name': b['p_name'], 'at': r['sig']['at'], 'ip': '203.0.113.9'}
        return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps(out))
    if path == '/rest/v1/rpc/arc_sign_attach':
        b = json.loads(req.post_data); r = SIGN.get(b['p_token'])
        if not r or r['status'] != 'signed': out = {'ok': False, 'why': 'not-signed'}
        elif r.get('pdf'): out = {'ok': False, 'why': 'already'}
        elif not b['p_pdf'].startswith('JVBER'): out = {'ok': False, 'why': 'bad'}
        else: r['pdf'] = b['p_pdf']; out = {'ok': True}
        return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps(out))
    if path == '/rest/v1/arc_sign':
        LOG.append((req.method, req.url))
        if req.method == 'GET':
            rows = [dict(r, taxRate=str(r['info'].get('taxRate')), taxCity=r['info'].get('taxCity'), what=r['info'].get('what')) for r in SIGN.values() if match(r, qs)]
            rows.sort(key=lambda r: r['created_at'], reverse=True)
            return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps(rows))
        if req.method == 'POST':
            b = json.loads(req.post_data)
            b.update(status='open', applied=False, sig=None, views=0, viewed_at=None, last_viewed_at=None, created_at=time.strftime('%Y-%m-%dT%H:%M:%S.') + str(len(SIGN)).zfill(3) + 'Z', item=b.get('item', ''))
            SIGN[b['token']] = b
            return route.fulfill(status=201, headers=hdr, body='')
        if req.method == 'PATCH':
            b = json.loads(req.post_data)
            for r in SIGN.values():
                if match(r, qs): r.update(b)
            return route.fulfill(status=204, headers=hdr, body='')
    # arc_records / arc_costs / arc_docs: empty and accept everything
    if req.method == 'GET': return route.fulfill(status=200, headers=hdr, content_type='application/json', body='[]')
    return route.fulfill(status=201, headers=hdr, body='')

def gmail(route):
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'})
    SENT.append(json.loads(route.request.post_data)['raw'])
    route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body='{"id":"m1"}')

now = int(time.time() * 1000)
CUST = {'id': 'c15', 'arcNum': 'ARC-00015', 'first': 'Ray', 'last': 'Scott', 'email': 'rayscott1951@aol.com', 'phone': '(505) 555-1234',
        'address': '8011 Camino Paisano NW', 'city': 'Albuquerque', 'state': 'NM', 'zip': '87120', 'stage': 'Proposed',
        'scope': 'Seal **parapet** cap seams\nPatch blistered field at drain\nRecoat repaired areas with silicone', 'requests': '',
        'materials': '850', 'labor': '600', 'other': '0', 'margin': '20', 'jobType': 'repair', 'taxRate': 7.3125,
        'quotes': [], 'changeOrders': [], 'activityLog': [], 'createdAt': now, 'updatedAt': now}

errors = []
ok = lambda cond, msg: print(('PASS ' if cond else 'FAIL ') + msg) or (cond or errors.append(msg))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    ctx.route('https://xndcntpxhzfaqtmzcuje.supabase.co/**', supabase)
    ctx.route('https://gmail.googleapis.com/**', gmail)
    ctx.route('https://accounts.google.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.google={accounts:{oauth2:{}}};'))
    def cdn(r):
        u = r.request.url
        f = '/home/claude/vendor/jspdf-2.5.1/dist/jspdf.umd.min.js' if 'jspdf' in u else '/home/claude/vendor/html2canvas-1.4.1/dist/html2canvas.min.js' if 'html2canvas' in u else None
        if f: r.fulfill(status=200, content_type='text/javascript', body=open(f).read())
        else: r.fulfill(status=404, body='')
    ctx.route('https://cdnjs.cloudflare.com/**', cdn)
    fontroute.install(ctx)
    ctx.route('https://www.googleapis.com/**', lambda r: r.fulfill(status=403, body='{}'))
    page = ctx.new_page()
    cons = []
    page.on('pageerror', lambda e: cons.append('pageerror ' + str(e)))
    page.on('console', lambda m: m.type == 'error' and cons.append('console ' + m.text))
    page.goto(BASE)
    page.evaluate("""c => { localStorage.setItem('arc_v3', JSON.stringify([c])); localStorage.setItem('arc_ext', JSON.stringify({ c15: { jobType: 'repair', taxRate: 7.3125 } }));
      localStorage.setItem('arc_auth', JSON.stringify({ access: 'A', refresh: 'R', exp: Date.now() + 3e6, email: 'orlando.montanez@agencyroofingco.com', uid: 'u1' }));
      localStorage.setItem('arc_owner_sig', JSON.stringify({ name: 'Orlando Montanez', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', at: new Date().toISOString() }));
      localStorage.setItem('arc_settings', JSON.stringify({ autoCountersign: true, showPay: false }));
      sessionStorage.setItem('arc_gtoken', JSON.stringify({ t: 'G', d: false, s: 1, exp: Date.now() + 3e6 })); }""", CUST)
    page.goto(BASE + '?open=c15')
    page.wait_for_timeout(1500)
    page.evaluate("selectCustomer('c15')")
    page.wait_for_timeout(500)
    ok(page.locator('#btn-rsign-proposal').is_visible(), 'SIGN ON THEIR PHONE button shows on the proposal')
    page.screenshot(path='/tmp/s1-detail.png', full_page=False)
    # Preview → link is made
    page.evaluate("generateProposal()")
    page.wait_for_function("document.getElementById('pv-link').dataset.state === 'ready'", timeout=15000)
    ok(len(SIGN) == 1, 'one sign request created in Supabase')
    row = list(SIGN.values())[0]
    ok(row['info']['ack'] == "I've read About This Repair." and row['info']['what'] == 'repair quote', 'request carries repair wording + acknowledgment')
    ok('materials' not in json.dumps(row['info']).lower() or 'Materials' not in row['info']['html'], 'no internal costs in what the customer sees')
    ok(not re.search(r'\b850\b|\b600\.00\b', row['info']['html']), 'no material/labor figures in the customer document')
    page.wait_for_function("!document.getElementById('pv-send').disabled", timeout=30000)
    page.screenshot(path='/tmp/s2-preview.png')
    # Same document previewed again → same link (no duplicates)
    page.evaluate("closePreview(); generateProposal()")
    page.wait_for_function("document.getElementById('pv-link').dataset.state === 'ready'", timeout=15000)
    ok(len(SIGN) == 1, 're-preview reuses the same link')
    # QR sheet
    page.click('#pv-link'); page.wait_for_timeout(300)
    ok(page.locator('#rs-sheet.active .rs-qr svg').count() == 1, 'QR code shows on the Sign on their phone sheet')
    href = page.get_attribute('#rs-text', 'href')
    ok(href.startswith('sms:+15055551234?&body=') and 'sign.html%23' in href, 'Text link goes to the customer number with the link')
    page.screenshot(path='/tmp/s3-qr.png')
    page.click('#rs-close')
    # Email (Gmail panel) has the link and sends HTML with a button
    page.wait_for_function("!document.getElementById('pv-send').disabled", timeout=30000)
    page.click('#pv-send'); page.wait_for_selector('#am-sheet.on')
    body = page.input_value('#am-body')
    tok = row['token']
    ok(('sign.html#' + tok) in body, 'email message includes the sign-online link')
    ok('Includes a' in page.inner_text('#am-sheet'), 'email panel says the sign button is included')
    page.screenshot(path='/tmp/s4-email.png')
    page.click('#am-send'); page.wait_for_timeout(1500)
    ok(len(SENT) == 1, 'email sent through Gmail')
    raw = base64.urlsafe_b64decode(SENT[0] + '=' * (-len(SENT[0]) % 4)).decode()
    ok('multipart/alternative' in raw and 'text/html' in raw and 'application/pdf' in raw, 'email = text + HTML + PDF attachment')
    parts = re.findall(r'Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)', raw)
    html = base64.b64decode(parts[0].replace('\r\n', '')).decode() if parts else ''
    ok('REVIEW &amp; SIGN ONLINE' in html and ('href="' + BASE + 'sign.html#' + tok) in html, 'HTML email has the Review & Sign button')
    open('/tmp/email.html', 'w').write(html)
    page.wait_for_timeout(500)
    page.evaluate("closePreview()")

    # ── Customer side: new device, no CRM data ──
    cctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    cctx.route('https://xndcntpxhzfaqtmzcuje.supabase.co/**', supabase)
    cctx.route('https://cdnjs.cloudflare.com/**', cdn)
    fontroute.install(cctx)
    cp = cctx.new_page(); ccons = []
    cp.on('pageerror', lambda e: ccons.append('pageerror ' + str(e)))
    cp.on('console', lambda m: m.type == 'error' and ccons.append('console ' + m.text))
    cp.goto(BASE + 'sign.html#' + tok)
    cp.wait_for_selector('#go-sign:visible')
    cp.wait_for_timeout(2500)
    ok('Hi Ray' in cp.inner_text('main') and 'ARC-00015' in cp.inner_text('main'), 'customer page greets Ray with his quote number')
    ok('About This Repair' in cp.inner_text('main'), 'customer page shows About This Repair')
    cp.screenshot(path='/tmp/c1-review.png', full_page=True)
    cp.screenshot(path='/tmp/c1-top.png')
    ok(cp.evaluate("Object.keys(localStorage).length") == 0, 'sign page wrote nothing to storage')
    cp.click('#go-sign'); cp.wait_for_selector('#sg.on')
    cp.locator('#sg-canvas').scroll_into_view_if_needed(); cp.wait_for_timeout(300)
    box = cp.locator('#sg-canvas').bounding_box()
    x, y = box['x'], box['y'] + box['height'] * 0.55
    cp.mouse.move(x + 30, y); cp.mouse.down()
    for i in range(1, 30): cp.mouse.move(x + 30 + i * 8, y - 20 * ((i % 6) / 6))
    cp.mouse.up()
    ok(cp.locator('#sg-ok').is_disabled(), 'Sign stays off until the boxes are ticked')
    cp.check('#sg-ack'); cp.check('#sg-consent')
    ok(cp.input_value('#sg-name') == 'Ray Scott', 'name pre-filled')
    cp.screenshot(path='/tmp/c2-sign.png')
    cp.click('#sg-ok'); cp.wait_for_timeout(1200)
    ok('Signed. Thank you, Ray!' in cp.inner_text('main'), 'customer sees the thank-you screen')
    ok('<!--arc-sig-->' in row['info']['html'] and '⟦NAME⟧' in row['info']['sigTpl'] and row['info']['driveFolder'] == 'Scott, Ray · ARC-00015', 'request carries the signature block + Drive folder name')
    cp.wait_for_selector('#copy-box a[download]', timeout=40000)
    ok('DOWNLOAD YOUR SIGNED COPY' in cp.inner_text('#copy-box'), 'customer can download their signed copy')
    cp.screenshot(path='/tmp/c3-done.png')
    pdf = base64.b64decode(SIGN[tok].get('pdf') or '')
    ok(pdf[:5] == b'%PDF-', 'signed PDF saved for Orlando (Drive + email)')
    open('/tmp/signed_copy.pdf', 'wb').write(pdf)
    ok(pdf.count(b'/Type /Page') - pdf.count(b'/Type /Pages') == 1, 'signed copy is one page')
    cp.reload(); cp.wait_for_timeout(1200)
    ok('signed by' in cp.inner_text('main'), 'reopening the link shows it is already signed')
    ok(not ccons, 'customer page: zero JS errors ' + str(ccons))

    # ── Back in the CRM: signature arrives ──
    page.evaluate("rsPoll()"); page.wait_for_timeout(700)
    ok(page.locator('#confetti').count() == 1, 'confetti falls when the signature moves the job to Signed')
    page.screenshot(path='/tmp/s5-confetti.png')
    ok(page.evaluate("getComputedStyle(document.getElementById('confetti')).pointerEvents") == 'none', 'confetti never blocks taps')
    page.wait_for_timeout(4600)
    ok(page.locator('#confetti').count() == 0, 'confetti clears itself')
    c = page.evaluate("customers.find(x => x.id === 'c15')")
    ok(c['sig'] and c['sig']['customer']['method'] == 'Signed online' and c['sig']['contractor'], 'signature on the record, countersigned with saved signature')
    ok(c['stage'] == 'Signed', 'stage moved to Signed')
    ok(any('signed online by Ray Scott' in a['msg'] for a in c['activityLog']), 'activity log entry')
    ok(SIGN[tok]['applied'] is True, 'request marked applied')
    ok(page.locator('#rs-banner').is_visible() and 'signed repair quote ARC-00015' in page.inner_text('#rs-banner'), 'banner: Ray signed repair quote online')
    page.screenshot(path='/tmp/s5-banner.png')
    stored = page.evaluate("JSON.parse(localStorage.getItem('arc_v3'))[0].sig")
    ok(stored and stored['customer']['name'] == 'Ray Scott', 'signature saved to phone storage (syncs)')
    page.click('#rs-open'); page.wait_for_timeout(400)
    ok('signed online' in page.inner_text('#sign-status-proposal'), 'status: SIGNED · signed online')
    ok(not page.locator('#btn-rsign-proposal').is_visible(), 'Sign on their phone hidden once signed')
    page.evaluate("rsPoll()"); page.wait_for_timeout(500)
    ok(page.locator('#confetti').count() == 0, 'no repeat confetti on the next check')
    # Signed document: one page, audit line says online
    page.evaluate("generateProposal()")
    page.wait_for_function("(() => { const f = document.querySelector('#pv-stage iframe'); const d = f && f.contentDocument; return d && d.documentElement && d.documentElement.getAttribute('data-pages'); })()", timeout=20000)
    pages = page.evaluate("document.querySelector('#pv-stage iframe').contentDocument.documentElement.getAttribute('data-pages')")
    audit = page.evaluate("(document.querySelector('#pv-stage iframe').contentDocument.querySelector('.esig-audit')||{}).textContent||''")
    ok(pages == '1', 'signed proposal still one page')
    ok('signed online through a private signing link' in audit and '203.0.113.9' in audit, 'audit line records online signing + IP')
    ok(page.locator('#pv-link-row').is_hidden(), 'no sign link offered on a signed document')
    page.wait_for_function("!document.getElementById('pv-send').disabled", timeout=30000)
    page.screenshot(path='/tmp/s6-signed.png')
    fr = page.frame_locator('#pv-stage iframe')
    page.evaluate("closePreview()")

    # Edit after sending → old link is replaced
    page.evaluate("""() => { const c = customers.find(x => x.id === 'c15'); c.sig = null; c.stage = 'Proposed'; c.materials = '900'; save(); selectCustomer('c15'); }""")
    page.evaluate("generateProposal()")
    page.wait_for_function("document.getElementById('pv-link').dataset.state === 'ready'", timeout=15000)
    page.wait_for_timeout(500)
    ok(len(SIGN) == 2, 'edited document gets a new link')
    page.evaluate("closePreview()")
    page.evaluate("generateProposal()")
    page.wait_for_function("document.getElementById('pv-link').dataset.state === 'ready'", timeout=15000)
    page.wait_for_timeout(300)
    page.evaluate("closePreview()")
    new_tok = [t for t in SIGN if t != tok][0]
    # in-person signing switches the open link off
    page.evaluate("""() => { rsVoid('c15', { kind: 'proposal' }); }"""); page.wait_for_timeout(500)
    ok(SIGN[new_tok]['status'] == 'void', 'signing in person switches off the open link')
    cp.goto(BASE + 'sign.html#' + new_tok); cp.wait_for_timeout(1200)
    ok('replaced' in cp.inner_text('main'), 'customer opening a switched-off link sees it was replaced')
    cp.goto(BASE + 'sign.html#short'); cp.wait_for_timeout(500)
    ok('Link not found' in cp.inner_text('main'), 'bad link handled')

    # Signed out → button explains
    page.evaluate("ARCSync.signOut()")
    page.evaluate("generateProposal()"); page.wait_for_timeout(800)
    ok('SIGN IN TO CLOUD SYNC' in page.inner_text('#pv-link'), 'signed out: button says to sign in to sync')
    page.wait_for_function("!document.getElementById('pv-send').disabled", timeout=30000)
    page.click('#pv-send'); page.wait_for_selector('#am-sheet.on')
    ok('let me know and we\'ll get you on the schedule' in page.input_value('#am-body'), 'without a link the email keeps the original wording')
    real = [c for c in cons if 'Failed to load resource' not in c and 'net::' not in c]
    ok(not real, 'CRM: zero JS errors ' + str(cons))
    b.close()

print('\n%d failure(s)' % len(errors))
sys.exit(1 if errors else 0)
