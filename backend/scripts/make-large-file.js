// Creates a BIG Excel file for testing large uploads (50 MB+).
//
//   npm run samples                -> 1,000,000 rows (about 65 MB)
//   npm run samples -- 200000      -> 200,000 rows
//
// About 1 row in 500 is deliberately broken (bad email, missing phone, repeated email)
// so you can also see the error list and the error report on a big file.
// The file is written to ../samples/contacts-large.xlsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const MAX_EXCEL_ROWS = 1048575; // Excel's limit (1,048,576 rows including the header)
const rowCount = Math.min(Number(process.argv[2]) || 1000000, MAX_EXCEL_ROWS);

const samplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
const outputFile = path.join(samplesDir, 'contacts-large.xlsx');

const firstNames = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Kabir', 'Meera', 'Arjun', 'Sara', 'John', 'Emma', 'Liam', 'Olivia', 'Noah'];
const lastNames = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Khan', 'Singh', 'Das', 'Nair', 'Smith', 'Brown', 'Wilson', 'Taylor'];
const companies = ['Acme Ltd', 'Globex', 'Initech', 'Umbrella Corp', 'Stark Industries', 'Wayne Enterprises', 'Hooli', 'Soylent'];
const groups = ['Friends', 'Family', 'Work', 'Clients', 'Vendors'];
const places = ['Pune, Maharashtra', 'Mumbai, Maharashtra', 'Bengaluru, Karnataka', 'Delhi', 'Raipur, Chhattisgarh', 'Lucknow, Uttar Pradesh', 'Durg, Chhattisgarh', 'Hyderabad, Telangana'];
const streets = ['MG Road', 'Station Road', 'Civil Lines', 'Park Street', 'Main Bazaar', 'Nehru Nagar'];
const words = ['met', 'at', 'conference', 'follow', 'up', 'next', 'quarter', 'interested', 'in', 'demo', 'call', 'back', 'prefers', 'email', 'renewal', 'due'];

// Small predictable random number generator (mulberry32), so every run makes the same file
let seed = 42;
function random(max) {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) % max);
}
const pick = (list) => list[random(list.length)];
const token = (length) => Array.from({ length }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[random(36)]).join('');

async function main() {
  fs.mkdirSync(samplesDir, { recursive: true });
  console.log(`Writing ${rowCount.toLocaleString()} rows to ${outputFile} ...`);
  const started = Date.now();

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outputFile, useStyles: false, useSharedStrings: false });
  const sheet = workbook.addWorksheet('Contacts');
  sheet.addRow(['Name', 'Email', 'Phone Number', 'Group', 'Company', 'Address', 'Notes', 'Status']).commit();

  for (let i = 1; i <= rowCount; i += 1) {
    let email = `user${i}.${pick(lastNames).toLowerCase()}@example${random(5000)}.com`;
    let phone = `+91 ${9000000000 + i}`;

    if (i % 500 === 0) email = `broken-email-${i}`; //                    invalid email
    if (i % 777 === 0) phone = ''; //                                     missing phone
    if (i % 1009 === 0) email = `repeat${i}@example.com`; //              this email...
    if (i % 1009 === 1 && i > 1) email = `repeat${i - 1}@example.com`; // ...appears again on the next row

    const notes = `${Array.from({ length: 8 + random(9) }, () => pick(words)).join(' ')} (ref ${token(24)})`;
    const address = `${1 + random(999)}, ${pick(streets)}, ${pick(places)}`;
    const status = random(10) === 0 ? 'Inactive' : 'Active';
    sheet.addRow([`${pick(firstNames)} ${pick(lastNames)}`, email, phone, pick(groups), pick(companies), address, notes, status]).commit();

    if (i % 100000 === 0) console.log(`  ${i.toLocaleString()} rows written`);
  }

  await sheet.commit();
  await workbook.commit();

  const sizeMb = fs.statSync(outputFile).size / (1024 * 1024);
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s. File size: ${sizeMb.toFixed(1)} MB`);
  if (sizeMb < 50) console.log('Tip: the file is under 50 MB - run again with more rows, e.g. npm run samples -- 1048575');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
