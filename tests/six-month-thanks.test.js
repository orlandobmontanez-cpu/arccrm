// Six-month thank-you email (apps-script/SixMonthThanks.gs): wording, seasonal lines, Christmas rule, HTML safety.
// Run: node tests/six-month-thanks.test.js   (writes a sample to /tmp/six-month-thanks-sample.html)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build_, season_ } = require(path.join(__dirname, '..', 'apps-script', 'SixMonthThanks.gs'));

const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const cases = [
  ['2026-12-01', /^Merry Christmas!/], ['2026-12-25', /^Merry Christmas!/], ['2026-12-26', /Merry Christmas, and/],
  ['2027-01-02', /^Happy New Year! I hope 2027/], ['2027-01-20', /chilly/], ['2027-02-28', /chilly/],
  ['2027-04-10', /Spring winds/], ['2027-06-15', /Summer is here/], ['2027-07-04', /Fourth of July/],
  ['2027-07-20', /Monsoon/], ['2027-08-20', /Green chile/], ['2027-10-05', /Balloon season/], ['2027-10-20', /Fall has settled/],
  ['2026-11-26', /Thanksgiving gets close/], ['2026-11-27', /had a wonderful Thanksgiving/],   // Thanksgiving 2026 = Nov 26
  ['2027-11-25', /Thanksgiving gets close/], ['2027-11-26', /had a wonderful Thanksgiving/],   // Thanksgiving 2027 = Nov 25
];
for (const [day, re] of cases) assert.match(season_(d(day)), re, day + ': ' + season_(d(day)));

// Every day of a year: no "holiday" wording, at most one exclamation mark, no dashes
for (let t = d('2027-01-01'); t < d('2028-01-01'); t.setDate(t.getDate() + 1)) {
  const m = build_({ first: 'Pat', address: '123 Sample St NW', closed_at: '2026-06-01' }, new Date(t));
  for (const s of [m.text, m.html]) assert.ok(!/holiday/i.test(s), 'holiday wording on ' + t.toDateString());
  assert.ok((m.text.match(/!/g) || []).length <= 1, 'more than one ! on ' + t.toDateString());
  assert.ok(!/[–—]/.test(m.text), 'dash on ' + t.toDateString());
}

const m = build_({ first: 'Pat', address: '123 Sample St NW', closed_at: '2026-06-01' }, d('2026-12-10'));
assert.strictEqual(m.subject, 'Pat, thank you for trusting us');
assert.match(m.text, /finished your roof at 123 Sample St NW in June\./);
assert.match(m.text, /\$15,000 and up: \$265/);
assert.match(m.html, /INTRODUCE A NEIGHBOR/);

// No name, no address: still reads right
const bare = build_({ first: '', address: '', closed_at: '2026-06-01' }, d('2026-12-10'));
assert.strictEqual(bare.subject, 'Thank you for trusting us');
assert.match(bare.text, /^Thank you\.\n/);
assert.match(bare.text, /finished your roof in June\./);

// Customer text is escaped in the HTML
const x = build_({ first: '<b>Al</b>', address: '1 "A" & B St', closed_at: '2026-06-01' }, d('2027-03-01'));
assert.ok(!/<b>Al<\/b>/.test(x.html) && /&lt;b&gt;Al/.test(x.html) && /1 &quot;A&quot; &amp; B St/.test(x.html));

fs.writeFileSync('/tmp/six-month-thanks-sample.html', m.html);
console.log('six-month-thanks: all good');
