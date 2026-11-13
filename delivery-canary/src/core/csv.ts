/**
 * A small RFC 4180 CSV reader: quoted fields with commas, doubled quotes and
 * line breaks inside, CRLF or LF rows, a leading byte-order mark. Shopify's
 * exports are plain comma-separated UTF-8, so nothing more is needed and no
 * dependency is pulled in. Blank lines are skipped; an unclosed quote at the
 * end keeps what it read (the caller checks the columns it needs).
 */
export class CsvTooWide extends Error {}

export function parseCsv(text: string, opts: { maxColumns?: number } = {}): string[][] {
  const maxColumns = opts.maxColumns ?? Infinity;
  const rows: string[][] = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row: string[] = [];

  const endRow = () => {
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i <= n) {
    if (i === n) {
      // End of text right after a comma or at the start of a row.
      if (row.length) {
        row.push('');
        endRow();
      }
      break;
    }
    let field: string;
    if (text[i] === '"') {
      // Quoted field: read to the closing quote, turning "" into ".
      let out = '';
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          out += text.slice(j);
          j = n;
          break;
        }
        out += text.slice(j, q);
        if (text[q + 1] === '"') {
          out += '"';
          j = q + 2;
          continue;
        }
        j = q + 1;
        break;
      }
      // Anything between the closing quote and the delimiter is kept as written.
      let k = j;
      while (k < n && text[k] !== ',' && text[k] !== '\n' && text[k] !== '\r') k++;
      field = out + text.slice(j, k);
      i = k;
    } else {
      let k = i;
      while (k < n && text[k] !== ',' && text[k] !== '\n' && text[k] !== '\r') k++;
      field = text.slice(i, k);
      i = k;
    }
    row.push(field);
    // A hostile file of nothing but commas would otherwise build millions of fields in one row.
    if (row.length > maxColumns) throw new CsvTooWide(`More than ${maxColumns} columns in a row.`);
    if (i >= n) {
      endRow();
      break;
    }
    const c = text[i];
    if (c === ',') {
      i++;
      continue;
    }
    // A line break ends the row.
    i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    endRow();
  }
  return rows;
}

/** One CSV field: quoted when it holds a comma, quote or line break; formula starters are defused for spreadsheets. */
export function csvField(value: string | number): string {
  if (typeof value === 'number') return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
