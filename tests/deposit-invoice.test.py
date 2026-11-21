# Payment invoice (deposit) flow, phone size. Made-up data only.
# Quote → "Any promises made?" → Payment Invoice (slider + typed amount, check + cash payments) → Deposit Receipt → final receipt subtracts it.
# Run: python3 tests/deposit-invoice.test.py   (serves the repo on localhost:8766 itself)
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

cust = {"id": "c_test", "arcNum": "ARC-00042", "createdAt": 1, "updatedAt": 1, "stage": "Signed", "first": "Pat", "last": "Sample",
        "phone": "505-555-0100", "email": "pat@example.com", "address": "123 Sample St NW", "city": "Albuquerque", "zip": "87120",
        "scope": "Remove existing roof\nInstall new TPO membrane\nNew flashings and sealed penetrations\nCleanup", "requests": "",
        "materials": "1000", "labor": "500", "other": "", "margin": "30", "activityLog": [], "quotes": [], "changeOrders": [], "sig": None}
errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        ctx.route("https://cdnjs.cloudflare.com/**", lambda r: r.abort())
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8766/index.html")
        pg.evaluate("c => { localStorage.setItem('arc_v3', c); localStorage.setItem('arc_settings', JSON.stringify({ payLink: 'https://buy.stripe.com/test_sample', showPay: true })); }", json.dumps([cust]))
        pg.goto("http://localhost:8766/index.html?open=c_test"); pg.wait_for_timeout(1200)

        # 1) Proposal preview asks "Any promises made?" once
        pg.click("#btn-generate"); pg.wait_for_timeout(300)
        assert pg.locator("#pm-sheet.active").count() == 1, "promises prompt should open"
        pg.fill("#pm-text", "Crew parks on the street\nProtect the rose bed")
        pg.screenshot(path="/tmp/dep-0-promises.png")
        pg.click("#pm-save"); pg.wait_for_timeout(1200)
        assert pg.locator("#pv-sheet.active").count() == 1, "preview should open after the prompt"
        doc = pg.frame_locator("#pv-stage iframe")
        assert doc.locator(".paybox").count() == 0, "no pay QR on a proposal"
        pg.click("#pv-close"); pg.wait_for_timeout(300)
        assert pg.input_value("#f-promises").startswith("Crew parks")
        pg.click("#btn-generate"); pg.wait_for_timeout(600)
        assert pg.locator("#pm-sheet.active").count() == 0, "asked only once per visit"
        pg.click("#pv-close"); pg.wait_for_timeout(300)

        # 2) Payment invoice: slider, then a typed amount
        pg.click("#btn-new-dep"); pg.wait_for_timeout(400)
        assert pg.locator("#dp-sheet.active").count() == 1
        total = pg.evaluate("priceOf(getCurrent(), mainRate(getCurrent())).total")
        assert abs(float(pg.input_value("#dp-amount")) - round(total * 0.5, 2)) < 0.01, "defaults to 50%"
        pg.fill("#dp-pct", "30"); pg.dispatch_event("#dp-pct", "input")
        assert abs(float(pg.input_value("#dp-amount")) - round(total * 0.3, 2)) < 0.01
        pg.fill("#dp-amount", "777.77"); pg.wait_for_timeout(100)
        assert pg.inner_text("#dp-pct-l").endswith("%") and pg.inner_text("#dp-pct-l") != "30%"
        assert "Crew parks" in pg.input_value("#dp-prom")
        pg.screenshot(path="/tmp/dep-1-form.png", full_page=True)

        # Preview the invoice: promises + agency promise + QR for the deposit, one page
        pg.click("#dp-pdf"); pg.wait_for_timeout(1500)
        doc = pg.frame_locator("#pv-stage iframe")
        txt = doc.locator("body").inner_text().lower()
        assert "payment invoice for" in txt and "our commitments to you" in txt and "protect the rose bed" in txt and "listen before we climb" in txt, txt[:1500]
        assert doc.locator(".paybox").count() == 1 and "$777.77" in txt
        assert doc.locator(".page").count() == 1, "one Letter page"
        pg.screenshot(path="/tmp/dep-2-invoice.png")
        pg.click("#pv-close"); pg.wait_for_timeout(300)

        # 3) A check (pending) for part, then cash for the rest
        pg.click("#dp-addpay"); pg.wait_for_timeout(200)
        pg.fill("#dpp-amt", "500"); pg.fill("#dpp-ref", "1234")
        pg.click("#dpp-save"); pg.wait_for_timeout(300)
        assert "Check pending" in pg.locator(".dp-pst").first.evaluate("s => s.options[s.selectedIndex].text")
        pg.click("#dp-addpay"); pg.wait_for_timeout(200)
        pg.select_option("#dpp-m", "Other"); pg.wait_for_timeout(100)
        pg.click("#dpp-save"); pg.wait_for_timeout(200)   # "Other" needs a note
        assert pg.locator(".dp-pay").count() == 1
        pg.select_option("#dpp-m", "Cash"); pg.wait_for_timeout(100)
        assert pg.input_value("#dpp-amt") == "277.77"
        pg.click("#dpp-save"); pg.wait_for_timeout(300)
        pg.screenshot(path="/tmp/dep-3-paid.png", full_page=True)
        assert pg.inner_text("#dp-pdf") == "PREVIEW RECEIPT"
        pg.click("#dp-pdf"); pg.wait_for_timeout(1500)
        doc = pg.frame_locator("#pv-stage iframe")
        txt = doc.locator("body").inner_text().lower()
        assert "deposit receipt for" in txt and "deposit received" in txt and "#1234" in txt and "(pending)" in txt, txt[:1500]
        assert doc.locator(".paybox").count() == 0 and doc.locator(".page").count() == 1
        pg.screenshot(path="/tmp/dep-4-receipt.png")
        pg.click("#pv-close"); pg.wait_for_timeout(300)
        pg.click("#dp-close"); pg.wait_for_timeout(300)
        assert "Paid" in pg.inner_text("#dep-list")

        ext = json.loads(pg.evaluate("localStorage.getItem('arc_ext')"))["c_test"]
        d = ext["deposits"][0]
        assert d["num"] == "ARC-00042-D1" and d["amount"] == 777.77 and len(d["payments"]) == 2 and ext["promises"].startswith("Crew")

        # 4) Final receipt subtracts the deposit
        pg.goto("http://localhost:8766/receipt.html?id=c_test&rate=7.3125&tcity=Albuquerque"); pg.wait_for_timeout(1200)
        assert pg.input_value("#tDep") == "777.77"
        assert pg.is_visible("#vDep") and "ARC-00042-D1" in pg.inner_text("#kDep")
        assert pg.inner_text("#kPaid") == "Final Payment"
        paid = float(pg.input_value("#tPaid").replace(",", ""))
        assert abs(paid - (total - 777.77)) < 0.01 and pg.inner_text("#tBal") == "$0.00"
        pg.screenshot(path="/tmp/dep-5-final.png", full_page=True)

        # 5) Bounced check: no longer counts
        pg.goto("http://localhost:8766/index.html?open=c_test"); pg.wait_for_timeout(1000)
        pg.locator("[data-dep]").first.click(); pg.wait_for_timeout(300)
        pg.locator(".dp-pst").first.select_option("bounced"); pg.wait_for_timeout(300)
        assert pg.inner_text("#dp-pdf") == "PREVIEW INVOICE"
        pg.click("#dp-close"); pg.wait_for_timeout(200)
        assert "Partly paid" in pg.inner_text("#dep-list")
        b.close()
finally:
    srv.terminate()
assert not errs, errs
print("deposit-invoice: OK")
