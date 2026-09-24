# ARC CRM — Agency Roofing Co.

Custom CRM for **Agency Roofing Co. LLC**, a flat-roof specialty contractor in Albuquerque, NM.
Owner and only user: **Orlando Montanez**. He runs it from **Safari on his iPhone** in the field.

- Live site: https://orlandobmontanez-cpu.github.io/arccrm/ (GitHub Pages, deploys from `main` in about 60 seconds)
- The live app is `index.html` (must keep that exact name). `receipt.html` is the receipt page.
- `ARC CRM · Agency Roofing Co..html`, `ARC_CRM_LATEST.html`, `arc_crm_v4_index_1.html`, `current_arc_crm_v4_index.html` are old copies. Do not edit or delete them unless asked.
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

- Everything is plain HTML/CSS/JS in single files. **No build step, no frameworks, no external JS.** The only outside resource is Google Fonts.
- Data lives in the phone's browser `localStorage` (per device, same origin as the site):
  - `arc_v3` — array of customer records (the whole CRM)
  - `arc_settings` — `{ payLink, showPay, autoCountersign }`
  - `arc_owner_sig` — Orlando's saved signature `{ name, img (PNG data URL), at }`
  - `arc_receipt_<customerId>` — receipt drafts
- `normalize(c)` whitelists customer fields. **Any new field must be added there**, or it is silently dropped on load. Same for `normQuote` / `normCO`.
- Never break existing records: old data must load unchanged. Import/Export backups are a JSON array of customers.
- Pipeline stages: Lead → Inspected → Proposed → Signed → In Production → Closed (+ Declined).
- Numbering: customers `ARC-00007`; additional quotes `ARC-00007-Q2…` (Q1 = main proposal); change orders `ARC-00007-CO1…`; receipts `ARC-00007-R`.
- Pricing: materials + labor + other, plus margin % = customer price; discount applied pre-tax; NM gross receipts tax `TAX_RATE = 0.073125`.
- **Internal cost, labor, and margin are never shown on anything customer-facing.** Customers see price, discount, tax, total only.
- `save()` catches storage-full errors and warns. Signatures are images (~17 KB each); keep them small.

## Documents (proposal, quote, change order, receipt)

- Proposal, quote and change order share one style: `ARC_DOC_CSS` + `ARC_DOC_HEAD` in `index.html`. Change it there, not per document.
- Every document must print on **one US Letter page**. Check with a print render after any change.
- Documents open with `openDoc(html)`: new tab if allowed, otherwise the same tab (iPhone). Back returns to the customer via `sessionStorage.arc_return`.
- Terms on proposals: 30-day validity, 50% deposit on acceptance, balance on completion. Receipts carry a 5-year workmanship warranty.

## E-signatures and payments

- `ARCSign` (shared by both pages) = in-person signature pad: ink + printed name + consent checkbox required.
- Each signed item stores `sig: { customer, contractor, docId }`. `docId` fingerprints the scope and price. If they change, the signature no longer prints and the UI shows "Edited after signing". Keep this rule.
- Signing sets status: proposal → stage Signed, quote → Accepted, change order → Approved.
- Pay Online: Stripe Payment Link from Settings (or per-customer `payLink`). A QR code (bundled MIT `qrcode-generator`) prints for the 50% deposit, change order amount, or receipt balance due. No QR on credits.

## iPhone Safari rules (learned the hard way)

- Use `addEventListener`, not new inline `onclick` handlers.
- Do not depend on `window.open` — use `openDoc`.
- Use `100dvh` for full-height screens; `env(safe-area-inset-*)` on fixed bars.
- No `alert` / `confirm` / `prompt`; use in-page modals or two-tap confirm buttons.

## Brand (locked — apply, never redesign)

- Colors: Stone `#EAE4DA`, Ink `#1C1A18`, Copper `#974930`, Mid `#C97E78`, Highlight `#F0C8C2`.
- Fonts: AGENCY in **Anton**; ROOFING CO. in **Bebas Neue**, letter-spaced, copper; tagline in **Lora Italic**; body in **Inter**.
- Tagline: "Built with agency. Driven by obligation."
- Shield mark: double hexagon, three-tone copper A, apex bead, **solid** base bar. Always paired with the wordmark on documents; full color; no background box behind it.

## Testing before every push

- Playwright with Chromium at 390×844 (phone). Chromium is at `/opt/pw-browsers/chromium`.
- Run the flows you touched end to end, check there are zero JavaScript errors, and print-render each affected document to confirm it is still one page.
- Tell Orlando in one line what changed and what to tap on his phone to check it.

## Open to-dos

- Confirm the gross receipts tax rate; add the NM license number to documents once issued.
- Have an attorney review the warranty exclusions and e-signature consent wording.
- Remote (not in-person) signing and multi-device sync need a cloud database — planned move to Supabase.
