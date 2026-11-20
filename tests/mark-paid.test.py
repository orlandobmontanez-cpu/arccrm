# Mark Paid + Paid archive on the Invoices screen (phone size). Made-up data only.
# Run: python3 tests/mark-paid.test.py   (serves the repo on localhost:8765 itself)
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

inv = lambda i, seq, amt: {"id": i, "seq": seq, "coId": "c1", "date": "2026-11-01", "due": "2026-12-01", "status": "Sent", "sentAt": 1762000000000,
                           "items": [{"d": "Sample work", "q": 1, "rate": amt}], "taxOn": False, "payments": [], "log": [], "upd": 1}
billing = {"co": {"c1": {"id": "c1", "name": "Sample Roofing Co", "email": "ap@example.com", "terms": "net30"}},
           "inv": {"i1": inv("i1", 1001, 1200), "i2": inv("i2", 1002, 450)}, "seq": 1002}
errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 390, "height": 844})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8765/index.html")
        pg.evaluate("b => localStorage.setItem('arc_billing', b)", json.dumps(billing))
        pg.reload(); pg.wait_for_timeout(800)
        pg.click("#btn-invoices"); pg.wait_for_timeout(500)
        assert pg.locator("[data-mpaid]").count() == 2
        pg.locator("[data-mpaid='i1']").click(); pg.wait_for_timeout(300)
        pg.fill("#mp-ref", "1111")
        pg.screenshot(path="/tmp/mp-1.png")
        pg.click("[data-b='mp-save']"); pg.wait_for_timeout(400)
        assert pg.locator("#inv-inner .bl-item").count() == 1, "paid invoice should leave OPEN"
        pg.locator("[data-inv='i2']").click(); pg.wait_for_timeout(300)
        pg.click("[data-b='payopen']"); pg.fill("#bp-ref", "2222"); pg.click("[data-b='paysave']"); pg.wait_for_timeout(300)
        pg.click("[data-b='saveinv']"); pg.wait_for_timeout(300)
        pg.click("[data-filter='paid']"); pg.wait_for_timeout(300)
        assert pg.locator("#inv-inner .bl-item").count() == 2
        pg.screenshot(path="/tmp/mp-2.png")
        pg.fill("#bl-search", "1111"); pg.wait_for_timeout(200)
        assert pg.locator("#inv-inner .bl-item:visible").count() == 1
        st = json.loads(pg.evaluate("localStorage.getItem('arc_billing')"))
        assert st["inv"]["i1"]["payments"][0]["amount"] == 1200 and st["inv"]["i1"]["payments"][0]["ref"] == "1111"
        b.close()
finally:
    srv.terminate()
assert not errs, errs
print("mark-paid: OK")
