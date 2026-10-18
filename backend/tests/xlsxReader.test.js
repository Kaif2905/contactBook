// Tests for the .xlsx reader (no database needed).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { readXlsxRows } from '../src/services/xlsxReader.js';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-reader-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));

/** Writes an .xlsx with ExcelJS. ExcelJS puts the sheet BEFORE sharedStrings.xml and
 *  workbook.xml inside the zip - exactly the layout that broke the old reader on Windows. */
async function writeXlsx(name, rows, edit = () => {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contacts');
  for (const row of rows) sheet.addRow(row);
  edit(sheet, workbook);
  const file = path.join(folder, name);
  await workbook.xlsx.writeFile(file);
  return file;
}

async function readAll(file) {
  const rows = [];
  for await (const row of readXlsxRows(file)) rows.push(row);
  return rows;
}

describe('readXlsxRows', () => {
  it('reads text, numbers, links, formulas and rich text', async () => {
    const file = await writeXlsx(
      'mixed.xlsx',
      [
        ['Name', 'Email', 'Phone'],
        ['Asha Rao', 'asha@example.com', '+91 98765 00001'],
        ['Ravi Kumar', '', 9876500009],
        ['', '', '9811111111'],
        ['', '', ''],
      ],
      (sheet) => {
        sheet.getCell('B3').value = { text: 'ravi@example.com', hyperlink: 'mailto:ravi@example.com' };
        sheet.getCell('A4').value = { richText: [{ text: 'Ri', font: { bold: true } }, { text: 'ch' }] };
        sheet.getCell('B4').value = { formula: 'LOWER("RICH@EXAMPLE.COM")', result: 'rich@example.com' };
      },
    );
    const rows = await readAll(file);
    assert.deepEqual(rows.slice(0, 4), [
      { rowNumber: 1, cells: ['Name', 'Email', 'Phone'] },
      { rowNumber: 2, cells: ['Asha Rao', 'asha@example.com', '+91 98765 00001'] },
      { rowNumber: 3, cells: ['Ravi Kumar', 'ravi@example.com', '9876500009'] },
      { rowNumber: 4, cells: ['Rich', 'rich@example.com', '9811111111'] },
    ]);
  });

  it('keeps Excel row numbers when there are empty rows', async () => {
    const file = await writeXlsx('gaps.xlsx', [[], [], ['Name', 'Email'], ['A', 'a@example.com']]);
    const rows = (await readAll(file)).filter((row) => row.cells.some((cell) => cell !== ''));
    assert.deepEqual(rows.map((row) => row.rowNumber), [3, 4]);
  });

  it('reads only the first sheet', async () => {
    const file = await writeXlsx('two-sheets.xlsx', [['First'], ['row']], (sheet, workbook) => {
      workbook.addWorksheet('Second').addRow(['WRONG']);
    });
    const rows = await readAll(file);
    assert.deepEqual(rows.map((row) => row.cells[0]), ['First', 'row']);
  });

  it('streams thousands of rows and reports progress', async () => {
    const many = [['Name', 'Email', 'Phone']];
    for (let i = 0; i < 5000; i += 1) many.push([`Person ${i}`, `p${i}@example.com`, `+91${9000000000 + i}`]);
    const file = await writeXlsx('many.xlsx', many);
    let lastProgress = 0;
    let count = 0;
    for await (const row of readXlsxRows(file, (percent) => { lastProgress = percent; })) {
      count += 1;
      if (count === 5001) assert.deepEqual(row.cells, ['Person 4999', 'p4999@example.com', '+919000004999']);
    }
    assert.equal(count, 5001);
    assert.equal(lastProgress, 100);
  });

  it('can stop early and the file can then be deleted', async () => {
    const file = await writeXlsx('stop.xlsx', [['A'], ['B'], ['C']]);
    for await (const row of readXlsxRows(file)) {
      assert.equal(row.cells[0], 'A');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // the zip library closes the file asynchronously
    fs.rmSync(file); // would fail on Windows if the reader kept the file locked
  });

  it('rejects a damaged file', async () => {
    const file = path.join(folder, 'damaged.xlsx');
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]));
    await assert.rejects(readAll(file));
  });
});
