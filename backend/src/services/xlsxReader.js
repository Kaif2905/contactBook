// ---------------------------------------------------------------------------
// Reads the FIRST sheet of an .xlsx file row by row, using very little memory.
//
// Why not ExcelJS's streaming reader? It reads the zip from start to end in one
// pass, and when the sheet comes before sharedStrings.xml / workbook.xml inside the
// zip (Excel, ExcelJS and LibreOffice all do this) it parks the sheet in a temp file.
// On slower disks (typically Windows) its zip library reports "end" too early and
// the rest of the file is silently lost, so text cells come back empty.
//
// This reader avoids that completely: an .xlsx file is a zip, and a zip has a table
// of contents at the end. We jump straight to the parts we need, in the order we need:
//   1. xl/sharedStrings.xml  - the list of texts used by the cells
//   2. xl/workbook.xml + rels - to find which file is the first sheet
//   3. the sheet itself       - streamed and parsed row by row
// ---------------------------------------------------------------------------
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import yauzl from 'yauzl';
import saxes from 'saxes';

const { SaxesParser } = saxes;

/** "x:row" -> "row" (some programs put a prefix on every tag) */
function localName(name) {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** "AB12" -> 27 (0 = column A) */
function columnIndexFromRef(ref) {
  let index = 0;
  for (const char of ref) {
    const code = char.toUpperCase().charCodeAt(0);
    if (code < 65 || code > 90) break; // stop at the row number
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** Opens the zip and lists its files. Resolves { zip, entries } (entries keyed by lower-case name). */
function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const entries = new Map();
      zip.on('entry', (entry) => {
        entries.set(entry.fileName.replace(/\\/g, '/').toLowerCase(), entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', (zipError) => {
        zip.close();
        reject(zipError);
      });
      zip.readEntry();
    });
  });
}

function openEntryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

/**
 * Feeds one zip entry through an XML parser; `handlers` receive the parser events.
 * Pauses (yields) after every chunk so the caller can hand out finished rows.
 */
async function* parseEntry(zip, entry, handlers, onBytes) {
  const stream = await openEntryStream(zip, entry);
  const parser = new SaxesParser();
  parser.on('opentag', (node) => handlers.open?.(localName(node.name), node.attributes));
  parser.on('closetag', (node) => handlers.close?.(localName(node.name)));
  parser.on('text', (text) => handlers.text?.(text));
  parser.on('cdata', (text) => handlers.text?.(text));
  const decoder = new StringDecoder('utf8'); // keeps characters split across chunks intact
  try {
    for await (const chunk of stream) {
      onBytes?.(chunk.length);
      parser.write(decoder.write(chunk));
      yield;
    }
    parser.write(decoder.end());
    parser.close();
    yield;
  } finally {
    stream.destroy();
  }
}

/** Reads a whole (small) XML entry, just for its events. */
async function readEntry(zip, entry, handlers) {
  for await (const _chunk of parseEntry(zip, entry, handlers)) {
    // nothing to do between chunks - the handlers collect what we need
  }
}

/** All the texts in xl/sharedStrings.xml, in order. Cells refer to them by number. */
async function readSharedStrings(zip, entries) {
  const strings = [];
  const entry = entries.get('xl/sharedstrings.xml');
  if (!entry) return strings;

  let current = null;
  let inText = false;
  let inPhonetic = 0; // <rPh> holds pronunciation hints (Japanese) - not part of the text
  await readEntry(zip, entry, {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 'rPh') inPhonetic += 1;
      else if (name === 't' && current !== null && !inPhonetic) inText = true;
    },
    close(name) {
      if (name === 'si') {
        strings.push(current);
        current = null;
      } else if (name === 'rPh') inPhonetic -= 1;
      else if (name === 't') inText = false;
    },
    text(text) {
      if (inText) current += text;
    },
  });
  return strings;
}

