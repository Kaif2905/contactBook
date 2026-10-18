// ---------------------------------------------------------------------------
// Excel Service - reading uploaded files and writing Excel downloads.
//
// Reading uses STREAMING: the file is read a few rows at a time, so a
// 50 MB+ file with a million rows never has to fit in memory at once.
// (.xlsx reading lives in xlsxReader.js; ExcelJS is used for writing files.)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import ExcelJS from 'exceljs';
import { readXlsxRows } from './xlsxReader.js';
import * as XLSX from 'xlsx'; // SheetJS - only used for old .xls files
import { parse as parseCsv } from 'csv-parse';
import { HttpError } from '../utils/httpError.js';
import { CONTACT_FIELDS, EXPORT_FIELDS, toText } from '../../../shared/contactRules.mjs';
import { streamContactsForExport } from './contactService.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------------------------------------------------------------------------
// File format checks
// ---------------------------------------------------------------------------

export const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

/** First check, by file name only (runs before the file is even saved). */
export function checkFileExtension(fileName) {
  const extension = path.extname(fileName || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new HttpError(415, 'Only Excel (.xlsx, .xls) and CSV (.csv) files can be uploaded.', { code: 'UNSUPPORTED_FILE' });
  }
  return extension.slice(1); // 'xlsx', 'xls' or 'csv'
}

async function readFirstBytes(filePath, count) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Second check, by looking INSIDE the file. A renamed .txt or .pdf is caught
 * here even if its name ends with .xlsx.
 */
export async function detectFileType(filePath, fileName) {
  const fileType = checkFileExtension(fileName);
  const firstBytes = await readFirstBytes(filePath, 4096);

  if (firstBytes.length === 0) {
    throw new HttpError(400, 'The file is empty.', { code: 'EMPTY_FILE' });
  }

  // Real .xlsx files are ZIP archives and start with the bytes "PK"
  const isZip = firstBytes[0] === 0x50 && firstBytes[1] === 0x4b;
  // Old .xls files (and password-protected workbooks) start with D0 CF 11 E0
  const isOldExcel = firstBytes[0] === 0xd0 && firstBytes[1] === 0xcf && firstBytes[2] === 0x11 && firstBytes[3] === 0xe0;

  if (fileType === 'xls') {
    // Some programs save HTML/XML tables with an .xls name - Excel and SheetJS open those too
    const looksLikeMarkup = firstBytes.toString('utf8', 0, 200).trimStart().startsWith('<');
    if (!isOldExcel && !looksLikeMarkup) {
      throw new HttpError(415, 'This is not a real Excel file, even though its name ends with .xls.', { code: 'UNSUPPORTED_FILE' });
    }
  } else if (fileType === 'xlsx') {
    if (isOldExcel) {
      throw new HttpError(415, 'This file is password-protected, or it is an old .xls file renamed to .xlsx. Remove the password / save it as .xlsx and try again.', {
        code: 'UNSUPPORTED_FILE',
      });
    }
    if (!isZip) {
      throw new HttpError(415, 'This is not a real Excel file, even though its name ends with .xlsx.', { code: 'UNSUPPORTED_FILE' });
    }
  } else if (firstBytes.includes(0)) {
    // Text files never contain zero bytes; binary files almost always do
    throw new HttpError(415, 'This .csv file contains binary data. Please upload a plain-text CSV file.', { code: 'UNSUPPORTED_FILE' });
  }

  return fileType;
}

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

/** Excel cells can hold text, numbers, dates, links, formulas... turn them all into text. */
export function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim(); // formatted text
    if ('text' in value) return cellToText(value.text); // hyperlink (emails are often links)
    if ('result' in value) return cellToText(value.result); // formula -> its result
    return ''; // error cells like #N/A
  }
  return toText(value);
}

/** 0 -> A, 1 -> B, 26 -> AA */
export function columnLetter(index) {
  let letters = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

/**
 * Reads a .xlsx, .xls or .csv file row by row.
 * Yields { rowNumber, cells } where cells is an array of text (cells[0] = column A).
 * onProgress(percent) is called while reading - used for the progress bar.
 */
export async function* readRows(filePath, fileType, onProgress = null) {
  if (fileType === 'xlsx') {
    // Streams the first sheet with very little memory (see xlsxReader.js)
    for await (const { rowNumber, cells } of readXlsxRows(filePath, onProgress)) {
      yield { rowNumber, cells: cells.map(cellToText) };
    }
    return;
  }

  if (fileType === 'xls') {
    // Old .xls files are small (max 65,536 rows), so they are read in one go
    const workbook = XLSX.read(await fs.promises.readFile(filePath), { type: 'buffer', dense: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet || !sheet['!ref']) return;
    const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r; // 0 = Excel row 1
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: true, defval: '' });
    for (let index = 0; index < rows.length; index += 1) {
      yield { rowNumber: firstRow + index + 1, cells: Array.from(rows[index], cellToText) };
    }
    return;
  }

  // CSV: stream the file through a CSV parser, counting bytes for the progress bar
  const { size } = await fs.promises.stat(filePath);
  let bytesRead = 0;
  const fileStream = fs.createReadStream(filePath);
  const byteCounter = new Transform({
    transform(chunk, encoding, callback) {
      bytesRead += chunk.length;
      if (onProgress && size > 0) onProgress(Math.min(100, (bytesRead / size) * 100));
      callback(null, chunk);
    },
  });
  fileStream.on('error', (error) => byteCounter.destroy(error));
  const parser = fileStream.pipe(byteCounter).pipe(
    parseCsv({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: false }),
  );

  try {
    let rowNumber = 0;
    for await (const record of parser) {
      rowNumber += 1;
      yield { rowNumber, cells: record.map(cellToText) };
    }
  } finally {
    // Always close the file (Windows cannot delete a file that is still open)
    fileStream.destroy();
    byteCounter.destroy();
  }
}

