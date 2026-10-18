// API tests for the Excel / CSV import: file format checks, column mapping,
// row validation, error report, import, duplicates and big files.
// Needs MySQL running and backend/.env filled in. Uses the "contact_book_test" database.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearContacts,
  createContacts,
  fileForm,
  makeClient,
  makeXls,
  makeXlsx,
  readXlsx,
  startTestServer,
  waitForUpload,
} from './helpers.js';

let server;
let api;

before(async () => {
  server = await startTestServer();
  api = makeClient(server.baseUrl);
});

after(async () => {
  await server.stop();
});

beforeEach(async () => {
  await clearContacts();
});

const header = ['Full Name', 'E-mail', 'Mobile No', 'Company', 'Group'];

// Row numbers in the comments are Excel row numbers (row 1 = header)
const mixedRows = [
  header,
  ['Asha Rao', 'asha@example.com', '+91 98765 00001', 'Acme', 'Friends'], //   2 ok
  ['', 'noname@example.com', '9876500002', '', ''], //                      3 missing name
  ['No Email', '', '9876500003', '', ''], //                                4 missing email
  ['No Phone', 'nophone@example.com', '', '', ''], //                      5 missing phone
  ['Bad Email', 'bad@', '9876500006', '', ''], //                           6 invalid email
  ['Bad Phone', 'badphone@example.com', '98-76', '', ''], //               7 invalid phone
  ['Asha Copy', 'Asha@Example.com', '9876500008', '', ''], //               8 email repeated in file
  ['Ravi Kumar', 'ravi@example.com', 9876500009, 'Globex', 'Work'], //     9 ok (phone stored as a number)
];

/** Uploads a file and waits until it has been read. */
async function uploadFile(content, fileName) {
  const response = await api.post('/contacts/upload', fileForm(content, fileName));
  if (response.status !== 201) return response;
  const ready = await waitForUpload(api, response.data.id, ['ready']);
  return { status: response.status, data: ready };
}

async function validate(uploadId, mapping) {
  const response = await api.post(`/contacts/upload/${uploadId}/validate`, { mapping });
  if (response.status !== 200) return response;
  return { status: 200, data: await waitForUpload(api, uploadId, ['validated']) };
}

async function importRows(uploadId) {
  const response = await api.post(`/contacts/upload/${uploadId}/import`);
  if (response.status !== 200) return response;
  return { status: 200, data: await waitForUpload(api, uploadId, ['completed']) };
}

// ---------------------------------------------------------------------------
describe('file format checks', () => {
  it('rejects a text file renamed to .xls', async () => {
    const { status, data } = await api.post('/contacts/upload', fileForm('just some text', 'contacts.xls'));
    assert.equal(status, 415);
    assert.match(data.message, /not a real Excel file/);
  });

  it('rejects other file types', async () => {
    for (const name of ['contacts.pdf', 'contacts.txt', 'contacts']) {
      const { status } = await api.post('/contacts/upload', fileForm('hello', name));
      assert.equal(status, 415, name);
    }
  });

  it('rejects a text file renamed to .xlsx', async () => {
    const { status, data } = await api.post('/contacts/upload', fileForm('Name,Email\nA,b@c.com', 'renamed.xlsx'));
    assert.equal(status, 415);
    assert.match(data.message, /not a real Excel file/);
  });

  it('rejects an empty file', async () => {
    const { status } = await api.post('/contacts/upload', fileForm('', 'empty.csv'));
    assert.equal(status, 400);
  });

  it('rejects a request without a file', async () => {
    const { status } = await api.post('/contacts/upload', new FormData());
    assert.equal(status, 400);
  });

  it('rejects a file over the size limit (test limit = 5 MB)', async () => {
    const big = 'a'.repeat(6 * 1024 * 1024);
    const { status, data } = await api.post('/contacts/upload', fileForm(big, 'big.csv'));
    assert.equal(status, 413);
    assert.match(data.message, /5 MB/);
  });

  it('reports a damaged .xlsx file', async () => {
    // Starts like a ZIP file but is not a real workbook
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
    const response = await api.post('/contacts/upload', fileForm(broken, 'broken.xlsx'));
    assert.equal(response.status, 201);
    const final = await waitForUpload(api, response.data.id, ['ready']);
    assert.equal(final.status, 'failed');
    assert.match(final.message, /Could not read this file|empty or damaged/);
  });

  it('reports a file with headers but no rows', async () => {
    const { data } = await uploadFile(await makeXlsx([header]), 'only-header.xlsx');
    assert.equal(data.status, 'failed');
    assert.match(data.message, /no contact rows/);
  });
});

