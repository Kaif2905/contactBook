// ---------------------------------------------------------------------------
// Contact Service - all database work for contacts (Create, Read, Update, Delete)
// ---------------------------------------------------------------------------
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotLockedByOthers, getActiveLock } from './lockService.js';
import { CONTACT_FIELDS, normalizePhone, toText, validateContact } from '../../../shared/contactRules.mjs';

// API field name -> database column name
const COLUMN_FOR_FIELD = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  group: 'contact_group',
  company: 'company',
  address: 'address',
  notes: 'notes',
  status: 'status',
};

// Columns we read, renamed to the camelCase names the frontend uses
const SELECT_COLUMNS = `
  c.id, c.name, c.email, c.phone, c.contact_group AS \`group\`, c.company,
  c.address, c.notes, c.status, c.version,
  c.created_at AS createdAt, c.updated_at AS updatedAt`;

// Columns the user may sort by (anything else falls back to createdAt)
const SORT_COLUMNS = {
  name: 'c.name',
  email: 'c.email',
  phone: 'c.phone',
  group: 'c.contact_group',
  company: 'c.company',
  status: 'c.status',
  createdAt: 'c.created_at',
  updatedAt: 'c.updated_at',
};

// Columns used when inserting (same order as the values from contactValues())
const INSERT_COLUMNS = 'name, email, phone, contact_group, company, address, notes, status';

function contactValues(c) {
  return [c.name, c.email, c.phone, c.group, c.company, c.address, c.notes, c.status];
}

const MAX_BATCH_IDS = 10000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Makes % and _ in the user's search text match literally in LIKE. */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

function wholeNumber(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function orderByClause(sortBy, sortOrder) {
  const column = SORT_COLUMNS[sortBy] || SORT_COLUMNS.createdAt;
  const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // c.id as a tie-breaker keeps pages stable when many rows share a value
  return `${column} ${direction}, c.id ${direction}`;
}

/** Reads a date filter (e.g. "2026-10-01T00:00:00.000Z"). Empty -> null, nonsense -> 400. */
function dateFilter(value, label) {
  const text = toText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} is not a valid date`);
  return date;
}

/**
 * Builds the WHERE part of a query from search/filter options.
 *   search        - matches name, email, phone or company (partial match)
 *   name, email   - partial match on that one field
 *   group, company, status - exact match (these come from dropdowns)
 *   createdFrom, createdTo - added between these two moments
 */
export function buildWhere(filters = {}) {
  const conditions = [];
  const params = [];

  const search = toText(filters.search);
  if (search) {
    const like = `%${escapeLike(search)}%`;
    // Phones are stored cleaned (+919876543210), so clean the search text the same way
    const cleanedPhone = normalizePhone(search);
    const phoneLike = cleanedPhone ? `%${escapeLike(cleanedPhone)}%` : like;
    conditions.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)');
    params.push(like, like, phoneLike, like);
  }

  for (const field of ['name', 'email']) {
    const text = toText(filters[field]);
    if (text) {
      conditions.push(`c.${field} LIKE ?`);
      params.push(`%${escapeLike(text)}%`);
    }
  }

  for (const [field, column] of [['group', 'contact_group'], ['company', 'company'], ['status', 'status']]) {
    const text = toText(filters[field]);
    if (text) {
      conditions.push(`c.${column} = ?`);
      params.push(text);
    }
  }

  const createdFrom = dateFilter(filters.createdFrom, 'createdFrom');
  if (createdFrom) {
    conditions.push('c.created_at >= ?');
    params.push(createdFrom);
  }
  const createdTo = dateFilter(filters.createdTo, 'createdTo');
  if (createdTo) {
    conditions.push('c.created_at < ?');
    params.push(createdTo);
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/** Turns a MySQL "Duplicate entry" error into a 409 error. */
function duplicateError(fieldErrors) {
  const message = Object.values(fieldErrors).join('. ');
  return new HttpError(409, message, { code: 'DUPLICATE_CONTACT', fieldErrors });
}

function fieldErrorsFromMysqlDuplicate(error) {
  if (error.message.includes('uq_contacts_email')) return { email: 'Another contact already uses this email' };
  if (error.message.includes('uq_contacts_phone')) return { phone: 'Another contact already uses this phone number' };
  return { email: 'This contact already exists' };
}

/** Finds other contacts that already use this email or phone. */
async function findDuplicateFields(db, { email, phone }, excludeId = null) {
  const params = [email, phone];
  let sql = 'SELECT id, email, phone FROM contacts WHERE (email = ? OR phone = ?)';
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  const [rows] = await db.query(`${sql} LIMIT 5`, params);

  const fieldErrors = {};
  for (const row of rows) {
    if (row.email.toLowerCase() === email) fieldErrors.email = 'Another contact already uses this email';
    if (row.phone === phone) fieldErrors.phone = 'Another contact already uses this phone number';
  }
  return fieldErrors;
}

function validateOrThrow(input) {
  const { value, errors, isValid } = validateContact(input);
  if (!isValid) {
    throw new HttpError(400, 'Please fix the highlighted fields', { code: 'VALIDATION_ERROR', fieldErrors: errors });
  }
  return value;
}

async function findContactById(id, db = pool) {
  const [rows] = await db.query(`SELECT ${SELECT_COLUMNS} FROM contacts c WHERE c.id = ?`, [id]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/** One page of contacts, with search, filters and sorting. */
export async function listContacts(query, user) {
  const page = wholeNumber(query.page, 1, 1, 1000000);
  const limit = wholeNumber(query.limit, 10, 1, 100);
  const { whereSql, params } = buildWhere(query);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM contacts c ${whereSql}`, params);

  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS},
            l.user_name AS lockUserName, l.session_id AS lockSessionId
       FROM contacts c
       LEFT JOIN contact_edit_locks l ON l.contact_id = c.id AND l.expires_at > NOW()
       ${whereSql}
      ORDER BY ${orderByClause(query.sortBy, query.sortOrder)}
      LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const data = rows.map(({ lockUserName, lockSessionId, ...contact }) => ({
    ...contact,
    // Only tell the user about OTHER people editing (not their own open edit)
    editingBy: lockUserName && lockSessionId !== user.sessionId ? lockUserName : null,
  }));

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** One contact, plus who (if anyone) is editing it right now. */
export async function getContact(id, user) {
  const contact = await findContactById(id);
  if (!contact) throw new HttpError(404, 'Contact not found');

  const lock = await getActiveLock(id);
  const lockedByOther = lock && lock.sessionId !== user.sessionId;
  return {
    ...contact,
    editingBy: lockedByOther ? { userName: lock.userName, lockedAt: lock.lockedAt } : null,
    lockedByMe: Boolean(lock && !lockedByOther),
  };
}

