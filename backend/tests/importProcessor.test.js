// Unit tests for the import logic, using a fake in-memory database (no MySQL needed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ImportCancelledError, processRows } from '../src/services/importProcessor.js';

const mapping = { name: 0, email: 1, phone: 2, company: 3, group: null, address: null, notes: null, status: null };

/** A fake database that behaves like MySQL's unique email/phone constraints. */
function fakeDatabase({ existingEmails = [], existingPhones = [] } = {}) {
  const emails = new Set(existingEmails);
  const phones = new Set(existingPhones);
  const saved = [];
  const duplicateError = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });

  return {
    saved,
    emails,
    phones,
    async findExisting(emailList, phoneList) {
      return {
        emails: new Set(emailList.filter((email) => emails.has(email))),
        phones: new Set(phoneList.filter((phone) => phones.has(phone))),
      };
    },
    async insertMany(contacts) {
      if (contacts.some((c) => emails.has(c.email) || phones.has(c.phone))) throw duplicateError();
      for (const c of contacts) await this.insertOne(c);
    },
    async insertOne(contact) {
      if (emails.has(contact.email) || phones.has(contact.phone)) throw duplicateError();
      emails.add(contact.email);
      phones.add(contact.phone);
      saved.push(contact);
    },
  };
}

async function* toRows(list, firstRowNumber = 2) {
  let rowNumber = firstRowNumber;
  for (const cells of list) {
    yield { rowNumber, cells };
    rowNumber += 1;
  }
}

const sampleRows = [
  ['Asha Rao', 'asha@example.com', '+91 98765 00001', 'Acme'], // row 2  ok
  ['', 'noname@example.com', '9876500002', ''], //                  row 3  missing name
  ['Bad Email', 'bad-email', '9876500003', ''], //                  row 4  invalid email
  ['Bad Phone', 'phone@example.com', '12ab', ''], //                row 5  invalid phone
  ['', '', '', ''], //                                              row 6  blank - skipped
  ['Asha Again', 'ASHA@example.com', '9876500006', ''], //          row 7  email repeated (case-insensitive)
  ['Phone Again', 'other@example.com', '+919876500001', ''], //     row 8  phone repeated (after cleaning)
  ['Ravi Kumar', 'ravi@example.com', '9876500009', 'Globex'], //    row 9  ok
  ['Old Friend', 'old@example.com', '9876500010', ''], //           row 10 already in database
];

describe('processRows - checking only (save = false)', () => {
  it('finds every kind of problem and counts the good rows', async () => {
    const database = fakeDatabase({ existingEmails: ['old@example.com'] });
    const result = await processRows({ rows: toRows(sampleRows), mapping, save: false, database, batchSize: 3 });

    assert.equal(result.totalRows, 8, 'blank row is not counted');
    assert.equal(result.validRows, 2);
    assert.equal(result.inserted, 0);
    assert.equal(database.saved.length, 0, 'nothing is saved while checking');

    const byRow = Object.fromEntries(result.errors.map((error) => [error.rowNumber, error.messages.join(' | ')]));
    assert.deepEqual(Object.keys(byRow).map(Number), [3, 4, 5, 7, 8, 10], 'errors are sorted by row number');
    assert.match(byRow[3], /Name is required/);
    assert.match(byRow[4], /Email format is invalid/);
    assert.match(byRow[5], /Phone Number format is invalid/);
    assert.match(byRow[7], /Email is repeated in this file \(first used on row 2\)/);
    assert.match(byRow[8], /Phone Number is repeated in this file \(first used on row 2\)/);
    assert.match(byRow[10], /Email already exists in contacts/);
  });

  it('keeps the original values of bad rows for the error report', async () => {
    const result = await processRows({ rows: toRows(sampleRows), mapping, save: false, database: fakeDatabase() });
    const row4 = result.errors.find((error) => error.rowNumber === 4);
    assert.equal(row4.values.name, 'Bad Email');
    assert.equal(row4.values.email, 'bad-email');
  });

  it('reports several problems on the same row', async () => {
    const result = await processRows({
      rows: toRows([['', 'not-an-email', '12', '']]),
      mapping,
      save: false,
      database: fakeDatabase(),
    });
    assert.equal(result.errors[0].messages.length, 3);
  });
});

describe('processRows - importing (save = true)', () => {
  it('saves only the valid rows, cleaned up', async () => {
    const database = fakeDatabase({ existingEmails: ['old@example.com'] });
    const result = await processRows({ rows: toRows(sampleRows), mapping, save: true, database, batchSize: 2 });

    assert.equal(result.inserted, 2);
    assert.deepEqual(database.saved.map((c) => c.email), ['asha@example.com', 'ravi@example.com']);
    assert.equal(database.saved[0].phone, '+919876500001');
    assert.equal(database.saved[0].company, 'Acme');
    assert.equal(database.saved[0].group, null);
    assert.equal(database.saved[0].status, 'Active');
  });

  it('handles a contact that someone else saved during the import', async () => {
    const database = fakeDatabase();
    // Simulate another user adding ravi@example.com between the duplicate check and the insert
    const originalFind = database.findExisting.bind(database);
    database.findExisting = async (emails, phones) => {
      const answer = await originalFind(emails, phones);
      database.emails.add('ravi@example.com');
      return answer;
    };

    const rows = [
      ['Asha Rao', 'asha@example.com', '9876500001', ''],
      ['Ravi Kumar', 'ravi@example.com', '9876500009', ''],
    ];
    const result = await processRows({ rows: toRows(rows), mapping, save: true, database, batchSize: 10 });

    assert.equal(result.inserted, 1, 'the other row is still saved');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].rowNumber, 3);
    assert.match(result.errors[0].messages[0], /added to contacts by someone else/);
  });

  it('stops when the upload is cancelled', async () => {
    let calls = 0;
    await assert.rejects(
      processRows({
        rows: toRows(sampleRows),
        mapping,
        save: true,
        database: fakeDatabase(),
        isCancelled: () => (calls += 1) > 2,
      }),
      ImportCancelledError,
    );
  });

  it('copes with thousands of rows in many batches', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => [`Person ${i}`, `person${i}@example.com`, `+91${9000000000 + i}`, '']);
    const database = fakeDatabase();
    const result = await processRows({ rows: toRows(many), mapping, save: true, database, batchSize: 1000 });
    assert.equal(result.inserted, 5000);
    assert.equal(result.errors.length, 0);
  });
});
