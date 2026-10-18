// API tests for contacts: CRUD, search/filter/sort/pagination, edit locks,
// change tracking, batch delete, export and database constraints.
// Needs MySQL running and backend/.env filled in. Uses the "contact_book_test" database.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearContacts,
  createContacts,
  makeClient,
  pool,
  readXlsx,
  startTestServer,
} from './helpers.js';

let server;
let alice; // browser tab of user "Alice"
let bob; // browser tab of user "Bob"

before(async () => {
  server = await startTestServer();
  alice = makeClient(server.baseUrl, { sessionId: 'tab-alice', userName: 'Alice' });
  bob = makeClient(server.baseUrl, { sessionId: 'tab-bob', userName: 'Bob' });
});

after(async () => {
  await server.stop();
});

beforeEach(async () => {
  await clearContacts();
});

const priya = { name: 'Priya Sharma', email: 'Priya.Sharma@Example.com', phone: '+91 98765-43210', company: 'Acme', group: 'Friends', address: 'Pune, Maharashtra' };

// ---------------------------------------------------------------------------
describe('health check', () => {
  it('reports that the database is connected', async () => {
    const { status, data } = await alice.get('/health');
    assert.equal(status, 200);
    assert.equal(data.database, 'connected');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/contacts (create)', () => {
  it('creates a contact and stores email/phone cleaned', async () => {
    const { status, data } = await alice.post('/contacts', priya);
    assert.equal(status, 201);
    assert.ok(data.id);
    assert.equal(data.email, 'priya.sharma@example.com');
    assert.equal(data.phone, '+919876543210');
    assert.equal(data.version, 1);
    assert.equal(data.status, 'Active', 'status defaults to Active');
    assert.equal(data.notes, null);
  });

  it('rejects missing and badly formatted fields with a message per field', async () => {
    const { status, data } = await alice.post('/contacts', { name: '', email: 'not-an-email', phone: '12ab' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.fieldErrors.name, /required/);
    assert.match(data.fieldErrors.email, /invalid/);
    assert.match(data.fieldErrors.phone, /invalid/);
  });

  it('rejects a duplicate email (any letter case)', async () => {
    await alice.post('/contacts', priya);
    const { status, data } = await alice.post('/contacts', { ...priya, email: 'PRIYA.SHARMA@example.COM', phone: '9999988888' });
    assert.equal(status, 409);
    assert.equal(data.code, 'DUPLICATE_CONTACT');
    assert.ok(data.fieldErrors.email);
    assert.equal(data.fieldErrors.phone, undefined);
  });

  it('rejects a duplicate phone even when typed differently', async () => {
    await alice.post('/contacts', priya);
    const { status, data } = await alice.post('/contacts', { ...priya, email: 'other@example.com', phone: '+91 (98765) 43210' });
    assert.equal(status, 409);
    assert.ok(data.fieldErrors.phone);
  });

  it('rejects a body that is not valid JSON', async () => {
    const { status, data } = await alice.post('/contacts', '{"name": ');
    assert.equal(status, 400);
    assert.match(data.message, /not valid JSON/);
  });
});

// ---------------------------------------------------------------------------
describe('database-level constraints', () => {
  it('MySQL itself refuses a duplicate email', async () => {
    await alice.post('/contacts', priya);
    await assert.rejects(
      pool.query("INSERT INTO contacts (name, email, phone) VALUES ('X', 'priya.sharma@example.com', '+911111111111')"),
      (error) => error.code === 'ER_DUP_ENTRY',
    );
  });

  it('MySQL itself refuses a duplicate phone', async () => {
    await alice.post('/contacts', priya);
    await assert.rejects(
      pool.query("INSERT INTO contacts (name, email, phone) VALUES ('X', 'x@example.com', '+919876543210')"),
      (error) => error.code === 'ER_DUP_ENTRY',
    );
  });

  it('MySQL itself refuses a badly formatted phone, email or empty name', async () => {
    const isCheckError = (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.errno === 3819;
    await assert.rejects(pool.query("INSERT INTO contacts (name, email, phone) VALUES ('X', 'x@example.com', 'abc')"), isCheckError);
    await assert.rejects(pool.query("INSERT INTO contacts (name, email, phone) VALUES ('X', 'not-an-email', '9876543210')"), isCheckError);
    await assert.rejects(pool.query("INSERT INTO contacts (name, email, phone) VALUES ('  ', 'x@example.com', '9876543210')"), isCheckError);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/contacts (list, search, filter, sort, pagination)', () => {
  beforeEach(async () => {
    const people = [];
    for (let i = 1; i <= 25; i += 1) {
      people.push({
        name: `Person ${String(i).padStart(2, '0')}`,
        email: `person${i}@example.com`,
        phone: `98765${String(i).padStart(5, '0')}`,
        company: i % 2 === 0 ? 'Acme' : 'Globex',
        group: i <= 10 ? 'Friends' : 'Work',
        status: i % 5 === 0 ? 'Inactive' : 'Active',
      });
    }
    people.push({ name: 'Zara 100% Real', email: 'zara@sample.org', phone: '+14155550134', company: 'Initech', group: 'Clients' });
    await createContacts(alice, people);
  });

  it('returns the first page with totals', async () => {
    const { status, data } = await alice.get('/contacts?page=1&limit=10');
    assert.equal(status, 200);
    assert.equal(data.data.length, 10);
    assert.deepEqual(data.pagination, { page: 1, limit: 10, total: 26, totalPages: 3 });
  });

  it('returns the last (partial) page', async () => {
    const { data } = await alice.get('/contacts?page=3&limit=10');
    assert.equal(data.data.length, 6);
  });

  it('returns an empty list for a page after the end', async () => {
    const { data } = await alice.get('/contacts?page=99&limit=10');
    assert.equal(data.data.length, 0);
    assert.equal(data.pagination.total, 26);
  });

  it('never returns more than 100 rows per page', async () => {
    const { data } = await alice.get('/contacts?limit=5000');
    assert.equal(data.pagination.limit, 100);
  });

  it('uses safe defaults for nonsense paging values', async () => {
    const { status, data } = await alice.get('/contacts?page=abc&limit=-4');
    assert.equal(status, 200);
    assert.equal(data.pagination.page, 1);
    assert.equal(data.pagination.limit, 1);
  });

  it('searches by part of the name', async () => {
    const { data } = await alice.get('/contacts?search=person 0');
    assert.equal(data.pagination.total, 9); // Person 01 .. Person 09
  });

  it('searches by email', async () => {
    const { data } = await alice.get('/contacts?search=zara@sample');
    assert.equal(data.data[0].name, 'Zara 100% Real');
  });

  it('searches by phone, even with spaces typed in', async () => {
    const { data } = await alice.get(`/contacts?search=${encodeURIComponent('+1 415 555')}`);
    assert.equal(data.pagination.total, 1);
    assert.equal(data.data[0].email, 'zara@sample.org');
  });

  it('treats % in the search text as a normal character', async () => {
    const { data } = await alice.get(`/contacts?search=${encodeURIComponent('100%')}`);
    assert.equal(data.pagination.total, 1);
  });

  it('filters by group, company and status (combined)', async () => {
    const { data } = await alice.get('/contacts?company=Acme&group=Friends&status=Active&limit=100');
    assert.equal(data.pagination.total, 4); // 2, 4, 6, 8 (10 is Inactive)
    assert.ok(data.data.every((c) => c.company === 'Acme' && c.group === 'Friends' && c.status === 'Active'));
  });

  it('filters by status', async () => {
    const { data } = await alice.get('/contacts?status=Inactive');
    assert.equal(data.pagination.total, 5); // 5, 10, 15, 20, 25
  });

  it('filters by the date the contact was added', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const all = await alice.get(`/contacts?createdFrom=${past}&createdTo=${future}`);
    assert.equal(all.data.pagination.total, 26);
    const none = await alice.get(`/contacts?createdFrom=${future}`);
    assert.equal(none.data.pagination.total, 0);
    const bad = await alice.get('/contacts?createdFrom=not-a-date');
    assert.equal(bad.status, 400);
  });

  it('combines search with filters', async () => {
    const { data } = await alice.get('/contacts?search=person 1&company=Globex&limit=100');
    // "Person 1" matches Person 10..19; the odd ones (11, 13, 15, 17, 19) are Globex
    assert.equal(data.pagination.total, 5);
  });

  it('filters by name and email fields separately', async () => {
    const byName = await alice.get('/contacts?name=Zara');
    assert.equal(byName.data.pagination.total, 1);
    const byEmail = await alice.get('/contacts?email=person2');
    assert.equal(byEmail.data.pagination.total, 7); // person2, person20..25
  });

  it('sorts by name both ways', async () => {
    const asc = await alice.get('/contacts?sortBy=name&sortOrder=asc&limit=3');
    assert.deepEqual(asc.data.data.map((c) => c.name), ['Person 01', 'Person 02', 'Person 03']);
    const desc = await alice.get('/contacts?sortBy=name&sortOrder=desc&limit=1');
    assert.equal(desc.data.data[0].name, 'Zara 100% Real');
  });

  it('ignores an unknown sort column instead of failing', async () => {
    const { status } = await alice.get('/contacts?sortBy=password;DROP TABLE contacts');
    assert.equal(status, 200);
  });

  it('lists the values for the filter dropdowns', async () => {
    const { data } = await alice.get('/contacts/filter-options');
    assert.deepEqual(data.groups, ['Clients', 'Friends', 'Work']);
    assert.deepEqual(data.companies, ['Acme', 'Globex', 'Initech']);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/contacts/:id', () => {
  it('returns one contact', async () => {
    const [created] = await createContacts(alice, [priya]);
    const { status, data } = await alice.get(`/contacts/${created.id}`);
    assert.equal(status, 200);
    assert.equal(data.name, 'Priya Sharma');
    assert.equal(data.editingBy, null);
  });

  it('answers 404 for a contact that does not exist', async () => {
    const { status } = await alice.get('/contacts/999999');
    assert.equal(status, 404);
  });

  it('answers 400 for an id that is not a number', async () => {
    const { status } = await alice.get('/contacts/abc');
    assert.equal(status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('PUT /api/contacts/:id (update with change tracking)', () => {
  it('updates, bumps the version and records what changed', async () => {
    const [created] = await createContacts(alice, [priya]);
    const { status, data } = await alice.put(`/contacts/${created.id}`, { ...priya, company: 'Initech', address: '', status: 'Inactive', version: 1 });
    assert.equal(status, 200);
    assert.equal(data.version, 2);
    assert.equal(data.company, 'Initech');
    assert.equal(data.address, null);
    assert.equal(data.status, 'Inactive');

    const history = await alice.get(`/contacts/${created.id}/history`);
    const changes = Object.fromEntries(history.data.map((h) => [h.field, h]));
    assert.equal(history.data.length, 3);
    assert.equal(changes.company.oldValue, 'Acme');
    assert.equal(changes.company.newValue, 'Initech');
    assert.equal(changes.address.oldValue, 'Pune, Maharashtra');
    assert.equal(changes.address.newValue, null);
    assert.equal(changes.status.oldValue, 'Active');
    assert.equal(changes.status.newValue, 'Inactive');
    assert.equal(changes.company.changedBy, 'Alice');
    assert.equal(changes.company.version, 2);
  });

  it('does nothing (and keeps the version) when no field changed', async () => {
    const [created] = await createContacts(alice, [priya]);
    const { data } = await alice.put(`/contacts/${created.id}`, { ...priya, version: 1 });
    assert.equal(data.version, 1);
    const history = await alice.get(`/contacts/${created.id}/history`);
    assert.equal(history.data.length, 0);
  });

  it('refuses to overwrite changes someone else saved first (stale version)', async () => {
    const [created] = await createContacts(alice, [priya]);
    await bob.put(`/contacts/${created.id}`, { ...priya, company: 'Bob Co', version: 1 });
    const { status, data } = await alice.put(`/contacts/${created.id}`, { ...priya, company: 'Alice Co', version: 1 });
    assert.equal(status, 409);
    assert.equal(data.code, 'VERSION_CONFLICT');
  });

  it('requires the version number', async () => {
    const [created] = await createContacts(alice, [priya]);
    const { status } = await alice.put(`/contacts/${created.id}`, { ...priya });
    assert.equal(status, 400);
  });

  it('refuses an email that another contact already uses', async () => {
    const [first, second] = await createContacts(alice, [priya, { name: 'Ravi', email: 'ravi@example.com', phone: '9123456789' }]);
    const { status, data } = await alice.put(`/contacts/${second.id}`, { name: 'Ravi', email: first.email, phone: '9123456789', version: 1 });
    assert.equal(status, 409);
    assert.ok(data.fieldErrors.email);
  });

  it('validates the new values', async () => {
    const [created] = await createContacts(alice, [priya]);
    const { status, data } = await alice.put(`/contacts/${created.id}`, { ...priya, email: 'broken', version: 1 });
    assert.equal(status, 400);
    assert.ok(data.fieldErrors.email);
  });

  it('answers 404 when the contact does not exist', async () => {
    const { status } = await alice.put('/contacts/999999', { ...priya, version: 1 });
    assert.equal(status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('edit locks (two people editing the same contact)', () => {
  it('lets only one person edit at a time', async () => {
    const [created] = await createContacts(alice, [priya]);

    const aliceLock = await alice.post(`/contacts/${created.id}/lock`);
    assert.equal(aliceLock.status, 200);

    const bobLock = await bob.post(`/contacts/${created.id}/lock`);
    assert.equal(bobLock.status, 409);
    assert.equal(bobLock.data.code, 'CONTACT_LOCKED');
    assert.equal(bobLock.data.lock.userName, 'Alice');
    assert.match(bobLock.data.message, /Alice is editing/);
  });

  it('shows the other person who is editing (detail and list)', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.post(`/contacts/${created.id}/lock`);

    const forBob = await bob.get(`/contacts/${created.id}`);
    assert.equal(forBob.data.editingBy.userName, 'Alice');
    const listForBob = await bob.get('/contacts');
    assert.equal(listForBob.data.data[0].editingBy, 'Alice');

    const forAlice = await alice.get(`/contacts/${created.id}`);
    assert.equal(forAlice.data.editingBy, null, 'Alice is not warned about herself');
    assert.equal(forAlice.data.lockedByMe, true);
  });

  it('blocks saving and deleting by others while locked', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.post(`/contacts/${created.id}/lock`);

    const save = await bob.put(`/contacts/${created.id}`, { ...priya, company: 'Bob Co', version: 1 });
    assert.equal(save.status, 409);
    assert.equal(save.data.code, 'CONTACT_LOCKED');

    const remove = await bob.delete(`/contacts/${created.id}`);
    assert.equal(remove.status, 409);

    const ownSave = await alice.put(`/contacts/${created.id}`, { ...priya, company: 'Alice Co', version: 1 });
    assert.equal(ownSave.status, 200, 'the lock owner can still save');
  });

  it('renewing your own lock works (heartbeat)', async () => {
    const [created] = await createContacts(alice, [priya]);
    assert.equal((await alice.post(`/contacts/${created.id}/lock`)).status, 200);
    assert.equal((await alice.post(`/contacts/${created.id}/lock`)).status, 200);
  });

  it('frees the contact when the editor releases the lock', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.post(`/contacts/${created.id}/lock`);
    await alice.delete(`/contacts/${created.id}/lock`);
    assert.equal((await bob.post(`/contacts/${created.id}/lock`)).status, 200);
  });

  it('someone else cannot release your lock', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.post(`/contacts/${created.id}/lock`);
    await bob.delete(`/contacts/${created.id}/lock`);
    assert.equal((await bob.post(`/contacts/${created.id}/lock`)).status, 409);
  });

  it('a lock expires if the editor disappears (closed tab)', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.post(`/contacts/${created.id}/lock`);
    await new Promise((resolve) => setTimeout(resolve, 3000)); // test locks last 2 seconds
    assert.equal((await bob.post(`/contacts/${created.id}/lock`)).status, 200);
  });

  it('answers 404 when locking a contact that does not exist', async () => {
    assert.equal((await alice.post('/contacts/999999/lock')).status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /api/contacts/:id and batch delete', () => {
  it('deletes one contact (and its history)', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.put(`/contacts/${created.id}`, { ...priya, company: 'X', version: 1 });

    const { status } = await alice.delete(`/contacts/${created.id}`);
    assert.equal(status, 200);
    assert.equal((await alice.get(`/contacts/${created.id}`)).status, 404);
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM contact_history WHERE contact_id = ?', [created.id]);
    assert.equal(rows[0].n, 0);
  });

  it('answers 404 when deleting a contact twice', async () => {
    const [created] = await createContacts(alice, [priya]);
    await alice.delete(`/contacts/${created.id}`);
    assert.equal((await alice.delete(`/contacts/${created.id}`)).status, 404);
  });

  it('batch-deletes, skipping contacts someone else is editing', async () => {
    const created = await createContacts(alice, [
      priya,
      { name: 'B', email: 'b@example.com', phone: '9000000002' },
      { name: 'C', email: 'c@example.com', phone: '9000000003' },
    ]);
    await bob.post(`/contacts/${created[2].id}/lock`); // Bob is editing C

    const { status, data } = await alice.post('/contacts/batch-delete', { ids: [created[0].id, created[1].id, created[2].id, 999999] });
    assert.equal(status, 200);
    assert.equal(data.deleted, 2);
    assert.equal(data.notFound, 1);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].id, created[2].id);
    assert.match(data.skipped[0].reason, /Bob/);

    const list = await alice.get('/contacts');
    assert.equal(list.data.pagination.total, 1);
  });

  it('rejects a bad batch-delete request', async () => {
    assert.equal((await alice.post('/contacts/batch-delete', { ids: [] })).status, 400);
    assert.equal((await alice.post('/contacts/batch-delete', { ids: ['abc'] })).status, 400);
    assert.equal((await alice.post('/contacts/batch-delete', {})).status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/contacts/export (Excel export)', () => {
  let created;
  beforeEach(async () => {
    created = await createContacts(alice, [
      priya,
      { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9123456789', company: 'Globex' },
      { name: 'Asha Rao', email: 'asha@example.com', phone: '9234567890', company: 'Acme' },
    ]);
  });

  it('exports all contacts with all fields by default', async () => {
    const { status, data, headers } = await alice.post('/contacts/export', {});
    assert.equal(status, 200);
    assert.match(headers.get('content-disposition'), /attachment; filename="contacts-.*\.xlsx"/);
    const rows = await readXlsx(data);
    assert.equal(rows.length, 4); // header + 3
    assert.equal(rows[0][0], 'Name');
    assert.ok(rows[0].includes('Created At'));
  });

  it('exports only the chosen fields, in the natural order', async () => {
    const { data } = await alice.post('/contacts/export', { fields: ['phone', 'name'] });
    const rows = await readXlsx(data);
    assert.deepEqual(rows[0], ['Name', 'Phone Number']);
  });

  it('exports only the selected contacts', async () => {
    const { data } = await alice.post('/contacts/export', { ids: [created[1].id], fields: ['name', 'email'] });
    const rows = await readXlsx(data);
    assert.deepEqual(rows, [['Name', 'Email'], ['Ravi Kumar', 'ravi@example.com']]);
  });

  it('exports contacts filtered by name, group, status and date', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await alice.post('/contacts/export', {
      fields: ['name', 'group', 'status'],
      filters: { name: 'priya', group: 'Friends', status: 'Active', createdFrom: yesterday },
    });
    const rows = await readXlsx(data);
    assert.deepEqual(rows, [['Name', 'Group', 'Status'], ['Priya Sharma', 'Friends', 'Active']]);
  });

  it('exports the filtered contacts in the chosen sort order', async () => {
    const { data } = await alice.post('/contacts/export', {
      fields: ['name'],
      filters: { company: 'Acme' },
      sortBy: 'name',
      sortOrder: 'asc',
    });
    const rows = await readXlsx(data);
    assert.deepEqual(rows, [['Name'], ['Asha Rao'], ['Priya Sharma']]);
  });

  it('rejects unknown or empty field lists', async () => {
    assert.equal((await alice.post('/contacts/export', { fields: ['password'] })).status, 400);
    assert.equal((await alice.post('/contacts/export', { fields: [] })).status, 400);
    assert.equal((await alice.post('/contacts/export', { ids: ['x'] })).status, 400);
  });

  it('offers an import template', async () => {
    const { status, data } = await alice.get('/contacts/template');
    assert.equal(status, 200);
    const rows = await readXlsx(data);
    assert.equal(rows[0][0], 'Name');
    assert.equal(rows.length, 3);
  });
});

// ---------------------------------------------------------------------------
describe('unknown routes', () => {
  it('answers 404 JSON for an unknown API route', async () => {
    const { status, data } = await alice.get('/nothing-here');
    assert.equal(status, 404);
    assert.match(data.message, /no API route/i);
  });
});