/** Change history of a contact, newest first. */
export async function getContactHistory(id) {
  const contact = await findContactById(id);
  if (!contact) throw new HttpError(404, 'Contact not found');

  const [rows] = await pool.query(
    `SELECT id, version, field_name AS field, old_value AS oldValue, new_value AS newValue,
            changed_by AS changedBy, changed_at AS changedAt
       FROM contact_history
      WHERE contact_id = ?
      ORDER BY id DESC
      LIMIT 200`,
    [id],
  );
  return rows;
}

/** Values for the Group / Company filter dropdowns. */
export async function getFilterOptions() {
  const distinct = async (column) => {
    const [rows] = await pool.query(
      `SELECT DISTINCT ${column} AS value FROM contacts
        WHERE ${column} IS NOT NULL AND ${column} <> ''
        ORDER BY ${column} LIMIT 500`,
    );
    return rows.map((row) => row.value);
  };
  const [groups, companies] = await Promise.all([distinct('contact_group'), distinct('company')]);
  return { groups, companies };
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function createContact(input) {
  const contact = validateOrThrow(input);

  const fieldErrors = await findDuplicateFields(pool, contact);
  if (Object.keys(fieldErrors).length > 0) throw duplicateError(fieldErrors);

  try {
    const [result] = await pool.query(`INSERT INTO contacts (${INSERT_COLUMNS}) VALUES (?)`, [contactValues(contact)]);
    return findContactById(result.insertId);
  } catch (error) {
    // Someone saved the same email/phone a split second before us
    if (error.code === 'ER_DUP_ENTRY') throw duplicateError(fieldErrorsFromMysqlDuplicate(error));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// UPDATE (with conflict protection and change tracking)
// ---------------------------------------------------------------------------

/**
 * input must include `version` - the version the user saw when they started editing.
 * If someone else saved in the meantime, the versions differ and we refuse (409),
 * so nobody silently overwrites another person's changes.
 */
export async function updateContact(id, input, user) {
  const contact = validateOrThrow(input);
  const expectedVersion = Number(input.version);
  if (!Number.isInteger(expectedVersion)) {
    throw new HttpError(400, 'version is required when updating a contact', { code: 'VALIDATION_ERROR' });
  }

  try {
    return await withTransaction(async (connection) => {
      const [rows] = await connection.query(`SELECT ${SELECT_COLUMNS} FROM contacts c WHERE c.id = ? FOR UPDATE`, [id]);
      const current = rows[0];
      if (!current) throw new HttpError(404, 'Contact not found');

      await assertNotLockedByOthers(id, user, connection);

      if (current.version !== expectedVersion) {
        throw new HttpError(
          409,
          'Someone else saved changes to this contact after you opened it. Reload to see the latest version, then make your changes again.',
          { code: 'VERSION_CONFLICT', currentVersion: current.version },
        );
      }

      const fieldErrors = await findDuplicateFields(connection, contact, id);
      if (Object.keys(fieldErrors).length > 0) throw duplicateError(fieldErrors);

      // Work out which fields really changed
      const changes = CONTACT_FIELDS
        .map((field) => ({ field: field.key, oldValue: current[field.key] ?? null, newValue: contact[field.key] ?? null }))
        .filter((change) => change.oldValue !== change.newValue);

      if (changes.length === 0) return current; // nothing to save

      const newVersion = current.version + 1;
      const setSql = changes.map((change) => `${COLUMN_FOR_FIELD[change.field]} = ?`).join(', ');
      await connection.query(`UPDATE contacts SET ${setSql}, version = ? WHERE id = ?`, [
        ...changes.map((change) => change.newValue),
        newVersion,
        id,
      ]);

      await connection.query(
        'INSERT INTO contact_history (contact_id, version, field_name, old_value, new_value, changed_by) VALUES ?',
        [changes.map((change) => [id, newVersion, change.field, change.oldValue, change.newValue, user.name])],
      );

      return findContactById(id, connection);
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw duplicateError(fieldErrorsFromMysqlDuplicate(error));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function deleteContact(id, user) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) throw new HttpError(404, 'Contact not found');

    await assertNotLockedByOthers(id, user, connection);
    await connection.query('DELETE FROM contacts WHERE id = ?', [id]);
  });
}

/**
 * Deletes many contacts at once. Contacts that someone else is editing
 * are skipped (and reported back), the rest are deleted.
 */
export async function deleteContacts(ids, user) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, 'Send a non-empty list of contact ids, e.g. { "ids": [1, 2, 3] }');
  }
  const uniqueIds = [...new Set(ids.map(Number))];
  if (uniqueIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new HttpError(400, 'Every id must be a positive whole number');
  }
  if (uniqueIds.length > MAX_BATCH_IDS) {
    throw new HttpError(400, `You can delete at most ${MAX_BATCH_IDS} contacts at once`);
  }

  return withTransaction(async (connection) => {
    const [existing] = await connection.query('SELECT id FROM contacts WHERE id IN (?) FOR UPDATE', [uniqueIds]);
    const existingIds = existing.map((row) => row.id);

    const [locked] = existingIds.length
      ? await connection.query(
          `SELECT contact_id AS id, user_name AS userName FROM contact_edit_locks
            WHERE contact_id IN (?) AND expires_at > NOW() AND session_id <> ?`,
          [existingIds, user.sessionId],
        )
      : [[]];
    const lockedIds = new Set(locked.map((row) => row.id));
    const deletableIds = existingIds.filter((id) => !lockedIds.has(id));

    if (deletableIds.length > 0) {
      await connection.query('DELETE FROM contacts WHERE id IN (?)', [deletableIds]);
    }

    return {
      deleted: deletableIds.length,
      notFound: uniqueIds.length - existingIds.length,
      skipped: locked.map((row) => ({ id: row.id, reason: `${row.userName} is editing this contact` })),
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers used by the Excel import / export
// ---------------------------------------------------------------------------

/** Which of these emails / phones already exist in the database? */
export async function findExistingEmailsAndPhones(emails, phones) {
  const [rows] = await pool.query('SELECT email, phone FROM contacts WHERE email IN (?) OR phone IN (?)', [
    emails.length ? emails : [null],
    phones.length ? phones : [null],
  ]);
  return {
    emails: new Set(rows.map((row) => row.email.toLowerCase())),
    phones: new Set(rows.map((row) => row.phone)),
  };
}

/** Saves many already-validated contacts with ONE insert statement. */
export async function insertManyContacts(contacts) {
  await pool.query(`INSERT INTO contacts (${INSERT_COLUMNS}) VALUES ?`, [contacts.map(contactValues)]);
}

/** Saves one already-validated contact. */
export async function insertOneContact(contact) {
  await pool.query(`INSERT INTO contacts (${INSERT_COLUMNS}) VALUES (?)`, [contactValues(contact)]);
}

/**
 * Reads contacts one by one for the Excel export (never loads them all into memory).
 * Uses `ids` when given (export selected), otherwise the search/filters.
 */
export async function* streamContactsForExport({ ids, filters, sortBy, sortOrder }) {
  let whereSql;
  let params;
  if (Array.isArray(ids) && ids.length > 0) {
    whereSql = 'WHERE c.id IN (?)';
    params = [ids];
  } else {
    ({ whereSql, params } = buildWhere(filters));
  }

  const sql = `SELECT ${SELECT_COLUMNS} FROM contacts c ${whereSql} ORDER BY ${orderByClause(sortBy, sortOrder)}`;
  const connection = await pool.getConnection();
  let finished = false;
  try {
    // .connection is the underlying mysql2 connection, which supports streaming rows
    const rows = connection.connection.query(sql, params).stream({ highWaterMark: 500 });
    for await (const row of rows) yield row;
    finished = true;
  } finally {
    // If the download was cancelled half way, throw this connection away instead of reusing it
    if (finished) connection.release();
    else connection.destroy();
  }
}
