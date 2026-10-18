// ---------------------------------------------------------------------------
// Import processor - checks every row of an uploaded file and (optionally) saves it.
//
// The SAME function is used twice:
//   1. "Check" step  (save = false): find every problem so the user can review it
//   2. "Import" step (save = true):  run the same checks again and save the good rows
//
// It does not know about Express, files or MySQL directly - everything it needs is
// passed in. That keeps it easy to read and easy to unit test.
// ---------------------------------------------------------------------------
import { applyMapping, validateContact } from '../../../shared/contactRules.mjs';

export class ImportCancelledError extends Error {
  constructor() {
    super('Import was cancelled');
  }
}

/** A fresh, empty result object. */
export function createImportResult() {
  return { rowsProcessed: 0, totalRows: 0, validRows: 0, inserted: 0, errors: [] };
}

/**
 * rows      - async iterable of { rowNumber, cells } (data rows only, no header)
 * mapping   - { name: 0, email: 1, phone: 2, company: null, ... } (column indexes)
 * save      - false = only check, true = check and insert into the database
 * database  - { findExisting(emails, phones), insertMany(contacts), insertOne(contact) }
 * result    - object that is filled in while we work (so progress can be shown live)
 */
export async function processRows({
  rows,
  mapping,
  save,
  database,
  batchSize = 1000,
  result = createImportResult(),
  isCancelled = () => false,
}) {
  // Remember the first row that used each email / phone, to catch repeats inside the file
  const firstRowByEmail = new Map();
  const firstRowByPhone = new Map();
  let batch = [];

  function addError(rowNumber, values, messages) {
    result.errors.push({ rowNumber, values, messages });
  }

  // Saves rows one at a time - only used when a batch insert hits a duplicate
  async function insertOneByOne(rowsToSave) {
    for (const row of rowsToSave) {
      try {
        await database.insertOne(row.contact);
        result.validRows += 1;
        result.inserted += 1;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        addError(row.rowNumber, row.values, ['Email or Phone Number was added to contacts by someone else during this import']);
      }
    }
  }

  // Checks a batch of good-looking rows against the database, then saves them if needed
  async function finishBatch() {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];

    const existing = await database.findExisting(
      current.map((row) => row.contact.email),
      current.map((row) => row.contact.phone),
    );

    const newRows = [];
    for (const row of current) {
      const messages = [];
      if (existing.emails.has(row.contact.email)) messages.push('Email already exists in contacts');
      if (existing.phones.has(row.contact.phone)) messages.push('Phone Number already exists in contacts');
      if (messages.length > 0) addError(row.rowNumber, row.values, messages);
      else newRows.push(row);
    }

    if (!save) {
      result.validRows += newRows.length;
      return;
    }
    if (newRows.length === 0) return;

    try {
      // One INSERT for the whole batch - fast. MySQL saves all of them or none.
      await database.insertMany(newRows.map((row) => row.contact));
      result.validRows += newRows.length;
      result.inserted += newRows.length;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      // Another user saved one of these contacts a moment ago. Find which one.
      await insertOneByOne(newRows);
    }
  }

  for await (const { rowNumber, cells } of rows) {
    if (isCancelled()) throw new ImportCancelledError();
    result.rowsProcessed += 1;

    const values = applyMapping(cells, mapping);
    if (Object.values(values).every((value) => value === '')) continue; // blank row - skip quietly
    result.totalRows += 1;

    // 1. Format checks (required fields, email, phone, lengths)
    const { value: contact, errors } = validateContact(values);
    const messages = Object.values(errors);

    // 2. Repeats inside the same file
    if (messages.length === 0) {
      const emailRow = firstRowByEmail.get(contact.email);
      const phoneRow = firstRowByPhone.get(contact.phone);
      if (emailRow) messages.push(`Email is repeated in this file (first used on row ${emailRow})`);
      if (phoneRow) messages.push(`Phone Number is repeated in this file (first used on row ${phoneRow})`);
    }

    if (messages.length > 0) {
      addError(rowNumber, values, messages);
      continue;
    }

    firstRowByEmail.set(contact.email, rowNumber);
    firstRowByPhone.set(contact.phone, rowNumber);

    // 3. Database duplicates are checked per batch (one query for many rows)
    batch.push({ rowNumber, values, contact });
    if (batch.length >= batchSize) await finishBatch();
  }

  await finishBatch();

  // Batch checks add their errors a little later than format errors - put them back in row order
  result.errors.sort((a, b) => a.rowNumber - b.rowNumber);
  return result;
}
