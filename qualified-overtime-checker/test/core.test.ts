import { describe, expect, it } from 'vitest';
import { csvCell, detectSeparator, parseCsv, toCsv } from '../src/core/csv';
import { dayNumber, formatDay, isoDay, parseDate, weekday, workweekStart } from '../src/core/dates';
import { buildWeeks, computeWeek, employeesOf, round2 } from '../src/core/engine';
import {
  classifyCode,
  emptyMapping,
  guessMapping,
  importCsv,
  importRows,
  mappingProblems,
  parseHours,
  parseMoney,
  ssnColumns,
} from '../src/core/importer';
import type { TimeLine } from '../src/core/types';

function line(p: Partial<TimeLine> & { date: string; hours: number; rate: number }): TimeLine {
  return {
    employeeKey: 'id:e1',
    employeeId: 'E1',
    employeeName: 'Pat',
    kind: 'work',
    multiplier: 1,
    payDate: null,
    code: '',
    line: 2,
    ...p,
  };
}

/** Lines for a Sunday-start week from `sunday`, hours per day Mon..Sat at one rate. */
function week(sunday: string, perDay: number[], rate: number, extra: Partial<TimeLine> = {}): TimeLine[] {
  const start = dayNumber(sunday);
  return perDay.map((h, i) => line({ date: isoDay(start + 1 + i), hours: h, rate, ...extra })).filter((l) => l.hours > 0);
}

describe('csv', () => {
  it('parses quotes, doubled quotes, line breaks in quotes, CRLF and a BOM', () => {
    const t = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3');
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['1', '2', '3'],
    ]);
    expect(t.rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });
  it('detects semicolon and tab separators', () => {
    expect(detectSeparator('a;b;c\n1;2;3')).toBe(';');
    expect(detectSeparator('a\tb\tc')).toBe('\t');
    expect(detectSeparator('"a;b",c')).toBe(',');
    expect(parseCsv('a;b\n1;2').rows[1].cells).toEqual(['1', '2']);
  });
  it('handles a last row without a newline and a trailing separator', () => {
    expect(parseCsv('a,b\n1,').rows[1].cells).toEqual(['1', '']);
  });
  it('writes cells that need quoting', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell(' pad')).toBe('" pad"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(toCsv([['a', 1], ['b', undefined]])).toBe('a,1\r\nb,\r\n');
  });
});

describe('dates', () => {
  it('reads ISO, US slash, short year, month names and drops a time', () => {
    expect(parseDate('2026-11-03')).toBe('2026-11-03');
    expect(parseDate('11/3/2026')).toBe('2026-11-03');
    expect(parseDate('11/03/26')).toBe('2026-11-03');
    expect(parseDate('11-03-2026')).toBe('2026-11-03');
    expect(parseDate('2026/11/03')).toBe('2026-11-03');
    expect(parseDate('Nov 3, 2026')).toBe('2026-11-03');
    expect(parseDate('November 3 2026')).toBe('2026-11-03');
    expect(parseDate('Sept 3, 2026')).toBe('2026-09-03');
    expect(parseDate('3-Nov-2026')).toBe('2026-11-03');
    expect(parseDate('03 Nov 26')).toBe('2026-11-03');
    expect(parseDate('11/03/2026 08:00 AM')).toBe('2026-11-03');
    expect(parseDate('2026-11-03T08:00:00')).toBe('2026-11-03');
  });
  it('refuses impossible dates and words', () => {
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('13/01/2026')).toBeNull();
    expect(parseDate('Novem 3, 2026')).toBeNull();
    expect(parseDate('3-Foo-2026')).toBeNull();
    expect(parseDate('Foo 3, 2026')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate('1800-01-01')).toBeNull();
  });
  it('counts days and weekdays without time zones', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(isoDay(dayNumber('2026-12-31'))).toBe('2026-12-31');
    expect(weekday(dayNumber('2026-11-10'))).toBe(2); // a Tuesday
    expect(isoDay(workweekStart(dayNumber('2026-11-10'), 0))).toBe('2026-11-08');
    expect(isoDay(workweekStart(dayNumber('2026-11-10'), 1))).toBe('2026-11-09');
    expect(isoDay(workweekStart(dayNumber('2026-11-08'), 3))).toBe('2026-11-04');
    expect(formatDay('2026-01-05')).toBe('Jan 5, 2026');
  });
});

