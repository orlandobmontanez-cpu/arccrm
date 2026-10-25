// Unit tests for Paste-to-Sort (SortIt in index.html).
// Run: node tests/sort-it.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('/* SORT-IT:BEGIN */')[1].split('/* SORT-IT:END */')[0];
const SortIt = new Function(src + '\nreturn SortIt;')();

const EMPTY = { first: '', last: '', phone: '', email: '', street: '', city: '', state: '', zip: '' };
const cases = [
  {
    name: 'one-line text with emoji, lowercase, "my name is"',
    text: 'Hi Orlando! 👋 My name is jeanette serna, I have a leak over my kitchen 😩 Address is 1234 montgomery blvd ne albuquerque nm 87111. Call me 505.555.0199 or JSerna@Gmail.com thanks!!',
    want: { first: 'Jeanette', last: 'Serna', phone: '(505) 555-0199', email: 'jserna@gmail.com', street: '1234 Montgomery Blvd NE', city: 'Albuquerque', state: 'NM', zip: '87111' },
  },
  {
    name: 'email with signature block and "Sent from my iPhone"',
    text: `Hello,

We have a flat roof that's leaking after the storm. Can someone come take a look?

Thanks,
Daniel Sandoval
4812 Montaño Rd NW
Albuquerque, NM 87120
(505) 555-0148
dsandoval@yahoo.com

Sent from my iPhone`,
    want: { first: 'Daniel', last: 'Sandoval', phone: '(505) 555-0148', email: 'dsandoval@yahoo.com', street: '4812 Montaño Rd NW', city: 'Albuquerque', state: 'NM', zip: '87120' },
  },
  {
    name: 'web form with labels, ALL CAPS name, unit, "New Mexico"',
    text: `Name: MARIA LOPEZ
Phone: 5055551234
Email: Maria.Lopez@Gmail.com
Address: 10512 lagrima de oro rd ne apt 3, Albuquerque, New Mexico 87111
Message: roof is ponding near the drain`,
    want: { first: 'Maria', last: 'Lopez', phone: '(505) 555-1234', email: 'maria.lopez@gmail.com', street: '10512 Lagrima de Oro Rd NE Apt 3', city: 'Albuquerque', state: 'NM', zip: '87111' },
  },
  {
    name: '+1 phone, #unit, no state, numbers that are not addresses',
    text: 'this is Rob from nextdoor 🙂 +1 (505) 321-7788. 2201 Central Ave SE #4B Albuquerque 87106. 2 story building, 20 years old roof',
    want: { first: 'Rob', last: '', phone: '(505) 321-7788', email: '', street: '2201 Central Ave SE #4B', city: 'Albuquerque', state: 'NM', zip: '87106' },
  },
  {
    name: 'couple, Rio Rancho, no state',
    text: `Hey there!
Tom & Linda Garcia
1600 sara rd se, rio rancho 87124
tom.garcia@comcast.net 505-891-2233`,
    want: { first: 'Tom & Linda', last: 'Garcia', phone: '(505) 891-2233', email: 'tom.garcia@comcast.net', street: '1600 Sara Rd SE', city: 'Rio Rancho', state: 'NM', zip: '87124' },
  },
  {
    name: 'Spanish street name, "ABQ", "my name\'s"',
    text: "Good afternoon, my name's Lupe Chavez. We're at 905 Calle del Ranchero NW in ABQ 87107. My cell is 505 400 1212.",
    want: { first: 'Lupe', last: 'Chavez', phone: '(505) 400-1212', email: '', street: '905 Calle del Ranchero NW', city: 'Albuquerque', state: 'NM', zip: '87107' },
  },
  {
    name: 'Last, First on its own line, multi-line address',
    text: `SERNA, JEANETTE
7400 Lomas Blvd NE
Albuquerque NM 87110
(505)555-0101`,
    want: { first: 'Jeanette', last: 'Serna', phone: '(505) 555-0101', email: '', street: '7400 Lomas Blvd NE', city: 'Albuquerque', state: 'NM', zip: '87110' },
  },
  {
    name: 'everything in caps on one line, suite',
    text: "PLEASE CALL BACK!!! JOHN O'BRIEN 505-555-7676 3300 SAN MATEO BLVD NE STE 200 ALBUQUERQUE NM 87110",
    want: { first: 'John', last: "O'Brien", phone: '(505) 555-7676', email: '', street: '3300 San Mateo Blvd NE Ste 200', city: 'Albuquerque', state: 'NM', zip: '87110' },
  },
  {
    name: 'ZIP+4, lowercase nm, nickname line before the real name',
    text: `hi, its mike t.
mike thompson
8800 holly ave ne albuquerque nm 87122-1234
mike.t@hotmail.com`,
    want: { first: 'Mike', last: 'Thompson', phone: '', email: 'mike.t@hotmail.com', street: '8800 Holly Ave NE', city: 'Albuquerque', state: 'NM', zip: '87122' },
  },
  {
    name: '7-digit local number, extension, no address',
    text: 'Jeanette Serna here. my number is 555-4321 ext 2, call after 5pm',
    want: { first: 'Jeanette', last: 'Serna', phone: '(505) 555-4321' },
  },
  {
    name: 'no street type, Corrales, comma-separated',
    text: 'Hello! Ana Martinez. 54 Camino de la Tierra, Corrales NM 87048. ana_m@icloud.com. text me at 5055550987 😊',
    want: { first: 'Ana', last: 'Martinez', phone: '(505) 555-0987', email: 'ana_m@icloud.com', street: '54 Camino de la Tierra', city: 'Corrales', state: 'NM', zip: '87048' },
  },
  {
    name: 'only name and phone',
    text: 'Jeanette Serna 505 555 0101',
    want: { first: 'Jeanette', last: 'Serna', phone: '(505) 555-0101' },
  },
  {
    name: 'nothing useful',
    text: '🔥🔥🔥 need roof asap!!!',
    want: {},
  },
  {
    name: 'sizes and counts are not addresses; "I\'m Carlos"',
    text: "We had 3 leaks and the roof is 1500 sq ft. I'm Carlos. 505-555-2020",
    want: { first: 'Carlos', phone: '(505) 555-2020' },
  },
  {
    name: 'unit on its own line',
    text: `Kim Nguyen
3700 Coors Blvd NW
Unit 12
Albuquerque, NM 87120
kim.nguyen@outlook.com`,
    want: { first: 'Kim', last: 'Nguyen', email: 'kim.nguyen@outlook.com', street: '3700 Coors Blvd NW Unit 12', city: 'Albuquerque', state: 'NM', zip: '87120' },
  },
  {
    name: 'Mr. honorific, middle initial, dotted phone, Los Lunas',
    text: `From: Mr. Robert J. Archuleta
Re: flat roof estimate
Property: 312 Main St. NW, Los Lunas, NM 87031
Phone 505.865.4410`,
    want: { first: 'Robert', last: 'Archuleta', phone: '(505) 865-4410', street: '312 Main St NW', city: 'Los Lunas', state: 'NM', zip: '87031' },
  },
  {
    name: 'compound last name, Santa Fe, Hi Orlando greeting',
    text: `Hi Orlando,
Maria de la Cruz
1500 Cerrillos Rd, Santa Fe, NM 87505
maria.delacruz@gmail.com`,
    want: { first: 'Maria', last: 'de la Cruz', email: 'maria.delacruz@gmail.com', street: '1500 Cerrillos Rd', city: 'Santa Fe', state: 'NM', zip: '87505' },
  },
  {
    name: 'numbered street (4th St), greeting + "I\'m"',
    text: "Hi I'm Dave, 1234 4th St SW, Albuquerque. call (505) 555 1212",
    want: { first: 'Dave', phone: '(505) 555-1212', street: '1234 4th St SW', city: 'Albuquerque', state: 'NM' },
  },
];

let failed = 0;
cases.forEach(c => {
  const got = SortIt.parse(c.text);
  const want = Object.assign({}, EMPTY, c.want);
  try {
    assert.deepStrictEqual(got, want);
    console.log('  ok   ' + c.name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + c.name);
    Object.keys(want).forEach(k => { if (got[k] !== want[k]) console.log(`         ${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want[k])}`); });
  }
});

// Street names are title-cased
assert.strictEqual(SortIt.titleCase('10512 LAGRIMA DE ORO RD NE'), '10512 Lagrima de Oro Rd NE');

console.log(`\n${cases.length - failed}/${cases.length} sample texts sorted correctly`);
process.exit(failed ? 1 : 0);