/** True when every cell in the row is empty. */
export function isBlankRow(cells) {
  return cells.every((cell) => cell === '');
}

/**
 * Turns the header row cells into [{ index, label }].
 * Empty header cells get a name like "Column C"; repeated names get "(2)".
 */
export function buildHeaders(cells) {
  // Drop empty columns at the end of the header row
  let lastFilled = cells.length - 1;
  while (lastFilled >= 0 && cells[lastFilled] === '') lastFilled -= 1;

  const seen = new Map();
  return cells.slice(0, lastFilled + 1).map((cell, index) => {
    let label = cell || `Column ${columnLetter(index)}`;
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count > 1) label = `${label} (${count})`;
    return { index, label };
  });
}

// ---------------------------------------------------------------------------
// Writing Excel files (downloads)
// ---------------------------------------------------------------------------

/**
 * Streams an .xlsx file straight into the HTTP response.
 * columns: [{ key, label, width }]   rows: any (async) iterable of plain objects
 */
export async function sendWorkbook(res, { fileName, sheetName, columns, rows }) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.label, key: column.key, width: column.width || 22 }));
  sheet.getRow(1).font = { bold: true };

  for await (const row of rows) {
    sheet.addRow(row).commit();
  }
  await sheet.commit();
  await workbook.commit();
}

/** 2026-10-18 14:05 in the user's time zone (falls back to UTC). */
function formatDate(date, timeZone) {
  if (!date) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(date));
    const part = (type) => parts.find((p) => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour') === '24' ? '00' : part('hour')}:${part('minute')}`;
  } catch {
    return new Date(date).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/** Checks the list of fields the user wants in the export. */
export function pickExportFields(requested) {
  if (requested === undefined || requested === null) return EXPORT_FIELDS;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new HttpError(400, 'Choose at least one field to export.');
  }
  const unknown = requested.filter((key) => !EXPORT_FIELDS.some((field) => field.key === key));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown export field(s): ${unknown.join(', ')}`);
  }
  // Keep the natural column order, whatever order the user clicked them in
  return EXPORT_FIELDS.filter((field) => requested.includes(field.key));
}

/** Export all / filtered / selected contacts with the chosen fields. */
export async function exportContacts(res, { fields, ids, filters, sortBy, sortOrder, timeZone }) {
  const columns = pickExportFields(fields);
  const contacts = streamContactsForExport({ ids, filters, sortBy, sortOrder });

  async function* rows() {
    for await (const contact of contacts) {
      const row = {};
      for (const column of columns) {
        const value = contact[column.key];
        row[column.key] = column.key === 'createdAt' || column.key === 'updatedAt' ? formatDate(value, timeZone) : value ?? '';
      }
      yield row;
    }
  }

  await sendWorkbook(res, { fileName: `contacts-${todayStamp()}.xlsx`, sheetName: 'Contacts', columns, rows: rows() });
}

/** Downloadable list of rows that failed validation during an import. */
export async function sendErrorReport(res, upload) {
  const mappedFields = CONTACT_FIELDS.filter((field) => upload.mapping && upload.mapping[field.key] !== null);
  const columns = [
    { key: 'rowNumber', label: 'Row Number', width: 12 },
    ...mappedFields.map((field) => ({ key: field.key, label: field.label })),
    { key: 'problems', label: 'Problems', width: 70 },
  ];

  const rows = upload.errors.map((error) => ({
    rowNumber: error.rowNumber,
    ...error.values,
    problems: error.messages.join('; '),
  }));

  const baseName = path.parse(upload.fileName).name.replace(/[^\w.-]+/g, '_');
  await sendWorkbook(res, { fileName: `${baseName}-errors.xlsx`, sheetName: 'Rows with errors', columns, rows });
}

/** An empty template with the right headers and two example rows. */
export async function sendTemplate(res) {
  const columns = CONTACT_FIELDS.map((field) => ({ key: field.key, label: field.label }));
  const rows = [
    { name: 'Amit Sharma', email: 'amit.sharma@example.com', phone: '+91 98765 43210', group: 'Friends', company: 'ABC Pvt Ltd', address: 'Lucknow, Uttar Pradesh', notes: 'Friend from college', status: 'Active' },
    { name: 'Neha Verma', email: 'neha.verma@example.com', phone: '9123456780', group: 'Work', company: 'Globex', address: 'Pune, Maharashtra', notes: '', status: 'Active' },
  ];
  await sendWorkbook(res, { fileName: 'contacts-template.xlsx', sheetName: 'Contacts', columns, rows });
}