describe('importer', () => {
  it('parses money and hours in export formats', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5);
    expect(parseMoney('(12.00)')).toBe(-12);
    expect(parseMoney('-3')).toBe(-3);
    expect(parseMoney('.5')).toBe(0.5);
    expect(parseMoney('7.')).toBe(7);
    expect(parseMoney('12 USD')).toBe(12);
    expect(parseMoney('')).toBeNaN();
    expect(parseMoney('abc')).toBeNaN();
    expect(parseHours('8:30')).toBe(8.5);
    expect(parseHours('-1:15')).toBe(-1.25);
    expect(parseHours('8h 30m')).toBe(8.5);
    expect(parseHours('8 hrs')).toBe(8);
    expect(parseHours('45 min')).toBe(0.75);
    expect(parseHours('7.25')).toBe(7.25);
    expect(parseHours('')).toBeNaN();
  });
  it('classifies pay codes', () => {
    expect(classifyCode('Regular')).toEqual({ kind: 'work', multiplier: 1 });
    expect(classifyCode('Overtime')).toEqual({ kind: 'overtime', multiplier: 1.5 });
    expect(classifyCode('OT 1.5x')).toEqual({ kind: 'overtime', multiplier: 1.5 });
    expect(classifyCode('Double time')).toEqual({ kind: 'overtime', multiplier: 2 });
    expect(classifyCode('Holiday')).toEqual({ kind: 'excluded', multiplier: 1 });
    expect(classifyCode('Holiday worked')).toEqual({ kind: 'work', multiplier: 1 });
    expect(classifyCode('PTO')).toEqual({ kind: 'excluded', multiplier: 1 });
    expect(classifyCode('Bonus')).toEqual({ kind: 'lump' });
    expect(classifyCode('Night shift differential')).toEqual({ kind: 'lump' });
  });
  it('guesses columns from common headers', () => {
    const m = guessMapping(['Employee ID', 'Employee', 'Date', 'Pay Type', 'Hours', 'Rate', 'Amount', 'Check Date']);
    expect(m).toMatchObject({ employeeId: 0, employeeName: 1, date: 2, code: 3, hours: 4, rate: 5, amount: 6, payDate: 7 });
    const qb = guessMapping(['Activity Date', 'First Name', 'Last Name', 'Service Item', 'Duration', 'Pay rate']);
    expect(qb).toMatchObject({ date: 0, firstName: 1, lastName: 2, code: 3, hours: 4, rate: 5, employeeName: null });
    const loose = guessMapping(['Worker Name', 'Shift Start Date', 'Hours (decimal)', 'Hourly rate USD']);
    expect(loose).toMatchObject({ employeeName: 0, date: 1, hours: 2, rate: 3 });
  });
  it('names what a mapping is missing', () => {
    expect(mappingProblems(emptyMapping())).toHaveLength(4);
    expect(mappingProblems({ ...emptyMapping(), firstName: 0, lastName: 1, date: 2, hours: 3, amount: 4 })).toEqual([]);
  });
  it('drops SSN columns by header and by value, even when mapped', () => {
    const csv = 'Name,SSN,Date,Hours,Rate,Tax number\nPat,123-45-6789,2026-11-02,8,20,987-65-4321\n';
    const table = parseCsv(csv);
    expect(ssnColumns(table)).toEqual([1, 5]);
    const mapping = { ...guessMapping(table.rows[0].cells), employeeId: 1 };
    const r = importRows(table, mapping);
    expect(r.report.droppedColumns).toEqual(['SSN', 'Tax number']);
    expect(r.lines[0].employeeId).toBe('');
    expect(JSON.stringify(r.lines)).not.toContain('6789');
    expect(ssnColumns(parseCsv(''))).toEqual([]);
  });
  it('imports rows and reports the ones it cannot use with line numbers', () => {
    const csv = [
      'Employee,Date,Pay Type,Hours,Rate,Amount,Pay Date',
      'Pat,11/2/2026,Regular,8,20,,11/13/2026',
      'Pat,11/3/2026,Overtime,2,30,,11/13/2026',
      'Pat,11/4/2026,Holiday,8,20,,bad',
      'Pat,11/5/2026,Regular,8,,168,',
      ',11/5/2026,Regular,8,20,,',
      'Pat,someday,Regular,8,20,,',
      'Pat,11/6/2026,Regular,x,20,,',
      'Pat,11/6/2026,Regular,0,20,,',
      'Pat,11/6/2026,Regular,8,,,',
      'Pat,11/6/2026,Bonus,,,100,',
      'Total,,,,,,',
    ].join('\n');
    const r = importCsv(csv);
    expect(r.lines).toHaveLength(4);
    expect(r.lines[1]).toMatchObject({ kind: 'overtime', multiplier: 1.5, rate: 30 });
    expect(r.lines[2]).toMatchObject({ kind: 'excluded', payDate: null });
    expect(r.lines[3].rate).toBe(21);
    expect(r.report).toMatchObject({ rowsRead: 11, linesUsed: 4, employees: 1, overtimeLines: 1, excludedLines: 1, badPayDates: 1, firstDate: '2026-11-02', lastDate: '2026-11-05' });
    expect(r.report.skipped.map((s) => s.line)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(r.report.skipped[0].reason).toMatch(/No employee/);
    expect(r.report.skipped[5].reason).toMatch(/not used yet/);
    expect(r.report.skipped[6].reason).toMatch(/total row/);
  });
  it('keys employees by ID when there is one, by name otherwise', () => {
    const r = importCsv('ID,First,Last,Date,Hours,Rate\n7,Ann,Lee,2026-11-02,8,20\n,Bo,Ray,2026-11-02,8,20\n');
    expect(r.lines.map((l) => [l.employeeKey, l.employeeName])).toEqual([
      ['id:7', 'Ann Lee'],
      ['name:bo ray', 'Bo Ray'],
    ]);
  });
});

