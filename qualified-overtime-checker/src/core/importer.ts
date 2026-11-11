/**
 * Turns a timesheet or payroll CSV into TimeLines: guesses which column is
 * which from the header row (the user can change every choice), drops any
 * column that looks like a Social Security number before anything is kept,
 * and reports every row it could not use with its line number.
 */
import { parseCsv, type CsvTable } from './csv';
import { parseDate } from './dates';
import type { LineKind, TimeLine } from './types';

export const FIELDS = ['employeeId', 'employeeName', 'firstName', 'lastName', 'employeeGroup', 'entryId', 'date', 'hours', 'overtimeHours', 'doubleHours', 'rate', 'amount', 'overtimePay', 'payDate', 'code', 'earnedFrom', 'earnedTo'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number | null>;

export const FIELD_LABELS: Record<Field, string> = {
  employeeId: 'Employee ID',
  employeeName: 'Employee name',
  firstName: 'First name',
  lastName: 'Last name',
  employeeGroup: 'Employee (a name row above their lines)',
  entryId: 'Time entry ID (tells repeated shifts apart)',
  date: 'Work date',
  hours: 'Hours (regular, or all hours)',
  overtimeHours: 'Overtime hours (own column)',
  doubleHours: 'Double-time hours (own column)',
  rate: 'Hourly rate',
  amount: 'Pay amount',
  overtimePay: 'Overtime pay (own column)',
  payDate: 'Pay date (check date)',
  code: 'Pay type or item',
  earnedFrom: 'Bonus earned from (period start)',
  earnedTo: 'Bonus earned to (period end)',
};

/** Normalised header: lower case, letters, digits, # and single spaces. */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
}

