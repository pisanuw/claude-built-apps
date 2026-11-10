/**
 * Turns a timesheet or payroll CSV into TimeLines: guesses which column is
 * which from the header row (the user can change every choice), drops any
 * column that looks like a Social Security number before anything is kept,
 * and reports every row it could not use with its line number.
 */
import { parseCsv, type CsvTable } from './csv';
import { parseDate } from './dates';
import type { LineKind, TimeLine } from './types';

export const FIELDS = ['employeeId', 'employeeName', 'firstName', 'lastName', 'date', 'hours', 'overtimeHours', 'doubleHours', 'rate', 'amount', 'payDate', 'code'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number | null>;

export const FIELD_LABELS: Record<Field, string> = {
  employeeId: 'Employee ID',
  employeeName: 'Employee name',
  firstName: 'First name',
  lastName: 'Last name',
  date: 'Work date',
  hours: 'Hours (regular, or all hours)',
  overtimeHours: 'Overtime hours (own column)',
  doubleHours: 'Double-time hours (own column)',
  rate: 'Hourly rate',
  amount: 'Pay amount',
  payDate: 'Pay date (check date)',
  code: 'Pay type or item',
};

/** Normalised header: lower case, letters, digits, # and single spaces. */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
}

const SSN_HEADER = /\b(ssn|ss#|ss ?no|ss ?num(ber)?|social security|soc sec|taxpayer id|tax ?id|tin|itin)(?!\w)/;
// Dashed, or nine digits in a row (an undashed SSN in an "ID" column must not be kept).
const SSN_VALUE = /^\d{3}-\d{2}-\d{4}$|^\d{9}$/;

/** Indexes of columns that hold SSNs, by header or by values shaped 123-45-6789 or 123456789. */
export function ssnColumns(table: CsvTable): number[] {
  const [head, ...body] = table.rows;
  if (!head) return [];
  const out: number[] = [];
  head.cells.forEach((h, i) => {
    if (SSN_HEADER.test(normHeader(h)) || SSN_HEADER.test(h.toLowerCase())) {
      out.push(i);
      return;
    }
    const values = body.map((r) => (r.cells[i] ?? '').trim()).filter((v) => v !== '');
    if (values.length > 0 && values.filter((v) => SSN_VALUE.test(v)).length / values.length >= 0.5) out.push(i);
  });
  return out;
}

/** Header patterns, tried in order; the first unused column that matches wins. */
const GUESSES: [Field, RegExp][] = [
  ['payDate', /^(pay|check|payment|paid|payroll) ?(date|day)$|^paid on$|^check dt$/],
  ['overtimeHours', /^(ot|overtime|o t) ?(hours|hrs)$|^(hours|hrs) ?(ot|overtime)$|^overtime$/],
  ['doubleHours', /^(dt|double|double time|doubletime) ?(hours|hrs)?$|^(hours|hrs) ?(dt|double)$/],
  ['employeeId', /^(employee|emp|worker|staff|team member|payroll) ?(id|#|no|number|num|code|badge)$|^(id|badge( number)?)$/],
  ['firstName', /^(employee )?first( name)?$|^given name$/],
  ['lastName', /^(employee )?(last|sur)( name)?$|^surname$|^family name$/],
  ['employeeName', /^(employee|employee name|employee full name|name|full name|worker|staff|team member|staff member)$/],
  ['date', /^(date|work date|activity date|shift date|date worked|clock in date|in date|business date|time entry date)$/],
  ['hours', /^(hours|hrs|duration|total hours|hours worked|regular hours|qty|quantity|time|total)$/],
  ['rate', /^(rate|pay rate|hourly rate|wage|wage rate|hourly wage|rate per hour|bill rate|cost rate)$/],
  ['amount', /^(amount|earnings|pay|gross|gross pay|total pay|wages|current amount|line total)$/],
  ['code', /^(pay type|pay code|earning|earnings code|earning code|earnings type|item|service item|payroll item|job|type|category|code|wage type|pay item)$/],
];

/** Looser second pass: a header that contains the word. */
const LOOSE: [Field, RegExp][] = [
  ['payDate', /\b(pay|check) ?date\b/],
  ['date', /\bdate\b/],
  ['hours', /\b(hours|hrs|duration)\b/],
  ['rate', /\brate\b/],
  ['amount', /\b(amount|earnings|gross)\b/],
  ['employeeName', /\b(employee|name)\b/],
  ['code', /\b(type|code|item|earning)\b/],
];

export function emptyMapping(): Mapping {
  return Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;
}

/** Guesses the mapping from the header row, never choosing an SSN column. */
export function guessMapping(header: string[], skip: number[] = []): Mapping {
  const mapping = emptyMapping();
  const used = new Set<number>(skip);
  const norm = header.map(normHeader);
  for (const pass of [GUESSES, LOOSE]) {
    for (const [field, re] of pass) {
      if (mapping[field] !== null) continue;
      const i = norm.findIndex((h, idx) => !used.has(idx) && re.test(h));
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
      }
    }
  }
  // A single name column plus separate first/last would double up: prefer the split pair.
  if (mapping.firstName !== null && mapping.lastName !== null && mapping.employeeName !== null && /\b(employee|name)\b/.test(norm[mapping.employeeName]) && !/^(employee|employee name|name|full name)$/.test(norm[mapping.employeeName])) {
    mapping.employeeName = null;
  }
  return mapping;
}

/** What is missing before an import can run, as sentences; empty when the mapping is usable. */
export function mappingProblems(m: Mapping): string[] {
  const out: string[] = [];
  if (m.employeeId === null && m.employeeName === null && (m.firstName === null || m.lastName === null)) out.push('Choose the column with the employee name or ID.');
  if (m.date === null) out.push('Choose the column with the date the hours were worked.');
  if (m.hours === null) out.push('Choose the column with the hours.');
  if (m.rate === null && m.amount === null) out.push('Choose the column with the hourly rate or the pay amount.');
  return out;
}

/**
 * Parses a money cell: $1,234.50, (12.00), -12, 18.5. NaN when empty or not a
 * number. With `decimalComma` (semicolon-separated files) 1.234,50 is 1234.5.
 */
export function parseMoney(raw: string, decimalComma = false): number {
  let s = raw.trim().replace(/[$\s]/g, '').replace(/USD$/i, '');
  s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return NaN;
  return sign * Number(s);
}

/** Parses hours: 8.5, 8:30 (hours:minutes), 8h 30m, 8 hrs. NaN when not hours. */
export function parseHours(raw: string, decimalComma = false): number {
  const s = raw.trim().toLowerCase();
  if (s === '') return NaN;
  let m = /^(-?)(\d+):([0-5]\d)(?::[0-5]\d)?$/.exec(s);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
  m = /^(\d+(?:\.\d+)?) ?h(?:rs?|ours?)?(?: ?(\d+) ?m(?:in(?:utes?)?)?)?$/.exec(s);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  m = /^(\d+) ?m(?:in(?:utes?)?)?$/.exec(s);
  if (m) return Number(m[1]) / 60;
  return parseMoney(s, decimalComma);
}

const EXCLUDED = /\b(holiday|vacation|sick|pto|paid time off|bereavement|jury|leave|personal|unworked|time off)\b/;
const HOLIDAY_WORKED = /\bholiday (worked|work)\b|\bworked holiday\b/;
const DOUBLE = /\b(double|dt|2x|2\.0x|2\.0)\b/;
const OVERTIME = /\b(overtime|ot|o\/t|1\.5x|1\.5|time and a half|time and one half)\b/;
const LUMP = /\b(bonus|commission|incentive|award|tips?|gratuit\w*|reimburse\w*|mileage|per diem|allowance|severance|differential|shift diff|shift premium)\b/;

/** Classifies a pay code. `lump` means pay that is not hours at a rate (not used yet). */
export function classifyCode(code: string): { kind: LineKind; multiplier: number } | { kind: 'lump' } {
  const c = code.toLowerCase();
  if (LUMP.test(c)) return { kind: 'lump' };
  if (DOUBLE.test(c)) return { kind: 'overtime', multiplier: 2 };
  if (OVERTIME.test(c)) return { kind: 'overtime', multiplier: 1.5 };
  if (EXCLUDED.test(c) && !HOLIDAY_WORKED.test(c)) return { kind: 'excluded', multiplier: 1 };
  return { kind: 'work', multiplier: 1 };
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ImportReport {
  rowsRead: number;
  linesUsed: number;
  skipped: SkippedRow[];
  /** Header names of the columns dropped as Social Security numbers. */
  droppedColumns: string[];
  employees: number;
  firstDate: string | null;
  lastDate: string | null;
  overtimeLines: number;
  excludedLines: number;
  /** Rows whose pay date could not be read (the line is kept without one). */
  badPayDates: number;
}

export interface ImportResult {
  lines: TimeLine[];
  report: ImportReport;
}

function cell(cells: string[], i: number | null): string {
  return i === null ? '' : (cells[i] ?? '').trim();
}

export function employeeKey(id: string, name: string): string {
  return id ? `id:${id.toLowerCase()}` : `name:${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

/** Converts parsed rows with a mapping. The first row of the table is the header. */
export function importRows(table: CsvTable, mapping: Mapping): ImportResult {
  const drop = new Set(ssnColumns(table));
  const header = table.rows[0]?.cells ?? [];
  const safe = { ...mapping };
  for (const f of FIELDS) if (safe[f] !== null && drop.has(safe[f] as number)) safe[f] = null;

  const comma = table.separator === ';';
  const lines: TimeLine[] = [];
  const skipped: SkippedRow[] = [];
  let badPayDates = 0;
  const body = table.rows.slice(1);
  for (const row of body) {
    const c = row.cells;
    const id = cell(c, safe.employeeId);
    const full = cell(c, safe.employeeName) || [cell(c, safe.firstName), cell(c, safe.lastName)].filter(Boolean).join(' ');
    const name = full || id;
    if (!name) {
      skipped.push({ line: row.line, reason: 'No employee name or ID.' });
      continue;
    }
    if (/^(total|totals|grand total|subtotal|report total)\b/i.test(name)) {
      skipped.push({ line: row.line, reason: 'A total row, not a time entry.' });
      continue;
    }
    const code = cell(c, safe.code);
    const cls = classifyCode(code);
    const regRaw = parseHours(cell(c, safe.hours), comma);
    const ot = safe.overtimeHours === null ? 0 : parseHours(cell(c, safe.overtimeHours), comma);
    const dt = safe.doubleHours === null ? 0 : parseHours(cell(c, safe.doubleHours), comma);
    const otHours = Number.isFinite(ot) ? ot : 0;
    const dtHours = Number.isFinite(dt) ? dt : 0;
    const wide = otHours !== 0 || dtHours !== 0;
    // In a wide row (own overtime columns) a blank regular-hours cell means 0.
    const hours = wide && !Number.isFinite(regRaw) ? 0 : regRaw;
    const rateCell = parseMoney(cell(c, safe.rate), comma);
    const amount = parseMoney(cell(c, safe.amount), comma);
    if (cls.kind === 'lump' || (!Number.isFinite(hours) && Number.isFinite(amount))) {
      skipped.push({ line: row.line, reason: `${code || 'Pay without hours'}: bonuses, commissions, tips and shift differentials are not used yet, so the regular rate may be understated.` });
      continue;
    }
    const date = parseDate(cell(c, safe.date));
    if (!date) {
      skipped.push({ line: row.line, reason: `The work date "${cell(c, safe.date)}" could not be read.` });
      continue;
    }
    if (!Number.isFinite(hours)) {
      skipped.push({ line: row.line, reason: `The hours "${cell(c, safe.hours)}" could not be read.` });
      continue;
    }
    if (hours + otHours + dtHours === 0) {
      skipped.push({ line: row.line, reason: 'Zero hours.' });
      continue;
    }
    // The rate column is the straight rate in a wide row; without one, the
    // amount pays the regular hours plus 1.5x and 2x for the overtime columns.
    let rate = rateCell;
    if (!Number.isFinite(rate) || rate === 0) rate = Number.isFinite(amount) ? amount / (hours + 1.5 * otHours + 2 * dtHours) : NaN;
    if (!Number.isFinite(rate) || rate < 0) {
      skipped.push({ line: row.line, reason: 'No hourly rate or pay amount.' });
      continue;
    }
    const payRaw = cell(c, safe.payDate);
    const payDate = payRaw ? parseDate(payRaw) : null;
    if (payRaw && !payDate) badPayDates++;
    const base = { employeeKey: employeeKey(id, name), employeeId: id, employeeName: name, date, payDate, code, line: row.line };
    if (hours !== 0) lines.push({ ...base, hours, rate, kind: cls.kind, multiplier: cls.multiplier });
    if (otHours !== 0) lines.push({ ...base, hours: otHours, rate: rate * 1.5, kind: 'overtime', multiplier: 1.5, code: code || 'Overtime hours column' });
    if (dtHours !== 0) lines.push({ ...base, hours: dtHours, rate: rate * 2, kind: 'overtime', multiplier: 2, code: code || 'Double-time hours column' });
  }
  // A row with a blank ID but the name of an employee who has one (a
  // correction line, say) belongs to that employee, not to a second one.
  const idsByName = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.employeeId) continue;
    const n = employeeKey('', l.employeeName);
    idsByName.set(n, (idsByName.get(n) ?? new Set()).add(l.employeeId));
  }
  for (const l of lines) {
    if (l.employeeId) continue;
    const ids = idsByName.get(l.employeeKey);
    if (ids && ids.size === 1) {
      l.employeeId = [...ids][0];
      l.employeeKey = employeeKey(l.employeeId, l.employeeName);
    }
  }
  const dates = lines.map((l) => l.date).sort();
  return {
    lines,
    report: {
      rowsRead: body.length,
      linesUsed: lines.length,
      skipped,
      droppedColumns: [...drop].map((i) => header[i] || `column ${i + 1}`),
      employees: new Set(lines.map((l) => l.employeeKey)).size,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      overtimeLines: lines.filter((l) => l.kind === 'overtime').length,
      excludedLines: lines.filter((l) => l.kind === 'excluded').length,
      badPayDates,
    },
  };
}

/** Parses CSV text, guesses the mapping and imports in one step. */
export function importCsv(text: string, mapping?: Mapping): ImportResult & { table: CsvTable; mapping: Mapping } {
  const table = parseCsv(text);
  const header = table.rows[0]?.cells ?? [];
  const m = mapping ?? guessMapping(header, ssnColumns(table));
  return { table, mapping: m, ...importRows(table, m) };
}
