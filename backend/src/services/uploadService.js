// ---------------------------------------------------------------------------
// Upload Service - the life of one uploaded file.
//
//   1. reading     The file is read ONCE (streaming) and its rows are copied into a
//                  simple temporary "rows file" (one JSON line per row).
//   2. ready       Column headers are known -> the user maps columns to fields.
//   3. validating  Every row is checked (format, required fields, duplicates).
//   4. validated   The user reviews the problems / downloads the error report.
//   5. importing   Good rows are saved to MySQL in batches.
//   6. completed   Done. (Or "failed" with a message if something went wrong.)
//
// Big files are processed in the background; the browser polls for progress.
// Upload sessions live in memory and are forgotten after an hour.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { CONTACT_FIELDS, checkMapping, suggestMapping } from '../../../shared/contactRules.mjs';
import { buildHeaders, detectFileType, isBlankRow, readRows } from './excelService.js';
import { ImportCancelledError, createImportResult, processRows } from './importProcessor.js';
import { findExistingEmailsAndPhones, insertManyContacts, insertOneContact } from './contactService.js';

const uploads = new Map(); // uploadId -> upload session
const BUSY_STATUSES = new Set(['reading', 'validating', 'importing']);

// The database functions the import processor needs
const database = {
  findExisting: findExistingEmailsAndPhones,
  insertMany: insertManyContacts,
  insertOne: insertOneContact,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function removeFile(filePath) {
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true }).catch((error) => {
    console.warn(`Could not delete temporary file ${filePath}: ${error.message}`);
  });
}

async function removeUploadFiles(upload) {
  await removeFile(upload.filePath);
  await removeFile(upload.rowsFilePath);
}

function percent(done, total) {
  if (!total) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}

/** What the browser is allowed to see about an upload. */
function toPublicView(upload) {
  return {
    id: upload.id,
    fileName: upload.fileName,
    fileSize: upload.fileSize,
    status: upload.status,
    message: upload.message,
    progress: upload.progress,
    headers: upload.headers,
    preview: upload.preview,
    suggestedMapping: upload.suggestedMapping,
    mapping: upload.mapping,
    dataRowCount: upload.dataRowCount,
    summary: upload.summary,
    fields: CONTACT_FIELDS.map(({ key, label, required }) => ({ key, label, required })),
  };
}

function getUploadOrThrow(uploadId) {
  const upload = uploads.get(uploadId);
  if (!upload) {
    throw new HttpError(404, 'This upload was not found or has expired. Please upload the file again.', {
      code: 'UPLOAD_NOT_FOUND',
    });
  }
  upload.lastUsedAt = Date.now();
  return upload;
}

