# ARC CRM — Agency Roofing Co.

Custom CRM for **Agency Roofing Co. LLC**, a flat-roof specialty contractor in Albuquerque, NM.
Owner and only user: **Orlando Montanez**. He runs it from **Safari on his iPhone** in the field.

- Live site: https://orlandobmontanez-cpu.github.io/arccrm/ (GitHub Pages, deploys from `main` in about 60 seconds)
- The live app is `index.html` (must keep that exact name). `receipt.html` is the receipt page. `board.html` is the **Job Board**
  (Today: follow-ups due, installs today, proposals with no follow-up; schedule; close rate; pricing check; pipeline;
  accepted/declined; success map). Tapping a job opens a sheet to mark Accepted/Declined/Reopen, set the install date and a
  follow-up date + note, add either to Google Calendar, and call/text/email. It writes **only** `stage`, `scheddate`,
  `activityLog`, `updatedAt` on the `arc_v3` record and `followUp` / `followNote` in `arc_ext[id]` + `arc_follow` (`update()` in board.html) —
  never any other field. The CRM re-reads storage on `pageshow` (back/forward cache) and `storage` events so it never saves
  stale data over board edits. It loads Leaflet 1.9.4 from cdnjs and OpenStreetMap tiles for the map (Orlando asked for a real
  street map); everything else on it works offline. ZIP centers for the 870/871/875 areas are bundled in the page.
  Close rate = Signed + In Production + Closed ÷ (those + Declined). Amounts are before tax: (materials+labor+other)×(1+margin) − discount.
  Tapping a job opens `./?open=<customer id>` in the CRM.
- `sign.html` is the **customer signing page** (online signing, below). It is standalone on purpose: it never loads
  `arcsync.js`/`arcmail.js` and never reads or writes localStorage, so a customer opening it can't touch CRM data.
- Never add copies of the app to this repo (old ones were deleted): any page on this site shares `localStorage` with the live app
  and an old copy would overwrite `arc_v3` in an old format if opened.
- `manifest.webmanifest` **must keep `"display": "browser"`. Never change it to `"standalone"`**: on iOS a standalone home-screen app
  gets its own separate storage, so the CRM would open empty.
- `orlandomontanez-create/ARCCRM` is an older, abandoned copy. Never work there.

## How Orlando wants work done

- Be direct. Say what you're about to do and why before doing it; no hedging, no over-explaining.
- He expects brand standards to be applied from this file, not re-explained each time.
- Mobile first: every screen must work at iPhone width (390px) with 48px minimum tap targets.
- **Small fixes:** commit straight to `main` (goes live).
  **New features or anything touching data storage:** push a branch and tell him to review and merge.
  If unsure, ask which one he wants.
- Before any change that touches stored data, remind him to tap **Export Backup** on his iPhone first.

## Architecture

- Everything is plain HTML/CSS/JS in single files. **No build step, no frameworks, no external JS.** Two shared files only:
  **`arcsync.js`** (cloud sync; `<head>` of index, board and receipt) and **`arcmail.js`** (Gmail sending; index and receipt).
  It loads Google's sign-in script (`accounts.google.com/gsi/client`) on demand. The only outside resources are Google Fonts
  and, for PDFs only, html2canvas 1.4.1 + jsPDF 2.5.1 from cdnjs (Orlando asked for this; loaded on demand when a preview or receipt opens).
