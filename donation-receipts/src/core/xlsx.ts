/**
 * A small reader for the first worksheet of an .xlsx file (what Xero's
 * "Export > Excel" produces). An .xlsx is a ZIP of XML files; entries are
 * stored or deflated, and the browser's DecompressionStream inflates them,
 * so no spreadsheet library is needed.
 */
import type { Cell, Rows } from './table';

interface Entry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** List the files in a ZIP from its central directory. */
export function zipEntries(bytes: Uint8Array): Entry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    entries.push({
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(bytes, p + 10),
      size: u32(bytes, p + 20),
      offset: u32(bytes, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read one ZIP entry as text. */
export async function readEntry(bytes: Uint8Array, e: Entry): Promise<string> {
  const p = e.offset;
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const raw = bytes.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method === 8) return new TextDecoder().decode(await inflate(raw));
  throw new Error('The Excel file uses a compression this app cannot read. Save it as CSV and try again.');
}

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/** Text of every <t> run inside a fragment (shared strings and inline strings can be split into runs). */
function runs(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]!);
  return out;
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => runs(m[1] ?? ''));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheet(xml: string, shared: string[]): Rows {
  const rows: Rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: Cell[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = runs(body);
      else if (type === 'str' || type === 'e') value = decodeXml(v ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined && v !== '') value = Number(v);
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** The first worksheet (in workbook order) of an .xlsx file as rows of cells. */
export async function readXlsx(bytes: Uint8Array): Promise<Rows> {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(await readEntry(bytes, wb))?.[1];
    const relsXml = await readEntry(bytes, rels);
    const target = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)]
      .map((m) => m[0])
      .find((r) => r.includes(`Id="${rid}"`));
    const t = target && /Target="([^"]+)"/.exec(target)?.[1];
    if (t) sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
  }
  const sheet = byName.get(sheetPath) ?? entries.find((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name));
  if (!sheet) throw new Error('No worksheet found in this Excel file.');
  const ss = byName.get('xl/sharedStrings.xml');
  const shared = ss ? parseSharedStrings(await readEntry(bytes, ss)) : [];
  return parseSheet(await readEntry(bytes, sheet), shared);
}