// ---------------------------------------------------------------------------
describe('reading headers and suggesting the column mapping', () => {
  it('finds the headers and guesses the mapping', async () => {
    const { status, data } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    assert.equal(status, 201);
    assert.equal(data.status, 'ready');
    assert.equal(data.dataRowCount, 8);
    assert.deepEqual(data.headers.map((h) => h.label), header);
    assert.deepEqual(
      { name: data.suggestedMapping.name, email: data.suggestedMapping.email, phone: data.suggestedMapping.phone, company: data.suggestedMapping.company, group: data.suggestedMapping.group, status: data.suggestedMapping.status },
      { name: 0, email: 1, phone: 2, company: 3, group: 4, status: null },
    );
  });

  it('skips empty rows above the header', async () => {
    const { data } = await uploadFile(await makeXlsx([[], [], ...mixedRows]), 'gap.xlsx');
    assert.equal(data.status, 'ready');
    assert.equal(data.headers[0].label, 'Full Name');
  });

  it('refuses a mapping without the required fields', async () => {
    const { data } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const response = await api.post(`/contacts/upload/${data.id}/validate`, { mapping: { name: 0, email: 1 } });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, 'INVALID_MAPPING');
    assert.match(response.data.message, /Phone Number/);
  });
});

// ---------------------------------------------------------------------------
describe('checking rows before import', () => {
  it('lists every invalid row with the reason', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const { data } = await validate(upload.id, upload.suggestedMapping);

    assert.equal(data.status, 'validated');
    assert.deepEqual(data.summary, { totalRows: 8, validRows: 2, invalidRows: 6, inserted: 0 });

    const errors = await api.get(`/contacts/upload/${upload.id}/errors?page=1&limit=50`);
    const byRow = Object.fromEntries(errors.data.data.map((e) => [e.rowNumber, e.messages.join(' | ')]));
    assert.deepEqual(Object.keys(byRow).map(Number), [3, 4, 5, 6, 7, 8]);
    assert.match(byRow[3], /Name is required/);
    assert.match(byRow[4], /Email is required/);
    assert.match(byRow[5], /Phone Number is required/);
    assert.match(byRow[6], /Email format is invalid/);
    assert.match(byRow[7], /Phone Number format is invalid/);
    assert.match(byRow[8], /repeated in this file \(first used on row 2\)/);
  });

  it('pages through the error list', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    await validate(upload.id, upload.suggestedMapping);
    const page2 = await api.get(`/contacts/upload/${upload.id}/errors?page=2&limit=4`);
    assert.equal(page2.data.data.length, 2);
    assert.deepEqual(page2.data.pagination, { page: 2, limit: 4, total: 6, totalPages: 2 });
  });

  it('flags rows that already exist in the database', async () => {
    await createContacts(api, [{ name: 'Old Ravi', email: 'ravi@example.com', phone: '9000000000' }]);
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const { data } = await validate(upload.id, upload.suggestedMapping);
    assert.equal(data.summary.validRows, 1);
    const errors = await api.get(`/contacts/upload/${upload.id}/errors?limit=50`);
    const row9 = errors.data.data.find((e) => e.rowNumber === 9);
    assert.match(row9.messages.join(' '), /Email already exists in contacts/);
  });

  it('does not save anything while checking', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    await validate(upload.id, upload.suggestedMapping);
    const list = await api.get('/contacts');
    assert.equal(list.data.pagination.total, 0);
  });

  it('will not import before the rows have been checked', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const response = await api.post(`/contacts/upload/${upload.id}/import`);
    assert.equal(response.status, 409);
  });

  it('offers the invalid rows as a downloadable Excel report', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const early = await api.get(`/contacts/upload/${upload.id}/error-report`);
    assert.equal(early.status, 409, 'not available before checking');

    await validate(upload.id, upload.suggestedMapping);
    const report = await api.get(`/contacts/upload/${upload.id}/error-report`);
    assert.equal(report.status, 200);
    assert.match(report.headers.get('content-disposition'), /contacts-errors\.xlsx/);

    const rows = await readXlsx(report.data);
    assert.deepEqual(rows[0], ['Row Number', 'Name', 'Email', 'Phone Number', 'Group', 'Company', 'Problems']);
    assert.equal(rows.length, 7); // header + 6 bad rows
    assert.equal(rows[1][0], 3);
    assert.match(String(rows[1][6]), /Name is required/);
  });
});