/** Finds the zip path of the first sheet (as shown in Excel's tab order). */
async function findFirstSheet(zip, entries) {
  let firstSheetRelId = null;
  const workbook = entries.get('xl/workbook.xml');
  if (workbook) {
    await readEntry(zip, workbook, {
      open(name, attributes) {
        if (name === 'sheet' && firstSheetRelId === null) {
          const idAttribute = Object.keys(attributes).find((key) => key === 'r:id' || key.endsWith(':id'));
          firstSheetRelId = idAttribute ? attributes[idAttribute] : null;
        }
      },
    });
  }

  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (firstSheetRelId && rels) {
    let target = null;
    await readEntry(zip, rels, {
      open(name, attributes) {
        if (name === 'Relationship' && attributes.Id === firstSheetRelId) target = attributes.Target;
      },
    });
    if (target) {
      const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
      const entry = entries.get(sheetPath.toLowerCase());
      if (entry) return entry;
    }
  }

  // Fallback: the lowest numbered xl/worksheets/sheetN.xml
  const sheets = [...entries.keys()]
    .map((name) => ({ name, match: /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name) }))
    .filter((item) => item.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  return sheets.length > 0 ? entries.get(sheets[0].name) : null;
}

/** Turns the raw cell content into text, depending on the cell type. */
function cellText(type, raw, sharedStrings) {
  switch (type) {
    case 's':
      return sharedStrings[Number.parseInt(raw, 10)] ?? '';
    case 'inlineStr':
    case 'str':
    case 'd':
      return raw;
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'e':
      return ''; // #N/A, #DIV/0! ...
    default: {
      // plain numbers, e.g. a phone number typed without + -> "9876543210"
      const number = Number(raw);
      return raw !== '' && Number.isFinite(number) ? String(number) : raw;
    }
  }
}

/**
 * Yields { rowNumber, cells } for every row of the first sheet.
 * cells[0] = column A, as trimmed text. onProgress(percent) reports how far we are.
 */
export async function* readXlsxRows(filePath, onProgress = null) {
  const { zip, entries } = await openZip(filePath);
  try {
    const sharedStrings = await readSharedStrings(zip, entries);
    const sheetEntry = await findFirstSheet(zip, entries);
    if (!sheetEntry) return; // no sheet at all -> treated as an empty file

    const ready = []; // finished rows waiting to be handed out
    let rowNumber = 0;
    let cells = null;
    let nextColumn = 0;
    let cell = null; // { column, type, raw }
    let inValue = false;
    let inInline = false;
    let inText = false;
    let inPhonetic = 0;

    const handlers = {
      open(name, attributes) {
        switch (name) {
          case 'row':
            rowNumber = attributes.r ? Number.parseInt(attributes.r, 10) : rowNumber + 1;
            cells = [];
            nextColumn = 0;
            break;
          case 'c': {
            const column = attributes.r ? columnIndexFromRef(attributes.r) : nextColumn;
            nextColumn = column + 1;
            cell = { column, type: attributes.t || 'n', raw: '' };
            break;
          }
          case 'v':
            inValue = true;
            break;
          case 'is':
            inInline = true;
            break;
          case 'rPh':
            inPhonetic += 1;
            break;
          case 't':
            if (inInline && !inPhonetic) inText = true;
            break;
          default:
            break;
        }
      },
      close(name) {
        switch (name) {
          case 'v':
            inValue = false;
            break;
          case 't':
            inText = false;
            break;
          case 'rPh':
            inPhonetic -= 1;
            break;
          case 'is':
            inInline = false;
            break;
          case 'c':
            if (cell && cells) cells[cell.column] = cellText(cell.type, cell.raw, sharedStrings).trim();
            cell = null;
            break;
          case 'row':
            if (cells) ready.push({ rowNumber, cells: Array.from(cells, (value) => value ?? '') });
            cells = null;
            break;
          default:
            break;
        }
      },
      text(text) {
        if (cell && (inValue || inText)) cell.raw += text;
      },
    };

    const total = sheetEntry.uncompressedSize || 0;
    let done = 0;
    const onBytes = (bytes) => {
      done += bytes;
      if (onProgress && total > 0) onProgress(Math.min(100, (done / total) * 100));
    };

    for await (const _chunk of parseEntry(zip, sheetEntry, handlers, onBytes)) {
      // hand out the rows finished by this chunk
      for (const row of ready.splice(0)) yield row;
    }
  } finally {
    zip.close(); // releases the file (Windows cannot delete a file that is still open)
  }
}