describe('engine', () => {
  it('a single rate: half the rate for each hour over 40', () => {
    const w = computeWeek(dayNumber('2026-11-01'), week('2026-11-01', [9, 9, 9, 9, 9], 20));
    expect(w).toMatchObject({ start: '2026-11-01', end: '2026-11-07', hours: 45, straightPay: 900, regularRate: 20, overtimeHours: 5, premium: 50, taxYear: 2026, yearFromWeekEnd: true });
    expect(w.notes).toEqual([]);
  });
  it('exactly 40 hours has no premium', () => {
    expect(computeWeek(dayNumber('2026-11-01'), week('2026-11-01', [8, 8, 8, 8, 8], 20)).premium).toBe(0);
  });
  it('two rates: the weighted average, as in 29 CFR 778.115 (35 h at $12 and 10 h at $15)', () => {
    const lines = [...week('2026-11-01', [7, 7, 7, 7, 7], 12), ...week('2026-11-01', [0, 0, 0, 0, 5, 5], 15)];
    const w = computeWeek(dayNumber('2026-11-01'), lines);
    expect(w.straightPay).toBe(570);
    expect(round2(w.regularRate)).toBe(12.67);
    expect(w.premium).toBe(31.67);
    expect(w.rates).toEqual([
      { rate: 12, hours: 35 },
      { rate: 15, hours: 10 },
    ]);
    expect(w.notes[0]).toMatch(/2 rates/);
  });
  it('overtime-coded lines count at the straight rate and their premium is compared', () => {
    const lines = [...week('2026-11-01', [8, 8, 8, 8, 8], 20), line({ date: '2026-11-07', hours: 5, rate: 30, kind: 'overtime', multiplier: 1.5 })];
    const w = computeWeek(dayNumber('2026-11-01'), lines);
    expect(w).toMatchObject({ hours: 45, straightPay: 900, premium: 50, paidPremium: 50 });
    expect(w.notes).toEqual([]);
  });
  it('daily overtime that is not over 40 a week is not qualified', () => {
    const lines = [...week('2026-11-01', [8, 8, 8, 6], 20), line({ date: '2026-11-06', hours: 2, rate: 30, kind: 'overtime', multiplier: 1.5 })];
    const w = computeWeek(dayNumber('2026-11-01'), lines);
    expect(w.premium).toBe(0);
    expect(w.paidPremium).toBe(20);
    expect(w.notes.join(' ')).toMatch(/FLSA does not require/);
  });
  it('flags overtime hours paid at straight time and a premium paid short', () => {
    const lines = [...week('2026-11-01', [8, 8, 8, 8, 8, 4], 20), line({ date: '2026-11-07', hours: 2, rate: 30, kind: 'overtime', multiplier: 1.5 })];
    const w = computeWeek(dayNumber('2026-11-01'), lines);
    expect(w.premium).toBe(60);
    expect(w.notes.join(' ')).toMatch(/Only 2 h were paid as overtime/);
    expect(w.notes.join(' ')).toMatch(/less than the FLSA premium/);
  });
  it('leaves paid time off out of hours and pay', () => {
    const lines = [...week('2026-11-01', [8, 8, 8, 8, 8], 20), line({ date: '2026-11-07', hours: 8, rate: 20, kind: 'excluded' })];
    const w = computeWeek(dayNumber('2026-11-01'), lines);
    expect(w).toMatchObject({ hours: 40, premium: 0 });
    expect(w.notes[0]).toMatch(/paid time off/);
  });
  it('a workweek split across two pay periods is one week, paid with the later check', () => {
    // Semi-monthly: Nov 1-15 paid Nov 20, Nov 16-30 paid Dec 4. The week Nov 15-21 spans both.
    const lines = [
      line({ date: '2026-11-15', hours: 8, rate: 20, payDate: '2026-11-20' }),
      ...week('2026-11-15', [8, 8, 8, 8, 8], 20, { payDate: '2026-12-04' }),
    ];
    const [ew] = buildWeeks(lines, { workweekStart: 0 });
    expect(ew.weeks).toHaveLength(1);
    expect(ew.weeks[0]).toMatchObject({ hours: 48, premium: 80, payDate: '2026-12-04', taxYear: 2026, yearFromWeekEnd: false });
  });
  it('a week across 31 December belongs to the year of its pay date', () => {
    const paid = buildWeeks(week('2026-12-27', [9, 9, 9, 9, 9], 20, { payDate: '2027-01-08' }), { workweekStart: 0 })[0].weeks[0];
    expect(paid).toMatchObject({ start: '2026-12-27', end: '2027-01-02', taxYear: 2027 });
    const twoYears = buildWeeks(
      [line({ date: '2026-12-28', hours: 45, rate: 20, payDate: '2026-12-31' }), line({ date: '2026-12-29', hours: 1, rate: 20, payDate: '2027-01-08' })],
      { workweekStart: 0 },
    )[0].weeks[0];
    expect(twoYears.taxYear).toBe(2027);
    expect(twoYears.notes.join(' ')).toMatch(/two years/);
    const unpaid = buildWeeks(week('2025-12-28', [9, 9, 9, 9, 9], 20), { workweekStart: 0 })[0].weeks[0];
    expect(unpaid).toMatchObject({ end: '2026-01-03', taxYear: 2026, yearFromWeekEnd: true });
  });
  it('the workweek start day changes which hours fall together', () => {
    // 30 h Thu-Sat and 30 h Sun-Tue: one 60 h week if weeks start Thursday, two 30 h weeks if Sunday.
    const lines = [...['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map((d) => line({ date: d, hours: 10, rate: 20 }))];
    expect(buildWeeks(lines, { workweekStart: 4 })[0].weeks.map((w) => w.premium)).toEqual([200]);
    expect(buildWeeks(lines, { workweekStart: 0 })[0].weeks.map((w) => w.premium)).toEqual([0, 0]);
  });
  it('flags negative totals and handles a week with no hours', () => {
    const w = computeWeek(dayNumber('2026-11-01'), [line({ date: '2026-11-02', hours: -2, rate: 20 })]);
    expect(w.notes.join(' ')).toMatch(/Negative/);
    expect(computeWeek(dayNumber('2026-11-01'), [line({ date: '2026-11-02', hours: 8, rate: 20, kind: 'excluded' })])).toMatchObject({ regularRate: 0, premium: 0 });
  });
  it('lists employees by name', () => {
    const lines = [line({ employeeKey: 'b', employeeName: 'Zed', date: '2026-11-02', hours: 1, rate: 1 }), line({ employeeKey: 'a', employeeName: 'Amy', date: '2026-11-02', hours: 1, rate: 1 }), line({ employeeKey: 'a', employeeName: 'Amy', date: '2026-11-03', hours: 1, rate: 1 })];
    expect(employeesOf(lines).map((e) => e.name)).toEqual(['Amy', 'Zed']);
  });
  it('rounds half cents up', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(72.605)).toBe(72.61);
    expect(round2(0)).toBe(0);
  });
});
