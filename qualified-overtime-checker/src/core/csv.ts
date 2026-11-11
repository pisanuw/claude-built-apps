/**
 * A small CSV reader for payroll and timesheet exports: RFC 4180 quoting
 * (quoted fields with commas, doubled quotes and line breaks), a UTF-8 byte
 * order mark, CRLF or LF line ends, and comma, semicolon or tab separators
 * (whichever the header line uses most). Rows keep their 1-based line number
 * in the source file so the import report can point at a line.
 */

export interface CsvRow {
  /** 1-based line number where the row starts in the source text. */
  line: number;
  cells: string[];
}

export interface CsvTable {
  separator: string;
  rows: CsvRow[];
  /** The line of a quote that is never closed (everything after it became one cell). */
  unclosedQuote?: number;
}

/** The separator the first line uses most, outside quotes. Defaults to a comma. */
export function detectSeparator(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  let best = ',';
  for (const sep of [';', '\t']) if (counts[sep] > counts[best]) best = sep;
  return best;
}

/** Parses CSV text. Blank lines are dropped; cells are not trimmed. */
export function parseCsv(input: string, separator?: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = separator ?? detectSeparator(text);
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 0;

  const endRow = () => {
    cells.push(cell);
    if (cells.length > 1 || cells[0] !== '') rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      quoteLine = line;
    }
    else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length > 0) endRow();
  return quoted ? { separator: sep, rows, unclosedQuote: quoteLine } : { separator: sep, rows };
}

/** Quotes a value for CSV output when it needs it. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A text cell a spreadsheet would run as a formula (=, +, -, @ or a control
 * character first) gets a leading apostrophe; numbers and plain negative
 * amounts are left alone.
 */
export function safeCell(value: string | number | null | undefined): string | number | null | undefined {
  if (typeof value !== 'string') return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** CSV for download: formula-safe and quoted where needed. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => csvCell(safeCell(v))).join(',')).join('\r\n') + '\r\n';
}