const SSN_HEADER = /\b(ssn|ss#|ss ?no|ss ?num(ber)?|social security|soc sec|taxpayer id|tax ?id|tin|itin)(?!\w)/;
/** Run-together headers: "SocialSecurityNumber", "EmpSSN", "SocSecNo". */
const SSN_SQUASHED = /ssn|socialsecurity|socsec|taxpayerid/;
// Dashed, or nine digits in a row (an undashed SSN in an "ID" column must not be kept).
const SSN_VALUE = /^\d{9}$/;
/** Digits of a value written 123-45-6789, 123 45 6789, 123.45.6789 or 123456789. */
const ssnDigits = (v: string) => (/^\d{3}[-. ]?\d{2}[-. ]?\d{4}$/.test(v) ? v.replace(/[-. ]/g, '') : v);

/** Indexes of columns that hold SSNs, by header or by values shaped 123-45-6789 or 123456789. */
export function ssnColumns(table: CsvTable): number[] {
  const [head, ...body] = table.rows;
  if (!head) return [];
  const out: number[] = [];
  head.cells.forEach((h, i) => {
    if (SSN_HEADER.test(normHeader(h)) || SSN_HEADER.test(h.toLowerCase()) || SSN_SQUASHED.test(h.toLowerCase().replace(/[^a-z]/g, ''))) {
      out.push(i);
      return;
    }
    const values = body.map((r) => (r.cells[i] ?? '').trim()).filter((v) => v !== '');
    // One value written like an SSN (123-45-6789) is enough: the column is dropped, not kept and printed.
    if (values.some((v) => /^\d{3}-\d{2}-\d{4}$/.test(v))) out.push(i);
    else if (values.length > 0 && values.filter((v) => SSN_VALUE.test(ssnDigits(v))).length / values.length >= 0.5) out.push(i);
  });
  return out;
}

/** Header patterns, tried in order; the first unused column that matches wins. */
const GUESSES: [Field, RegExp][] = [
  ['payDate', /^(pay|check|payment|paid|payroll) ?(date|day)$|^paid on$|^check dt$/],
  ['overtimeHours', /^(ot|overtime|o t) ?(hours|hrs)$|^(hours|hrs) ?(ot|overtime)$|^overtime$/],
  ['overtimePay', /^(ot|overtime) ?(pay|earnings|wages|amount)$/],
  ['entryId', /^(time entry|entry|shift|punch) ?(id|guid|number|no)$/],
  ['doubleHours', /^(dt|double|double time|doubletime) ?(hours|hrs)?$|^(hours|hrs) ?(dt|double)$/],
  ['employeeId', /^(employee|emp|worker|staff|team member|payroll) ?(id|#|no|number|num|code|badge)$|^(id|badge( number)?)$/],
  ['firstName', /^(employee )?first( name)?$|^given name$/],
  ['lastName', /^(employee )?(last|sur)( name)?$|^surname$|^family name$/],
  ['employeeName', /^(employee|employee name|employee full name|name|full name|worker|staff|team member|staff member)$/],
  ['date', /^(date|work date|activity date|shift date|date worked|clock in date|in date|business date|time entry date)$/],
  ['hours', /^(hours|hrs|duration|total hours|hours worked|regular hours|qty|quantity|time|total)$/],
  ['rate', /^(rate|pay rate|hourly rate|wage|wage rate|hourly wage|rate per hour|bill rate|cost rate)$/],
  ['amount', /^(amount|earnings|pay|gross|gross pay|total pay|wages|current amount|line total)$/],
  // Only earning-period columns: a pay period's dates are not when a bonus was earned.
  ['earnedFrom', /^(earned|period earned|earning period|bonus period) ?(from|start|begin)?$|^earned from( date)?$/],
  ['earnedTo', /^(earned|period earned|earning period|bonus period) ?(to|end|through)$|^earned (to|through)( date)?$/],
  ['code', /^(pay type|pay code|earning|earnings code|earning code|earnings type|item|service item|payroll item|job|type|category|code|wage type|pay item)$/],
];

/** Looser second pass: a header that contains the word. */
const LOOSE: [Field, RegExp][] = [
  ['payDate', /\b(pay|check) ?date\b/],
  ['date', /\bdate\b/],
  // Weekly totals ("Week Ending"), and pay-period totals, which the import then refuses by name.
  ['date', /\b(week|period) (ending|end|start|starting|beginning|of)\b|^week$/],
  ['hours', /\b(hours|hrs|duration)\b/],
  ['rate', /\brate\b/],
  ['amount', /\b(amount|earnings|gross)\b/],
  ['employeeName', /\b(employee|name)\b/],
  ['code', /\b(type|code|item|earning)\b/],
];

export function emptyMapping(): Mapping {
  return Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;
}

/**
 * Export layouts the checker knows by name. `confirmed` says whether the
 * column names come from the vendor's own documentation or are inferred.
 * Each sets the columns that a plain guess would get wrong.
 */
export interface Layout {
  name: string;
  confirmed: boolean;
  note: string;
  detect(norm: string[]): boolean;
  columns: Partial<Record<Field, string | null>>;
}

export const LAYOUTS: Layout[] = [
  {
    // Toast's TimeEntries.csv, field reference at doc.toasttab.com (adminDataExportFieldReference), read 11 Nov 2026.
    name: 'Toast time entries',
    confirmed: true,
    note: 'Columns from Toast\u2019s published field reference. Regular and overtime hours are read separately (Total Hours already includes the overtime), the hourly rate is Wage, and Overtime Pay shows the premium actually paid. Tips are left out of the regular rate.',
    detect: (n) => ['in date', 'regular hours', 'overtime hours', 'wage'].every((h) => n.includes(h)),
    columns: { employeeName: 'employee', employeeId: 'employee id', entryId: 'guid', date: 'in date', hours: 'regular hours', overtimeHours: 'overtime hours', rate: 'wage', overtimePay: 'overtime pay', amount: null, code: null },
  },
  {
    // QuickBooks Online "Time Activities by Employee Detail": no published header list; inferred from Intuit community answers (2021, 2025).
    name: 'QuickBooks Online time activities',
    confirmed: false,
    note: 'Layout inferred, not confirmed by Intuit: check the columns. Each employee\u2019s name is on a row above their lines; Duration is hours:minutes; Rates and Amount are what the customer is billed, not pay, so enter each employee\u2019s pay rate in step 3.',
    detect: (n) => n.includes('activity date') && n.includes('duration') && !n.some((h) => /\b(employee|name|first|last)\b/.test(h)),
    // "Rates" (billing) is never guessed as the pay rate; Amount is what the customer is billed.
    columns: { date: 'activity date', hours: 'duration', rate: null, amount: null, code: null },
  },
];

/** The known layout these headers match, if any. */
export function detectLayout(header: string[]): Layout | null {
  const norm = header.map(normHeader);
  return LAYOUTS.find((l) => l.detect(norm)) ?? null;
}

/** Guesses the mapping from the header row, never choosing an SSN column. */
export function guessMapping(header: string[], skip: number[] = []): Mapping {
  const mapping = emptyMapping();
  const used = new Set<number>(skip);
  const norm = header.map(normHeader);
  const layout = detectLayout(header);
  if (layout) {
    for (const [field, name] of Object.entries(layout.columns) as [Field, string | null][]) {
      const i = name === null ? -1 : norm.findIndex((h, idx) => h === name && !used.has(idx));
      if (name === null) mapping[field] = null;
      else if (i >= 0) {
        mapping[field] = i;
        used.add(i);
      }
    }
  }
  const fixed = new Set<Field>(layout ? (Object.keys(layout.columns) as Field[]) : []);
  for (const pass of [GUESSES, LOOSE]) {
    for (const [field, re] of pass) {
      if (mapping[field] !== null || fixed.has(field)) continue;
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
  // Total hours already include the overtime: with an overtime column, read regular hours.
  if (mapping.overtimeHours !== null && mapping.hours !== null && /\b(total|payable|all)\b/.test(norm[mapping.hours])) {
    const reg = norm.findIndex((h, idx) => /^(regular|reg|straight) ?(hours|hrs|time)$/.test(h) && !skip.includes(idx));
    if (reg >= 0) mapping.hours = reg;
  }
  // No employee column, and a blank first header: employee names sit on rows above their lines.
  if (mapping.employeeId === null && mapping.employeeName === null && (mapping.firstName === null || mapping.lastName === null) && header.length > 1 && (header[0] ?? '').trim() === '' && !skip.includes(0)) {
    mapping.employeeGroup = 0;
  }
  return mapping;
}

/** What is missing before an import can run, as sentences; empty when the mapping is usable. */
export function mappingProblems(m: Mapping): string[] {
  const out: string[] = [];
  if (m.employeeId === null && m.employeeName === null && m.employeeGroup === null && (m.firstName === null || m.lastName === null)) out.push('Choose the column with the employee name or ID.');
  if (m.date === null) out.push('Choose the column with the date the hours were worked.');
  if (m.hours === null) out.push('Choose the column with the hours.');
  // No rate or amount is allowed: the pay rates are then entered per employee.
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
/** Pay that is not part of the regular rate at all (29 CFR 778.200 and following): gifts, discretionary bonuses, tips, expenses. */
const NOT_WAGES = /\b((?<!non[- ]?)discretionary|gift|christmas bonus|holiday bonus|tips?|gratuit\w*|reimburse\w*|expense\w*|mileage|per diem|allowance|severance|referral)\b/;
/** Non-discretionary bonuses and commissions: spread over the weeks they were earned in (778.209-210, 778.117). */
const BONUS = /\b(bonus\w*|commission\w*|incentive\w*|production|attendance|retention|safety award|award)\b/;
/** Pay that adds to the week it was earned in: shift differentials and premiums (778.207). */
const EXTRA = /\b(differential|shift diff|shift premium|night premium|hazard pay|on.call pay|lead pay)\b/;

/**
 * Classifies a pay code. A row with worked hours is always work, overtime or
 * paid time off (a "Tip credit hours" or "Per Diem RN" row is hours worked);
 * only a row without hours can be a bonus, or pay the regular rate leaves out
 * (`not-wages`: counted, then dropped). A differential is `extra` either way,
 * with the overtime multiplier when it is an overtime differential.
 */
export function classifyCode(code: string, hasHours = false): { kind: LineKind | 'not-wages'; multiplier: number } {
  const c = code.toLowerCase();
  const multiplier = DOUBLE.test(c) ? 2 : OVERTIME.test(c) ? 1.5 : 1;
  if (EXTRA.test(c)) return { kind: 'extra', multiplier };
  if (!hasHours) {
    if (NOT_WAGES.test(c)) return { kind: 'not-wages', multiplier: 1 };
    if (BONUS.test(c)) return { kind: 'bonus', multiplier: 1 };
  }
  if (multiplier > 1) return { kind: 'overtime', multiplier };
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
  /** Rows that gave at least one line (a row with overtime columns gives two). */
  rowsUsed: number;
  skipped: SkippedRow[];
  /** Header names of the columns dropped as Social Security numbers. */
  droppedColumns: string[];
  employees: number;
  firstDate: string | null;
  lastDate: string | null;
  overtimeLines: number;
  excludedLines: number;
  /** Bonus and commission lines, spread over the weeks they were earned in. */
  bonusLines: number;
  /** Shift differential and similar lines added to their week's pay. */
  extraLines: number;
  /** Gifts, discretionary bonuses, tips and expense lines: not part of the regular rate, left out. */
  notWagesLines: number;
  /** Lines of an hours-only file: their pay rate is entered per employee. */
  rateMissingLines: number;
  /** The header of the date column (a "period" in it means pay-period rows). */
  dateHeader: string;
  /** Hours were a total including overtime; the overtime columns were taken out. */
  hoursWereTotal: boolean;
  /** The known export layout, when the headers match one. */
  layout: { name: string; confirmed: boolean; note: string } | null;
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

/**
 * A row with a blank ID but the name of an employee who has one (a correction
 * line, or a second export without IDs) belongs to that employee, not to a
 * second one. Changes the lines in place.
 */
export function linkNamesToIds(lines: TimeLine[]): void {
  const idsByName = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.employeeId) continue;
    const n = employeeKey('', l.employeeName);
    idsByName.set(n, (idsByName.get(n) ?? new Set()).add(l.employeeId));
  }
  for (const l of lines) {
    if (l.employeeId) continue;
    const ids = idsByName.get(employeeKey('', l.employeeName));
    if (ids && ids.size === 1) {
      l.employeeId = [...ids][0];
      l.employeeKey = employeeKey(l.employeeId, l.employeeName);
    }
  }
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
  let group = '';
  const hoursAreTotal = (safe.overtimeHours !== null || safe.doubleHours !== null) && safe.hours !== null && /\b(total|payable|all)\b/.test(normHeader(header[safe.hours] ?? ''));
  // No rate and no amount column: an hours-only file; pay rates are entered per employee.
  const hoursOnly = safe.rate === null && safe.amount === null;
  let rateMissingLines = 0;
  const lines: TimeLine[] = [];
  const skipped: SkippedRow[] = [];
  let badPayDates = 0;
  let notWagesLines = 0;
  const body = table.rows.slice(1);
  for (const row of body) {
    const c = row.cells;
    if (safe.employeeGroup !== null) {
      const label = cell(c, safe.employeeGroup);
      const rest = c.filter((_, i) => i !== safe.employeeGroup).some((v) => v.trim() !== '');
      if (label && !rest) {
        // A name row: the lines below belong to this employee.
        group = /^(total|totals|grand total)\b/i.test(label) ? '' : label;
        continue;
      }
      if (/^total for\b|^(total|totals|grand total)\b/i.test(label)) {
        group = '';
        continue;
      }
    }
    const id = cell(c, safe.employeeId);
    const full = cell(c, safe.employeeName) || [cell(c, safe.firstName), cell(c, safe.lastName)].filter(Boolean).join(' ') || (safe.employeeGroup !== null ? group : '');
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
    const regRaw = parseHours(cell(c, safe.hours), comma);
    const ot = safe.overtimeHours === null ? 0 : parseHours(cell(c, safe.overtimeHours), comma);
    const dt = safe.doubleHours === null ? 0 : parseHours(cell(c, safe.doubleHours), comma);
    const otHours = Number.isFinite(ot) ? ot : 0;
    const dtHours = Number.isFinite(dt) ? dt : 0;
    const wide = otHours !== 0 || dtHours !== 0;
    // In a wide row (own overtime columns) a blank regular-hours cell means 0;
    // a total-hours column already includes the overtime, so take it out.
    const hours = wide && !Number.isFinite(regRaw) ? 0 : hoursAreTotal && Number.isFinite(regRaw) ? regRaw - otHours - dtHours : regRaw;
    const rateCell = parseMoney(cell(c, safe.rate), comma);
    const amount = parseMoney(cell(c, safe.amount), comma);
    const cls = classifyCode(code, (Number.isFinite(hours) && hours !== 0) || wide);
    if (cls.kind === 'not-wages') {
      notWagesLines++;
      continue;
    }
    if (cls.kind === 'bonus' || cls.kind === 'extra') {
      // Pay with no hours of its own: the amount, or hours x rate for a differential given per hour.
      const pay = Number.isFinite(amount) ? amount : Number.isFinite(hours) && Number.isFinite(rateCell) ? hours * rateCell : NaN;
      const payRawB = cell(c, safe.payDate);
      const payDateB = payRawB ? parseDate(payRawB) : null;
      const workDate = parseDate(cell(c, safe.date));
      const dateB = workDate ?? payDateB;
      if (!Number.isFinite(pay) || pay === 0) {
        skipped.push({ line: row.line, reason: `${code}: no amount to add to the regular rate.` });
        continue;
      }
      if (!dateB) {
        skipped.push({ line: row.line, reason: `${code}: no work date or pay date to place it in a week.` });
        continue;
      }
      const from = parseDate(cell(c, safe.earnedFrom));
      const to = parseDate(cell(c, safe.earnedTo));
      lines.push({
        employeeKey: employeeKey(id, name),
        employeeId: id,
        employeeName: name,
        date: dateB,
        hours: 0,
        rate: 0,
        kind: cls.kind,
        multiplier: cls.multiplier,
        amount: pay,
        earnedFrom: cls.kind === 'bonus' && from && to ? from : null,
        earnedTo: cls.kind === 'bonus' && from && to ? to : null,
        // Dated only by its check: the bonus was earned in the period before.
        ...(cls.kind === 'bonus' && !workDate ? { datedByPay: true } : {}),
        payDate: payDateB,
        code,
        line: row.line,
      });
      continue;
    }
    if (!Number.isFinite(hours) && Number.isFinite(amount)) {
      skipped.push({ line: row.line, reason: `${code || 'Pay without hours'}: pay with no hours and a pay type the checker does not know, so it is left out. If it is a bonus or commission, name the pay type so (for example "Bonus").` });
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
    if (!Number.isFinite(rate) && hoursOnly) {
      rate = 0;
      rateMissingLines++;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      skipped.push({ line: row.line, reason: 'No hourly rate or pay amount.' });
      continue;
    }
    const payRaw = cell(c, safe.payDate);
    const payDate = payRaw ? parseDate(payRaw) : null;
    if (payRaw && !payDate) badPayDates++;
    const entry = cell(c, safe.entryId);
    const base = { employeeKey: employeeKey(id, name), employeeId: id, employeeName: name, date, payDate, code, line: row.line, ...(entry ? { entryId: entry } : {}) };
    if (hours !== 0) lines.push({ ...base, hours, rate, kind: cls.kind, multiplier: cls.multiplier });
    // An overtime pay column shows what was actually paid for the overtime hours.
    const otPay = safe.overtimePay === null ? NaN : parseMoney(cell(c, safe.overtimePay), comma);
    // An overtime pay of 0.00 is a fact (nothing paid), not a missing value.
    const otRate = Number.isFinite(otPay) && otHours > 0 && otPay >= 0 ? otPay / otHours : rate * 1.5;
    // The row's rate is the straight rate of its overtime hours (a row may be overtime only, at another job's rate).
    const known = rate > 0 ? { baseRate: rate } : {};
    if (otHours !== 0) lines.push({ ...base, hours: otHours, rate: otRate, kind: 'overtime', multiplier: 1.5, code: code || 'Overtime hours column', ...known });
    if (dtHours !== 0) lines.push({ ...base, hours: dtHours, rate: rate * 2, kind: 'overtime', multiplier: 2, code: code || 'Double-time hours column', ...known });
  }
  linkNamesToIds(lines);
  const dates = lines.map((l) => l.date).sort();
  return {
    lines,
    report: {
      rowsRead: body.length,
      linesUsed: lines.length,
      rowsUsed: new Set(lines.map((l) => l.line)).size,
      skipped,
      droppedColumns: [...drop].map((i) => header[i] || `column ${i + 1}`),
      employees: new Set(lines.map((l) => l.employeeKey)).size,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      overtimeLines: lines.filter((l) => l.kind === 'overtime').length,
      excludedLines: lines.filter((l) => l.kind === 'excluded').length,
      bonusLines: lines.filter((l) => l.kind === 'bonus').length,
      extraLines: lines.filter((l) => l.kind === 'extra').length,
      notWagesLines,
      rateMissingLines,
      dateHeader: safe.date === null ? '' : header[safe.date] ?? '',
      hoursWereTotal: hoursAreTotal,
      layout: (() => {
        const l = detectLayout(header);
        return l ? { name: l.name, confirmed: l.confirmed, note: l.note } : null;
      })(),
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
