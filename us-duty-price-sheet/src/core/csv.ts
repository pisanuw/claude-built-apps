/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF, and a BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Blank rows are kept so row numbers in messages match the file; trailing ones are dropped.
  while (rows.length && isBlank(rows[rows.length - 1])) rows.pop();
  return rows;
}

export function isBlank(row: string[]): boolean {
  return row.every((f) => f.trim() === '');
}

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas in exported text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
