/** A sheet of cells read from a CSV or Excel file. Excel numbers stay numbers (dates arrive as serial days). */
export type Cell = string | number;
export type Rows = Cell[][];

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min > bestScore) {
      best = d;
      bestScore = min;
    }
  }
  return best;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, a BOM, any line ending. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): Rows {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with CRLF line ends, which Excel opens cleanly. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