function friendlyJobError(error) {
  if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ETIMEDOUT'].includes(error.code)) {
    return 'Lost connection to the MySQL database. Check that MySQL is running, then try again.';
  }
  if (error instanceof HttpError) return error.message;
  return `Could not process the file: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Step 1 - receive the file and read it once
// ---------------------------------------------------------------------------

/**
 * Called right after multer saved the uploaded file to disk.
 *
 * Normal (website) mode: answer straight away; the browser then shows the column
 * mapping and the errors, and calls /validate and /import itself.
 *
 * One-step mode (importNow = true, e.g. from Postman): read, validate and save in
 * this single request, then answer with the result and the rows that failed.
 */
export async function createUpload(file, { importNow = false, mapping = null } = {}) {
  let fileType;
  try {
    fileType = await detectFileType(file.path, file.originalname); // wrong format -> 415 right away
  } catch (error) {
    await removeFile(file.path);
    throw error;
  }

  const upload = {
    id: randomUUID(),
    fileName: file.originalname,
    fileSize: file.size,
    fileType,
    filePath: file.path,
    rowsFilePath: `${file.path}.rows.jsonl`,
    status: 'reading',
    message: null,
    progress: { percent: 0, rowsDone: 0 },
    headers: [],
    preview: [],
    suggestedMapping: null,
    mapping: null,
    dataRowCount: 0,
    summary: null,
    errors: [],
    cancelled: false,
    job: null, // the running check/import (a Promise)
    lastUsedAt: Date.now(),
  };
  uploads.set(upload.id, upload);

  const reading = readFileInBackground(upload);
  if (!importNow) return toPublicView(upload);

  try {
    await reading;
    if (upload.status !== 'ready') throw new HttpError(400, upload.message || 'Could not read this file.');

    startValidation(upload.id, mapping || upload.suggestedMapping); // 400 if required columns can't be found
    await upload.job;
    if (upload.status === 'validated' && upload.summary.validRows > 0) {
      startImport(upload.id);
      await upload.job;
    }
    if (upload.status === 'failed') throw new HttpError(500, upload.message);

    return { ...toPublicView(upload), errors: upload.errors.slice(0, 100) };
  } finally {
    // The temporary files are not needed any more (the error list stays for the error report)
    await removeUploadFiles(upload);
  }
}

/** Reads the uploaded Excel/CSV file once and stores its rows in a simple temp file. */
async function readFileInBackground(upload) {
  const output = fs.createWriteStream(upload.rowsFilePath);

  try {
    const rows = readRows(upload.filePath, upload.fileType, (done) => {
      upload.progress.percent = Math.min(99, Math.floor(done));
    });

    let headerFound = false;
    for await (const { rowNumber, cells } of rows) {
      if (upload.cancelled) throw new ImportCancelledError();
      if (isBlankRow(cells)) continue;

      if (!headerFound) {
        // The first non-empty row holds the column names
        upload.headers = buildHeaders(cells);
        upload.suggestedMapping = suggestMapping(upload.headers);
        headerFound = true;
        continue;
      }

      upload.dataRowCount += 1;
      upload.progress.rowsDone = upload.dataRowCount;
      if (upload.preview.length < 3) upload.preview.push(cells); // example values for the mapping screen
      // One line per row: [rowNumber, [cell, cell, ...]]
      if (!output.write(`${JSON.stringify([rowNumber, cells])}\n`)) {
        await once(output, 'drain'); // wait if the disk is slower than the reader
      }
    }

    output.end();
    await once(output, 'finish');

    if (!headerFound) throw new HttpError(400, 'No data was found in the first sheet. The file is empty or damaged.');
    if (upload.dataRowCount === 0) throw new HttpError(400, 'The file has a header row but no contact rows below it.');

    upload.status = 'ready';
    upload.progress = { percent: 100, rowsDone: upload.dataRowCount };
    await removeFile(upload.filePath); // the original file is no longer needed
  } catch (error) {
    output.destroy();
    if (upload.cancelled) return;
    upload.status = 'failed';
    upload.message = error instanceof HttpError ? error.message : `Could not read this file. Make sure it is a valid .xlsx or .csv file. (${error.message})`;
    console.warn(`Upload ${upload.id} failed while reading: ${error.message}`);
    await removeUploadFiles(upload); // a file we cannot read is of no further use
  } finally {
    upload.lastUsedAt = Date.now();
    if (upload.cancelled) await removeUploadFiles(upload);
  }
}

/** Reads the rows back from the temp rows file, one at a time. */
async function* readStoredRows(rowsFilePath) {
  const input = fs.createReadStream(rowsFilePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const [rowNumber, cells] = JSON.parse(line);
      yield { rowNumber, cells };
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

// ---------------------------------------------------------------------------
// Steps 3 and 5 - check rows / save rows (background jobs)
// ---------------------------------------------------------------------------

function runRowsJob(upload, { save }) {
  upload.status = save ? 'importing' : 'validating';
  upload.message = null;
  upload.progress = { percent: 0, rowsDone: 0 };

  const result = createImportResult();
  upload.liveResult = result;

  // Update the progress bar about 4 times a second
  const progressTimer = setInterval(() => {
    upload.progress = { percent: percent(result.rowsProcessed, upload.dataRowCount), rowsDone: result.rowsProcessed };
  }, 250);

  upload.job = processRows({
    rows: readStoredRows(upload.rowsFilePath),
    mapping: upload.mapping,
    save,
    database,
    batchSize: config.importBatchSize,
    result,
    isCancelled: () => upload.cancelled,
  })
    .then(() => {
      upload.errors = result.errors;
      upload.summary = {
        totalRows: result.totalRows,
        validRows: result.validRows,
        invalidRows: result.errors.length,
        inserted: result.inserted,
      };
      upload.status = save ? 'completed' : 'validated';
      upload.progress = { percent: 100, rowsDone: result.rowsProcessed };
      if (save) return removeFile(upload.rowsFilePath); // nothing left to do with it
      return undefined;
    })
    .catch((error) => {
      if (upload.cancelled) return;
      console.error(`Upload ${upload.id} failed:`, error);
      upload.status = 'failed';
      upload.message = save && result.inserted > 0
        ? `${friendlyJobError(error)} (${result.inserted} contacts were saved before the problem happened.)`
        : friendlyJobError(error);
    })
    .finally(async () => {
      clearInterval(progressTimer);
      upload.liveResult = null;
      upload.lastUsedAt = Date.now();
      if (upload.cancelled) await removeUploadFiles(upload);
    });
}

/** Step 3: the user picked the columns - check every row in the background. */
export function startValidation(uploadId, mapping) {
  const upload = getUploadOrThrow(uploadId);
  if (BUSY_STATUSES.has(upload.status)) throw new HttpError(409, 'This file is still being processed. Please wait.');
  if (upload.status === 'completed') throw new HttpError(409, 'This file has already been imported.');
  if (upload.status === 'failed' && upload.headers.length === 0) throw new HttpError(409, upload.message || 'This upload failed.');

  const problems = checkMapping(mapping, upload.headers);
  if (problems.length > 0) {
    throw new HttpError(400, problems.join('. '), { code: 'INVALID_MAPPING', problems });
  }

  // Keep only known fields, as numbers (or null when not mapped)
  upload.mapping = {};
  for (const field of CONTACT_FIELDS) {
    const column = mapping[field.key];
    upload.mapping[field.key] = column === null || column === undefined || column === '' ? null : Number(column);
  }
  upload.errors = [];
  upload.summary = null;

  runRowsJob(upload, { save: false });
  return toPublicView(upload);
}

/** Step 5: the user reviewed the problems and clicked "Import". */
export function startImport(uploadId) {
  const upload = getUploadOrThrow(uploadId);
  if (upload.status === 'completed') throw new HttpError(409, 'This file has already been imported.');
  if (BUSY_STATUSES.has(upload.status)) throw new HttpError(409, 'This file is still being processed. Please wait.');
  if (upload.status !== 'validated') {
    throw new HttpError(409, 'Please check the file (map the columns and review the errors) before importing.');
  }
  if (upload.summary.validRows === 0) {
    throw new HttpError(400, 'There are no valid rows to import. Fix the file and upload it again.');
  }
  runRowsJob(upload, { save: true });
  return toPublicView(upload);
}

// ---------------------------------------------------------------------------
// Reading upload state
// ---------------------------------------------------------------------------

export function getUploadStatus(uploadId) {
  return toPublicView(getUploadOrThrow(uploadId));
}

/** One page of rows that failed validation. */
export function getUploadErrors(uploadId, query) {
  const upload = getUploadOrThrow(uploadId);
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const start = (page - 1) * limit;
  return {
    data: upload.errors.slice(start, start + limit),
    pagination: { page, limit, total: upload.errors.length, totalPages: Math.ceil(upload.errors.length / limit) },
  };
}

/** Used by the error-report download. */
export function getUploadForReport(uploadId) {
  const upload = getUploadOrThrow(uploadId);
  if (!['validated', 'completed'].includes(upload.status)) {
    throw new HttpError(409, 'The error report is available after the file has been checked.');
  }
  return upload;
}

// ---------------------------------------------------------------------------
// Cancel and clean-up
// ---------------------------------------------------------------------------

export async function cancelUpload(uploadId) {
  const upload = getUploadOrThrow(uploadId);
  upload.cancelled = true;
  uploads.delete(uploadId);
  // A running job notices `cancelled` and deletes the files itself when it stops
  if (!BUSY_STATUSES.has(upload.status)) await removeUploadFiles(upload);
}

/** Creates the uploads folder and removes files left over from a previous run. */
export async function prepareUploadFolder() {
  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  const leftovers = await fs.promises.readdir(config.uploadDir);
  await Promise.all(leftovers.map((name) => removeFile(path.join(config.uploadDir, name))));
}

/** Every few minutes, forget uploads nobody has touched for an hour. */
export function startCleanupTimer() {
  const timer = setInterval(async () => {
    const expiry = Date.now() - config.uploadExpiryMinutes * 60 * 1000;
    for (const upload of uploads.values()) {
      if (upload.lastUsedAt < expiry && !BUSY_STATUSES.has(upload.status)) {
        uploads.delete(upload.id);
        await removeUploadFiles(upload);
      }
    }
  }, 5 * 60 * 1000);
  timer.unref(); // don't keep Node running just for this timer
  return timer;
}