// ---------------------------------------------------------------------------
describe('importing', () => {
  it('saves only the valid rows', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    await validate(upload.id, upload.suggestedMapping);
    const { status, data } = await importRows(upload.id);

    assert.equal(status, 200);
    assert.equal(data.status, 'completed');
    assert.equal(data.summary.inserted, 2);

    const list = await api.get('/contacts?sortBy=name&sortOrder=asc');
    assert.deepEqual(list.data.data.map((c) => [c.name, c.email, c.phone, c.company, c.group, c.status]), [
      ['Asha Rao', 'asha@example.com', '+919876500001', 'Acme', 'Friends', 'Active'],
      ['Ravi Kumar', 'ravi@example.com', '9876500009', 'Globex', 'Work', 'Active'],
    ]);
  });

  it('cannot import the same upload twice', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    await validate(upload.id, upload.suggestedMapping);
    await importRows(upload.id);
    const again = await api.post(`/contacts/upload/${upload.id}/import`);
    assert.equal(again.status, 409);
  });

  it('uploading the same file again finds only duplicates', async () => {
    const file = await makeXlsx(mixedRows);
    const first = await uploadFile(file, 'contacts.xlsx');
    await validate(first.data.id, first.data.suggestedMapping);
    await importRows(first.data.id);

    const second = await uploadFile(file, 'contacts.xlsx');
    const { data } = await validate(second.data.id, second.data.suggestedMapping);
    assert.equal(data.summary.validRows, 0);

    const response = await api.post(`/contacts/upload/${second.data.id}/import`);
    assert.equal(response.status, 400, 'nothing valid to import');
  });

  it('reads links, formulas and number cells as text', async () => {
    const file = await makeXlsx(
      [
        ['Name', 'Email', 'Phone'],
        ['Link Person', '', '9811111111'],
        ['Formula Person', '', 919822222222],
      ],
      (sheet) => {
        sheet.getCell('B2').value = { text: 'link@example.com', hyperlink: 'mailto:link@example.com' };
        sheet.getCell('B3').value = { formula: 'LOWER("FORMULA@EXAMPLE.COM")', result: 'formula@example.com' };
      },
    );
    const { data: upload } = await uploadFile(file, 'special.xlsx');
    await validate(upload.id, upload.suggestedMapping);
    const { data } = await importRows(upload.id);
    assert.equal(data.summary.inserted, 2);

    const list = await api.get('/contacts?sortBy=name&sortOrder=asc');
    assert.deepEqual(list.data.data.map((c) => [c.email, c.phone]), [
      ['formula@example.com', '919822222222'],
      ['link@example.com', '9811111111'],
    ]);
  });

  it('imports an old .xls file', async () => {
    const file = makeXls([
      ['Name', 'Email', 'Phone', 'Status'],
      ['Old Format', 'old.format@example.com', 9811112222, 'inactive'],
      ['Bad Row', 'bad', '1', ''],
    ]);
    const { data: upload } = await uploadFile(file, 'legacy.xls');
    assert.equal(upload.status, 'ready');
    const { data: checked } = await validate(upload.id, upload.suggestedMapping);
    assert.deepEqual(checked.summary, { totalRows: 2, validRows: 1, invalidRows: 1, inserted: 0 });
    const { data } = await importRows(upload.id);
    assert.equal(data.summary.inserted, 1);

    const list = await api.get('/contacts');
    assert.equal(list.data.data[0].email, 'old.format@example.com');
    assert.equal(list.data.data[0].status, 'Inactive');
  });

  it('rejects rows with an unknown status', async () => {
    const csv = 'Name,Email,Phone,Status\nA,a@example.com,9876500001,Deleted\n';
    const { data: upload } = await uploadFile(csv, 'status.csv');
    const { data } = await validate(upload.id, upload.suggestedMapping);
    assert.equal(data.summary.invalidRows, 1);
    const errors = await api.get(`/contacts/upload/${upload.id}/errors`);
    assert.match(errors.data.data[0].messages[0], /Active or Inactive/);
  });

  it('imports a CSV file (with BOM, quotes and commas inside values)', async () => {
    const csv = '﻿Name,Email,Phone,Company\n"Rao, Asha",asha@example.com,9876500001,"Acme, Inc."\nRavi,ravi@example.com,9876500002,\n';
    const { data: upload } = await uploadFile(csv, 'contacts.csv');
    assert.equal(upload.headers[0].label, 'Name', 'the BOM is not part of the first header');
    await validate(upload.id, upload.suggestedMapping);
    const { data } = await importRows(upload.id);
    assert.equal(data.summary.inserted, 2);

    const list = await api.get('/contacts?search=Asha');
    assert.equal(list.data.data[0].name, 'Rao, Asha');
    assert.equal(list.data.data[0].company, 'Acme, Inc.');
  });

  it('imports 20,000 rows in batches', async () => {
    const lines = ['Name,Email,Phone'];
    for (let i = 0; i < 20000; i += 1) lines.push(`Person ${i},person${i}@example.com,+91${9000000000 + i}`);
    const { data: upload } = await uploadFile(lines.join('\n'), 'many.csv');
    assert.equal(upload.dataRowCount, 20000);

    await validate(upload.id, upload.suggestedMapping);
    const { data } = await importRows(upload.id);
    assert.equal(data.summary.inserted, 20000);
    assert.equal(data.progress.percent, 100);

    const list = await api.get('/contacts?limit=1');
    assert.equal(list.data.pagination.total, 20000);
  });
});

