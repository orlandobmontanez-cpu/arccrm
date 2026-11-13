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
  When `compose` gets `signUrl` and the message still contains that link, the body is multipart/alternative: the plain text
  plus an HTML copy (`htmlBody`) where the link line becomes a copper **REVIEW & SIGN ONLINE** button.
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
  `ReadReceipt.parse` (between `READ-RECEIPT` markers) fills the form, Orlando checks and saves. On save the scan is renamed
  `YYYY-MM-DD · Vendor · $Total · ARC-00007.ext` and its Drive description holds the full record (`driveRecord`).
  Every change rewrites the **Agency Roofing Expenses** Google Sheet from the CRM (`expenseCsv`, formula-safe); its link is
  `settings.expSheet`. Offline/no Google pass: saved in the CRM with `driveStale`, Drive catches up on the next connect.
  Cancelling a new scan or deleting an expense moves the scan to Drive trash.

## Invoices (billing roofing companies) — Invoices screen in `index.html` (`#inv-sheet`, button under Job Board)

- Companies (name, contact, billing email, extra CC, address, default terms, **NTTC on file**, private notes) and invoices.
- Numbers `INV-1001`, `INV-1002`… from `billing.seq` (starts 1000). A number is used up the moment an invoice is created:
  a never-sent draft can be deleted, a sent invoice can only be **voided**; numbers never repeat. Two devices offline can
  hand out the same number: on load the later never-sent draft is renumbered (`loadBilling`).
- Line items (description, qty × rate), every amount editable. Tax switch per invoice (on by default, off for NTTC
  companies), rate from the tax city via `ARCSign.cityRate`. Statuses: Draft, Sent, Partly paid, Paid, Overdue (past due
  with a balance), Void (`invCalc`). Payments `{ n, date, amount, method, ref }`; each has a receipt `INV-1001-R<n>`.
- Invoice and receipt documents use `docShell` + `BILL_DOC_CSS` (one Letter page; Pay Online QR for the balance).
  Line items ARE shown on invoices (these are billed prices, not internal costs).
- Email through the same `ARCMail.compose` panel via `openPreview({ ext })`: To = billing email, CC = company CC,
  **"Send a copy to me" (Bcc orlando.montanez@agencyroofingco.com) on by default**. PDF also filed in Drive:
  Agency Roofing / Invoices / <Company> (tags `invoices`, `ico:<companyId>`).
- Syncs through table `arc_docs` (`supabase/docs.sql`): `co:<id>`, `inv:<id>`, `billing-seq` (merged as max). The channel
  only touches keys it owns (`billOwns`), so new record types can be added to `arc_docs` later without older versions
  deleting them — keep that rule (add an `owns` filter for any new channel).

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
- Pay Online: Stripe Payment Link from Settings (or per-customer `payLink`). A QR code (bundled MIT `qrcode-generator`) prints for the 50% deposit, change order amount, or receipt balance due. No QR on credits.

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

## Testing before every push

- Playwright with Chromium at 390×844 (phone). Chromium is at `/opt/pw-browsers/chromium`.
- Paste-to-Sort parser unit tests: `node tests/sort-it.test.js`. Add a sample when you fix a parsing case.
- Receipt reader unit tests: `node tests/read-receipt.test.js` (text as Google returns it). Add a sample when you fix a case.
- Online signing: `python3 tests/online-sign.test.py` (fake Supabase + Gmail; needs html2canvas/jsPDF and the brand fonts served locally
  when cdnjs/Google Fonts are blocked — see the top of the file).
- Signed alerts (Apps Script with fake Gmail/Drive/Supabase): `node tests/signed-alerts.test.js`.
- Run the flows you touched end to end, check there are zero JavaScript errors, and print-render each affected document to confirm it is still one page.
- Tell Orlando in one line what changed and what to tap on his phone to check it.

## Open to-dos

- Confirm the gross receipts tax rate; add the NM license number to documents once issued.
- Have an attorney review the warranty exclusions and e-signature consent wording.
- Signed alerts need the one-time Apps Script setup (steps at the top of `apps-script/SignedAlerts.gs`).
- Scheduled / automatic follow-up emails (no tap) would need server-side sending (Supabase Edge Function + stored Google
  refresh token). Not built; current sending is tap → review → Send from the browser.

## Customer forms sent through DocuSign

- `forms/insurance-repair-agreement.pdf` is the blank insurance repair agreement, served publicly at
  https://orlandobmontanez-cpu.github.io/arccrm/forms/insurance-repair-agreement.pdf so DocuSign can pull it (remoteUrl).
- `forms/insurance-repair-agreement.docusign.json` holds the tab layout (points, top-left origin). Always give text tabs
  an explicit `width`/`height` from that file; without them DocuSign shrinks them to a tiny square over the label.
- Send: Gerald-style envelope = customer signer (routing 1: text tabs on page 1, signHere + dateSigned on the Homeowner
  line, page 2) then Orlando `orlando.montanez@agencyroofingco.com` (routing 2: signHere + dateSigned on the contractor line).
  Pre-fill Homeowner, Email and Company Representative = "Orlando Montanez" as locked tabs.
