// Shared helpers for the API tests (they need a running MySQL - see README).
import './testEnv.js';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { setupDatabase } from '../src/setupDatabase.js';
import { prepareUploadFolder } from '../src/services/uploadService.js';

/** Fresh empty test database + the API on a random free port. */
export async function startTestServer() {
  await setupDatabase({ resetTables: true, quiet: true });
  await prepareUploadFolder();

  const app = createApp();
  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api`,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

/** Empties the contacts table between tests. */
export async function clearContacts() {
  await pool.query('DELETE FROM contacts');
}

export { pool };

/**
 * A tiny API client that behaves like one browser tab.
 * Every call returns { status, data, headers } (data = parsed JSON, or an ArrayBuffer for files).
 */
export function makeClient(baseUrl, { sessionId = 'tab-alice', userName = 'Alice' } = {}) {
  async function request(method, path, body) {
    const headers = { 'X-Session-Id': sessionId, 'X-User-Name': encodeURIComponent(userName) };
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (typeof body === 'string') {
      headers['Content-Type'] = 'application/json';
      payload = body; // already a string (used to send broken JSON)
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(baseUrl + path, { method, headers, body: payload });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.arrayBuffer();
    return { status: response.status, data, headers: response.headers };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  };
}

/** Builds an .xlsx file in memory. `rows` is a list of arrays (first one = headers). */
export async function makeXlsx(rows, edit = () => {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contacts');
  for (const row of rows) sheet.addRow(row);
  edit(sheet); // lets a test add special cells (links, formulas)
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Builds an old-style .xls file in memory (rows = list of arrays, first one = headers). */
export function makeXls(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Contacts');
  return XLSX.write(workbook, { bookType: 'xls', type: 'buffer' });
}

/** Reads an .xlsx download back into a list of arrays (first one = headers). */
export async function readXlsx(arrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(arrayBuffer));
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row) => rows.push(Array.from(row.values.slice(1), (value) => (value === undefined || value === null ? '' : value))));
  return rows;
}

/** Puts a file into a multipart form, like the browser's file picker does. */
export function fileForm(content, fileName) {
  const form = new FormData();
  form.append('file', new Blob([content]), fileName);
  return form;
}

/** Polls an upload until it reaches one of the wanted statuses (or fails). */
export async function waitForUpload(client, uploadId, wanted, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await client.get(`/contacts/upload/${uploadId}`);
    if (wanted.includes(data.status) || data.status === 'failed') return data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Upload ${uploadId} did not reach ${wanted.join('/')} in time`);
}

/** Inserts contacts quickly through the API. */
export async function createContacts(client, contacts) {
  const created = [];
  for (const contact of contacts) {
    const { status, data } = await client.post('/contacts', contact);
    if (status !== 201) throw new Error(`Could not create test contact: ${JSON.stringify(data)}`);
    created.push(data);
  }
  return created;
}