// ---------------------------------------------------------------------------
describe('one-step upload: POST /api/contacts/upload validates AND stores', () => {
  it('saves the valid rows and returns the invalid ones in the same request', async () => {
    const form = fileForm(await makeXlsx(mixedRows), 'contacts.xlsx');
    form.append('mode', 'import');
    const { status, data } = await api.post('/contacts/upload', form);
    assert.equal(status, 201);
    assert.equal(data.status, 'completed');
    assert.deepEqual(data.summary, { totalRows: 8, validRows: 2, invalidRows: 6, inserted: 2 });
    assert.deepEqual(data.errors.map((e) => e.rowNumber), [3, 4, 5, 6, 7, 8]);
    const list = await api.get('/contacts');
    assert.equal(list.data.pagination.total, 2);
  });

  it('accepts a custom column mapping', async () => {
    const form = fileForm('Person,Mail,Mobile\nVikram Nair,vikram@example.com,9988776655\n', 'custom.csv');
    form.append('mode', 'import');
    form.append('mapping', JSON.stringify({ name: 0, email: 1, phone: 2 }));
    const { status, data } = await api.post('/contacts/upload', form);
    assert.equal(status, 201);
    assert.equal(data.summary.inserted, 1);
  });

  it('answers 400 when the required columns cannot be found', async () => {
    const form = fileForm('Foo,Bar\n1,2\n', 'unknown.csv');
    form.append('mode', 'import');
    const { status, data } = await api.post('/contacts/upload', form);
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_MAPPING');
  });
});

// ---------------------------------------------------------------------------
describe('cancelling and expired uploads', () => {
  it('cancels an upload', async () => {
    const { data: upload } = await uploadFile(await makeXlsx(mixedRows), 'contacts.xlsx');
    const cancel = await api.delete(`/contacts/upload/${upload.id}`);
    assert.equal(cancel.status, 200);
    assert.equal((await api.get(`/contacts/upload/${upload.id}`)).status, 404);
  });

  it('answers 404 for an unknown upload id', async () => {
    const response = await api.get('/contacts/upload/does-not-exist');
    assert.equal(response.status, 404);
    assert.equal(response.data.code, 'UPLOAD_NOT_FOUND');
  });
});
