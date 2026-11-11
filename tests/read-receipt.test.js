// Unit tests for reading scanned receipts / supplier invoices (ReadReceipt in index.html).
// The text is what Google's text recognition returns for a scan. Run: node tests/read-receipt.test.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('/* READ-RECEIPT:BEGIN */')[1].split('/* READ-RECEIPT:END */')[0];
const ReadReceipt = new Function(src + '\nreturn ReadReceipt;')();

const cases = [
  {
    name: 'Home Depot store receipt',
    text: `THE HOME DEPOT
5550 Montgomery Blvd NE
Albuquerque, NM 87109 (505)889-0555
3509 00045 98327 11/03/26 07:42 AM
SALE SELF CHECKOUT
012871301563 HENRY 208 5G <A> 64.98
2@32.49
076174721058 TITEBOND SLNT <A> 23.94
6@3.99
051115010113 SIMPSON 1-5/8 <A> 12.47
SUBTOTAL 101.39
SALES TAX 7.41
TOTAL $108.80
XXXXXXXXXXXX4415 VISA USD$ 108.80
AUTH CODE 07734D/1047265 TA`,
    want: { vendor: 'The Home Depot', cat: 'materials', date: '2026-11-03', sub: 101.39, tax: 7.41, total: 108.80, items: 3, firstItem: 64.98 },
  },
  {
    name: 'ABC Supply invoice, columns split onto their own lines',
    text: `ABC SUPPLY CO., INC.
Branch 521 - Albuquerque
3711 Princeton Dr NE, Albuquerque, NM 87107
INVOICE
Invoice Number: 52144871
Invoice Date: 10/28/2026
Due Date: 11/27/2026
Sold To: AGENCY ROOFING CO LLC
Job Name: MONTANEZ
Qty Description Unit Price Extension
12 GAF EVERGUARD TPO 60 MIL 10X100 RL 412.00 4,944.00
4 GAF TPO BONDING ADHESIVE 5GL PL 189.50 758.00
2 GAF TPO PRIMED WALKWAY RL 245.00 490.00
Subtotal
6,192.00
Sales Tax
452.79
Invoice Total
6,644.79`,
    want: { vendor: 'ABC Supply', cat: 'materials', date: '2026-10-28', ref: '52144871', sub: 6192.00, tax: 452.79, total: 6644.79, items: 3, firstItem: 4944.00, firstQty: 12, firstDesc: 'GAF EVERGUARD TPO 60 MIL 10X100 RL' },
  },
  {
    name: "Lowe's receipt with savings and change lines",
    text: `LOWE'S HOME CENTERS, LLC
6800 4TH ST NW, LOS RANCHOS, NM 87107
SALE
TRANS: 1428  11-05-26
5402521 DEWALT 20V DRILL 99.00
YOU SAVED 30.00
1074213 KOBALT TAPE 25FT 14.98
SUBTOTAL: 113.98
TAX: 8.33
INVOICE 66291 TOTAL: 122.31
CASH: 140.00
CHANGE DUE: 17.69`,
    want: { vendor: "Lowe's", cat: 'materials', date: '2026-11-05', sub: 113.98, tax: 8.33, total: 122.31, items: 2 },
  },
  {
    name: 'Landfill ticket → Other',
    text: `CERRO COLORADO LANDFILL
City of Albuquerque Solid Waste
Ticket # 884512
Date: Nov 6, 2026
Vehicle: AGENCY F250
Inbound 8,420 lb  Outbound 6,110 lb
Net Tons 1.16
C&D Roofing Debris 1.16 TN @ 38.00 44.08
Total 44.08
Paid: Card`,
    want: { vendor: 'Cerro Colorado Landfill', cat: 'other', date: '2026-11-06', ref: '884512', total: 44.08, tax: 0 },
  },
  {
    name: 'Gas station → Other',
    text: `MAVERIK #401
2601 Rio Grande Blvd NW
11/07/2026 6:12 PM
PUMP # 7
DIESEL 24.312 G @ 3.899
FUEL TOTAL $94.79
TOTAL 94.79
DEBIT 94.79`,
    want: { vendor: 'Maverik', cat: 'other', date: '2026-11-07', total: 94.79 },
  },
  {
    name: 'Unknown local supplier, no subtotal line',
    text: `Rio Grande Sheet Metal
Custom flashing & gutters
Invoice # RG-2207
Date 11/02/26
Coping cap 24ga dark bronze 10' pcs 8 @ 41.50 332.00
Labor - bending 1 75.00
Gross Receipts Tax 30.33
Amount Due $437.33`,
    want: { vendor: 'Rio Grande Sheet Metal', cat: 'materials', date: '2026-11-02', ref: 'RG-2207', sub: 407.00, tax: 30.33, total: 437.33, items: 2, firstQty: 8 },
  },
  {
    name: 'Crew labor bill → Labor',
    text: `J. Archuleta Roofing Services
Invoice 1043
Date: 11/08/2026
Crew labor - tear off 2 days 1,600.00
Crew labor - TPO install 3 days 2,400.00
Total Due 4,000.00`,
    want: { vendor: 'J. Archuleta Roofing Services', cat: 'labor', date: '2026-11-08', ref: '1043', total: 4000.00, tax: 0, items: 2 },
  },
  {
    name: 'Nothing readable',
    text: `   \n  ~~ \n`,
    want: { vendor: '', total: null, items: 0 },
  },
];

let pass = 0, fail = 0;
cases.forEach(c => {
  const r = ReadReceipt.parse(c.text), w = c.want, bad = [];
  const eq = (k, a, b) => { if (b !== undefined && a !== b) bad.push(`${k}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
  eq('vendor', r.vendor, w.vendor); eq('cat', r.cat, w.cat); eq('date', r.date, w.date); eq('ref', r.ref, w.ref);
  eq('sub', r.sub, w.sub); eq('tax', r.tax, w.tax); eq('total', r.total, w.total);
  eq('items', r.items.length, w.items);
  if (w.firstItem !== undefined) eq('firstItem', r.items[0] && r.items[0].p, w.firstItem);
  if (w.firstQty !== undefined) eq('firstQty', r.items[0] && r.items[0].q, w.firstQty);
  if (w.firstDesc !== undefined) eq('firstDesc', r.items[0] && r.items[0].d, w.firstDesc);
  if (bad.length) { fail++; console.log('FAIL ' + c.name + '\n   ' + bad.join('\n   ') + '\n   items: ' + JSON.stringify(r.items)); }
  else pass++;
});
console.log(`${pass}/${cases.length} receipts read correctly`);
process.exit(fail ? 1 : 0);