- Data lives in the phone's browser `localStorage` (per device, same origin as the site):
  - `arc_v3` — array of customer records (the whole CRM)
  - `arc_settings` — `{ payLink, showPay, autoCountersign, lastQuoteType, taxRates, lastBackupAt }`
    (`taxRates` = `[{ city, rate }]` in percent, starts with Albuquerque 7.3125; `lastBackupAt` ms timestamp of the last Export Backup)
  - `arc_owner_sig` — Orlando's saved signature `{ name, img (PNG data URL), at }`
  - `arc_receipt_<customerId>` — receipt drafts
  - `arc_follow` — follow-up dates + notes `{ [id]: { d, n } }` (also mirrored in `arc_ext`)
  - `arc_costs` — job costing `{ [id]: [expense] }` (own key, never in `arc_v3`/`arc_ext`, so older versions can't drop it).
    Expense = `{ id, date, vendor, cat: materials|labor|other, ref, sub, tax, total, items: [{ d, q, p }], note, file: { id, name, link } | null, driveStale, at, upd }`
    (`normExpense`). Backups carry it as `arcCosts`; importing a backup without `arcCosts` keeps the job's expenses.
  - `arc_billing` — Invoices screen `{ co: { [id]: company }, inv: { [id]: invoice }, seq }` (`normCompany` / `normInvoice`).
    Backups carry it in `arcBackup.billing`; import merges (newer `upd` wins, nothing removed, `seq` only goes up).
- `normalize(c)` whitelists customer fields. **Any new field must be added there**, or it is silently dropped on load. Same for `normQuote` / `normCO`.
  - Address: `address` (street + unit), `city`, `state` (default NM), `zip`. Old records with "NM 87120" in `zip` are split on load.
    Documents always print "City, NM ZIP" via `cityLine(c)`.
  - Quote type: customer `jobType` / quote `type` = `'replace'` or `'repair'`. **Both price the same way** (Materials + Labor + Other,
    Margin %, Discount — one pricing screen). The type only changes the customer-facing terms (About This Repair, no 5-year warranty,
    inspection reminder). Before Oct 27 2026 repair jobs used line items (`items`); `migrateRepairItems` converts them on load to
    Materials = line-item total, margin 0, so totals and signatures are unchanged. `items` is now always empty.
  - Inspections: `completedAt`, `nextInspection`, `lastInspected` (YYYY-MM-DD).
  - Follow-up: `followUp` (YYYY-MM-DD) + `followNote` (short text), stored in `arc_ext` **and** `arc_follow`
    (`{ id: { d, n } }`, its own key — older versions rebuild `arc_ext` on save and would drop them; `arc_follow` wins on load). Set in the CRM (Next Follow-Up section,
    with Google Calendar link) or on the Job Board. The customer list shows FOLLOW UP TODAY / FOLLOW-UP OVERDUE badges.
  - Tax: `taxRate` (percent, per job) and `taxAuto` (rate follows the job city via Settings → Tax rates until typed over).
    Existing customers keep 7.3125. Stored in `arc_ext` like the other newer fields.
- Never break existing records: old data must load unchanged. Import/Export backups are a JSON array of customers
  (importable by every version). The first record carries `arcBackup: { settings, ownerSig }`; import restores those only after a
  second confirm. Import also accepts `{ customers, settings, ownerSig }`. A banner on the customer list asks for a backup after 7 days.
- On load the app calls `navigator.storage.persist()` (silent) so the browser is less likely to clear storage.
- **Revert-safe storage:** `arc_v3` is always written in the previous version's format (`toStored`): real costs for every job, and
  ZIP keeps the way it was typed. Newer fields live in `arc_ext` (`extOf` / `applyExt`), which older versions never touch; backups
  carry them as `arcExt`. Repair jobs are written to `arc_ext` with `jobType: 'repair'` and **no `mirror`**, so an older version
  loads them as replacement jobs at the same price (only the repair wording is lost on a revert). Ext records that still have a
  `mirror` are the old line-item format and are converted on load. Signature `docId` keeps the old formula; `sig.linesId` is
  legacy (dropped on conversion when it matched, set to `'edited'` when it didn't). Keep this when adding fields.
- Pipeline stages: Lead → Inspected → Proposed → Signed → In Production → Closed (+ Declined).
- Numbering: customers `ARC-00007`; additional quotes `ARC-00007-Q2…` (Q1 = main proposal); change orders `ARC-00007-CO1…`; receipts `ARC-00007-R`.
- Pricing: materials + labor + other, plus margin % = customer price; discount applied pre-tax; NM gross receipts tax is **per job**
  (`customer.taxRate`), filled from the job city with `ARCSign.cityRate(city)`; an unknown city gets the Albuquerque rate and a
  "Check tax rate for [city]" note. Never hard-code a rate. Signing locks the rate into the signature (`sig.taxRate`, `sig.taxCity`);
  a document is priced at its locked rate while its signature matches (`mainRate` / `quoteRate` / `coRate`), so table changes never
  alter a signed total. Signatures without `taxRate` were made at 7.3125%. The receipt gets the rate from the CRM (`?rate=&tcity=`)
  and saves it in the draft, so a saved or signed receipt keeps its rate.
- **Internal cost, labor, and margin are never shown on anything customer-facing.** Every customer-facing price card (proposal, quotes,
  change orders, repair quotes, receipt print/PDF) shows only: Subtotal, Gross Receipts Tax (City, rate%), Final Investment. No line items,
  no "Base Proposal", no discount line. Receipts also keep Amount Paid / Balance Due. Line items stay visible inside the CRM.
- `save()` catches storage-full errors and warns. Signatures are images (~17 KB each); keep them small.

## Cloud sync (iPhone ⇄ Mac) — `arcsync.js` + Supabase

- Supabase project `xndcntpxhzfaqtmzcuje` (owned by orlando.montanez@agencyroofingco.com). The publishable key in `arcsync.js`
  is public by design; security is **Row Level Security** (`supabase/setup.sql`: one table `arc_records`, rows locked to
  `owner = auth.uid()`) plus **sign-ups turned off**. Never put a secret / service_role key in this repo.
- Pages still read and write `localStorage` exactly as before (works offline). `arcsync.js` wraps `Storage.prototype.setItem`
  to notice saves to `arc_v3`, `arc_ext`, `arc_follow`, `arc_settings`, `arc_owner_sig`, `arc_receipt_*`, and mirrors them as
  records: `c:<id>` = `{ v3, ext, fol }`, `settings`, `ownersig`, `r:<id>`. Its own bookkeeping lives in `arc_sync` and the
  login in `arc_auth` (never synced).
- Cycle: pull (rows with server `updated_at` ≥ cursor) → apply → scan → push (upsert on `owner,key`). Last edit wins per record
  by `mod` (device ms); a record's first sync uses its own `updatedAt`. Deletes are tombstones (`deleted: true`).
  Hashes use sorted-key JSON because Postgres jsonb reorders keys.
- Applying remote changes rewrites localStorage and fires `arc:synced`; the page re-reads (`reloadFromStorage` in the CRM,
  `loadAll`/`render` on the board). The CRM blocks applying while you're editing (`formDirty`, focused input, or any sheet/
  modal open — `syncCanApply`) and shows "New changes from your other device. Tap to load them." (saves the open form first).
  The receipt page only pushes (`init({ pull: false })`).
- Sign in: Settings → Cloud Sync (email + password, created in Supabase → Authentication → Users). Status line on the list.
- Any **new stored key or field** must be inside one of the synced records (or added to `localRecords`/`applyRecords`).
- Job costing syncs through its **own table `arc_costs`** (`supabase/costs.sql`, also in `supabase/docs.sql`, same shape + RLS; key = customer id, value `{ list }`,
  meta in `arc_sync_costs`). Never put new record types in `arc_records` under a new key prefix: an older `arcsync.js` pulls every
  row and then tombstones keys it can't produce locally. If `arc_costs` doesn't exist yet, main sync carries on and Settings says
  "run supabase/costs.sql" (`status.costsSetup`).

## Emailing documents — `arcmail.js` (Gmail API from the browser)

- **Email** on a proposal/quote/change order preview and **Send** on the receipt open `ARCMail.compose(...)`: a sheet with To
  (customer email), Subject, Message and the PDF attached; **SEND** sends it with the Gmail API as the signed-in Google account
  (orlando.montanez@agencyroofingco.com), so it lands in Gmail Sent. Orlando asked for this; he reviews then taps Send — never
  auto-send without the panel.
- Auth: Google Identity Services token client, scopes `gmail.send` + `drive.file` (only files/folders this app creates), `CLIENT_ID` constant in `arcmail.js` (OAuth **Web**
  client in his Google Cloud project "ARC CRM", consent screen **Internal**, authorized JavaScript origin
  `https://orlandobmontanez-cpu.github.io`). The 1-hour access token is kept in `sessionStorage` (`arc_gtoken`) only.
  `requestAccessToken` must run inside the tap (pop-up rules), so the PDF and the Google script are prepared beforehand.
  No client secret or refresh token anywhere. If `CLIENT_ID` is empty, `ARCMail.enabled` is false and the Mail-app flow runs.
- Message = RFC 822 multipart/mixed built by hand (base64 body + PDF, RFC 2047 folded subject) → `users/me/messages/send` `{ raw }`.
  The body is multipart/alternative: the plain text plus a branded HTML copy (`htmlBody`, Nov 18 2026 — he found the old one
  "very on your face"): stone page, small shield + AGENCY / ROOFING CO. header, off-white card, calm 15.5px type, the tagline in
  Lora italic, the sign-off under a hairline with the phone as a tap-to-call link. If the message contains the `signUrl`, that line
  becomes a quiet rose-gold **REVIEW & SIGN ONLINE** button (`email/sign-button.gif`, built by `tools/make-sign-button.py`; a glint crosses it right to left every ~3 s, alt text on a rose-gold pill if images are off) with "Or open it in your browser" under it (no raw link shown). Same words as
  the plain text; never add or change wording here.
- "Use the Mail app instead" in the sheet runs the older flow below. Sends are logged in the customer's activity log
  (the receipt page writes the log entry straight into `arc_v3`).
- **One inbox only:** everything goes to and from orlando.montanez@agencyroofingco.com (Orlando's choice, Nov 2026). Never route
  customers, DocuSign or notifications to agencyroofingco@gmail.com.
- Proposal subject/message wording comes from `pvMail` (don't change without asking). Receipt subject:
  "[Name], your Agency Roofing Co. receipt for [address] · [number]".

## Google Drive + Job Costing (`arcmail.js` Drive helpers + Job Costing section in `index.html`)

- Needs the **Google Drive API** enabled in the "ARC CRM" Google Cloud project. Same Google sign-in as Gmail (one consent).
  Folders are found by `appProperties.arc` tags, never by name: `root` = **Agency Roofing**, `customers` = **Customers**,
  `c:<id>` = **Last, First · ARC-00007**, `cx:<id>` = **Receipts & Invoices**. The sheet is tagged `expenses-sheet`.
- Every emailed proposal/quote/change order/receipt PDF is also filed in the customer folder (same name replaces the old copy).
- Job Costing (customer record, after Change Orders): quoted Materials/Labor/Other (proposal + approved change orders) vs actual
  expenses, contract before tax, profit + margin. Internal only, never on a customer document.
  Add receipt: tap 1 connects Google if needed (pop-up must be in a tap), tap 2 opens the file picker. The scan uploads to
  Receipts & Invoices, Google reads it (copy as a Google Doc = Drive text recognition → export text → delete the copy),
  `ReadReceipt.parse` (between `READ-RECEIPT` markers) fills the form, Orlando checks and saves.
  Returns (Nov 21 2026): amounts in brackets `(761.93)` are negative; a CREDIT MEMO is read as all-negative (items keep a positive
  qty, negative amount); a scan holding several documents (split at their own INVOICE / CREDIT MEMO heading line) becomes one
  net entry with both numbers in `ref` and a note like "Invoice … $311.93 + Credit memo (return) … −$761.93 = net −$450.00".
  Supplier column rows ("-2 -2 DR -2.000 DR 273.760") give qty = shipped; "5GAL" is a pail size, never the quantity. On save the scan is renamed
  `YYYY-MM-DD · Vendor · $Total · ARC-00007.ext` and its Drive description holds the full record (`driveRecord`).
  Every change rewrites the **Agency Roofing Expenses** Google Sheet from the CRM (`expenseCsv`, formula-safe); its link is
  `settings.expSheet`. Offline/no Google pass: saved in the CRM with `driveStale`, Drive catches up on the next connect.
  Cancelling a new scan or deleting an expense moves the scan to Drive trash.

## Invoices (billing roofing companies) — Invoices screen in `index.html` (`#inv-sheet`, button under Job Board)

- Companies (name, contact, billing email, extra CC, address, default terms, **NTTC on file**, private notes) and invoices.
- Numbers `INV-1001`, `INV-1002`… from `billing.seq` (starts 1000). A number is used up the moment an invoice is created:
  a never-sent draft can be deleted, a sent invoice can only be **voided**; numbers never repeat. A void can be undone: a voided invoice shows **RESTORE THIS INVOICE** (two taps), which sets it back to Sent (or Draft if never sent) and keeps payments and history. Two devices offline can
  hand out the same number: on load the later never-sent draft is renumbered (`loadBilling`).
- Line items (description, qty × rate), every amount editable. Tax switch per invoice (on by default, off for NTTC
  companies), rate from the tax city via `ARCSign.cityRate`. Statuses: Draft, Sent, Partly paid, Paid, Overdue (past due
  with a balance), Void (`invCalc`). Payments `{ n, date, amount, method, ref }`; each has a receipt `INV-1001-R<n>`.
- **Mark Paid (Nov 20 2026):** each open invoice in the list has a **✓ MARK PAID** bar under it (`data-mpaid`, its own button, never
  inside the row button). Tap → inline confirm (Paid by, Check/Ref #, date) → CONFIRM PAID records one payment for the full balance
  (`markPaidSave`), so it becomes Paid through `invCalc` and leaves OPEN. Inside an invoice the payment button reads ✓ MARK PAID · $balance
  (same pay form, amount editable for partials). No new fields. The **PAID** tab is the archive: newest payment first, grouped by month with
  totals, check #s on each row, and a search box (`#bl-search`, filters by company, invoice #, job, PO, amount, check #). Test: `python3 tests/mark-paid.test.py`.
- Invoice and receipt documents use `docShell` + `BILL_DOC_CSS` (one Letter page; Pay Online QR for the balance).
  Long ones (big hours log + Pay Online QR) first get `html.tight` billing spacing; if still too long, whole blocks move to page 2
  (the paginator moves a block it can't split instead of leaving it cut off — fixed Nov 27 2026 after INV-1006's QR was clipped).
  Line items ARE shown on invoices (these are billed prices, not internal costs).
- Email through the same `ARCMail.compose` panel via `openPreview({ ext })`: To = billing email, CC = company CC,
  **"Send a copy to me" (Bcc orlando.montanez@agencyroofingco.com) on by default**. PDF also filed in Drive:
  Agency Roofing / Invoices / <Company> (tags `invoices`, `ico:<companyId>`).
- Syncs through table `arc_docs` (`supabase/docs.sql`): `co:<id>`, `inv:<id>`, `billing-seq` (merged as max). The channel
  only touches keys it owns (`billOwns`), so new record types can be added to `arc_docs` later without older versions
  deleting them — keep that rule (add an `owns` filter for any new channel).

## Hours tracker (hourly consulting billed through Invoices) — added Nov 13 2026

Orlando consults by the hour for some clients (invoiced weekly). Lives inside the Invoices screen.

- **A company becomes hourly when it has a rate** (`co.rate`, set from the HOURS tile setup or the tracker's settings). The rate is **private**: it only turns
  hours into a total and is **never printed** on an invoice or the hours log, and the tracker shows only the running total.
  He doesn't mind that total ÷ hours reveals it; he just doesn't want it displayed. Keep it off every document.
- `co.time` = hours not yet invoiced: `{ id, date, a: 'HH:MM', b: 'HH:MM', who, note, at }`. `who` is the customer's last name or
  "Training". No finish time = in progress (0 hours, not invoiced). A finish earlier than the start means past midnight (`timeMin`).
- **Entry point: the HOURS tile on the main screen** (`#btn-hours` → `openHours`). It goes straight to the last-used hourly company's
  tracker. With no hourly company yet it shows one setup screen (`bv.view === 'hsetup'`): pick or create the company, rate, invoice
  wording, tax. Rate / wording / tax are changed later from **RATE & SETTINGS** at the top of the tracker. The company form has
  **no** hourly fields (he found that buried and confusing); saving a company keeps rate, hrTax, hrLabel and time untouched.
- The tracker (`bv.view === 'time'`): running total, add/edit form with NOW buttons, entries, past invoiced periods, chips to switch
  to another hourly company. Hourly companies also show a dark card at the top of the Invoices list. The HOURS tile shows "N OPEN"
  when an entry has a start but no finish.
- **Entries are "brackets"** (`.tm-br` cards, oldest first) above a fresh form titled NEXT ENTRY. SAVE ENTRY stores it, clears the
  form (keeping the date) and scrolls to it. Tap a card to edit it in the form.
- **Customers box is a paste box** (`#tm-who`, grows with content). He pastes the list the client texts him, e.g.
  `1. Pat Sample (10001) - 123 Sample Road Northwest`; `stopLines()` turns each into
  `Sample (10001) · 123 Sample Road Northwest` (last name, their job #, address as sent), one per line, shown live under the
  box as "ON THE HOURS LOG". Handles numbered items run together on one line. `who` stores those lines joined by newlines; the hours
  log prints one per line. A day with several homes is **one** time block with all stops (his choice), not one entry per home.
- **BUILD INVOICE** (two taps) moves every finished entry onto a new Draft invoice (`inv.time`), one line
  "<hrLabel>, <date range> (<hours> hours)" with qty 1 and rate = the total, tax from `co.hrTax`. The tracker is then fresh.
  **The reset is tied to building the invoice, not to the calendar**, so late sends and forgotten entries never split or double-bill.
- Deleting that draft puts its hours back on the tracker (never lost). The company form never overwrites `co.time`.
- The invoice document for a time invoice shows Description + Amount only (no Qty/Rate columns) and an **Hours Log** table
  (`hoursLog`). Still one Letter page.
- No new storage key or sync channel: the fields ride on the existing `co:` / `inv:` records, so sync and backups carry them.
- He sends it himself on Thursdays (a reminder comes from elsewhere); the CRM does not auto-send.
- Tax is per company (`hrTax`).

## Documents (proposal, quote, change order, receipt)

- Proposal, quote and change order share one style: `ARC_DOC_CSS` + `ARC_DOC_HEAD` + `docShell()` in `index.html`. Change it there, not per document.
  Layout is locked: stone page edge to edge, 1.2pt Ink rule 0.25in in + 0.6pt #C97E78 rule inside it, content 0.6in in,
  signatures + footer pinned to the bottom, poppy bottom-right above the footer rule.
- Every document must print on **one US Letter page**. Check with a print render after any change. If content truly overflows,
  `ARC_DOC_PAGINATE` first tries About This Repair in the scope column, then `html.tight` (slightly smaller spacing), then moves whole blocks/bullets to page 2 (never splits a line item, the pricing card or signatures).
- Documents open in the inline preview (`openPreview`), which builds the PDF in the background so **Email** and **Save PDF** work in one tap.
  Both call `navigator.share({ files })` with the PDF only — any title/text makes iOS "Save to Files" add a stray .txt.
  **Email** = Orlando's original email, restored on purpose: after the PDF is saved it opens `mailto:` with To = customer email,
  subject "[Name], your Agency Roofing Co. proposal|repair quote|quote for [address] · [number]" and his message (`pvMail`).
  He attaches the PDF in Mail (⊕ → Attach File → Recents). If iOS blocks Mail opening after the share sheet, the button turns into
  OPEN EMAIL. Don't change the subject or message wording without asking him.
  PDF names: `ARC Proposal|Quote|Change Order|Receipt - [Last] - [number].pdf`.
  The receipt page (`receipt.html`) builds its own PDF from its print layout. Back from the receipt returns via `sessionStorage.arc_return`.
- Scope/notes text renders `**bold**` and drops markdown escapes (`richLine`).
- Terms on proposals: 30-day validity, 50% deposit on acceptance, balance on completion. Receipts carry a 5-year workmanship warranty.
- Repair / maintenance work: **no** 5-year warranty anywhere; the "About This Repair" text replaces the manufacturer-warranty term,
  and the customer must tick "I've read About This Repair." before signing. Repair proposals/quotes print a "☐ I've read About This
  Repair" box + Initials line directly above the signature row, checked when the customer ticked it in the app. Closing a repair job sets the next inspection +12 months.

## E-signatures and payments

- `ARCSign` (shared by both pages) = in-person signature pad: ink + printed name + consent checkbox required.
- Each signed item stores `sig: { customer, contractor, docId }`. `docId` fingerprints the scope and price. If they change, the signature no longer prints and the UI shows "Edited after signing". Keep this rule.
- Signing sets status: proposal → stage Signed, quote → Accepted, change order → Approved.
- **Online signing** (`supabase/sign.sql` + `sign.html` + the ONLINE SIGNING section in `index.html`, `rs*` functions):
  - Previewing an unsigned proposal/quote/change order while signed in to Cloud Sync makes (or reuses, same `docId`) a request in
    table **`arc_sign`**: 48-hex random token, `cid`, `kind` (proposal|quote|co), `item`, `num`, `doc_id`, `info` (customer-facing only:
    the document HTML, scope bullets, amount, terms, About This Repair + ack). Older open requests for that document are set `void`.
  - The email (`pvMail`) then says they can review and sign online and includes `sign.html#<token>`; without a link it keeps the
    original wording. Preview also has **SIGN ON THEIR PHONE** (QR + Text link + Copy) and so does each signature area.
  - The public page can't read the table (RLS, `anon` revoked). It only calls `arc_sign_get(token)` (also records views) and
    `arc_sign_submit(...)` (once; checks name, PNG, ack; server sets time + IP; `method: 'Signed online'`).
  - `rsPoll` (load, every 45 s, after sync, on return to the app) applies signed requests exactly like in-person signing
    (stage → Signed / Accepted / Approved, auto-countersign), logs it, shows a banner, then sets `applied = true`. It waits while
    that customer is being edited. If the document was edited after sending, the signature is saved but shows "Edited after signing".
  - When a returned signature moves the job (Signed / Accepted / Approved), `celebrate()` drops brand-color confetti from the top
    (canvas, ~4 s, no taps blocked, skipped with Reduce Motion). Orlando asked for it; only automatic moves trigger it, not in-person signing.
  - **Signed alerts + Drive copy (works with the CRM closed):** right after signing, `sign.html` fills the document's own
    signature block (`info.sigTpl`, made by `rsSigTemplate` from `docSigSection` with ⟦NAME⟧ ⟦IMG⟧ ⟦DAY⟧ ⟦STAMP⟧ ⟦IP⟧ blanks,
    swapped in between the `<!--arc-sig-->` markers in `docShell`), renders the signed PDF with html2canvas + jsPDF and saves it
    with `arc_sign_attach` (once, ≤30 min after signing); the customer also gets DOWNLOAD YOUR SIGNED COPY.
    `apps-script/SignedAlerts.gs` runs every minute in Orlando's Google account: reads `arc_sign_outbox(ARC_KEY)` (waits up to
    3 min for the PDF), files it in Drive › Agency Roofing › Customers › `info.driveFolder` (found by name: Apps Script can't see the
    CRM's appProperties), emails orlando.montanez@agencyroofingco.com from a no-reply agencyroofingco.com address with the PDF,
    then `arc_sign_notified`. ARC_KEY lives in `arc_secret` (no API access) and in the script's Script Properties, never in the repo.
  - Signing in person voids open links for that document (`rsVoid`). Nothing new is stored on the phone; requests live in Supabase.
  - `sign.html` contains a copy of `ARCSign` — keep it in step with `index.html`.
- Pay Online: Stripe Payment Link from Settings (or per-customer `payLink`). A QR code (bundled MIT `qrcode-generator`) prints on
  **payment invoices** (deposit due), billing invoices and receipts (balance due). **Never on proposals, quotes or change orders**
  (Nov 20 2026: he felt a pay box under the total read as "PAY NOW" before the customer had said yes). No QR on credits.

## Payment invoice (deposits) — Nov 20 2026. Three steps: Quote → Payment Invoice → Receipt

- **Promises Made** (`c.promises`, text, one per line): field in Scope of Work, and an "Any promises made?" sheet (`#pm-sheet`,
  `askPromises`) before a proposal/quote preview — only when that document is unsigned, once per document per visit (`sessionStorage`
  `arc_pm_<id>_<proposal|q:id>`). NO PROMISES = nothing prints. Promises print only on the payment invoice (and its receipt).
- **SEND PAYMENT INVOICE** (Payment Invoice section after Change Orders, `#dp-sheet`, `openDeposit`) unlocks when the proposal is signed
  (or the stage is Signed/In Production/Closed) or a quote is Accepted (`depTargets`). One per signed item by default.
- `c.deposits` = `[{ id, n, num 'ARC-00007-D1', target 'proposal'|'q:<quoteId>', base, pct, amount, synopsis, promises, date, sentAt, void,
  payments: [{ id, date, amount, method, ref, note, status: cleared|pending|bounced, at }] }]` (`normDeposit`). Both fields live in
  `arc_ext` (`extOf`/`applyExt`), so they sync with `c:<id>` and older versions never drop them.
- Deposit = **slider** (0–100 %, steps of 5) **or a typed amount** (any amount he's handed; the slider follows). Locked once a payment exists.
- Payments: Check (Check #, **pending until he ticks "cleared"**; still counts, marked pending), Cash, Card (online), ACH, Zelle, Financing,
  **Other (note required)**. Bounced checks don't count. Paid in full → the same document becomes the **Deposit Receipt** (stamp, payment
  lines, balance at completion, Orlando's signature). Delete only if never sent and no payments; otherwise Void (Restore undoes it).
- Document `depositDoc` (`docShell` + `BILL_DOC_CSS`, one Letter page): The Work (synopsis), Our Commitments to You (promises, only if any),
  Agency Promise (`AGENCY_PROMISE_HTML`, same text as the proposal), contract total, deposit %, due now + pay QR.
  Email via `openPreview({ ext })` to the customer, copy to him, PDF filed in the customer's Drive folder.
- **Final receipt** (`receipt.html`) subtracts deposits received: hidden `tDep` / `tDepL`, a green "Deposit Received (ARC-…-D1)" line,
  "Amount Paid" becomes "Final Payment", Balance = total − deposit − final payment. Old drafts (no `tDep`) are unchanged; the deposit joins
  the signature fingerprint only when there is one. A receipt draft saved before the deposit was recorded needs Start over to pick it up.
- Test: `python3 tests/deposit-invoice.test.py`.
- Not built yet (his list): Job Board flag for unpaid deposits after X days; automatic Stripe matching; cancellation policy wording (later).

## iPhone Safari rules (learned the hard way)

- Use `addEventListener`, not new inline `onclick` handlers.
- Do not depend on `window.open` — documents open in the inline preview (`openPreview`).
- Use `100dvh` for full-height screens; `env(safe-area-inset-*)` on fixed bars.
- No `alert` / `confirm` / `prompt`; use in-page modals or two-tap confirm buttons.

## Brand (locked — apply, never redesign)

- Colors: Stone `#EAE4DA`, Ink `#1C1A18`, Copper `#974930`, Mid `#C97E78`, Highlight `#F0C8C2`.
- Fonts: AGENCY in **Anton**; ROOFING CO. in **Bebas Neue**, letter-spaced, copper; tagline in **Lora Italic**; body in **Inter**.
- Tagline: "Built with agency. Driven by obligation."
- Shield mark: double hexagon, three-tone copper A, apex bead, **solid** base bar. Always paired with the wordmark on documents; full color; no background box behind it.

## Premium look + motion layer (Nov 13 2026) — restyle only, no feature or data changes

Orlando approved a design canvas and a motion demo, then asked for them built. The whole thing is a **layer on top**:
one `PREMIUM LAYER` CSS block at the end of the main `<style>` in `index.html` and `board.html` (inside `@media screen`, so printed
documents and PDFs are untouched) and one `PREMIUM LAYER` `<script>` at the end of each page. It reads and writes **no stored data**.

- **Stone is the main ground** (he finds it calming). Customers screen: full-color lockup + tagline on stone, the dark list rises
  below it as a rounded sheet (`#list-sheet`). Stage filter is tap chips (`#stage-chips`) that drive the original `#stage-select`,
  which stays in the page as the source of truth. Job Board / Inspections / Invoices are three tiles. New Customer floats at the bottom.
- **Export Backup, Settings, Import** are the same three `#sidebar-footer` controls, now a menu that rises when you tap the
  top-right button (`#btn-menu`). The old ⬇ ⬆ icon buttons are still in the page but hidden.
- Customer rows show the before-tax price (`priceOf(c, 0).sub`) and a stage pill (`sp-<stage>`); rows carry `data-id`.
- Customer file: name in Anton caps, `#pipeline` moved **inside `#form-area`** so it scrolls with the form (the name + SAVE stay
  pinned). Pipeline is a six-step bar (`.pip-seg`); Declined is shown as a state, not a step. NEXT reads "NEXT: SIGNED →".
  Form sections are white cards. Emoji were removed from button labels (text unchanged otherwise).
- **Topographic lines:** one faint top-right corner per screen: the customer list header, the customer file, and every dark pop-up header (`.xe-head::before`, Invoices, Hours, documents). Never more than that one corner. The Job Board keeps its own contour card. **Sandia ridge:** only on the Job Board
  greeting card. Do not add either anywhere else (he finds more too busy). Buttons stay flat copper, no metal sheen.
- **Motion** (flowing water: quick start, soft settle, `cubic-bezier(.22,1,.36,1)`, about half a second):
  phone only, the customer file glides in from the right over the list (`#main` is always `display:flex` now and slides with
  `transform`; `#sidebar.hidden` shifts back 28% and dims via `#list-dim`); the tapped name flows up into the title (`morphName`);
  cards ripple in; swipe right to go back (starts 24px+ from the edge so it never fights Safari's own back swipe; ignored on
  inputs, canvases/signature pads and anything that scrolls sideways); sheets and pop-ups rise; Job Board numbers count up;
  pages cross-fade (`@view-transition`). Nothing waits on an animation, and everything is skipped under Reduce Motion.
- **Collapsing header (Nov 18 2026):** the customers screen scrolls as one (`#side-scroll` wraps `#sidebar-header` + `#list-sheet`;
  `#wx-panel`, `#list-dim`, `#menu-scrim`, `#sidebar-footer` stay outside it). Scrolling up lifts and fades the lockup, the dark sheet rises
  under a slim stone bar (`#hd-mini`, outside the scroller: copied shield + wordmark, tap = back to top, its menu button opens the same
  menu) that fades in once the sheet reaches it (`#side-scroll.stuck`). `#search-wrap` pins right under that bar (sticky) with stone
  rounded corners so the sheet keeps its shape; New Customer (`#sidebar-actions`, sticky bottom) stays pinned. He wanted the list to
  disappear into a stone header so the contrast stays.
  New Customer sits on a **stone dock** at the bottom (rounded sheet corners above it) and is **polished rose-gold metal** (warm
  peach-copper bands with a specular line and a reflected bottom edge, dark text, copper edge; a soft glint passes right to left behind the
  letters every ~7 s, off under Reduce Motion) instead of copper, so the sheet is framed in stone top and bottom and Safari tints its bottom bar stone.
  He wants rose gold + stone as the cohesive theme on this screen; copper stays elsewhere.
  `#customer-list` no longer scrolls on its own. He found the fixed top block clunky.
- **Shield glint:** one band of light crosses the header shield **right to left**, once per browser session (`sessionStorage`
  `arc_glint`), then never again. The shield itself never moves. He wants it to "hold its ground".
- **Haptic taps: removed (Nov 13 2026).** Apple closed the scripted `<input switch>` trick in iOS 26.5, so it was silent on his
  phone. He chose to skip haptics. Do not re-add without asking; the only method left needs an invisible switch over every button.
- Not built, his call still open: "Dusk" dark variant (he said leave it for now).
- When adding screens or buttons, style them inside the layer and keep to these rules.

## Inspections screen (Nov 22 2026 polish)

- `renderInspections`: three counts on top (OVERDUE / NEXT 30 DAYS / LATER), the list shows only inspections due within 30 days
  (overdue first), everything later is tucked under a **COMING UP LATER** drawer (`<details>`, open state kept in `insLaterOpen`).
  Nothing due = an "All caught up" card with the next one up. Cards: status rail on the left, CALL (when there's a phone), CALENDAR,
  rose-gold MARK INSPECTED (two taps).
- Confirming turns the button green "✓ INSPECTED" and the card **falls away** (`insDropAway`: lift, drop + tilt + fade, gap closes,
  ~0.8 s; plain update under Reduce Motion), then the list re-renders and that customer sits in the later drawer a year out.
  `markInspected` itself is unchanged (same fields as before). He asked for it to keep the list clean and be fun.

## Weather watch (Nov 16 2026)

Minimal by request: an icon in the top-right corner (`#wx-btn`, today's icon + high), a 7-day panel on tap (`#wx-panel`), a banner
under the sync line (`#wx-banner`) **only** when a scheduled job (`scheddate` within 7 days, not Closed/Declined) has **≥ 40% rain or
gusts ≥ 25 mph between 6 AM and 8 PM** at the job's ZIP (city, then Albuquerque as fallback; ZIP table copied from board.html), and a
small note under the address on the customer file (`#wx-job`).
- Source: **National Weather Service** (`api.weather.gov`, free, no key, CORS). He chose NWS over AccuWeather because an AccuWeather key
  would be public in this repo. `/points` URLs cached forever (`arc_wx_pts`), forecasts for an hour (`arc_wx_cache`).
- The banner's X hides it until the warnings change (`arc_wx_hide`). Read-only: it never writes customer data.
- Not push notifications: real lock-screen alerts would need the home-screen app + a push service. Banner only for now.

## Six-month check-in calls + relationship notes (Nov 17 2026)

- Purpose: repeat business. Every **Closed** job gets a check-in phone call 6 months after it closed, then every 6 months after each
  logged call. **Declined jobs never get one.**
- Fields (in `normalize`, `extOf`/`applyExt`, so they live in `arc_ext` and survive older versions): `closedAt` (set by `stageNext` when
  a job reaches Closed; Closed jobs without it are backfilled on load from `completedAt`, else the last-edit date), `lastCheckIn`,
  `relNotes` (free-text "relationship builders": pets, family, last visit), `checkIns` `[{ d, n }]` newest first.
- Due = (`lastCheckIn` || `closedAt`) + 6 months. When due, `#ci-banner` drops down on the customer list (stone card, rose-gold border,
  topo corner) with name, last call / closed date, the first relationship line, and a CALL button (tel: link). Tap the name to open
  the customer at the **Relationship** section.
- **Thank-you letter** (Nov 18 2026): checkbox at the top of the Relationship section, "Thank-you letter sent" (he mails a letter
  with Agency stickers). Field `thankYou` = date it was ticked ('' = not sent), in `normalize`/`extOf`/`applyExt` (lives in `arc_ext`),
  saved with the form, logged in activity. The customer list shows a THANK-YOU SENT tag.
- Relationship section (customer file, above Next Follow-Up): the notes box, the next call date, LOG CHECK-IN CALL (asks how it went;
  can append that to the notes; logs activity; resets the 6-month clock), and the call history.

## Six-month thank-you email + Good Neighbors referral program (Nov 27 2026) — sends on its own

Orlando's choice: fully automatic from the CRM, no tap. One email per **Closed** job, 6 months after `closedAt` (else `completedAt`),
thanking them and introducing the **Good Neighbors Referral Program** ($15 local coffee gift card per referral who completes an
inspection or estimate; cash tiers by project size, total $15 / $65 / $115 / $165 / $215 / $265; rules in the fine print).

- `apps-script/SixMonthThanks.gs` = Apps Script project **ARC Six-Month Thanks** in orlando.montanez@agencyroofingco.com's Google
  account. Daily ~9 AM Denver (`setup`), up to `MAX_PER_DAY` (10). `sendTest` emails only him a sample + who's due; `stop` turns it off.
  Sends with `GmailApp` as him (lands in his Sent, replies come to him). Same ARC_KEY as Signed Alerts.
- `supabase/thanks.sql`: table `arc_thanks` (one row per customer once sent or failed; RLS owner read) + `arc_thanks_due(key)` /
  `arc_thanks_sent(...)`. Reads `arc_records` `c:` rows only, never writes them. Failed sends are recorded (no daily retry) and he
  gets one email listing them; delete the `arc_thanks` row to retry.
- Wording lives in `build_()`; Orlando approved the preview. Seasonal opening line by send date in `season_()` (Christmas, New Year,
  winter, spring winds, Fourth of July, monsoon, green chile, Balloon season, fall, Thanksgiving = 4th Thursday).
  **Always "Christmas", never "Happy Holidays"** (his rule). At most one exclamation mark, no dashes. Test: `node tests/six-month-thanks.test.js`.
- Nov 27 2026 rework (his ask: "a lot of info for an email", "add the branding colors and logo"): the email is now short
  (thanks, one question, the promise line, a dark Good Neighbors card with $15 / $265 and one **SEE HOW IT WORKS** button).
  The full program (tiers, steps, fine print, call/email buttons) lives on `good-neighbors.html`, a standalone public page
  (noindex, no CRM scripts, no localStorage). Keep the email under ~230 words.
- Header = `email/agency-lockup.png` (master SVG lockup rendered on stone, shield set a bit closer to AGENCY) + ink band with the
  tagline in Lora italic. Email clients can't show SVG, so keep the PNG. Brand: Stone #EAE4DA, Ink #1C1A18, Copper #974930,
  Mid #C97E78, Highlight #F0C8C2.
- CRM: **Six-month thank-you email** checkbox in the Relationship section (on by default). Off = `noThanksMail: true` (in `normalize`,
  `extOf`/`applyExt`, so it lives in `arc_ext` and syncs). He unticks it when a customer replies "no thanks". The line under it shows
  the date it goes out; the CRM doesn't know whether it already went (check Gmail Sent).
- `supabase/thanks.sql` was run in his Supabase on Nov 27 2026 (migration arc_six_month_thanks). The first customer email is due about May 6 2027.
- Before public launch his program sheet says to confirm NM regulatory, insurance and tax reporting requirements.

## Privacy and security rules (Nov 16 2026)

- **This repository is public.** Never put a real customer's or client's name, address, phone, email, job number, price, or any
  business arrangement in code, comments, tests or this file. Use made-up examples (Pat Sample, 123 Sample St NW, 555 numbers,
  example.com). He has real customers; a public slip is a real privacy problem.
- **Backups are not password-locked, by his choice** (Nov 16 2026: a password would slow him down). Don't add one without asking.
- Supabase tables use row-level security (owner = auth.uid()); the key in the code is the publishable one. Keep it that way.

## Testing before every push

- Playwright with Chromium at 390×844 (phone). Chromium is at `/opt/pw-browsers/chromium`.
- Paste-to-Sort parser unit tests: `node tests/sort-it.test.js`. Add a sample when you fix a parsing case.
- Receipt reader unit tests: `node tests/read-receipt.test.js` (text as Google returns it). Add a sample when you fix a case.
- Online signing: `python3 tests/online-sign.test.py` (fake Supabase + Gmail; needs html2canvas/jsPDF and the brand fonts served locally
  when cdnjs/Google Fonts are blocked — see the top of the file).
- Signed alerts (Apps Script with fake Gmail/Drive/Supabase): `node tests/signed-alerts.test.js`.
- Six-month thank-you email wording + seasonal lines: `node tests/six-month-thanks.test.js`.
- Run the flows you touched end to end, check there are zero JavaScript errors, and print-render each affected document to confirm it is still one page.
- Tell Orlando in one line what changed and what to tap on his phone to check it.

## Open to-dos

- Confirm the gross receipts tax rate; add the NM license number to documents once issued.
- Have an attorney review the warranty exclusions and e-signature consent wording.
- Signed alerts are LIVE (set up Nov 12 2026): `supabase/sign.sql` run in Supabase; Apps Script project **ARC Signed Alerts** in
  orlando.montanez@agencyroofingco.com's Google account, every-minute trigger on `checkSigned`, ARC_KEY in its Script Properties.
  Tested end to end (email from noreply@agencyroofingco.com + Drive filing). If the code changes, paste the new file into that project.
- Scheduled / automatic follow-up emails (no tap) run in Apps Script (Orlando's Google account), not the browser. The only one built
  is the six-month thank-you email below; everything else is still tap → review → Send.

## Customer forms sent through DocuSign

- `forms/insurance-repair-agreement.pdf` is the blank insurance repair agreement, served publicly at
  https://orlandobmontanez-cpu.github.io/arccrm/forms/insurance-repair-agreement.pdf so DocuSign can pull it (remoteUrl).
- `forms/insurance-repair-agreement.docusign.json` holds the tab layout (points, top-left origin). Always give text tabs
  an explicit `width`/`height` from that file; without them DocuSign shrinks them to a tiny square over the label.
- Send: Gerald-style envelope = customer signer (routing 1: text tabs on page 1, signHere + dateSigned on the Homeowner
  line, page 2) then Orlando `orlando.montanez@agencyroofingco.com` (routing 2: signHere + dateSigned on the contractor line).
  Pre-fill Homeowner, Email and Company Representative = "Orlando Montanez" as locked tabs.
